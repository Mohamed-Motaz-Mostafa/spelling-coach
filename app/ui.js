/* Spelling Coach - UI core: helpers, routing, the Today screen and the practice-session runner. */
(function (root) {
  'use strict';
  var SC = root.SC;
  var S = SC.scheduler, A = SC.analyzer, ST = SC.store, SP = SC.speech, D = SC.dict;

  // ------------------------------------------------------------------ DOM helpers
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids == null ? [] : kids).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  var toastTimer = null;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }

  var modalStack = [];
  function modal(content, opts) {
    opts = opts || {};
    var back = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' });
    var box = h('div', { class: 'modal' }, [
      h('button', { class: 'btn ghost sm close', 'aria-label': 'Close', onclick: function () { close(); }, text: 'Close' }),
      content
    ]);
    back.appendChild(box);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    $('#modal-root').appendChild(back);
    var prevFocus = document.activeElement;
    var api = { el: box, close: close };
    modalStack.push(api);
    setTimeout(function () {
      var f = box.querySelector('[autofocus], input, textarea, select, .btn.primary');
      if (f) f.focus();
    }, 30);
    function close() {
      if (!back.parentNode) return;
      back.parentNode.removeChild(back);
      modalStack.splice(modalStack.indexOf(api), 1);
      if (opts.onClose) opts.onClose();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    return api;
  }

  // ------------------------------------------------------------------ app state
  var App = {
    words: {}, all: [], lessons: root.SC_LESSONS || [], meta: root.SC_META || {}, today: S.dayNumber(),
    session: null, routes: {}, st: null
  };

  function settings() { return ST.state.settings; }

  function prepareWords() {
    var st = ST.state;
    App.words = {};
    App.all = [];
    (root.SC_WORDS || []).forEach(function (e) {
      var x = Object.assign({}, e, st.edits[e.id] || {});
      App.words[x.id] = x;
      App.all.push(x);
    });
    Object.keys(st.userWords).forEach(function (id) {
      var u = st.userWords[id];
      var x = Object.assign({ t: 4, f: 0, k: 0.5, tags: [], u: [], d: [], ex: [] }, App.words[id] || {}, u, { mine: true });
      if (!App.words[id]) App.all.push(x);
      else App.all[App.all.indexOf(App.words[id])] = x;
      App.words[id] = x;
    });
  }

  function disp(e) { return settings().standard === 'us' && e.us ? e.us : e.w; }
  function statusOf(id) { return S.status(ST.state.progress[id], App.today); }
  function unitById(id) { return App.lessons.filter(function (u) { return u.id === +id; })[0]; }

  function unitsForWord(e) {
    var tu = App.meta.tagUnit || {}, out = (e.u || []).slice();
    (e.tags || []).forEach(function (t) { if (tu[t] != null && out.indexOf(tu[t]) < 0) out.push(tu[t]); });
    return out.sort(function (a, b) { return a - b; });
  }

  // ------------------------------------------------------------------ shared renderers
  function wordSum(e, opts) {
    if (!e.sum || !e.sum.length) return null;
    opts = opts || {};
    var parts = [];
    e.sum.forEach(function (p, i) {
      if (i) parts.push(h('span', { class: 'plus', text: '+' }));
      parts.push(h('span', { class: 'm ' + p[0], title: p[0] === 'p' ? 'prefix' : p[0] === 's' ? 'suffix' : 'base', text: p[1] }));
    });
    if (!opts.question) {
      parts.push(h('span', { class: 'arrow', text: '→' }));
      parts.push(h('b', { text: disp(e) }));
    }
    var notes = [];
    e.sum.forEach(function (p) { if (p[3] && notes.indexOf(p[3]) < 0 && p[2] !== 'nochange') notes.push(p[3]); });
    return h('div', { class: 'stack' }, [
      h('div', { class: 'sum' }, parts),
      notes.length && !opts.question ? h('div', { class: 'rule-note', text: 'Rule: ' + notes.join('; ') }) : null
    ]);
  }

  function syllableNode(e) {
    if (!e.syl) return null;
    return h('span', { class: 'syl', title: 'syllables (stressed syllable in bold)' }, e.syl.split('·').map(function (s, i, arr) {
      var piece = i === e.st ? h('b', { text: s }) : document.createTextNode(s);
      return i < arr.length - 1 ? h('span', null, [piece, '·']) : piece;
    }));
  }

  function audioBtn(label, fn, extra) {
    return h('button', Object.assign({ class: 'btn sm', type: 'button', onclick: fn }, extra || {}), label);
  }

  function say(text, opts) {
    return SP.speak(text, Object.assign({ settings: settings() }, opts || {}));
  }

  function sentenceFor(e, n) {
    if (!e.ex || !e.ex.length) return '';
    return e.ex[(n || 0) % e.ex.length];
  }

  function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function blankParts(sentence, e) {
    var forms = [e.w, e.id, e.us].filter(Boolean).map(escapeRx);
    var rx = new RegExp('\\b(' + forms.join('|') + ')\\b', 'ig');
    var out = [], last = 0, m;
    while ((m = rx.exec(sentence))) {
      out.push(sentence.slice(last, m.index));
      out.push(h('span', { class: 'gap', 'aria-label': 'missing word' }));
      last = m.index + m[0].length;
    }
    out.push(sentence.slice(last));
    return out;
  }

  // Definitions sometimes contain the word itself ("to give a receipt"); hide it during questions.
  function blankText(text, e) {
    var forms = [e.w, e.id, e.us].filter(Boolean).map(escapeRx);
    return String(text || '').replace(new RegExp('\\b(' + forms.join('|') + ')\\b', 'ig'), '_____');
  }

  function catChip(c) {
    return h('span', { class: 'chip grp-' + c.group, title: { P: 'Phonological (sound)', O: 'Orthographic (letter patterns)', M: 'Morphological (meaning parts)' }[c.group] }, c.label);
  }

  function unitLink(uid, prefix) {
    var u = unitById(uid);
    if (!u) return null;
    return h('a', { class: 'chip link', href: '#lesson/' + u.id }, (prefix || 'Unit ') + u.id + ': ' + u.title);
  }

  function markedWord(word, marks, cls) {
    var set = {};
    (marks || []).forEach(function (i) { set[i] = 1; });
    return h('span', { class: cls }, word.split('').map(function (ch, i) {
      return set[i] ? h('span', { class: 'mark', text: ch }) : document.createTextNode(ch);
    }));
  }

  // ------------------------------------------------------------------ word card (also used by pages.js)
  function wordCard(e, opts) {
    opts = opts || {};
    var p = ST.state.progress[e.id];
    var stt = statusOf(e.id);
    var errs = ST.errorsById()[e.id];
    var hist = null;
    if (p) {
      hist = h('div', { class: 'note info small' }, [
        'Practised ' + p.reps + ' time' + (p.reps === 1 ? '' : 's') + ' · ' + p.ok + ' correct · ' + p.bad + ' wrong',
        p.reps ? ' · next review ' + (p.due <= App.today ? 'today' : S.dayToISO(p.due)) : ''
      ]);
    }
    var fam = (e.fam || []).map(function (f) {
      var id = f.toLowerCase();
      return App.words[id] ? h('a', { class: 'chip link', href: '#', onclick: function (ev) { ev.preventDefault(); openWord(id); } }, f) : h('span', { class: 'chip' }, f);
    });
    var roots = (e.root || []).map(function (r) {
      var info = (App.meta.roots || {})[r];
      if (!info) return null;
      var ex = (info.ex || []).filter(function (x) { return x !== e.id && x !== e.w; }).slice(0, 3);
      return h('div', null, [
        h('b', { text: SC.morph.rootLabel(r, info) }), ' = ' + info.m + ' (' + info.o + ')' + (ex.length ? ' — ' + ex.join(', ') : ''),
        info.sp ? h('div', { class: 'small muted', text: 'Spelling: ' + info.sp }) : null,
        info.sx ? h('div', { class: 'small muted', text: 'Ending: ' + info.sx }) : null
      ]);
    }).filter(Boolean);
    var units = unitsForWord(e).map(function (u) { return unitLink(u); }).filter(Boolean);
    var variant = settings().standard === 'us' ? (e.us ? 'British: ' + e.w : '') : (e.us ? 'American: ' + e.us + ' (also accepted)' : '');

    return h('div', { class: 'stack' }, [
      h('div', { class: 'row' }, [
        h('span', { class: 'word-big', text: disp(e) }),
        audioBtn('🔊 Listen', function () { say(disp(e)); }),
        h('span', { class: 'chip' }, [h('span', { class: 'dot ' + stt }), stt])
      ]),
      h('div', { class: 'row muted' }, [
        e.ipa ? h('span', { class: 'ipa', text: '/' + e.ipa + '/' }) : null,
        syllableNode(e),
        variant ? h('span', { class: 'small', text: variant }) : null,
        (e.alt || []).length ? h('span', { class: 'small', text: 'Also correct: ' + e.alt.join(', ') }) : null
      ]),
      e.cue ? h('div', { class: 'note warn' }, [h('b', { text: 'Meaning cue: ' }), e.cue]) : null,
      (e.d || []).length ? h('div', null, [
        h('h3', { text: 'Meaning' }),
        h('ol', { class: 'def' }, e.d.map(function (d, i) {
          return h('li', null, [i === 0 && e.pos ? h('span', { class: 'pos', text: e.pos }) : null, d]);
        }))
      ]) : h('p', { class: 'muted', text: 'No definition yet. Use Edit to add one.' }),
      (e.ex || []).length ? h('div', null, [
        h('h3', { text: 'Example' + (e.ex.length > 1 ? 's' : '') }),
        h('div', { class: 'stack' }, e.ex.map(function (s) {
          return h('div', { class: 'row' }, [h('span', { class: 'sentence', style: { flex: '1' }, text: s }), audioBtn('🔊', function () { say(s); }, { 'aria-label': 'Play sentence' })]);
        }))
      ]) : null,
      wordSum(e) ? h('div', null, [h('h3', { text: 'Meaning parts (word sum)' }), wordSum(e)]) : null,
      roots.length ? h('div', null, [h('h3', { text: roots.length > 1 ? 'Roots' : 'Root' })].concat(roots)) : null,
      e.tip ? h('div', { class: 'note info' }, [h('b', { text: 'Why it is spelled this way: ' }), e.tip]) : null,
      e.sil && e.sil.note && e.sil.note !== e.tip ? h('div', { class: 'note info' }, [h('b', { text: 'Silent letter: ' }), e.sil.note]) : null,
      fam.length ? h('div', null, [h('h3', { text: 'Word family' }), h('div', { class: 'word-chips' }, fam)]) : null,
      units.length ? h('div', null, [h('h3', { text: 'Spelling patterns' }), h('div', { class: 'word-chips' }, units)]) : null,
      hist,
      errs && !opts.noAttempts ? h('details', null, [
        h('summary', { class: 'small muted', text: 'Show my past attempts (' + errs.count + ')' }),
        h('p', { class: 'small muted', text: 'Seeing wrong spellings can make them stick, so these stay hidden unless you open them.' }),
        h('div', { class: 'word-chips' }, errs.typed.slice(-6).map(function (t) { return h('span', { class: 'chip bad', text: t || '(blank)' }); }))
      ]) : null,
      opts.actions === false ? null : h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: function () { closeModals(); startSession('words', { ids: [e.id], title: 'Practise: ' + disp(e) }); } }, 'Practise now'),
        SC.pages && SC.pages.editWord ? h('button', { class: 'btn', onclick: function () { SC.pages.editWord(e.id); } }, 'Edit') : null,
        e.mine && SC.pages && SC.pages.deleteWord ? h('button', { class: 'btn danger', onclick: function () { SC.pages.deleteWord(e.id); } }, 'Delete') : null
      ])
    ]);
  }

  function openWord(id) {
    var e = App.words[id];
    if (!e) { toast('Word not found.'); return; }
    modal(wordCard(e));
  }
  function closeModals() { modalStack.slice().forEach(function (m) { m.close(); }); }

  // ------------------------------------------------------------------ routing
  function route(name, fn) { App.routes[name] = fn; }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

  function render() {
    App.today = S.dayNumber();
    var hash = (location.hash || '#today').slice(1);
    var parts = hash.split('/');
    var name = parts[0] || 'today';
    if (name === 'practice' && !App.session) name = 'today';
    var fn = App.routes[name] || App.routes.today;
    if (name !== 'practice') SP.stop();
    document.querySelectorAll('#nav a').forEach(function (a) {
      var r = a.getAttribute('data-route');
      a.classList.toggle('active', r === name || (name === 'lesson' && r === 'lessons') || ((name === 'task' || name === 'dictate') && r === 'writing'));
    });
    // On a phone the tab row scrolls sideways: keep the current tab in view.
    var act = $('#nav a.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    var main = clear($('#app'));
    fn(main, parts.slice(1).map(decodeURIComponent));
    updateStatus();
    renderBanner();
  }

  function dueCount() {
    var p = ST.state.progress, n = 0;
    Object.keys(p).forEach(function (id) { if (App.words[id] && S.isDue(p[id], App.today)) n++; });
    return n;
  }

  function updateStatus() {
    var el = clear($('#status'));
    var streak = ST.streak(App.today);
    el.appendChild(h('span', null, ['Streak ', h('b', { text: String(streak) }), streak === 1 ? ' day' : ' days']));
    el.appendChild(h('span', null, ['Due ', h('b', { text: String(dueCount()) })]));
  }

  function renderBanner() {
    var b = clear($('#banner'));
    if (!ST.persistent) {
      b.appendChild(h('div', { class: 'note bad' }, 'This browser is blocking storage, so progress will be lost when you close the page. Use Settings → Export backup, or open the file in Edge or Chrome.'));
      return;
    }
    var nProg = Object.keys(ST.state.progress).length;
    var last = ST.state.lastBackup;
    var snooze = ST.state.backupSnooze;
    var since = last != null ? last : (ST.state.created != null ? ST.state.created : App.today);
    var inPractice = (location.hash || '').indexOf('#practice') === 0;
    // A recent sync is an off-device copy, so skip the backup reminder.
    var synced = SC.sync && SC.sync.configured() && SC.sync.config().lastSync && Date.now() - SC.sync.config().lastSync < 7 * 864e5;
    if (synced) return;
    if (!inPractice && nProg >= 30 && App.today - since >= 3 && (last == null || App.today - last >= 7) && snooze !== App.today) {
      b.appendChild(h('div', { class: 'note warn row between' }, [
        h('span', { text: 'Your progress lives in this browser. Save a backup file once a week (it takes one click).' }),
        h('span', { class: 'row' }, [
          h('button', { class: 'btn sm', onclick: function () { exportBackup(); renderBanner(); } }, 'Export backup'),
          h('button', { class: 'btn ghost sm', onclick: function () { ST.state.backupSnooze = App.today; ST.save(); renderBanner(); } }, 'Later')
        ])
      ]));
    }
  }

  function exportBackup() {
    var blob = new Blob([ST.exportJSON()], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: 'spelling-coach-backup-' + S.dayToISO(App.today) + '.json' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    ST.state.lastBackup = App.today;
    ST.save();
    toast('Backup file downloaded.');
  }

  // ------------------------------------------------------------------ Today
  route('today', function (main) {
    var st = ST.state;
    var prog = st.progress;
    var seen = Object.keys(prog).length;
    var mastered = Object.keys(prog).filter(function (id) { return S.status(prog[id], App.today) === 'mastered'; }).length;
    var due = dueCount();
    var newToday = (st.daily[App.today] || {}).new || 0;
    var newLeft = Math.max(0, settings().newPerDay - newToday);
    var mistakes = Object.keys(prog).filter(function (id) { return App.words[id] && prog[id].bad > 0 && (prog[id].lastOk === false || prog[id].b <= 2); }).length;
    var u = unitById(st.units.current) || unitById(1);

    if (!st.units.diagDone && !seen) {
      main.appendChild(h('div', { class: 'card hero' }, [
        h('h1', { text: 'Welcome to Spelling Coach' }),
        h('p', { text: 'This app trains the spelling you need for IELTS: in Listening and Reading a misspelled answer scores zero, and in Writing band 8 allows only occasional spelling errors.' }),
        h('p', { text: 'Start with a short placement test (40 words, about 10 minutes). You will hear each word and type it. The app uses your mistakes to find the spelling patterns you need most.' }),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn primary big', onclick: function () { startSession('diagnostic'); } }, 'Start the placement test'),
          h('button', { class: 'btn', onclick: function () { st.units.diagDone = true; var o = S.unitOrderFromDiagnostic({}, settings().l1); st.units.order = o.order; st.units.current = o.order[0]; ST.save(); render(); } }, 'Skip and start with the lessons')
        ]),
        !SP.supported ? h('div', { class: 'note warn' }, 'Your browser has no speech engine, so dictation audio will not play. Please use Microsoft Edge or Google Chrome.') : null
      ]));
      main.appendChild(scienceCard());
      return;
    }

    var minutes = Math.max(1, Math.round((Math.min(due, settings().reviewCap) + newLeft) * 0.3));
    var hero = h('div', { class: 'card hero' }, [
      h('div', { class: 'row between' }, [
        h('h1', { text: 'Today' }),
        examCountdown()
      ]),
      h('div', { class: 'grid stats' }, [
        stat(due, 'reviews due'),
        stat(newToday + ' / ' + settings().newPerDay, 'new words today'),
        stat(ST.streak(App.today), 'day streak'),
        stat(mastered + ' / ' + App.all.length, 'words mastered')
      ]),
      due || newLeft ? h('div', { class: 'stack' }, [
        h('button', { class: 'btn primary big', onclick: function () { startSession('today'); } }, ['Start today’s practice', h('span', { class: 'kbd', text: 'Enter' })]),
        h('div', { class: 'muted small', text: (due ? Math.min(due, settings().reviewCap) + ' reviews' : 'No reviews') + ' + ' + newLeft + ' new words · about ' + minutes + ' min' })
      ]) : h('div', { class: 'note ok', text: 'All done for today. Extra practice below is optional - spacing your reviews works better than cramming.' }),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', disabled: !mistakes, onclick: function () { startSession('mistakes'); } }, 'Practise my mistakes (' + mistakes + ')'),
        h('button', { class: 'btn', onclick: function () { startSession('exam'); } }, 'Exam mode: sentence dictation'),
        h('button', { class: 'btn', onclick: chooseList }, 'Practise a list…')
      ])
    ]);
    main.appendChild(hero);

    if (u) {
      var pool = (App.meta.unitPools[u.id] || {}).core || [];
      var done = pool.filter(function (id) { return prog[id]; }).length;
      main.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row between' }, [
          h('div', null, [
            h('div', { class: 'qtype', text: 'Current unit' }),
            h('h2', { text: 'Unit ' + u.id + ': ' + u.title }),
            h('p', { class: 'muted', text: u.summary })
          ]),
          h('a', { class: 'btn', href: '#lesson/' + u.id }, 'Open lesson')
        ]),
        h('div', { class: 'unit-progress', 'aria-label': done + ' of ' + pool.length + ' words started' }, [h('span', { style: { width: (pool.length ? 100 * done / pool.length : 0) + '%' } })]),
        h('div', { class: 'small muted', style: { marginTop: '6px' }, text: done + ' of ' + pool.length + ' words started. New words follow the lesson order, so each day builds one pattern at a time.' })
      ]));
    }

    if (SP.supported && !SP.voices().length) {
      main.appendChild(h('div', { class: 'note warn' }, 'No English voice found yet. If audio stays silent, see Settings → Voice.'));
    } else if (SP.supported && !SP.hasBritish()) {
      main.appendChild(h('div', { class: 'note info' }, 'Tip: no British voice is installed, so dictation uses an American voice. Open this file in Microsoft Edge for natural British voices, or add one in Windows (see Settings → Voice).'));
    }
    main.appendChild(scienceCard());
  });

  function stat(n, label) {
    return h('div', { class: 'stat' }, [h('div', { class: 'n', text: String(n) }), h('div', { class: 'l', text: label })]);
  }

  function examCountdown() {
    var d = S.isoToDay(settings().examDate);
    if (d == null) return null;
    var left = d - App.today;
    if (left < 0) return null;
    return h('span', { class: 'chip info', text: left === 0 ? 'Exam day - good luck!' : left + ' day' + (left === 1 ? '' : 's') + ' to your IELTS exam' });
  }

  function scienceCard() {
    return h('details', { class: 'card flat' }, [
      h('summary', null, h('b', { text: 'How this app teaches spelling (and why)' })),
      h('ul', null, [
        h('li', { text: 'Retrieval, not copying: you hear a word and write it from memory. Studies show this beats copying or "write it five times".' }),
        h('li', { text: 'Patterns in a fixed order: each unit teaches one reliable rule or pattern explicitly, then practises words that follow it.' }),
        h('li', { text: 'Sound + pattern + meaning: every word shows its syllables, its spelling pattern and its meaning parts (word sum).' }),
        h('li', { text: 'Spaced reviews: words come back after 1, 3, 7, 14, 30, 60 and 120 days - just before you would forget them.' }),
        h('li', { text: 'Your mistakes are diagnosed by type (sound, letter pattern or meaning part) and send you back to the right pattern - not just to the single word.' })
      ]),
      h('p', { class: 'small muted' }, ['More detail in ', h('a', { href: '#settings' }, 'Settings → About & the science'), '.'])
    ]);
  }

  function chooseList() {
    var lists = (App.meta.lists || []).slice();
    var mine = App.all.filter(function (e) { return e.mine; }).map(function (e) { return e.id; });
    if (mine.length) lists.unshift({ id: 'mine', name: 'My words', group: 'Mine', ids: mine });
    var groups = {};
    lists.forEach(function (l) { (groups[l.group] = groups[l.group] || []).push(l); });
    var sel = h('select', { id: 'list-select' }, Object.keys(groups).map(function (g) {
      return h('optgroup', { label: g }, groups[g].map(function (l) { return h('option', { value: l.id, text: l.name + ' (' + l.ids.length + ')' }); }));
    }));
    var m = modal(h('div', { class: 'stack' }, [
      h('h2', { text: 'Practise a list' }),
      h('p', { class: 'muted', text: 'Due and unseen words from the list come first (20 per round).' }),
      h('div', { class: 'field' }, [h('label', { for: 'list-select', text: 'List' }), sel]),
      h('button', { class: 'btn primary', onclick: function () {
        var l = lists.filter(function (x) { return x.id === sel.value; })[0];
        m.close();
        if (l) startSession('list', { ids: l.ids, title: l.name });
      } }, 'Start')
    ]));
  }

  // ------------------------------------------------------------------ practice session
  var MODE_TITLES = { today: 'Today’s practice', diagnostic: 'Placement test', mistakes: 'Mistake practice', exam: 'Exam mode', list: 'List practice', unit: 'Unit practice', pattern: 'Pattern practice', words: 'Practice' };

  function startSession(mode, opts) {
    opts = opts || {};
    var st = ST.state;
    var built = S.buildSession({
      mode: mode, words: App.words, progress: st.progress, settings: settings(), today: App.today, meta: App.meta,
      unitState: st.units, introducedToday: (st.daily[App.today] || {}).new || 0, errorsById: ST.errorsById(),
      listIds: opts.ids, unitId: opts.unitId, size: opts.size
    });
    if (!built.items.length) { toast('Nothing to practise here right now.'); return; }
    if (built.unitAdvance != null) { st.units.current = built.unitAdvance; ST.save(); }
    var lessonUnit = built.lessonUnit;
    if (mode === 'today' && lessonUnit != null && st.units.seenLesson[lessonUnit]) lessonUnit = null;
    App.session = {
      mode: mode, title: opts.title || MODE_TITLES[mode], items: built.items, idx: 0, phase: lessonUnit != null && mode === 'today' ? 'lesson' : 'q',
      lessonUnit: lessonUnit, first: {}, results: [], requeued: {}, tries: 0, startedAt: Date.now(), rotate: 0, fb: null
    };
    go('#practice');
  }

  route('practice', function (main) {
    var s = App.session;
    var wrap = h('div', { class: 'practice' });
    main.appendChild(wrap);
    var answered = s.idx;
    wrap.appendChild(h('div', { class: 'row between' }, [
      h('div', null, [h('b', { text: s.title }), h('span', { class: 'muted small', text: '  ' + Math.min(answered + 1, s.items.length) + ' / ' + s.items.length })]),
      h('button', { class: 'btn ghost sm', onclick: function () { if (s.phase !== 'summary' && s.results.length && !confirm('Leave this session? Your answers so far are saved.')) return; App.session = null; SP.stop(); go('#today'); } }, s.phase === 'summary' ? 'Close' : 'Exit')
    ]));
    wrap.appendChild(h('div', { class: 'progressbar' }, [h('span', { style: { width: (100 * answered / s.items.length) + '%' } })]));
    if (s.phase === 'lesson') return renderLessonIntro(wrap, s);
    if (s.phase === 'summary') return renderSummary(wrap, s);
    var item = s.items[s.idx];
    var e = App.words[item.id];
    if (!e) { nextItem(); return; }
    if (s.phase === 'q' || s.phase === 'retype') renderQuestion(wrap, s, item, e);
    else renderFeedback(wrap, s, item, e);
  });

  function renderLessonIntro(wrap, s) {
    var u = unitById(s.lessonUnit);
    wrap.appendChild(h('div', { class: 'card qcard' }, [
      h('div', { class: 'qtype', text: 'New unit - read this first' }),
      h('h2', { text: 'Unit ' + u.id + ': ' + u.title }),
      h('div', { class: 'rule-card', html: u.rule }),
      u.examples && u.examples.length ? h('div', null, u.examples.map(function (ex) {
        return h('div', { class: 'example-row' }, [h('b', { text: ex.sum }), h('span', { class: 'arrow', text: '→' }), h('span', { text: ex.word }), h('span', { class: 'muted small', text: ex.note })]);
      })) : null,
      h('div', { class: 'row', style: { marginTop: '16px' } }, [
        h('button', { class: 'btn primary', id: 'primary-action', onclick: function () {
          ST.state.units.seenLesson[u.id] = true; ST.save(); s.phase = 'q'; render();
        } }, ['Start practice', h('span', { class: 'kbd', text: 'Enter' })])
      ])
    ]));
  }

  function playItem(item, e, slow) {
    var s = App.session;
    var st = settings();
    var opts = { settings: st, rotateIndex: s ? s.rotate : 0 };
    var rate = slow ? 0.6 : st.rate;
    var word = disp(e);
    if (item.kind === 'sent' || (item.kind !== 'sum' && st.sentenceAudio)) {
      var sent = sentenceFor(e, item.exIndex || 0);
      if (item.kind === 'sent' && sent) return SP.sequence([{ text: sent, rate: rate }], opts);
      if (sent && !slow) return SP.sequence([{ text: word, rate: rate, pause: 500 }, { text: sent, rate: rate, pause: 500 }, { text: word, rate: rate }], opts);
    }
    return SP.sequence([{ text: word, rate: rate, pause: 400 }, { text: word, rate: rate }], opts);
  }

  function renderQuestion(wrap, s, item, e) {
    var retype = s.phase === 'retype';
    if (item.exIndex == null) item.exIndex = (ST.state.progress[e.id] || {}).reps || 0;
    var sentence = sentenceFor(e, item.exIndex);
    var kind = retype ? 'retype' : item.kind;
    if (kind === 'sent' && !sentence) kind = 'dict';
    var labels = {
      dict: 'Dictation - listen and write the word',
      sent: item.once ? 'IELTS style - you hear the sentence once' : 'Listen and complete the sentence',
      sum: 'Build the word - join the parts',
      retype: 'Now write it from memory'
    };
    var input = h('input', {
      type: 'text', class: 'answer', id: 'answer', 'aria-label': 'Your spelling', autocomplete: 'off', autocorrect: 'off',
      autocapitalize: 'off', spellcheck: 'false', name: 'w' + Math.random().toString(36).slice(2), inputmode: 'text'
    });
    var keys = { backspaces: 0 };
    input.addEventListener('keydown', function (ev) { if (ev.key === 'Backspace') keys.backspaces++; });
    var plays = { n: 0 };
    function play(slow) {
      if (item.once && plays.n >= 1 && !retype) { toast('In exam mode the audio plays only once.'); return; }
      plays.n++;
      playItem(item, e, slow);
      input.focus();
    }
    var chips = [];
    if (item.isNew && !retype) chips.push(h('span', { class: 'chip info', text: 'New word' }));
    if (item.relearn) chips.push(h('span', { class: 'chip warn', text: 'Second chance' }));
    if (item.sibling) chips.push(h('span', { class: 'chip', text: 'Same pattern as a word you missed' }));

    var body = [];
    if (kind === 'sum') {
      body.push(h('div', { class: 'sumq' }, [wordSum(e, { question: true }), h('span', { class: 'arrow', text: '= ?' })]));
      if (e.d && e.d[0]) body.push(h('p', { class: 'def muted' }, [e.pos ? h('span', { class: 'pos', text: e.pos }) : null, blankText(e.d[0], e)]));
    } else if (kind === 'retype') {
      body.push(h('p', { class: 'muted', text: 'The word is hidden. Picture its parts, then type it.' }));
      if (e.sum) body.push(wordSum(e, { question: true }));
    } else {
      if (kind === 'dict' && e.d && e.d[0]) body.push(h('p', { class: 'def' }, [e.pos ? h('span', { class: 'pos', text: e.pos }) : null, blankText(e.d[0], e)]));
      if (sentence) body.push(h('p', { class: 'sentence' }, blankParts(sentence, e)));
      if (kind === 'sent' && !item.once && e.d && e.d[0]) {
        var defHidden = h('p', { class: 'def muted', hidden: true }, [e.pos ? h('span', { class: 'pos', text: e.pos }) : null, blankText(e.d[0], e)]);
        body.push(h('button', { class: 'btn ghost sm', onclick: function (ev) { defHidden.hidden = false; ev.target.remove(); } }, 'Show meaning'));
        body.push(defHidden);
      }
      if (e.cue && kind === 'dict') body.push(h('p', { class: 'small muted', text: 'Meaning: ' + blankText(e.cue, e) }));
    }

    var card = h('div', { class: 'card qcard' }, [
      h('div', { class: 'row between' }, [h('div', { class: 'qtype', text: labels[kind] }), h('div', { class: 'row' }, chips)]),
      h('div', { class: 'audio-row' }, [
        audioBtn(['🔊 Play ', h('span', { class: 'kbd', text: 'Shift+Enter' })], function () { play(false); }, { id: 'play-btn' }),
        kind !== 'sent' ? audioBtn('🐢 Slow', function () { play(true); }) : null
      ]),
      h('div', { class: 'stack' }, body),
      input,
      h('div', { class: 'row', style: { marginTop: '14px' } }, [
        h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { submit(false); } }, ['Check', h('span', { class: 'kbd', text: 'Enter' })]),
        !retype ? h('button', { class: 'btn', id: 'dont-know', onclick: function () { submit(true); } }, ['I don’t know', h('span', { class: 'kbd', text: 'Esc' })]) : null
      ])
    ]);
    wrap.appendChild(card);
    var shownAt = Date.now();
    setTimeout(function () { input.focus(); }, 30);
    if (settings().autoPlay && SP.supported && !retype) setTimeout(function () { if (App.session === s && s.items[s.idx] === item) play(false); }, 250);

    function submit(dontKnow) {
      var typed = dontKnow ? '' : input.value;
      if (!dontKnow && !typed.trim()) { toast('Type the word - or press Esc if you don’t know it.'); return; }
      handleAnswer(s, item, e, typed, { ms: Date.now() - shownAt, backspaces: keys.backspaces, plays: plays.n, retype: retype });
    }
    s._submit = submit;
    s._play = function () { play(false); };
  }

  function classifyCtx() {
    var cw = {};
    App.all.forEach(function (x) { if (x.cue) cw[x.id] = x.cue; });
    return { isWord: D.isWord, confusables: cw, groups: App.meta.confusableGroups || [], l1: settings().l1, roots: App.meta.roots || {} };
  }

  function handleAnswer(s, item, e, typed, info) {
    var res = A.check(typed, e, { standard: settings().standard });
    var cls = res.ok ? null : A.classify(typed, e, classifyCtx());
    if (settings().standard === 'us' && e.us && !res.ok && cls) cls = A.classify(typed, Object.assign({}, e, { id: e.us, w: e.us, sum: null }), classifyCtx());

    if (info.retype) {
      if (res.ok) {
        toast('Good. This word will come back later.');
        nextItem();
      } else {
        s.tries++;
        s.fb = { res: res, cls: cls, typed: typed, retype: true };
        s.phase = 'fb';
        render();
      }
      return;
    }

    var first = !item.relearn && !s.first[e.id];
    if (first) {
      s.first[e.id] = true;
      var hard = res.ok && (info.ms > 25000 || info.backspaces >= 6 || info.plays >= 4);
      // Placement-test words are scheduled for review but do not use up the daily new-word quota.
      ST.recordAnswer(e.id, { ok: res.ok, hard: hard, typed: typed, ms: info.ms, cats: cls ? cls.cats : [] },
        { countNew: s.mode !== 'diagnostic' });
      if (s.mode === 'diagnostic') {
        var idx = (App.meta.diagnostic || []).indexOf(e.id);
        var unit = (App.meta.diagnosticUnits || [])[idx];
        if (unit != null) {
          var d = ST.state.units.diag[unit] || [0, 0];
          ST.state.units.diag[unit] = [d[0] + (res.ok ? 1 : 0), d[1] + 1];
        }
      }
    }
    s.results.push({ id: e.id, ok: res.ok, status: res.status, cats: cls ? cls.cats : [], first: first, typed: typed });
    if (!res.ok && s.mode !== 'diagnostic' && (s.requeued[e.id] || 0) < 2) {
      s.requeued[e.id] = (s.requeued[e.id] || 0) + 1;
      var pos = Math.min(s.items.length, s.idx + 4);
      s.items.splice(pos, 0, { id: e.id, kind: 'dict', relearn: true });
    }
    s.tries = 0;
    s.fb = { res: res, cls: cls, typed: typed };
    s.phase = 'fb';
    render();
  }

  function renderFeedback(wrap, s, item, e) {
    var fb = s.fb, res = fb.res, cls = fb.cls;
    var word = settings().standard === 'us' && e.us ? e.us : e.w;
    var card = h('div', { class: 'card qcard', 'aria-live': 'polite' });
    wrap.appendChild(card);
    var diag = s.mode === 'diagnostic';

    if (res.ok) {
      card.appendChild(h('div', { class: 'verdict ' + (res.status === 'correct' ? 'ok' : 'info') }, res.status === 'correct' ? '✓ Correct' : '✓ Accepted'));
      if (res.note) card.appendChild(h('div', { class: 'note info', text: res.note }));
      card.appendChild(h('div', { class: 'row', style: { marginTop: '10px' } }, [h('span', { class: 'word-big', text: word }), audioBtn('🔊', function () { say(word); }, { 'aria-label': 'Listen' })]));
      card.appendChild(h('div', { class: 'row muted' }, [e.ipa ? h('span', { class: 'ipa', text: '/' + e.ipa + '/' }) : null, syllableNode(e)]));
      if (!diag && wordSum(e)) card.appendChild(wordSum(e));
      if (!diag && e.d && e.d[0]) card.appendChild(h('p', { class: 'def muted' }, [e.pos ? h('span', { class: 'pos', text: e.pos }) : null, e.d[0]]));
      card.appendChild(h('div', { class: 'row', style: { marginTop: '14px' } }, [
        h('button', { class: 'btn primary', id: 'primary-action', onclick: nextItem }, ['Next', h('span', { class: 'kbd', text: 'Enter' })])
      ]));
      return;
    }

    var blank = !fb.typed.trim();
    card.appendChild(h('div', { class: 'verdict bad' }, blank ? 'Here is the word' : '✗ Not quite'));
    card.appendChild(h('div', { style: { marginTop: '10px' } }, [h('div', { class: 'small muted', text: 'Correct spelling' }),
      h('div', { class: 'row' }, [markedWord(word, cls && !blank ? cls.marks.target : [], 'word-big'), audioBtn('🔊', function () { say(word); }, { 'aria-label': 'Listen' })])]));
    if (!blank) {
      card.appendChild(h('div', null, [h('span', { class: 'small muted', text: 'You wrote  ' }), markedWord(A.normalize(fb.typed), cls ? cls.marks.typed : [], 'typed')]));
    }
    card.appendChild(h('div', { class: 'row muted' }, [e.ipa ? h('span', { class: 'ipa', text: '/' + e.ipa + '/' }) : null, syllableNode(e)]));
    if (cls && !blank && cls.cats.length) {
      card.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, cls.cats.slice(0, 3).map(catChip)));
      var whys = cls.cats.slice(0, 2).map(function (c) { return c.why; }).filter(Boolean);
      if (whys.length) card.appendChild(h('div', { class: 'why stack' }, whys.map(function (w) { return h('p', { text: w }); })));
      if (cls.realWordNote) card.appendChild(h('p', { class: 'small muted', text: cls.realWordNote }));
      if (cls.l1note) card.appendChild(h('p', { class: 'small muted', text: cls.l1note }));
    }
    if (!diag) {
      if (wordSum(e)) card.appendChild(wordSum(e));
      if (e.tip) card.appendChild(h('div', { class: 'note info', text: e.tip }));
      if (e.cue) card.appendChild(h('div', { class: 'note warn', text: 'Meaning: ' + e.cue }));
      var u = cls && cls.cats[0] && cls.cats[0].unit;
      if (u) card.appendChild(h('div', { class: 'row' }, [h('span', { class: 'small muted', text: 'Pattern to review:' }), unitLink(u)]));
    }
    var actions = h('div', { class: 'row', style: { marginTop: '16px' } });
    if (diag || s.tries >= 3) {
      actions.appendChild(h('button', { class: 'btn primary', id: 'primary-action', onclick: nextItem }, ['Next', h('span', { class: 'kbd', text: 'Enter' })]));
    } else {
      actions.appendChild(h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { s.phase = 'retype'; render(); } },
        ['Hide it and write it from memory', h('span', { class: 'kbd', text: 'Enter' })]));
    }
    card.appendChild(actions);
  }

  function nextItem() {
    var s = App.session;
    if (!s) return;
    s.idx += 1;
    s.rotate += 1;
    s.tries = 0;
    s.fb = null;
    if (s.idx >= s.items.length) {
      s.phase = 'summary';
      if (s.mode === 'diagnostic') finishDiagnostic();
      setTimeout(autoSync, 500);
    } else {
      s.phase = 'q';
    }
    render();
  }

  function finishDiagnostic() {
    var st = ST.state;
    var o = S.unitOrderFromDiagnostic(st.units.diag, settings().l1);
    st.units.diagDone = true;
    st.units.order = o.order;
    st.units.strong = o.strong;
    st.units.current = o.current;
    ST.saveNow();
  }

  function renderSummary(wrap, s) {
    var firsts = s.results.filter(function (r) { return r.first; });
    var ok = firsts.filter(function (r) { return r.ok; }).length;
    var missed = [];
    firsts.forEach(function (r) { if (!r.ok && missed.indexOf(r.id) < 0) missed.push(r.id); });
    var cats = {};
    s.results.forEach(function (r) { (r.cats || []).slice(0, 1).forEach(function (c) { cats[c.key] = cats[c.key] || { c: c, n: 0 }; cats[c.key].n++; }); });
    var mins = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
    var card = h('div', { class: 'card qcard stack' }, [
      h('h2', { text: s.mode === 'diagnostic' ? 'Placement test complete' : 'Session complete' }),
      h('div', { class: 'grid stats' }, [
        stat(firsts.length, 'words'),
        stat(firsts.length ? Math.round(100 * ok / firsts.length) + '%' : '-', 'correct first time'),
        stat(mins, mins === 1 ? 'minute' : 'minutes')
      ])
    ]);
    wrap.appendChild(card);

    if (s.mode === 'diagnostic') {
      var st = ST.state;
      var rows = App.lessons.filter(function (u) { return u.id > 0 && st.units.diag[u.id]; }).map(function (u) {
        var d = st.units.diag[u.id];
        var strong = st.units.strong[u.id];
        return h('tr', null, [
          h('td', null, unitLink(u.id)),
          h('td', { text: d[0] + ' / ' + d[1] }),
          h('td', null, h('span', { class: 'chip ' + (strong ? 'ok' : 'warn'), text: strong ? 'Strong' : 'Practise' }))
        ]);
      });
      card.appendChild(h('div', { class: 'table-wrap' }, h('table', null, [h('thead', null, h('tr', null, [h('th', { text: 'Pattern' }), h('th', { text: 'Score' }), h('th', { text: '' })])), h('tbody', null, rows)])));
      var cu = unitById(st.units.current);
      card.appendChild(h('p', null, ['You will start with ', h('b', { text: 'Unit ' + cu.id + ': ' + cu.title }), '. Units where you scored full marks are skipped in the daily plan (you can still open them in Lessons, or change this in Settings).']));
    }

    var keys = Object.keys(cats).sort(function (a, b) { return cats[b].n - cats[a].n; });
    if (keys.length) {
      card.appendChild(h('div', null, [h('h3', { text: 'Your error types this session' }),
        h('div', { class: 'row' }, keys.map(function (k) { return h('span', { class: 'chip grp-' + cats[k].c.group, text: cats[k].c.label + ' ×' + cats[k].n }); }))]));
    }
    if (missed.length) {
      card.appendChild(h('div', null, [h('h3', { text: 'Words to watch' }),
        h('div', { class: 'word-chips' }, missed.map(function (id) {
          return h('a', { class: 'chip link', href: '#', onclick: function (ev) { ev.preventDefault(); openWord(id); } }, disp(App.words[id]));
        })),
        h('p', { class: 'small muted', text: 'These come back tomorrow, then at growing intervals.' })]));
    }
    card.appendChild(h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { App.session = null; go('#today'); } }, ['Done', h('span', { class: 'kbd', text: 'Enter' })]),
      missed.length && s.mode !== 'diagnostic' ? h('button', { class: 'btn', onclick: function () { startSession('words', { ids: missed, title: 'Missed words - again' }); } }, 'Practise the missed words again') : null
    ]));
  }

  // ------------------------------------------------------------------ keyboard
  document.addEventListener('keydown', function (ev) {
    if (modalStack.length) {
      if (ev.key === 'Escape') { ev.preventDefault(); modalStack[modalStack.length - 1].close(); }
      return;
    }
    var hash = (location.hash || '#today').slice(1);
    var s = App.session;
    if (hash === 'practice' && s) {
      if (ev.key === 'Enter' && ev.shiftKey) { ev.preventDefault(); if (s._play && (s.phase === 'q' || s.phase === 'retype')) s._play(); return; }
      if (ev.key === 'Enter' && !ev.altKey && !ev.ctrlKey) {
        ev.preventDefault();
        if ((s.phase === 'q' || s.phase === 'retype') && s._submit) s._submit(false);
        else { var b = $('#primary-action'); if (b) b.click(); }
        return;
      }
      if (ev.key === 'Escape' && s.phase === 'q' && s._submit) { ev.preventDefault(); s._submit(true); }
      return;
    }
    if (hash === 'today' || hash === '') {
      var tag = (ev.target && ev.target.tagName) || '';
      if (ev.key === 'Enter' && !/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(tag)) {
        var st = ST.state;
        if (!st.units.diagDone && !Object.keys(st.progress).length) startSession('diagnostic');
        else startSession('today');
      }
    }
  });

  // ------------------------------------------------------------------ start
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings().theme || 'auto');
  }

  // ------------------------------------------------------------------ sync between devices
  var visTimer = null, syncErrorShown = '';
  function inSession() { return !!(App.session && App.session.phase !== 'summary'); }

  // manual: show the result even when nothing changed. Merged changes re-render only outside a session.
  function syncNow(manual) {
    var SY = SC.sync;
    if (!SY || !SY.configured()) return Promise.resolve(null);
    if (manual) toast('Syncing…', 8000);
    return SY.now().then(function (res) {
      if (res.ok) {
        syncErrorShown = '';
        if (res.changed) { prepareWords(); applyTheme(); }
        if (manual) toast(res.changed ? 'Synced - progress from your other device was added.' : 'Synced - everything is up to date.');
        else if (res.changed) toast('Synced with your other device.');
        if ((res.changed || manual) && !inSession()) render();
      } else if (manual || (!res.offline && res.error !== syncErrorShown)) {
        syncErrorShown = res.error;
        toast('Sync failed: ' + res.error, 6000);
      }
      return res;
    });
  }
  function autoSync() { return syncNow(false); }

  function start() {
    ST.load();
    App.st = ST.state;
    applyTheme();
    prepareWords();
    window.addEventListener('hashchange', render);
    window.addEventListener('beforeunload', function () { ST.saveNow(); });
    SP.onVoices(function () { if ((location.hash || '#today') === '#today' || location.hash === '') { /* refresh voice notes */ if (!App.session) render(); } });
    render();
    autoSync();
    document.addEventListener('visibilitychange', function () {
      // Leaving the app (switching apps on a phone) pushes the latest answers; coming back pulls.
      clearTimeout(visTimer);
      visTimer = setTimeout(autoSync, document.visibilityState === 'hidden' ? 300 : 1000);
    });
    // The big dictionary loads in the background (real-word detection + adding words offline).
    setTimeout(function () { D.loadLexicon(); }, 600);
  }

  SC.ui = {
    start: start, App: App, h: h, $: $, clear: clear, toast: toast, modal: modal, go: go, render: render, route: route,
    startSession: startSession, openWord: openWord, wordCard: wordCard, wordSum: wordSum, syllableNode: syllableNode,
    say: say, disp: disp, settings: settings, statusOf: statusOf, unitById: unitById, unitLink: unitLink, catChip: catChip,
    prepareWords: prepareWords, exportBackup: exportBackup, syncNow: syncNow, applyTheme: applyTheme, unitsForWord: unitsForWord,
    closeModals: closeModals, stat: stat, dueCount: dueCount, audioBtn: audioBtn, classifyCtx: classifyCtx
  };
})(window);
