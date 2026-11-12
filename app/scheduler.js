/* Spelling Coach - spaced retrieval scheduler (Leitner boxes with expanding intervals) and
   session builder. Days are local day numbers (days since 1970-01-01). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SC = root.SC || {}; root.SC.scheduler = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120];
  var MASTERED_BOX = 6;
  var TROUBLE_LAPSES = 4;
  var DAY_MS = 86400000;

  function dayNumber(date) {
    var d = date || new Date();
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY_MS);
  }
  function dayToISO(n) { return new Date(n * DAY_MS).toISOString().slice(0, 10); }
  function isoToDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : null;
  }

  function fuzz(interval, rnd) {
    if (interval < 3) return interval;
    return Math.max(1, Math.round(interval * (0.9 + 0.2 * rnd)));
  }

  /* review(state, {ok, hard}, today, rnd) -> new state. Only the first attempt at a word in a
     session should be passed here; in-session relearning does not move the word between boxes. */
  function review(state, result, today, rnd) {
    if (rnd == null) rnd = Math.random();
    var isNew = !state || !state.reps;
    var s = {
      b: state ? state.b : 0, due: state ? state.due : today, reps: state ? state.reps : 0,
      lapses: state ? state.lapses : 0, ok: state ? state.ok : 0, bad: state ? state.bad : 0,
      first: state && state.first != null ? state.first : today, streak: state ? (state.streak || 0) : 0
    };
    s.reps += 1;
    s.last = today;
    if (result.ok) {
      s.ok += 1;
      s.streak += 1;
      if (isNew) s.b = result.hard ? 1 : 2;
      else if (result.hard) s.b = Math.max(1, s.b);
      else s.b = Math.min(s.b + 1, INTERVALS.length - 1);
      s.due = today + fuzz(INTERVALS[s.b], rnd);
      s.lastOk = true;
    } else {
      s.bad += 1;
      if (!isNew) s.lapses += 1;
      s.streak = 0;
      s.b = 1;
      s.due = today + 1;
      s.lastOk = false;
    }
    return s;
  }

  function status(s, today) {
    if (!s || !s.reps) return 'new';
    if (s.lapses >= TROUBLE_LAPSES && s.b < MASTERED_BOX) return 'trouble';
    if (s.b >= MASTERED_BOX) return 'mastered';
    if (s.b <= 2) return 'learning';
    return 'review';
  }

  function isDue(s, today) { return !!s && s.reps > 0 && s.due <= today; }

  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
      var x = a[i]; a[i] = a[j]; a[j] = x;
    }
    return a;
  }

  // Interleave: deal words round-robin across their units so the same pattern rarely repeats.
  function interleave(ids, unitOf, rnd) {
    var groups = {}, keys = [];
    shuffle(ids, rnd).forEach(function (id) {
      var u = unitOf(id);
      if (!groups[u]) { groups[u] = []; keys.push(u); }
      groups[u].push(id);
    });
    var out = [];
    while (out.length < ids.length) {
      keys.forEach(function (k) { if (groups[k].length) out.push(groups[k].shift()); });
    }
    return out;
  }

  function chooseKind(entry, p, mode, r) {
    var hasEx = entry.ex && entry.ex.length;
    if (mode === 'exam') return hasEx ? 'sent' : 'dict';
    if (entry.cue && hasEx) return 'sent';
    var ruleSum = entry.sum && entry.sum.length > 1 && entry.sum.some(function (x) { return x[2] && x[2] !== 'nochange'; });
    if (!p || !p.reps) {
      if (ruleSum && r < 0.4) return 'sum';
      return 'dict';
    }
    if (p.b >= 3 && hasEx && r < 0.5) return 'sent';
    if (ruleSum && r < 0.25) return 'sum';
    return 'dict';
  }

  /* buildSession(o) -> { items: [{id, kind}], lessonUnit, newIds, unitAdvance }
     o: { mode, words (id -> entry), progress, settings, today, meta, unitState, introducedToday,
          errorsById, listIds, unitId, rnd } */
  function buildSession(o) {
    var rnd = o.rnd || Math.random;
    var words = o.words, prog = o.progress || {}, today = o.today, st = o.settings || {};
    var meta = o.meta || {};
    var exists = function (id) { return !!words[id]; };
    var unitOf = function (id) {
      var e = words[id];
      if (!e) return 0;
      if (e.u && e.u.length) return e.u[0];
      var tu = meta.tagUnit || {};
      for (var k = 0; e.tags && k < e.tags.length; k++) if (tu[e.tags[k]]) return tu[e.tags[k]];
      return 0;
    };
    var cap = function (arr, n) { return arr.slice(0, n); };
    var items = [], newIds = [], lessonUnit = null, unitAdvance = null;

    function dueIds() {
      return Object.keys(prog).filter(function (id) { return exists(id) && isDue(prog[id], today); })
        .sort(function (a, b) { return (prog[a].b - prog[b].b) || (prog[a].due - prog[b].due); });
    }

    if (o.mode === 'today') {
      var due = cap(dueIds(), st.reviewCap || 80);
      var want = Math.max(0, (st.newPerDay || 10) - (o.introducedToday || 0));
      var us = o.unitState || {};
      var order = us.order && us.order.length ? us.order : Object.keys(meta.unitPools || {}).map(Number);
      var skip = st.skipStrong ? (us.strong || {}) : {};
      var curIndex = Math.max(0, order.indexOf(us.current));
      var usable = function (uid) {
        if (skip[uid] || (us.skip && us.skip[uid])) return false;
        return !(st.l1 !== 'ar' && (uid === 2 || uid === 3) && !(us.include && us.include[uid]));
      };
      var freshIn = function (uid) {
        return ((meta.unitPools[uid] || {}).core || []).filter(function (id) {
          return exists(id) && !prog[id] && newIds.indexOf(id) < 0;
        });
      };
      var lastUnit = null;
      for (var ui = curIndex; ui < order.length && newIds.length < want; ui++) {
        var uid = order[ui];
        if (!usable(uid)) continue;
        var fresh = freshIn(uid);
        if (fresh.length && lessonUnit === null && !(us.seenLesson && us.seenLesson[uid])) lessonUnit = uid;
        if (fresh.length) lastUnit = uid;
        newIds = newIds.concat(fresh.slice(0, want - newIds.length));
      }
      // The current unit becomes the first one that still has unseen words (or, if every unit is
      // used up, the unit the last new word came from).
      var nextCurrent = lastUnit;
      for (var uj = curIndex; uj < order.length; uj++) {
        if (usable(order[uj]) && freshIn(order[uj]).length) { nextCurrent = order[uj]; break; }
      }
      if (nextCurrent != null && nextCurrent !== us.current) unitAdvance = nextCurrent;
      if (newIds.length < want) {
        (meta.lists || []).forEach(function (l) {
          if (newIds.length >= want || l.group === 'Units') return;
          l.ids.forEach(function (id) {
            if (newIds.length < want && exists(id) && !prog[id] && newIds.indexOf(id) < 0) newIds.push(id);
          });
        });
      }
      var rev = interleave(due, unitOf, rnd);
      rev.forEach(function (id) { items.push({ id: id, kind: chooseKind(words[id], prog[id], 'today', rnd()) }); });
      newIds.forEach(function (id) { items.push({ id: id, kind: chooseKind(words[id], null, 'today', rnd()), isNew: true }); });
    } else if (o.mode === 'diagnostic') {
      (meta.diagnostic || []).filter(exists).forEach(function (id) { items.push({ id: id, kind: 'dict' }); });
    } else if (o.mode === 'mistakes') {
      var errs = o.errorsById || {};
      var missed = Object.keys(prog).filter(function (id) {
        return exists(id) && prog[id].bad > 0 && (prog[id].lastOk === false || prog[id].b <= 2 || prog[id].lapses > 0);
      }).sort(function (a, b) {
        var la = (errs[a] && errs[a].lastDay) || 0, lb = (errs[b] && errs[b].lastDay) || 0;
        return (lb - la) || (prog[b].lapses - prog[a].lapses);
      });
      missed = cap(missed, 20);
      var sib = [];
      missed.forEach(function (id) {
        if (sib.length >= 8) return;
        var unit = errs[id] && errs[id].unit;
        var pl = unit && meta.unitPools && meta.unitPools[unit];
        if (!pl) return;
        var cand = pl.core.concat(pl.more || []).filter(function (x) {
          return exists(x) && x !== id && missed.indexOf(x) < 0 && sib.indexOf(x) < 0 && (!prog[x] || isDue(prog[x], today) || prog[x].b <= 2);
        });
        if (cand.length) sib.push(cand[Math.floor(rnd() * Math.min(cand.length, 15))]);
      });
      interleave(missed.concat(sib), unitOf, rnd).forEach(function (id) {
        items.push({ id: id, kind: chooseKind(words[id], prog[id], 'mistakes', rnd()), sibling: sib.indexOf(id) >= 0 });
      });
    } else if (o.mode === 'list' || o.mode === 'unit' || o.mode === 'pattern') {
      var ids = (o.listIds || []).filter(exists);
      if (o.mode === 'pattern' && o.errorsById) {
        var mine = ids.filter(function (id) { return o.errorsById[id]; });
        ids = mine.concat(ids.filter(function (id) { return mine.indexOf(id) < 0; }));
      }
      var dueL = ids.filter(function (id) { return isDue(prog[id], today); });
      var unseen = ids.filter(function (id) { return !prog[id]; });
      var rest = ids.filter(function (id) { return prog[id] && !isDue(prog[id], today); })
        .sort(function (a, b) { return prog[a].b - prog[b].b; });
      var chosen = o.mode === 'pattern' ? ids.slice(0, 20) : cap(dueL.concat(unseen, rest), o.size || 20);
      chosen = o.mode === 'list' ? shuffle(chosen, rnd) : chosen;
      chosen.forEach(function (id) { items.push({ id: id, kind: chooseKind(words[id], prog[id], o.mode, rnd()), isNew: !prog[id] }); });
      if (o.mode === 'unit' && o.unitId != null) lessonUnit = o.unitId;
    } else if (o.mode === 'exam') {
      var seen = Object.keys(prog).filter(function (id) { return exists(id) && words[id].ex && words[id].ex.length; });
      var ielts = (meta.lists || []).filter(function (l) { return l.group === 'IELTS Listening'; })
        .reduce(function (acc, l) { return acc.concat(l.ids); }, []).filter(function (id) { return exists(id) && words[id].ex && words[id].ex.length; });
      var poolE = shuffle(seen, rnd).slice(0, 12).concat(shuffle(ielts, rnd).slice(0, 20));
      var uniq = [];
      poolE.forEach(function (id) { if (uniq.indexOf(id) < 0) uniq.push(id); });
      cap(shuffle(uniq, rnd), o.size || 20).forEach(function (id) { items.push({ id: id, kind: 'sent', once: true }); });
    } else if (o.mode === 'words') {
      (o.listIds || []).filter(exists).forEach(function (id) { items.push({ id: id, kind: chooseKind(words[id], prog[id], 'words', rnd()) }); });
    }
    return { items: items, lessonUnit: lessonUnit, newIds: newIds, unitAdvance: unitAdvance };
  }

  /* Order units after the placement test: the fixed scope & sequence is kept, units answered
     fully correctly are marked strong (skippable), Arabic-L1 units are included for L1 'ar'. */
  function unitOrderFromDiagnostic(results, l1) {
    var order = [];
    for (var u = 1; u <= 19; u++) {
      if ((u === 2 || u === 3) && l1 !== 'ar') continue;
      order.push(u);
    }
    var strong = {};
    Object.keys(results || {}).forEach(function (u) {
      var r = results[u];
      if (r && r[1] > 0 && r[0] === r[1]) strong[u] = true;
    });
    var first = order.filter(function (u) { return !strong[u]; })[0];
    return { order: order, strong: strong, current: first != null ? first : order[0] };
  }

  return {
    INTERVALS: INTERVALS, MASTERED_BOX: MASTERED_BOX, TROUBLE_LAPSES: TROUBLE_LAPSES,
    dayNumber: dayNumber, dayToISO: dayToISO, isoToDay: isoToDay,
    review: review, status: status, isDue: isDue, buildSession: buildSession,
    interleave: interleave, shuffle: shuffle, chooseKind: chooseKind, unitOrderFromDiagnostic: unitOrderFromDiagnostic
  };
});
