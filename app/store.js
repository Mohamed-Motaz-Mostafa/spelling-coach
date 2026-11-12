/* Spelling Coach - persistence (localStorage), backup export/import and answer recording. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SC = root.SC || {}; root.SC.store = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KEY = 'spellingCoach.v1';
  var MAX_ERRORS = 3000;
  var sched = function () { return (root.SC && root.SC.scheduler) || (typeof require === 'function' ? require('./scheduler.js') : null); };

  function defaults() {
    var today = sched().dayNumber();
    return {
      v: 1,
      created: today,
      settings: {
        standard: 'uk', l1: 'ar', newPerDay: 10, reviewCap: 80, voiceURI: '', rate: 0.9,
        accentRotation: false, examDate: '', skipStrong: true, theme: 'auto', autoPlay: true, sentenceAudio: true
      },
      progress: {},
      userWords: {},
      edits: {},
      errors: [],
      daily: {},
      units: { diagDone: false, diag: {}, order: [], strong: {}, current: 1, seenLesson: {}, skip: {}, include: {} },
      // AI-written dictations and IELTS tasks, plus practice stats per task (see app/writing.js).
      library: { passages: [], tasks: [], stats: {} },
      lastBackup: null
    };
  }

  function merge(base, saved) {
    var out = base;
    Object.keys(saved || {}).forEach(function (k) {
      if (saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = Object.assign({}, base[k], saved[k]);
      } else {
        out[k] = saved[k];
      }
    });
    return out;
  }

  var api = {
    KEY: KEY,
    state: null,
    persistent: true,
    lastError: '',
    _timer: null,

    defaults: defaults,

    load: function () {
      var saved = null;
      try {
        var raw = root.localStorage && root.localStorage.getItem(KEY);
        saved = raw ? JSON.parse(raw) : null;
        api.persistent = !!root.localStorage;
      } catch (e) {
        api.persistent = false;
        api.lastError = String(e && e.message || e);
      }
      api.state = merge(defaults(), saved);
      return api.state;
    },

    save: function () {
      if (api._timer) clearTimeout(api._timer);
      api._timer = setTimeout(api.saveNow, 300);
    },

    saveNow: function () {
      if (api._timer) { clearTimeout(api._timer); api._timer = null; }
      try {
        root.localStorage.setItem(KEY, JSON.stringify(api.state));
        api.persistent = true;
        return true;
      } catch (e) {
        api.persistent = false;
        api.lastError = String(e && e.message || e);
        return false;
      }
    },

    exportJSON: function () {
      return JSON.stringify({ app: 'spelling-coach', exported: new Date().toISOString(), state: api.state }, null, 1);
    },

    importJSON: function (text) {
      var data;
      try { data = JSON.parse(text); } catch (e) { return { ok: false, error: 'This file is not valid JSON.' }; }
      var st = data && data.app === 'spelling-coach' ? data.state : data;
      if (!st || typeof st !== 'object' || !st.progress || !st.settings) return { ok: false, error: 'This does not look like a Spelling Coach backup.' };
      api.state = merge(defaults(), st);
      api.saveNow();
      return { ok: true, words: Object.keys(api.state.progress).length };
    },

    reset: function () {
      api.state = defaults();
      api.saveNow();
    },

    /* recordAnswer(id, {ok, hard, status, typed, ms, cats:[{key, group, unit}]}, opts)
       Updates spaced-repetition progress (first attempt only), the error log and daily stats. */
    recordAnswer: function (id, res, opts) {
      opts = opts || {};
      var s = api.state, S = sched();
      var today = opts.today != null ? opts.today : S.dayNumber();
      var wasNew = !s.progress[id];
      s.progress[id] = S.review(s.progress[id], { ok: res.ok, hard: res.hard }, today, opts.rnd);
      var d = s.daily[today] || (s.daily[today] = { n: 0, ok: 0, new: 0, ms: 0 });
      d.n += 1;
      if (res.ok) d.ok += 1;
      if (wasNew && opts.countNew !== false) d.new += 1;
      d.ms += Math.min(res.ms || 0, 120000);
      if (!res.ok && res.cats && res.cats.length) {
        var c = res.cats[0];
        s.errors.push({ d: today, id: id, a: String(res.typed || '').slice(0, 40), c: c.key, g: c.group, u: c.unit,
          x: res.cats.slice(1, 3).map(function (k) { return k.key; }) });
        if (s.errors.length > MAX_ERRORS) s.errors.splice(0, s.errors.length - MAX_ERRORS);
      }
      api.save();
      return s.progress[id];
    },

    errorsById: function () {
      var out = {};
      (api.state.errors || []).forEach(function (e) {
        var o = out[e.id] || (out[e.id] = { count: 0, cats: {}, lastDay: 0, unit: null, typed: [] });
        o.count += 1;
        o.cats[e.c] = (o.cats[e.c] || 0) + 1;
        if (e.d >= o.lastDay) { o.lastDay = e.d; o.unit = e.u; o.lastCat = e.c; }
        o.typed.push(e.a);
      });
      return out;
    },

    categoryCounts: function (sinceDay) {
      var out = {};
      (api.state.errors || []).forEach(function (e) {
        if (sinceDay != null && e.d < sinceDay) return;
        out[e.c] = (out[e.c] || 0) + 1;
      });
      return out;
    },

    streak: function (today) {
      var S = sched();
      var t = today != null ? today : S.dayNumber();
      var daily = api.state.daily || {};
      var n = 0;
      var d = daily[t] && daily[t].n ? t : t - 1;
      while (daily[d] && daily[d].n > 0) { n += 1; d -= 1; }
      return n;
    }
  };
  return api;
});
