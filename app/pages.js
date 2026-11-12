/* Spelling Coach - pages: Lessons, Words (search, word cards, add/edit), Mistakes and Settings. */
(function (root) {
  'use strict';
  var SC = root.SC, U = SC.ui, h = U.h, App = U.App;
  var S = SC.scheduler, ST = SC.store, SP = SC.speech, D = SC.dict, A = SC.analyzer;

  // ------------------------------------------------------------------ Lessons
  U.route('lessons', function (main) {
    var st = ST.state;
    main.appendChild(h('h1', { text: 'Lessons' }));
    main.appendChild(h('p', { class: 'muted', text: 'Each unit teaches one reliable spelling pattern, explicitly, before you practise it. The daily plan follows this order; your current unit is highlighted.' }));
    var group = null;
    var list = h('div', { class: 'unit-list' });
    App.lessons.forEach(function (u) {
      if (u.group !== group) {
        group = u.group;
        list.appendChild(h('div', { class: 'group-title', text: group }));
      }
      var pool = (App.meta.unitPools[u.id] || {}).core || [];
      var done = pool.filter(function (id) { return st.progress[id]; }).length;
      var d = st.units.diag[u.id];
      var badges = [];
      if (u.l1 === 'ar') badges.push(h('span', { class: 'chip info', text: 'Arabic speakers' }));
      if (d) badges.push(h('span', { class: 'chip ' + (st.units.strong[u.id] ? 'ok' : 'warn'), text: 'Test ' + d[0] + '/' + d[1] }));
      if (st.units.skip[u.id]) badges.push(h('span', { class: 'chip', text: 'Skipped in daily plan' }));
      list.appendChild(h('a', { class: 'unit-item' + (st.units.current === u.id ? ' current' : ''), href: '#lesson/' + u.id }, [
        h('span', { class: 'unit-num', text: String(u.id) }),
        h('span', null, [h('b', { text: u.title }), h('div', { class: 'small muted', text: u.summary }), badges.length ? h('div', { class: 'row', style: { marginTop: '4px' } }, badges) : null]),
        h('span', { class: 'small muted', text: u.id ? done + '/' + pool.length : '' })
      ]));
    });
    main.appendChild(list);
  });

  U.route('lesson', function (main, args) {
    var u = U.unitById(args[0]);
    if (!u) { U.go('#lessons'); return; }
    var st = ST.state;
    var pools = App.meta.unitPools[u.id] || { core: [], more: [] };
    main.appendChild(h('a', { href: '#lessons', class: 'btn ghost sm' }, '← All lessons'));
    var card = h('div', { class: 'card', style: { marginTop: '10px' } }, [
      h('div', { class: 'qtype', text: u.group + (u.l1 === 'ar' ? ' · focus for Arabic speakers' : '') }),
      h('h1', { text: 'Unit ' + u.id + ': ' + u.title }),
      h('p', { class: 'muted', text: u.summary }),
      h('div', { class: 'rule-card', html: u.rule })
    ]);
    main.appendChild(card);
    if (u.examples && u.examples.length) {
      main.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Worked examples' })].concat(u.examples.map(function (ex) {
        return h('div', { class: 'example-row' }, [
          h('b', { text: ex.sum }), h('span', { class: 'arrow', text: '→' }),
          h('span', { class: 'word-big', style: { fontSize: '1.3rem' }, text: ex.word }),
          h('button', { class: 'btn sm', onclick: function () { U.say(ex.word); } }, '🔊'),
          h('span', { class: 'muted small', text: ex.note })
        ]);
      }))));
    }
    if (u.exceptions && u.exceptions.length) {
      main.appendChild(h('div', { class: 'card' }, [h('h2', { text: 'Exceptions worth knowing' }), h('ul', null, u.exceptions.map(function (x) { return h('li', { text: x }); }))]));
    }
    if (u.id === 0) {
      main.appendChild(h('div', { class: 'card row' }, [
        h('button', { class: 'btn primary', onclick: function () { st.units.diag = {}; U.startSession('diagnostic'); } }, st.units.diagDone ? 'Retake the placement test' : 'Start the placement test')
      ]));
      return;
    }
    var chips = pools.core.map(function (id) {
      var e = App.words[id];
      return h('a', { class: 'chip link', href: '#', onclick: function (ev) { ev.preventDefault(); U.openWord(id); } }, [h('span', { class: 'dot ' + U.statusOf(id) }), U.disp(e)]);
    });
    main.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Words in this unit (' + pools.core.length + ')' }),
      h('div', { class: 'word-chips' }, chips),
      pools.more.length ? h('p', { class: 'small muted', style: { marginTop: '10px' }, text: '+ ' + pools.more.length + ' more words in the database follow this pattern; they appear in unit and pattern practice.' }) : null,
      h('div', { class: 'row', style: { marginTop: '14px' } }, [
        h('button', { class: 'btn primary', onclick: function () { U.startSession('unit', { ids: pools.core.concat(pools.more), unitId: u.id, title: 'Unit ' + u.id + ': ' + u.title }); } }, 'Practise this unit'),
        st.units.current !== u.id ? h('button', { class: 'btn', onclick: function () { st.units.current = u.id; delete st.units.skip[u.id]; ST.save(); U.toast('Unit ' + u.id + ' is now your current unit.'); U.render(); } }, 'Make this my current unit') : h('span', { class: 'chip info', text: 'Current unit' }),
        h('button', { class: 'btn ghost', onclick: function () {
          if (st.units.skip[u.id]) delete st.units.skip[u.id]; else st.units.skip[u.id] = true;
          if (st.units.strong[u.id] && !st.units.skip[u.id]) { delete st.units.strong[u.id]; }
          if ((u.id === 2 || u.id === 3) && !st.units.skip[u.id]) st.units.include[u.id] = true;
          ST.save(); U.render();
        } }, st.units.skip[u.id] || st.units.strong[u.id] && st.settings.skipStrong ? 'Include in daily plan' : 'Skip in daily plan')
      ])
    ]));
  });

  // ------------------------------------------------------------------ Words
  var wordsView = { q: '', list: 'all', status: 'all', limit: 150 };

  U.route('words', function (main) {
    var lists = (App.meta.lists || []);
    main.appendChild(h('div', { class: 'row between' }, [
      h('h1', { text: 'Words (' + App.all.length + ')' }),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: function () { addWord(); } }, '+ Add a word'),
        h('button', { class: 'btn', onclick: function () { bulkAdd(); } }, 'Add many')
      ])
    ]));
    var q = h('input', { type: 'search', placeholder: 'Search words or meanings…', value: wordsView.q, 'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false' });
    var listSel = h('select', { 'aria-label': 'List' }, [h('option', { value: 'all', text: 'All lists' }), h('option', { value: 'mine', text: 'My words' })].concat(
      lists.map(function (l) { return h('option', { value: l.id, text: l.name }); })));
    listSel.value = wordsView.list;
    var statusSel = h('select', { 'aria-label': 'Status' }, ['all', 'new', 'learning', 'review', 'mastered', 'trouble'].map(function (s) {
      return h('option', { value: s, text: s === 'all' ? 'Any status' : s.charAt(0).toUpperCase() + s.slice(1) });
    }));
    statusSel.value = wordsView.status;
    main.appendChild(h('div', { class: 'card flat' }, h('div', { class: 'filters' }, [q, listSel, statusSel])));
    var results = h('div', { class: 'card', style: { padding: '0' } });
    main.appendChild(results);

    function refresh() {
      wordsView.q = q.value.trim().toLowerCase();
      wordsView.list = listSel.value;
      wordsView.status = statusSel.value;
      var pool = App.all;
      if (wordsView.list === 'mine') pool = pool.filter(function (e) { return e.mine; });
      else if (wordsView.list !== 'all') {
        var l = lists.filter(function (x) { return x.id === wordsView.list; })[0];
        var set = {};
        (l ? l.ids : []).forEach(function (id) { set[id] = 1; });
        pool = pool.filter(function (e) { return set[e.id]; });
      }
      if (wordsView.status !== 'all') pool = pool.filter(function (e) { return U.statusOf(e.id) === wordsView.status; });
      var qq = wordsView.q;
      if (qq) {
        var starts = [], contains = [], inDef = [];
        pool.forEach(function (e) {
          var w = e.id, us = (e.us || '');
          if (w.indexOf(qq) === 0 || us.indexOf(qq) === 0) starts.push(e);
          else if (w.indexOf(qq) >= 0 || us.indexOf(qq) >= 0) contains.push(e);
          else if (qq.length >= 3 && (e.d || []).join(' ').toLowerCase().indexOf(qq) >= 0) inDef.push(e);
        });
        pool = starts.concat(contains, inDef);
      } else {
        pool = pool.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
      }
      U.clear(results);
      if (!pool.length) {
        results.appendChild(h('div', { class: 'stack', style: { padding: '20px' } }, [
          h('p', { class: 'muted', text: 'No words found.' }),
          qq ? h('button', { class: 'btn primary', onclick: function () { addWord(qq); } }, 'Add "' + qq + '" to my words') : null
        ]));
        return;
      }
      pool.slice(0, wordsView.limit).forEach(function (e) {
        results.appendChild(h('div', { class: 'word-row', tabindex: '0', role: 'button', onclick: function () { U.openWord(e.id); },
          onkeydown: function (ev) { if (ev.key === 'Enter') U.openWord(e.id); } }, [
          h('span', { class: 'dot ' + U.statusOf(e.id), title: U.statusOf(e.id) }),
          h('span', { class: 'w' }, [U.disp(e), e.mine ? h('span', { class: 'chip', style: { marginLeft: '6px' }, text: 'mine' }) : null]),
          h('span', { class: 'd', text: (e.pos ? e.pos + ' · ' : '') + ((e.d || [])[0] || '') })
        ]));
      });
      if (pool.length > wordsView.limit) {
        results.appendChild(h('div', { style: { padding: '12px' } }, h('button', { class: 'btn', onclick: function () { wordsView.limit += 300; refresh(); } }, 'Show more (' + (pool.length - wordsView.limit) + ' left)')));
      }
    }
    var t = null;
    q.addEventListener('input', function () { clearTimeout(t); wordsView.limit = 150; t = setTimeout(refresh, 120); });
    listSel.addEventListener('change', function () { wordsView.limit = 150; refresh(); });
    statusSel.addEventListener('change', function () { wordsView.limit = 150; refresh(); });
    refresh();
    setTimeout(function () { q.focus(); }, 30);
  });

  U.route('word', function (main, args) {
    U.go('#words');
    setTimeout(function () { U.openWord((args[0] || '').toLowerCase()); }, 50);
  });

  function field(label, input, hint) {
    return h('div', { class: 'field' }, [h('label', null, [label, input]), hint ? h('div', { class: 'hint', text: hint }) : null]);
  }

  function lines(text) { return String(text || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean); }

  function addWord(prefill) {
    var w = h('input', { type: 'text', value: prefill || '', autocomplete: 'off', spellcheck: 'false', autofocus: true });
    var us = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    var pos = h('input', { type: 'text', autocomplete: 'off' });
    var def = h('textarea');
    var ex = h('textarea');
    var status = h('div', { class: 'small muted' });
    var preview = h('div');
    var looked = null;

    function analyse() {
      var word = w.value.trim();
      U.clear(preview);
      if (!word) return null;
      var an = D.analyse(word);
      var tmp = { w: word, id: word.toLowerCase(), sum: an.sum };
      var sumNode = U.wordSum(tmp);
      var units = U.unitsForWord({ tags: an.tags }).map(function (u) { return U.unitLink(u); }).filter(Boolean);
      if (sumNode || units.length) {
        preview.appendChild(h('div', { class: 'note info stack' }, [
          h('b', { text: 'Automatic analysis' }), sumNode, units.length ? h('div', { class: 'word-chips' }, units) : null
        ]));
      }
      return an;
    }

    function lookup() {
      var word = w.value.trim();
      if (!word) return;
      var id = word.toLowerCase();
      if (App.words[id]) {
        status.textContent = '"' + word + '" is already in the database.';
        status.appendChild(h('button', { class: 'btn ghost sm', onclick: function () { m.close(); U.openWord(id); } }, 'Open it'));
        return;
      }
      status.textContent = 'Looking up…';
      D.lookup(word).then(function (r) {
        looked = r;
        if (!r) { status.textContent = 'No definition found (offline dictionary and Wiktionary). You can type your own.'; analyse(); return; }
        if (!def.value) def.value = (r.d || []).join('\n');
        if (!ex.value) ex.value = (r.ex || []).join('\n');
        if (!pos.value) pos.value = r.pos || '';
        status.textContent = 'Filled in from ' + r.source + '. Check and edit before saving.';
        analyse();
      });
    }

    var m = U.modal(h('div', { class: 'stack' }, [
      h('h2', { text: 'Add a word' }),
      h('p', { class: 'muted small', text: 'Type the word with its correct British spelling. The app looks up a definition and an example (offline dictionary first, then Wiktionary when you are online) and analyses its spelling pattern.' }),
      h('div', { class: 'row' }, [h('div', { style: { flex: '1' } }, field('Word ', w)), h('button', { class: 'btn', onclick: lookup }, 'Look up')]),
      status,
      field('Part of speech ', pos),
      field('Definition ', def, 'One per line.'),
      field('Example sentence ', ex, 'One per line. A sentence makes dictation practice much better.'),
      field('American spelling (optional) ', us, 'Only if it differs, e.g. color for colour.'),
      preview,
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: function () {
          var word = w.value.trim();
          if (!/^[A-Za-z][A-Za-z' -]*$/.test(word)) { U.toast('Please enter a single English word (letters only).'); return; }
          var id = word.toLowerCase();
          if (App.words[id] && !App.words[id].mine) { U.toast('That word is already in the database.'); return; }
          var an = analyse() || {};
          ST.state.userWords[id] = {
            id: id, w: word, us: us.value.trim().toLowerCase() || undefined, pos: pos.value.trim(), d: lines(def.value), ex: lines(ex.value),
            sum: an.sum || undefined, tags: an.tags || [], root: an.root, added: App.today
          };
          ST.save();
          U.prepareWords();
          m.close();
          U.toast('"' + word + '" added to My words.');
          U.render();
        } }, 'Save word')
      ])
    ]));
    w.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); lookup(); } });
    if (prefill) lookup();
  }

  function bulkAdd() {
    var ta = h('textarea', { rows: 8, placeholder: 'One word per line, e.g.\nconscientious\nubiquitous', spellcheck: 'false' });
    var prog = h('div', { class: 'small muted' });
    var btn;
    var m = U.modal(h('div', { class: 'stack' }, [
      h('h2', { text: 'Add many words' }),
      h('p', { class: 'muted small', text: 'Paste a list (for example, words you got wrong in a practice test). Definitions and examples are looked up automatically; you can edit any word later.' }),
      ta, prog,
      btn = h('button', { class: 'btn primary', onclick: function () {
        var ws = lines(ta.value).filter(function (x) { return /^[A-Za-z][A-Za-z' -]*$/.test(x); });
        var todo = ws.filter(function (x) { return !App.words[x.toLowerCase()]; });
        if (!todo.length) { prog.textContent = ws.length ? 'All of these words are already in the database.' : 'No words found.'; return; }
        btn.disabled = true;
        var i = 0, added = 0;
        (function next() {
          if (i >= todo.length) {
            ST.save(); U.prepareWords();
            prog.textContent = 'Added ' + added + ' word' + (added === 1 ? '' : 's') + ' to My words.' + (ws.length > todo.length ? ' ' + (ws.length - todo.length) + ' were already in the database.' : '');
            btn.disabled = false;
            U.render();
            return;
          }
          var word = todo[i++];
          prog.textContent = 'Looking up ' + word + ' (' + i + '/' + todo.length + ')…';
          D.lookup(word).then(function (r) {
            var an = D.analyse(word);
            var id = word.toLowerCase();
            ST.state.userWords[id] = { id: id, w: word, pos: r ? r.pos : '', d: r ? r.d : [], ex: r ? r.ex : [], sum: an.sum || undefined, tags: an.tags, root: an.root, added: App.today };
            added++;
            next();
          });
        })();
      } }, 'Add all')
    ]));
    return m;
  }

  function editWord(id) {
    var e = App.words[id];
    if (!e) return;
    var def = h('textarea', { rows: 3 });
    def.value = (e.d || []).join('\n');
    var ex = h('textarea', { rows: 3 });
    ex.value = (e.ex || []).join('\n');
    var tip = h('textarea', { rows: 2 });
    tip.value = e.tip || '';
    var pos = h('input', { type: 'text', value: e.pos || '' });
    U.closeModals();
    var m = U.modal(h('div', { class: 'stack' }, [
      h('h2', { text: 'Edit: ' + U.disp(e) }),
      field('Part of speech ', pos),
      field('Definitions ', def, 'One per line.'),
      field('Example sentences ', ex, 'One per line. Dictation uses these sentences.'),
      field('Spelling note ', tip, 'Your own explanation or memory aid.'),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: function () {
          var patch = { pos: pos.value.trim(), d: lines(def.value), ex: lines(ex.value), tip: tip.value.trim() || undefined };
          if (e.mine) Object.assign(ST.state.userWords[id], patch);
          else ST.state.edits[id] = patch;
          ST.save(); U.prepareWords(); m.close(); U.toast('Saved.'); U.openWord(id);
        } }, 'Save'),
        !e.mine && ST.state.edits[id] ? h('button', { class: 'btn ghost', onclick: function () {
          delete ST.state.edits[id]; ST.save(); U.prepareWords(); m.close(); U.toast('Restored the original entry.'); U.openWord(id);
        } }, 'Restore original') : null
      ])
    ]));
  }

  function deleteWord(id) {
    var e = App.words[id];
    if (!e || !e.mine) return;
    if (!confirm('Delete "' + U.disp(e) + '" and its practice history?')) return;
    delete ST.state.userWords[id];
    delete ST.state.progress[id];
    ST.save();
    U.prepareWords();
    U.closeModals();
    U.toast('Deleted.');
    U.render();
  }

  // ------------------------------------------------------------------ Mistakes
  var mistakesView = { range: 30 };

  U.route('mistakes', function (main) {
    var st = ST.state;
    var since = mistakesView.range ? App.today - mistakesView.range + 1 : null;
    var counts = ST.categoryCounts(since);
    var byId = ST.errorsById();
    main.appendChild(h('div', { class: 'row between' }, [
      h('h1', { text: 'My mistakes' }),
      h('div', { class: 'row' }, [7, 30, 0].map(function (r) {
        return h('button', { class: 'btn sm' + (mistakesView.range === r ? ' primary' : ''), onclick: function () { mistakesView.range = r; U.render(); } }, r ? 'Last ' + r + ' days' : 'All time');
      }))
    ]));
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    if (!keys.length) {
      main.appendChild(h('div', { class: 'card' }, [
        h('p', { text: Object.keys(byId).length ? 'No mistakes in this period - well done.' : 'No mistakes recorded yet. Every time you misspell a word, the app records what kind of mistake it was, so this page shows which patterns to work on.' })
      ]));
    } else {
      var max = counts[keys[0]];
      main.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Error profile' }),
        h('p', { class: 'small muted', text: 'Each mistake is classified the way spelling researchers do: is the problem the sound, the letter pattern, or the meaning parts of the word?' }),
        h('div', { class: 'legend' }, [
          h('span', null, [h('i', { style: { background: 'var(--grp-P)' } }), 'Sound (phonological)']),
          h('span', null, [h('i', { style: { background: 'var(--grp-O)' } }), 'Letter patterns (orthographic)']),
          h('span', null, [h('i', { style: { background: 'var(--grp-M)' } }), 'Meaning parts (morphological)'])
        ]),
        h('div', { class: 'bars', style: { marginTop: '12px' } }, keys.map(function (k) {
          var c = A.CATS[k] || { label: k, group: 'P' };
          return h('div', { class: 'bar' }, [
            h('span', { text: c.label }),
            h('div', { class: 'track' }, h('div', { class: 'fill grp-' + c.group, style: { width: Math.max(4, 100 * counts[k] / max) + '%' } })),
            h('b', { text: String(counts[k]) })
          ]);
        }))
      ]));

      var weak = keys.slice(0, 3);
      main.appendChild(h('div', { class: 'card' }, [
        h('h2', { text: 'Patterns to work on' }),
        h('p', { class: 'small muted', text: 'Practising the pattern - not just the single missed word - is what builds lasting spelling. Each round mixes your missed words with other words that follow the same pattern.' }),
        h('div', { class: 'stack' }, weak.map(function (k) {
          var c = A.CATS[k] || { label: k, group: 'P' };
          var missedIds = Object.keys(byId).filter(function (id) { return byId[id].cats[k] && App.words[id]; });
          var unitIds = {};
          (st.errors || []).forEach(function (er) { if (er.c === k && er.u) unitIds[er.u] = (unitIds[er.u] || 0) + 1; });
          var unit = Object.keys(unitIds).sort(function (a, b) { return unitIds[b] - unitIds[a]; })[0] || c.unit;
          var pool = unit && App.meta.unitPools[unit] ? App.meta.unitPools[unit].core.concat(App.meta.unitPools[unit].more) : [];
          return h('div', { class: 'row between', style: { borderTop: '1px solid var(--border)', paddingTop: '10px' } }, [
            h('div', null, [U.catChip(c), ' ', h('span', { class: 'muted small', text: counts[k] + ' mistake' + (counts[k] === 1 ? '' : 's') }), unit ? h('div', { style: { marginTop: '6px' } }, U.unitLink(+unit, 'Lesson: Unit ')) : null]),
            h('button', { class: 'btn primary', onclick: function () {
              U.startSession('pattern', { ids: missedIds.concat(pool.filter(function (x) { return missedIds.indexOf(x) < 0; })), title: 'Pattern: ' + c.label });
            } }, 'Practise this pattern')
          ]);
        }))
      ]));
    }

    var ids = Object.keys(byId).filter(function (id) { return App.words[id]; }).sort(function (a, b) { return byId[b].lastDay - byId[a].lastDay || byId[b].count - byId[a].count; });
    if (ids.length) {
      var rows = ids.slice(0, 200).map(function (id) {
        var e = App.words[id], p = st.progress[id] || {}, er = byId[id];
        var c = A.CATS[er.lastCat] || { label: er.lastCat || '-', group: 'P' };
        return h('tr', null, [
          h('td', null, h('a', { href: '#', onclick: function (ev) { ev.preventDefault(); U.openWord(id); } }, U.disp(e))),
          h('td', { text: String(er.count) }),
          h('td', null, U.catChip(c)),
          h('td', { class: 'small', text: S.dayToISO(er.lastDay) }),
          h('td', { class: 'small', text: p.due == null ? '-' : (p.due <= App.today ? 'today' : S.dayToISO(p.due)) }),
          h('td', null, h('span', { class: 'chip' }, [h('span', { class: 'dot ' + U.statusOf(id) }), U.statusOf(id)]))
        ]);
      });
      main.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'row between' }, [
          h('h2', { text: 'Mistake log (' + ids.length + ' words)' }),
          h('div', { class: 'row' }, [
            h('button', { class: 'btn primary', onclick: function () { U.startSession('mistakes'); } }, 'Practise my mistakes'),
            h('a', { class: 'btn', href: '#writing' }, 'Dictation from my mistakes')
          ])
        ]),
        h('div', { class: 'table-wrap' }, h('table', null, [
          h('thead', null, h('tr', null, ['Word', 'Times wrong', 'Last mistake type', 'Last mistake', 'Next review', 'Status'].map(function (t) { return h('th', { text: t }); }))),
          h('tbody', null, rows)
        ])),
        h('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'Your misspellings are kept but hidden by default (open a word to see them): research suggests that looking at wrong spellings can make them stick.' })
      ]));
    }
  });

  // ------------------------------------------------------------------ Settings
  U.route('settings', function (main) {
    var st = ST.state, set = st.settings;
    function save(rerender) { ST.save(); if (rerender) U.render(); }
    main.appendChild(h('h1', { text: 'Settings' }));

    var standard = h('select', null, [h('option', { value: 'uk', text: 'British (American accepted, but flagged)' }), h('option', { value: 'us', text: 'American (British accepted, but flagged)' })]);
    standard.value = set.standard;
    standard.onchange = function () { set.standard = standard.value; save(); };
    var l1 = h('select', null, [h('option', { value: 'ar', text: 'Arabic' }), h('option', { value: 'other', text: 'Another language' })]);
    l1.value = set.l1;
    l1.onchange = function () { set.l1 = l1.value; var o = S.unitOrderFromDiagnostic(st.units.diag, set.l1); st.units.order = o.order; save(); };
    var npd = h('input', { type: 'range', min: '5', max: '40', step: '1', value: String(set.newPerDay) });
    var npdOut = h('b', { text: String(set.newPerDay) });
    npd.oninput = function () { set.newPerDay = +npd.value; npdOut.textContent = npd.value; save(); paceNote(); };
    var cap = h('input', { type: 'range', min: '20', max: '200', step: '10', value: String(set.reviewCap) });
    var capOut = h('b', { text: String(set.reviewCap) });
    cap.oninput = function () { set.reviewCap = +cap.value; capOut.textContent = cap.value; save(); };
    var skip = h('input', { type: 'checkbox' });
    skip.checked = !!set.skipStrong;
    skip.onchange = function () { set.skipStrong = skip.checked; save(); };
    var exam = h('input', { type: 'date', value: set.examDate || '' });
    var pace = h('div', { class: 'hint' });
    function paceNote() {
      var d = S.isoToDay(exam.value);
      if (d == null || d <= App.today) { pace.textContent = ''; return; }
      var left = d - App.today;
      var core = 0;
      Object.keys(App.meta.unitPools || {}).forEach(function (u) { core += App.meta.unitPools[u].core.length; });
      var seen = Object.keys(st.progress).length;
      var need = Math.max(0, core - seen);
      pace.textContent = left + ' days left. To meet all ' + core + ' lesson words before the exam you need about ' + Math.ceil(need / left) + ' new words a day (current setting: ' + set.newPerDay + ').';
    }
    exam.onchange = function () { set.examDate = exam.value; save(); paceNote(); };
    paceNote();
    var theme = h('select', null, [h('option', { value: 'auto', text: 'Match my system' }), h('option', { value: 'light', text: 'Light' }), h('option', { value: 'dark', text: 'Dark' })]);
    theme.value = set.theme || 'auto';
    theme.onchange = function () { set.theme = theme.value; save(); U.applyTheme(); };

    main.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Learning' }),
      field('Spelling standard ', standard, 'IELTS accepts both. Pick one and use it consistently in Writing.'),
      field('First language ', l1, 'Arabic adds two units (vowel letters; p/b and f/v) and explains errors that are typical for Arabic speakers.'),
      h('div', { class: 'field' }, [h('label', null, ['New words per day: ', npdOut]), npd]),
      h('div', { class: 'field' }, [h('label', null, ['Maximum reviews per day: ', capOut]), cap]),
      h('label', { class: 'check' }, [skip, 'Skip units I got fully right in the placement test']),
      h('div', { class: 'field', style: { marginTop: '14px' } }, [h('label', null, ['IELTS exam date (optional)', exam]), pace]),
      field('Theme ', theme)
    ]));

    // Voice
    var voiceSel = h('select');
    function fillVoices() {
      U.clear(voiceSel);
      voiceSel.appendChild(h('option', { value: '', text: 'Automatic (best British voice)' }));
      SP.voices().forEach(function (v) {
        voiceSel.appendChild(h('option', { value: v.voiceURI, text: v.name + ' (' + v.lang + ')' }));
      });
      voiceSel.value = set.voiceURI || '';
    }
    fillVoices();
    SP.onVoices(fillVoices);
    voiceSel.onchange = function () { set.voiceURI = voiceSel.value; save(); };
    var rate = h('input', { type: 'range', min: '0.6', max: '1.2', step: '0.05', value: String(set.rate) });
    var rateOut = h('b', { text: String(set.rate) });
    rate.oninput = function () { set.rate = +rate.value; rateOut.textContent = rate.value; save(); };
    function cb(key, label) {
      var c = h('input', { type: 'checkbox' });
      c.checked = !!set[key];
      c.onchange = function () { set[key] = c.checked; save(); };
      return h('label', { class: 'check' }, [c, label]);
    }
    main.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Voice' }),
      !SP.supported ? h('div', { class: 'note bad', text: 'This browser has no speech engine. Use Microsoft Edge or Google Chrome.' }) : null,
      field('Voice ', voiceSel),
      h('div', { class: 'field' }, [h('label', null, ['Speed: ', rateOut]), rate]),
      h('div', { class: 'stack' }, [
        cb('autoPlay', 'Play the audio automatically for each word'),
        cb('sentenceAudio', 'In dictation, read the example sentence too (word, sentence, word)'),
        cb('accentRotation', 'Rotate accents (British, Australian, Irish, American...) like the IELTS recordings')
      ]),
      h('div', { class: 'row', style: { marginTop: '12px' } }, [
        h('button', { class: 'btn', onclick: function () { U.say('Accommodation. The university offers accommodation to all first-year students.'); } }, '🔊 Test voice')
      ]),
      h('div', { class: 'note info small', style: { marginTop: '12px' } }, [
        h('b', { text: 'Getting a British voice: ' }),
        'Microsoft Edge includes natural online voices (e.g. "Microsoft Sonia Online (Natural) - English (United Kingdom)"), so opening this file in Edge is the easiest option. ',
        'For an offline voice, open Windows Settings → Time & language → Speech → Manage voices → Add voices → English (United Kingdom), then restart the browser.'
      ])
    ]));

    if (SC.writing) main.appendChild(SC.writing.settingsCard());

    // Backup
    var file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    file.onchange = function () {
      var f = file.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        if (!confirm('Replace your current progress with this backup?')) return;
        var res = ST.importJSON(String(r.result));
        if (res.ok) { U.prepareWords(); U.applyTheme(); U.toast('Backup restored (' + res.words + ' words with progress).'); U.render(); }
        else alert(res.error);
      };
      r.readAsText(f);
    };
    if (SC.sync) main.appendChild(syncCard());

    main.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Backup' }),
      h('p', { class: 'muted', text: 'Your progress, mistakes and own words are stored in this browser on this computer. Export a backup file regularly - clearing browser data would erase them.' }),
      h('p', { class: 'small', text: 'Last backup: ' + (st.lastBackup != null ? S.dayToISO(st.lastBackup) : 'never') }),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: function () { U.exportBackup(); U.render(); } }, 'Export backup'),
        h('button', { class: 'btn', onclick: function () { file.click(); } }, 'Import backup'),
        file
      ]),
      h('div', { class: 'hr' }),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', onclick: function () { st.units.diag = {}; U.startSession('diagnostic'); } }, 'Retake placement test'),
        h('button', { class: 'btn danger', onclick: function () {
          if (!confirm('Erase ALL progress, mistakes and your own words? Export a backup first if unsure.')) return;
          if (!confirm('Are you sure? This cannot be undone.')) return;
          ST.reset(); U.prepareWords(); U.applyTheme(); U.toast('Progress erased.'); U.go('#today');
        } }, 'Reset everything')
      ])
    ]));

    main.appendChild(aboutCard());
  });

  // Sync between devices: a private GitHub repo holds one progress file (see app/sync.js).
  function syncCard() {
    var SY = SC.sync, c = SY.config();
    var opts = { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' };
    var owner = h('input', Object.assign({ value: c.owner || '', placeholder: 'your GitHub username' }, opts));
    var repo = h('input', Object.assign({ value: c.repo || 'spelling-coach-data', placeholder: 'spelling-coach-data' }, opts));
    var token = h('input', Object.assign({}, opts, { type: 'password', value: c.token || '', placeholder: 'github_pat_…' }));
    function saveCfg() {
      SY.setConfig({ owner: owner.value.trim(), repo: repo.value.trim(), token: token.value.trim() });
    }
    var last = c.lastSync ? new Date(c.lastSync).toLocaleString() : 'never';
    return h('div', { class: 'card' }, [
      h('h2', { text: 'Sync between devices' }),
      h('p', { class: 'muted', text: 'Keeps your progress, mistakes, own words and writing library the same on your phone and computer. It uses one file in a private GitHub repo of yours. Answers given on both devices are combined, not overwritten.' }),
      field('GitHub username ', owner),
      field('Private repo ', repo),
      field('Access token ', token, 'A fine-grained token with access to this one repo only, permission "Contents: Read and write". It stays in this browser and is never included in backup files.'),
      h('p', { class: 'small', text: SY.configured() ? 'Last synced: ' + last + '. The app syncs when it opens, after each session and when you switch away.' : 'Sync is off.' }),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: function () {
          saveCfg();
          if (!SY.configured()) { U.toast('Fill in all three fields first.'); return; }
          U.syncNow(true);
        } }, 'Save and sync now'),
        SY.configured() ? h('button', { class: 'btn ghost', onclick: function () {
          if (!confirm('Turn sync off on this device? Your progress here and in the repo stays as it is.')) return;
          SY.forget(); U.toast('Sync is off on this device.'); U.render();
        } }, 'Turn off sync here') : null
      ]),
      h('details', { class: 'small', style: { marginTop: '12px' } }, [
        h('summary', { text: 'How to set it up (once, about 3 minutes)' }),
        h('ol', null, [
          h('li', null, ['On GitHub, create a ', h('b', { text: 'private' }), ' repository named spelling-coach-data.']),
          h('li', null, ['Open ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'Settings → Developer settings → Fine-grained tokens → Generate new token'), '.']),
          h('li', { text: 'Repository access: "Only select repositories" → spelling-coach-data. Permissions → Contents: Read and write. Choose an expiry (for example 1 year).' }),
          h('li', { text: 'Paste the token here on each device (computer and phone) and press "Save and sync now".' })
        ])
      ])
    ]);
  }

  function aboutCard() {
    var sources = (App.meta.sources || []).map(function (s) { return h('li', { text: s }); });
    var refs = [
      'Retrieval practice beats copying and "rainbow writing" for spelling: Jones, Wardlow, Pan et al. (2016), Educational Psychology Review.',
      'Spaced practice improves long-term retention: Cepeda et al. (2006), Psychological Bulletin (meta-analysis).',
      'Explicit spelling instruction improves spelling, reading and writing: Graham & Santangelo (2014), Reading and Writing (meta-analysis).',
      'Morphological instruction helps spelling, especially for English learners: Bowers, Kirby & Deacon (2010); Goodwin & Ahn (2010, 2013).',
      'Spelling relies on orthographic memory built from sounds, patterns and meaning, not visual memory alone: Ehri; Moats, Speech to Print.',
      'Errors are analysed as phonological, orthographic or morphological (POMAS; O’Brien et al. 2020).',
      'Arabic-speaking learners make more vowel-letter errors and p/b, f/v confusions: Ryan & Meara (1991); Abu-Rabia & Sammour (2013); Deacon (2017); ERIC review (2025).',
      'Seeing misspellings can weaken spelling memory, so wrong forms are shown only briefly: Pan, Rickard & Bjork (2021) review.',
      'IELTS: misspelled Listening/Reading answers are wrong; UK and US spellings are both accepted; Writing band 8 allows "occasional errors in spelling" (band descriptors, May 2023).'
    ];
    var rules = [
      ['Do not build random lists from errors', 'Mistakes point you to the pattern behind them; new words follow a fixed sequence of units.'],
      ['Match words to the pattern being taught', 'Each unit’s words share its pattern; the unit’s rule is shown before practice.'],
      ['Teach patterns explicitly', 'Every unit starts with a short rule card and worked word sums.'],
      ['Teach only reliable rules', 'Doubling, silent e, y→i and no-change rules; the unreliable "i before e" rhyme is replaced by word families.'],
      ['Spelling is not "crazy"', 'Every word shows sound (syllables), pattern (rule) and meaning (word sum, roots, family).'],
      ['Not just a Monday list and a Friday test', 'Daily spaced reviews and teaching between tests.'],
      ['No memorisation drills', 'Dictation, sentence dictation and word-sum building - never copying.']
    ];
    return h('div', { class: 'card', id: 'about' }, [
      h('h2', { text: 'About & the science' }),
      h('details', { open: true }, [h('summary', null, h('b', { text: 'How the app follows the 7 rules from the video' })),
        h('div', { class: 'table-wrap' }, h('table', null, h('tbody', null, rules.map(function (r, i) {
          return h('tr', null, [h('td', { text: String(i + 1) }), h('td', null, h('b', { text: r[0] })), h('td', { text: r[1] })]);
        }))))]),
      h('details', null, [h('summary', null, h('b', { text: 'Research behind the design' })), h('ul', null, refs.map(function (r) { return h('li', { text: r }); }))]),
      h('details', null, [h('summary', null, h('b', { text: 'Word data sources and licences' })), h('ul', null, sources),
        h('p', { class: 'small muted', text: 'Database built ' + (App.meta.built || '') + ' with ' + (App.meta.count || App.all.length) + ' words. For personal, non-commercial study.' })])
    ]);
  }

  SC.pages = { editWord: editWord, deleteWord: deleteWord, addWord: addWord };
})(window);
