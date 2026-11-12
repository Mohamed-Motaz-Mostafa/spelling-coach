/* Spelling Coach - Writing: dictation built from my mistakes, and IELTS Writing tasks with band-9 model answers
   (Google Gemini, free tier). Generated texts are stored in the progress state (ST.state.library), so they are
   kept, can be practised again and go into backups. The stored bank of tasks is data/writing.js. */
(function (root) {
  'use strict';
  var SC = root.SC, U = SC.ui, h = U.h, App = U.App;
  var ST = SC.store, A = SC.analyzer, SP = SC.speech, AI = SC.ai, P = SC.passage;
  var BANK = root.SC_WRITING || { tasks: [], us2uk: {} };
  var SVGNS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------------ stored outputs
  function lib() {
    var s = ST.state;
    var L = s.library || (s.library = {});
    L.passages = L.passages || [];
    L.tasks = L.tasks || [];
    L.stats = L.stats || {};
    return L;
  }
  function isUS() { return U.settings().standard === 'us'; }
  function aiOpts() { return { map: isUS() ? null : BANK.us2uk, us: isUS() }; }
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function allTasks() { return lib().tasks.concat(BANK.tasks || []); }
  function findTask(id) { return allTasks().filter(function (t) { return t.id === id; })[0]; }
  function findPassage(id) { return lib().passages.filter(function (p) { return p.id === id; })[0]; }
  function stats(id) { var S = lib().stats; return S[id] || (S[id] = { seen: false, attempts: [] }); }
  function bestScore(attempts) { return (attempts || []).reduce(function (b, a) { return Math.max(b, a.score); }, -1); }
  function pct(x) { return Math.round(100 * x) + '%'; }
  function typeLabel(t) {
    if (t.type === 'own') return 'Task ' + t.task + ' · Your question';
    var info = t.task === 1 ? AI.CHARTS[t.type] : AI.ESSAYS[t.type];
    return 'Task ' + t.task + ' · ' + (info ? info.label : t.type);
  }
  function mineChip(t) { return t.source === 'bank' ? null : h('span', { class: 'chip info', text: t.source === 'own' ? 'Your question' : 'Made for you' }); }

  // ------------------------------------------------------------------ hub
  var view = { filter: 0, length: 'short', topic: '', sel: null, chart: 'line', essay: 'opinion', t1topic: '', t2topic: '' };

  // Words for the mistake dictation: recent and frequent mistakes first, mastered words last.
  function candidates() {
    var byId = ST.errorsById();
    var ids = Object.keys(byId).filter(function (id) { var e = App.words[id]; return e && /^[A-Za-z][A-Za-z' -]*$/.test(e.w); });
    ids.sort(function (a, b) {
      var ma = U.statusOf(a) === 'mastered', mb = U.statusOf(b) === 'mastered';
      return (ma - mb) || byId[b].lastDay - byId[a].lastDay || byId[b].count - byId[a].count;
    });
    var from = 'mistakes';
    if (ids.length < 6) {
      var trouble = ((App.meta.lists || []).filter(function (l) { return l.id === 'trouble'; })[0] || { ids: [] }).ids;
      trouble.forEach(function (id) { if (ids.length < 40 && ids.indexOf(id) < 0 && App.words[id] && U.statusOf(id) !== 'mastered') ids.push(id); });
      from = Object.keys(byId).length ? 'mixed' : 'trouble';
    }
    return { ids: ids.slice(0, 40), from: from };
  }

  U.route('writing', function (main) {
    main.appendChild(h('div', { class: 'row between' }, [
      h('h1', { text: 'Writing' }),
      h('span', { class: 'small muted', text: aiStatusText() })
    ]));
    main.appendChild(mistakeCard());
    var mine = lib().passages;
    if (mine.length) main.appendChild(passagesCard(mine));
    main.appendChild(tasksCard());
  });

  function aiStatusText() {
    return AI.keySource() === 'none' ? 'AI helper: no API key (see Settings)' : 'AI helper: Gemini, free tier';
  }

  function mistakeCard() {
    var c = candidates();
    if (!view.sel) view.sel = c.ids.slice(0, AI.LENGTHS[view.length].words);
    view.sel = view.sel.filter(function (id) { return App.words[id]; });
    var count = h('span', { class: 'small muted', text: view.sel.length + ' selected' });
    var chips = h('div', { class: 'word-chips' });
    function drawChips() {
      U.clear(chips);
      c.ids.forEach(function (id) {
        var on = view.sel.indexOf(id) >= 0;
        chips.appendChild(h('button', { class: 'chip toggle' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: function () {
          var i = view.sel.indexOf(id);
          if (i >= 0) view.sel.splice(i, 1); else view.sel.push(id);
          count.textContent = view.sel.length + ' selected';
          drawChips();
        } }, U.disp(App.words[id])));
      });
    }
    drawChips();

    var len = h('select', null, Object.keys(AI.LENGTHS).map(function (k) { return h('option', { value: k, text: AI.LENGTHS[k].label + ' (about ' + AI.LENGTHS[k].words + ' of your words)' }); }));
    len.value = view.length;
    len.onchange = function () { view.length = len.value; view.sel = c.ids.slice(0, AI.LENGTHS[view.length].words); U.render(); };
    var topic = topicSelect(view.topic, function (v) { view.topic = v; });
    var status = h('div', { class: 'gen-status', 'aria-live': 'polite' });
    var aiBtn = h('button', { class: 'btn primary', id: 'make-dictation', onclick: function () {
      var words = view.sel.map(function (id) { return U.disp(App.words[id]); });
      if (words.length < 2) { U.toast('Choose at least 2 words.'); return; }
      var job = busy(aiBtn, status, 'Writing a text with your ' + words.length + ' words… (usually 3 to 10 seconds)');
      AI.makePassage(words, Object.assign(aiOpts(), { length: view.length, topic: view.topic, onStatus: job.onStatus })).then(function (p) {
        if (job.cancelled) return;
        p.id = newId('p');
        p.ids = view.sel.slice();
        p.attempts = [];
        lib().passages.unshift(p);
        ST.saveNow();
        startRun({ kind: 'passage', id: p.id }, p.text, p.title, 'listen', p.ids);
      }, function (err) {
        if (job.cancelled) return;
        done(aiBtn, status);
        showError(status, err, offlineDictation);
      });
    } }, 'Create with AI');
    function offlineDictation() {
      var p = offlinePassage(view.sel);
      if (!p) { U.toast('These words have no example sentences.'); return; }
      p.id = newId('p');
      lib().passages.unshift(p);
      ST.saveNow();
      startRun({ kind: 'passage', id: p.id }, p.text, p.title, 'listen', p.ids);
    }

    return h('div', { class: 'card' }, [
      h('h2', { text: 'Dictation from my mistakes' }),
      h('p', { class: 'muted', text: 'The AI writes a short text that uses the words you misspelt. The app reads it aloud one sentence at a time, you type each sentence, and every word is marked. Spelling mistakes go back into your reviews.' }),
      c.from !== 'mistakes' ? h('div', { class: 'note info small', text: c.from === 'trouble' ? 'No mistakes recorded yet, so these are commonly misspelt words. Your own mistakes will appear here as you practise.' : 'You have only a few mistakes so far, so commonly misspelt words fill the list.' }) : null,
      h('div', { class: 'row between', style: { marginTop: '10px' } }, [h('b', { text: 'Words to include (tap to add or remove)' }), count]),
      chips,
      h('div', { class: 'grid two', style: { marginTop: '12px' } }, [
        h('div', { class: 'field' }, [h('label', null, ['Length', len])]),
        h('div', { class: 'field' }, [h('label', null, ['Topic', topic])])
      ]),
      h('div', { class: 'row' }, [
        aiBtn,
        h('button', { class: 'btn', onclick: offlineDictation, title: 'Uses the example sentences of these words; works without internet' }, 'Use offline sentences')
      ]),
      status
    ]);
  }

  function topicSelect(value, onchange) {
    var s = h('select', { 'aria-label': 'Topic' }, [h('option', { value: '', text: 'Any IELTS topic' })].concat(AI.TOPICS.map(function (t) {
      return h('option', { value: t, text: t.charAt(0).toUpperCase() + t.slice(1) });
    })));
    s.value = value || '';
    s.onchange = function () { onchange(s.value); };
    return s;
  }

  /* busy(btn, status, msg) -> job: shows what the AI is doing (job.onStatus gets the fallback steps) and a Cancel
     button. After Cancel the late answer is ignored (job.cancelled). */
  function busy(btn, status, msg) {
    var job = { cancelled: false };
    btn.disabled = true;
    btn.dataset.label = btn.textContent;
    btn.textContent = 'Working…';
    var step = h('div', { class: 'small', style: { marginTop: '6px' } });
    U.clear(status).appendChild(h('div', { class: 'note info small' }, [
      h('div', { class: 'row between' }, [
        h('span', null, [h('span', { class: 'spinner', 'aria-hidden': 'true' }), msg]),
        h('button', { class: 'btn sm', onclick: function () { job.cancelled = true; done(btn, status); U.toast('Cancelled.'); } }, 'Cancel')
      ]),
      step
    ]));
    job.onStatus = function (text) { if (!job.cancelled) step.textContent = text; };
    return job;
  }
  function done(btn, status) {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    U.clear(status);
  }
  function showError(status, err, offline) {
    var hint = err.code === 'nokey' ? 'Add a key in Settings → AI writing helper.' :
      err.code === 'offline' ? 'You seem to be offline.' :
      err.code === 'quota' && !/back at/.test(err.message) ? 'Free daily limits reset once a day; Settings → AI writing helper shows when.' : '';
    U.clear(status).appendChild(h('div', { class: 'note bad small' }, [
      h('b', { text: 'The AI could not make it. ' }), err.message + ' ', hint,
      offline ? h('div', { style: { marginTop: '8px' } }, h('button', { class: 'btn sm', onclick: offline }, 'Use offline sentences instead')) : null
    ]));
  }

  // Offline fallback: one example sentence per word, taken from the word database.
  function offlinePassage(ids) {
    var sents = [], used = [];
    ids.forEach(function (id) {
      var e = App.words[id];
      var s = e && (e.ex || []).filter(function (x) { return AI.hasWord(x, U.disp(e)); })[0];
      if (s && sents.indexOf(s) < 0) { sents.push(s); used.push(id); }
    });
    if (!sents.length) return null;
    return { kind: 'offline', title: 'Your words in sentences', text: sents.join(' '), words: used.map(function (id) { return U.disp(App.words[id]); }),
      ids: used, missing: [], model: 'offline (example sentences)', created: new Date().toISOString(), attempts: [] };
  }

  function passagesCard(list) {
    return h('div', { class: 'card' }, [
      h('h2', { text: 'My dictations (' + list.length + ')' }),
      h('div', { class: 'table-wrap' }, h('table', null, [
        h('thead', null, h('tr', null, ['Text', 'Made', 'Your words', 'Best', ''].map(function (t) { return h('th', { text: t }); }))),
        h('tbody', null, list.slice(0, 30).map(function (p) {
          var b = bestScore(p.attempts);
          return h('tr', null, [
            h('td', null, [h('b', { text: p.title }), h('div', { class: 'small muted', text: p.text.slice(0, 90) + (p.text.length > 90 ? '…' : '') })]),
            h('td', { class: 'small', text: String(p.created || '').slice(0, 10) }),
            h('td', { class: 'small', text: (p.words || []).join(', ') }),
            h('td', { text: b < 0 ? '-' : pct(b) }),
            h('td', null, h('div', { class: 'row' }, [
              h('button', { class: 'btn sm primary', onclick: function () { startRun({ kind: 'passage', id: p.id }, p.text, p.title, 'listen', p.ids); } }, 'Dictation'),
              h('button', { class: 'btn sm', onclick: function () { startRun({ kind: 'passage', id: p.id }, p.text, p.title, 'memory', p.ids); } }, 'From memory'),
              h('button', { class: 'btn sm ghost', onclick: function () {
                if (!confirm('Delete "' + p.title + '"?')) return;
                lib().passages.splice(lib().passages.indexOf(p), 1);
                ST.save();
                U.render();
              } }, 'Delete')
            ]))
          ]);
        }))
      ]))
    ]);
  }

  function tasksCard() {
    var tasks = allTasks().filter(function (t) { return !view.filter || t.task === view.filter; });
    var status = h('div', { class: 'gen-status', 'aria-live': 'polite' });
    var chartSel = h('select', { 'aria-label': 'Chart type' }, Object.keys(AI.CHARTS).map(function (k) { return h('option', { value: k, text: AI.CHARTS[k].label }); }));
    chartSel.value = view.chart;
    chartSel.onchange = function () { view.chart = chartSel.value; };
    var essaySel = h('select', { 'aria-label': 'Essay type' }, Object.keys(AI.ESSAYS).map(function (k) { return h('option', { value: k, text: AI.ESSAYS[k].label }); }));
    essaySel.value = view.essay;
    essaySel.onchange = function () { view.essay = essaySel.value; };
    function makeBtn(task, label) {
      var b = h('button', { class: 'btn primary', onclick: function () {
        var job = busy(b, status, 'Writing a Task ' + task + ' question and a band-9 model answer… (up to a minute)');
        AI.makeTask(task, task === 1 ? view.chart : view.essay, task === 1 ? view.t1topic : view.t2topic, Object.assign(aiOpts(), { onStatus: job.onStatus })).then(function (t) {
          if (job.cancelled) return;
          t.id = newId('m');
          lib().tasks.unshift(t);
          ST.saveNow();
          U.go('#task/' + t.id);
        }, function (err) { if (job.cancelled) return; done(b, status); showError(status, err); });
      } }, label);
      return b;
    }
    return h('div', { class: 'card' }, [
      h('div', { class: 'row between' }, [
        h('h2', { text: 'IELTS Writing - model answers' }),
        h('div', { class: 'row' }, [[0, 'All'], [1, 'Task 1 (charts)'], [2, 'Task 2 (essays)']].map(function (f) {
          return h('button', { class: 'btn sm' + (view.filter === f[0] ? ' primary' : ''), onclick: function () { view.filter = f[0]; U.render(); } }, f[1]);
        }))
      ]),
      h('p', { class: 'muted', text: 'Read the question and plan your own answer first. Then study the band-9 model answer and rewrite it sentence by sentence, from dictation or from memory.' }),
      h('div', { class: 'gen-grid' }, [
        h('div', { class: 'row' }, [chartSel, topicSelect(view.t1topic, function (v) { view.t1topic = v; }), makeBtn(1, 'New Task 1')]),
        h('div', { class: 'row' }, [essaySel, topicSelect(view.t2topic, function (v) { view.t2topic = v; }), makeBtn(2, 'New Task 2')]),
        h('div', { class: 'row' }, [h('button', { class: 'btn', onclick: ownQuestion }, 'Use my own question (text or chart image)')])
      ]),
      status,
      tasks.length ? h('div', { class: 'task-list' }, tasks.map(function (t) {
        var b = bestScore(stats(t.id).attempts);
        return h('a', { class: 'task-row', href: '#task/' + encodeURIComponent(t.id) }, [
          h('div', { class: 'row' }, [h('span', { class: 'chip', text: typeLabel(t) }), mineChip(t), b >= 0 ? h('span', { class: 'chip ok', text: 'Best ' + pct(b) }) : null]),
          h('div', { class: 'small', text: t.question.slice(0, 170) + (t.question.length > 170 ? '…' : '') })
        ]);
      })) : h('p', { class: 'muted', text: 'No tasks yet. Make one above.' })
    ]);
  }

  // ------------------------------------------------------------------ own question (text and/or chart image)
  function ownQuestion() {
    var ta = h('textarea', { rows: 6, placeholder: 'Paste the question here, for example: "Some people think that... To what extent do you agree or disagree?"' });
    var file = h('input', { type: 'file', accept: 'image/*' });
    var preview = h('div');
    var image = null;
    file.onchange = function () {
      var f = file.files[0];
      if (!f) return;
      shrinkImage(f).then(function (im) {
        image = im;
        U.clear(preview).appendChild(h('img', { src: im.url, alt: 'The chart you added', class: 'own-image' }));
      }, function () { U.toast('This image could not be read.'); });
    };
    var status = h('div', { class: 'gen-status', 'aria-live': 'polite' });
    var m;
    var go = h('button', { class: 'btn primary', onclick: function () {
      if (!ta.value.trim() && !image) { U.toast('Paste a question or add an image.'); return; }
      var job = busy(go, status, 'Reading the question and writing a band-9 model answer… (up to a minute)');
      AI.answerOwn(ta.value, image ? { mime: image.mime, data: image.data } : null, Object.assign(aiOpts(), { onStatus: job.onStatus })).then(function (t) {
        if (job.cancelled) return;
        t.id = newId('o');
        if (image) t.image = image.url;
        if (!t.question) t.question = ta.value.trim();
        lib().tasks.unshift(t);
        ST.saveNow();
        m.close();
        U.go('#task/' + t.id);
      }, function (err) { if (job.cancelled) return; done(go, status); showError(status, err); });
    } }, 'Get a model answer');
    m = U.modal(h('div', { class: 'stack' }, [
      h('h2', { text: 'Use my own question' }),
      h('p', { class: 'muted small', text: 'Paste a Task 1 or Task 2 question from a book or website. For Task 1, add a photo or screenshot of the chart, table, map or diagram.' }),
      h('label', null, ['Question', ta]),
      h('label', null, ['Chart image (Task 1, optional)', file]),
      preview,
      h('div', { class: 'row' }, [go]),
      status
    ]));
  }

  // Downscale to at most 1400 px (JPEG) so the request and the stored copy stay small.
  function shrinkImage(f) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = reject;
      r.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var k = Math.min(1, 1400 / Math.max(img.width, img.height));
          var cv = document.createElement('canvas');
          cv.width = Math.round(img.width * k);
          cv.height = Math.round(img.height * k);
          var g = cv.getContext('2d');
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, cv.width, cv.height);
          g.drawImage(img, 0, 0, cv.width, cv.height);
          var url = cv.toDataURL('image/jpeg', 0.85);
          resolve({ url: url, mime: 'image/jpeg', data: url.split(',')[1] });
        };
        img.src = r.result;
      };
      r.readAsDataURL(f);
    });
  }

  // ------------------------------------------------------------------ task page
  function partNames(t, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push(i === 0 ? 'Introduction' : t.task === 1 ? (i === 1 ? 'Overview' : 'Details ' + (i - 1)) : i === n - 1 ? 'Conclusion' : 'Body paragraph ' + i);
    }
    return out;
  }

  U.route('task', function (main, args) {
    var t = findTask(args[0]);
    main.appendChild(h('a', { href: '#writing', class: 'btn ghost sm' }, '← Writing'));
    if (!t) { main.appendChild(h('div', { class: 'card', style: { marginTop: '10px' } }, h('p', { text: 'This task was not found.' }))); return; }
    var st = stats(t.id);
    var paras = t.answer.split(/\n\s*\n/);

    main.appendChild(h('div', { class: 'card', style: { marginTop: '10px' } }, [
      h('div', { class: 'row' }, [h('span', { class: 'chip', text: typeLabel(t) }), mineChip(t)]),
      h('div', { class: 'question-box' }, [
        h('p', { class: 'small muted', text: t.task === 1 ? 'You should spend about 20 minutes on this task.' : 'You should spend about 40 minutes on this task.' }),
        h('p', { class: 'question', text: t.question }),
        h('p', { class: 'small muted', text: t.task === 1 ? 'Write at least 150 words.' : 'Write at least 250 words.' })
      ]),
      t.chart ? chartView(t.chart) : null,
      t.image ? h('img', { src: t.image, alt: 'The chart for this question', class: 'own-image' }) : null
    ]));

    var answerCard = h('div', { class: 'card' });
    main.appendChild(answerCard);
    function drawAnswer() {
      U.clear(answerCard);
      if (!st.seen) {
        answerCard.appendChild(h('h2', { text: 'Model answer' }));
        answerCard.appendChild(h('p', { class: 'muted', text: t.task === 1
          ? 'First plan your own answer for 2 to 3 minutes: what is the overview (the biggest change or the main difference)? Which figures will you group together?'
          : 'First plan your own answer for 3 to 5 minutes: what is your position, and which two main ideas will you develop with an example each?' }));
        answerCard.appendChild(h('button', { class: 'btn primary', id: 'show-answer', onclick: function () { st.seen = true; ST.save(); drawAnswer(); } }, 'Show the model answer'));
        return;
      }
      var listening = false;
      var listenBtn = h('button', { class: 'btn sm', onclick: function () {
        if (listening) { SP.stop(); listening = false; listenBtn.textContent = '🔊 Listen'; return; }
        listening = true;
        listenBtn.textContent = '■ Stop';
        SP.sequence(P.split(t.answer).map(function (x) { return { text: x.s, pause: 350 }; }), { settings: U.settings() }).then(function () {
          listening = false;
          listenBtn.textContent = '🔊 Listen';
        });
      } }, '🔊 Listen');
      answerCard.appendChild(h('div', { class: 'row between' }, [h('h2', { text: 'Model answer' }), listenBtn]));
      answerCard.appendChild(h('div', { class: 'model-answer' }, paras.map(function (p) { return h('p', { text: p }); })));
      answerCard.appendChild(h('p', { class: 'small muted', text: t.words + ' words · written by ' + (t.model || 'Gemini') + (t.chart ? ' · the data is invented for practice' : '') + '. AI text can contain mistakes, so check facts and figures yourself.' }));
      if (t.tips && t.tips.length) answerCard.appendChild(h('div', null, [h('h3', { text: 'Why it scores high' }), h('ul', null, t.tips.map(function (x) { return h('li', { text: x }); }))]));
      if (t.phrases && t.phrases.length) answerCard.appendChild(h('div', null, [h('h3', { text: 'Useful phrases' }), h('div', { class: 'word-chips' }, t.phrases.map(function (x) { return h('span', { class: 'chip', text: x }); }))]));
    }
    drawAnswer();

    var part = h('select', null, [h('option', { value: 'all', text: 'The whole answer (' + P.split(t.answer).length + ' sentences)' })].concat(
      partNames(t, paras.length).map(function (name, i) { return h('option', { value: String(i), text: name + ' (' + P.split(paras[i]).length + ' sentences)' }); })));
    function textFor() { return part.value === 'all' ? t.answer : paras[+part.value]; }
    function partTitle() { return typeLabel(t) + (part.value === 'all' ? '' : ' - ' + part.options[part.selectedIndex].text.replace(/ \(.*/, '')); }
    function begin(mode) { st.seen = true; ST.save(); startRun({ kind: 'task', id: t.id, part: part.value }, textFor(), partTitle(), mode); }
    var tries = st.attempts.slice(-5).reverse();
    main.appendChild(h('div', { class: 'card' }, [
      h('h2', { text: 'Rewrite the model answer' }),
      h('p', { class: 'muted', text: 'Dictation: listen to each sentence and type it. From memory: read a sentence, hide it, then write it. Both train the spelling, grammar and phrases of a high-band answer.' }),
      h('div', { class: 'field' }, [h('label', null, ['Practise', part])]),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn primary', onclick: function () { begin('listen'); } }, 'From dictation (listen)'),
        h('button', { class: 'btn', onclick: function () { begin('memory'); } }, 'From memory (read, hide, write)')
      ]),
      tries.length ? h('div', { style: { marginTop: '12px' } }, [h('h3', { text: 'Your attempts' }), h('ul', { class: 'small' }, tries.map(function (a) {
        return h('li', { text: String(a.at || '').slice(0, 10) + ' · ' + (a.mode === 'memory' ? 'from memory' : 'dictation') + ' · ' +
          (a.part === 'all' || a.part == null ? 'whole answer' : partNames(t, paras.length)[+a.part] || 'part') + ' · ' + pct(a.score) });
      }))]) : null,
      t.source !== 'bank' ? h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn ghost sm', onclick: function () {
        if (!confirm('Delete this task?')) return;
        lib().tasks.splice(lib().tasks.indexOf(t), 1);
        delete lib().stats[t.id];
        ST.save();
        U.go('#writing');
      } }, 'Delete this task')) : null
    ]));
  });

  // ------------------------------------------------------------------ charts (SVG; colours are CSS tokens for light and dark)
  function el(tag, attrs, kids) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function withTip(node, text) { node.appendChild(el('title', null, [text])); return node; }
  // Categorical slots in fixed order (validated for colour-vision deficiency on both themes).
  function slot(i) { return 'var(--s' + (Math.min(i, 5) + 1) + ')'; }
  function niceTicks(lo, hi, n) {
    if (hi === lo) hi = lo + 1;
    var raw = (hi - lo) / n, step = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), err = raw / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var out = [];
    for (var v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function tick(v) { var a = Math.abs(v); return a >= 1e6 ? +(v / 1e6).toFixed(1) + 'M' : a >= 1000 ? +(v / 1000).toFixed(1) + 'K' : String(+v.toFixed(2)); }
  function value(v, unit) {
    var s = String(+Number(v).toFixed(2)).replace(/^(-?\d+)(\d{3})(?=\.|$)/, '$1,$2');
    return unit === '%' ? s + '%' : unit ? s + ' ' + unit : s;
  }
  function wrapLabel(text, max) {
    var lines = [''];
    String(text).split(' ').forEach(function (w) {
      var cur = lines[lines.length - 1];
      if (cur && (cur + ' ' + w).length > max && lines.length < 2) lines.push(w);
      else lines[lines.length - 1] = cur ? cur + ' ' + w : w;
    });
    return lines;
  }

  function chartView(c) {
    var body;
    if (c.type === 'process') body = h('ol', { class: 'flow' }, c.steps.map(function (s) { return h('li', null, h('span', { text: s })); }));
    else if (c.type === 'table') body = dataTable(c, true);
    else body = h('div', { class: 'chart-svg' }, c.type === 'line' ? lineChart(c) : c.type === 'bar' ? barChart(c) : pieChart(c));
    var legend = c.type === 'pie' ? c.labels : c.type === 'line' || (c.type === 'bar' && c.series.length > 1) ? c.series.map(function (s) { return s.name; }) : [];
    return h('figure', { class: 'chart' }, [
      h('figcaption', null, [h('b', { text: c.title }), c.unit && c.type !== 'process' ? h('span', { class: 'muted small', text: '  (' + (c.unit === '%' ? 'per cent' : c.unit) + ')' }) : null]),
      body,
      legend.length ? h('div', { class: 'viz-legend' }, legend.map(function (name, i) {
        return h('span', null, [h('i', { style: { background: slot(i) }, 'aria-hidden': 'true' }), name]);
      })) : null,
      c.type !== 'table' && c.type !== 'process' ? h('details', { class: 'data-table', open: c.type === 'pie' ? true : null }, [h('summary', { text: 'Data table' }), dataTable(c, false)]) : null
    ]);
  }

  function dataTable(c, main) {
    return h('div', { class: 'table-wrap' + (main ? ' ielts-table' : '') }, h('table', null, [
      h('thead', null, h('tr', null, [h('th', { text: '' })].concat(c.series.map(function (s) { return h('th', { text: s.name }); })))),
      h('tbody', null, c.labels.map(function (l, i) {
        return h('tr', null, [h('th', { text: l })].concat(c.series.map(function (s) { return h('td', { class: 'num', text: value(s.values[i], c.unit) }); })));
      }))
    ]));
  }

  function axes(svg, ticks, Y, x0, x1) {
    ticks.forEach(function (t, i) {
      svg.appendChild(el('line', { x1: x0, x2: x1, y1: Y(t), y2: Y(t), class: i === 0 ? 'axis' : 'gridline' }));
      svg.appendChild(el('text', { x: x0 - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'ax' }, [tick(t)]));
    });
  }

  function lineChart(c) {
    var W = 640, H = 320, L = 52, R = 130, T = 14, B = 34;
    var vals = [].concat.apply([], c.series.map(function (s) { return s.values; }));
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, vals)), Math.max.apply(null, vals), 5);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1], n = c.labels.length;
    function X(i) { return L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)); }
    function Y(v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); }
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': c.title });
    axes(svg, ticks, Y, L, W - R);
    c.labels.forEach(function (l, i) {
      if (n > 8 && i % 2) return;
      svg.appendChild(el('text', { x: X(i), y: H - B + 20, 'text-anchor': 'middle', class: 'ax' }, [l]));
    });
    c.series.forEach(function (s, k) {
      svg.appendChild(el('path', { d: s.values.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(''), class: 'line', stroke: slot(k) }));
    });
    c.series.forEach(function (s, k) {
      s.values.forEach(function (v, i) {
        svg.appendChild(withTip(el('g', { class: 'pt' }, [
          el('circle', { cx: X(i), cy: Y(v), r: 4, fill: slot(k), class: 'mk' }),
          el('circle', { cx: X(i), cy: Y(v), r: 11, class: 'hit' })
        ]), s.name + ', ' + c.labels[i] + ': ' + value(v, c.unit)));
      });
    });
    // Direct end labels only when they do not collide; the legend always carries identity.
    var ends = c.series.map(function (s) { return { y: Y(s.values[n - 1]), name: s.name }; }).sort(function (a, b) { return a.y - b.y; });
    if (ends.every(function (e, i) { return !i || e.y - ends[i - 1].y >= 14; })) {
      ends.forEach(function (e) { svg.appendChild(el('text', { x: X(n - 1) + 9, y: e.y + 4, class: 'lbl' }, [e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name])); });
    }
    return svg;
  }

  function barChart(c) {
    var W = 640, H = 330, L = 52, R = 12, T = 18, B = 46;
    var vals = [].concat.apply([], c.series.map(function (s) { return s.values; }));
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, vals)), Math.max.apply(null, vals), 5);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    function Y(v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); }
    var n = c.labels.length, k = c.series.length, band = (W - L - R) / n;
    var bw = Math.min(24, (band * 0.72 - (k - 1) * 2) / k), gw = k * bw + (k - 1) * 2;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': c.title });
    axes(svg, ticks, Y, L, W - R);
    var base = Y(Math.max(0, y0)), showVals = n * k <= 14;
    c.labels.forEach(function (l, i) {
      var gx = L + band * i + (band - gw) / 2;
      c.series.forEach(function (s, j) {
        var v = s.values[i], x = gx + j * (bw + 2), y = Y(v), hgt = Math.max(0, base - y), r = Math.min(4, hgt, bw / 2);
        var d = 'M' + x + ',' + base + 'V' + (y + r) + 'Q' + x + ',' + y + ' ' + (x + r) + ',' + y + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + r) + 'V' + base + 'Z';
        svg.appendChild(withTip(el('g', null, [el('path', { d: d, fill: slot(j) }), el('rect', { x: x - 2, y: Math.min(y, base - 12), width: bw + 4, height: Math.max(hgt, 12), class: 'hit' })]),
          (k > 1 ? s.name + ', ' : '') + l + ': ' + value(v, c.unit)));
        if (showVals) svg.appendChild(el('text', { x: x + bw / 2, y: y - 5, 'text-anchor': 'middle', class: 'val' }, [tick(v) + (c.unit === '%' ? '%' : '')]));
      });
      var cx = L + band * i + band / 2;
      svg.appendChild(el('text', { x: cx, y: H - B + 18, 'text-anchor': 'middle', class: 'ax' }, wrapLabel(l, Math.max(8, Math.floor(band / 7))).map(function (t, li) {
        return el('tspan', { x: cx, dy: li ? 13 : 0 }, [t]);
      })));
    });
    return svg;
  }

  function pieChart(c) {
    var k = c.series.length, W = 640, H = 270, r = k > 2 ? 62 : 86;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': c.title });
    c.series.forEach(function (s, p) {
      // Each pie in the middle of its own column, so the outside % labels of neighbours never meet.
      var cx = W * (2 * p + 1) / (2 * k), cy = 118;
      var sum = s.values.reduce(function (a, b) { return a + b; }, 0) || 1, a0 = -Math.PI / 2;
      s.values.forEach(function (v, i) {
        var a1 = a0 + 2 * Math.PI * v / sum;
        var d = v >= sum - 1e-9
          ? 'M' + (cx - r) + ',' + cy + 'a' + r + ',' + r + ' 0 1,0 ' + 2 * r + ',0a' + r + ',' + r + ' 0 1,0 ' + (-2 * r) + ',0Z'
          : 'M' + cx + ',' + cy + 'L' + (cx + r * Math.cos(a0)).toFixed(1) + ',' + (cy + r * Math.sin(a0)).toFixed(1) +
            'A' + r + ',' + r + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ',1 ' + (cx + r * Math.cos(a1)).toFixed(1) + ',' + (cy + r * Math.sin(a1)).toFixed(1) + 'Z';
        svg.appendChild(withTip(el('path', { d: d, fill: slot(i), class: 'slice' }), s.name + ', ' + c.labels[i] + ': ' + value(v, c.unit || '%')));
        if (v / sum >= 0.03) {
          var mid = (a0 + a1) / 2, lx = cx + (r + 16) * Math.cos(mid), ly = cy + (r + 16) * Math.sin(mid);
          svg.appendChild(el('text', { x: lx.toFixed(1), y: (ly + 4).toFixed(1), 'text-anchor': Math.cos(mid) > 0.2 ? 'start' : Math.cos(mid) < -0.2 ? 'end' : 'middle', class: 'val' }, [tick(v) + '%']));
        }
        a0 = a1;
      });
      svg.appendChild(el('text', { x: cx, y: cy + r + 40, 'text-anchor': 'middle', class: 'lbl strong' }, [s.name]));
    });
    return svg;
  }

  // ------------------------------------------------------------------ the dictation runner
  function startRun(src, text, title, mode, focus) {
    var sents = P.split(text);
    if (!sents.length) { U.toast('There is no text to practise.'); return; }
    SP.stop();
    App.dict = { src: src, text: text, title: title, mode: mode, sents: sents, idx: 0, phase: mode === 'memory' ? 'show' : 'q',
      results: [], focus: focus || [], recorded: {}, missed: {}, startedAt: Date.now(), cur: null };
    U.go('#dictate');
  }

  function variantFn(a, t) {
    var r = A.check(a, App.words[t] || { id: t, w: t }, { standard: U.settings().standard });
    return r.ok && r.status !== 'correct';
  }
  function isErr(it) { return it.op === 'spell' || it.op === 'wrong' || it.op === 'missing'; }
  function plain(raw) { return raw.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9']+$/, ''); }

  function playSentence(s, how) {
    var set = U.settings(), rate = set.rate || 0.9;
    if (how === 'phrases') return SP.sequence(P.chunks(s).map(function (c) { return { text: c, rate: rate * 0.9, pause: 1700 }; }), { settings: set });
    return SP.sequence([{ text: s, rate: how === 'slow' ? Math.max(0.5, rate * 0.75) : rate }], { settings: set });
  }

  U.route('dictate', function (main) {
    var R = App.dict;
    if (!R) { U.go('#writing'); return; }
    var wrap = h('div', { class: 'practice dictation' });
    main.appendChild(wrap);
    var n = R.sents.length, summary = R.phase === 'summary';
    wrap.appendChild(h('div', { class: 'row between' }, [
      h('div', null, [h('b', { text: R.title }), h('span', { class: 'muted small', text: '  ' + (summary ? n : R.idx + 1) + ' / ' + n + (R.mode === 'memory' ? ' · from memory' : ' · dictation') })]),
      h('button', { class: 'btn ghost sm', onclick: function () {
        if (!summary && R.results.length && !confirm('Leave this dictation? Mistakes so far are saved.')) return;
        exitRun(R);
      } }, summary ? 'Close' : 'Exit')
    ]));
    wrap.appendChild(h('div', { class: 'progressbar' }, [h('span', { style: { width: (100 * (summary ? n : R.idx) / n) + '%' } })]));
    var item = R.sents[R.idx];
    if (summary) renderRunSummary(wrap, R);
    else if (R.phase === 'show') renderShow(wrap, R, item);
    else if (R.phase === 'q') renderAsk(wrap, R, item);
    else if (R.phase === 'fb') renderMarked(wrap, R);
    else renderFix(wrap, R);
  });

  function exitRun(R) {
    App.dict = null;
    SP.stop();
    U.go(R.src.kind === 'task' ? '#task/' + encodeURIComponent(R.src.id) : '#writing');
  }

  function renderShow(wrap, R, item) {
    wrap.appendChild(h('div', { class: 'card qcard' }, [
      h('div', { class: 'qtype', text: 'From memory - read it, then hide it and write it' }),
      h('p', { class: 'passage-sentence', text: item.s }),
      h('div', { class: 'audio-row' }, [U.audioBtn('🔊 Listen', function () { playSentence(item.s); })]),
      h('div', { class: 'row' }, [h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { R.phase = 'q'; R.peeks = 0; U.render(); } },
        ['Hide it and write', h('span', { class: 'kbd', text: 'Enter' })])])
    ]));
  }

  function renderAsk(wrap, R, item) {
    var listen = R.mode === 'listen';
    var ta = h('textarea', { class: 'answer long', id: 'answer', rows: 3, spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
      'aria-label': 'Type the sentence', name: 'd' + Math.random().toString(36).slice(2) });
    var peekBox = h('p', { class: 'passage-sentence peek', hidden: true, text: item.s });
    var body = [];
    if (listen) {
      body.push(h('div', { class: 'qtype', text: 'Dictation - listen and write the whole sentence' }));
      body.push(h('div', { class: 'audio-row' }, [
        U.audioBtn(['🔊 Play ', h('span', { class: 'kbd', text: 'Shift+Enter' })], function () { playSentence(item.s); ta.focus(); }, { id: 'play-btn' }),
        U.audioBtn('🧩 Phrase by phrase', function () { playSentence(item.s, 'phrases'); ta.focus(); }),
        U.audioBtn('🐢 Slow', function () { playSentence(item.s, 'slow'); ta.focus(); })
      ]));
    } else {
      body.push(h('div', { class: 'qtype', text: 'From memory - write the sentence you just read' }));
      body.push(h('div', { class: 'audio-row' }, [U.audioBtn('👁 Peek (2 seconds)', function () {
        R.peeks = (R.peeks || 0) + 1;
        peekBox.hidden = false;
        setTimeout(function () { peekBox.hidden = true; ta.focus(); }, 2000);
      })]));
      body.push(peekBox);
    }
    function submit(giveUp) {
      var typed = giveUp ? '' : ta.value;
      if (!giveUp && !typed.trim()) { U.toast('Type the sentence first, or press "Show the sentence".'); return; }
      var res = P.compare(item.s, typed, { variant: variantFn });
      R.cur = { typed: typed, res: res, notes: recordErrors(R, res) };
      R.results.push({ s: item.s, typed: typed, right: res.right, total: res.total, items: res.items });
      R.phase = 'fb';
      U.render();
    }
    ta.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      if (ev.shiftKey) { if (listen) playSentence(item.s); } else submit(false);
    });
    wrap.appendChild(h('div', { class: 'card qcard' }, body.concat([
      ta,
      h('p', { class: 'small muted', text: 'Write the whole sentence with capitals and punctuation. Numbers can be typed as figures. Enter checks' + (listen ? '; Shift+Enter plays it again.' : '.') }),
      h('div', { class: 'row', style: { marginTop: '10px' } }, [
        h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { submit(false); } }, ['Check', h('span', { class: 'kbd', text: 'Enter' })]),
        h('button', { class: 'btn', onclick: function () { submit(true); } }, 'Show the sentence')
      ])
    ])));
    setTimeout(function () { ta.focus(); }, 30);
    if (listen && U.settings().autoPlay && SP.supported) setTimeout(function () { if (App.dict === R && R.phase === 'q' && R.sents[R.idx] === item) playSentence(item.s); }, 300);
  }

  // Spelling mistakes on known words go into the error log and the review schedule (once per word per run).
  function recordErrors(R, res) {
    var notes = {};
    res.items.forEach(function (it) {
      if (!isErr(it) || /^\d+$/.test(it.t.key)) return;
      var key = it.t.key;
      var m = R.missed[key] || (R.missed[key] = { word: plain(it.t.raw), typed: [] });
      if (it.a) m.typed.push(it.a.key);
      var e = App.words[key];
      if (!e || it.op === 'missing') return;
      var cls = A.classify(it.a.key, e, U.classifyCtx());
      if (it.op === 'wrong' && cls.primary !== 'wrong-word') return;
      notes[it.ti] = cls;
      if (!R.recorded[key]) {
        R.recorded[key] = true;
        ST.recordAnswer(e.id, { ok: false, typed: it.a.key, ms: 0, cats: cls.cats }, { countNew: false });
      }
    });
    return notes;
  }

  function markedSentence(items) {
    var out = h('p', { class: 'marked' });
    items.forEach(function (it, k) {
      if (k) out.appendChild(document.createTextNode(it.t && it.t.join ? '-' : ' '));
      if (it.op === 'extra') { out.appendChild(h('span', { class: 'tok extra', title: 'Extra word: not in the sentence' }, '+' + it.a.raw)); return; }
      if (it.op === 'spell' || it.op === 'wrong') {
        out.appendChild(h('span', { class: 'tok ' + it.op, title: (it.op === 'spell' ? 'Misspelt' : 'Different word') + ': you wrote ' + it.a.raw },
          [h('span', { class: 'tw', text: it.t.raw }), h('span', { class: 'aw', text: it.a.raw })]));
        return;
      }
      var title = { missing: 'You missed this word', variant: 'Accepted spelling: you wrote ' + (it.a && it.a.raw), 'case': 'Capital letter: you wrote ' + (it.a && it.a.raw) }[it.op];
      out.appendChild(h('span', { class: 'tok ' + it.op, title: title || null, text: it.t.raw }));
    });
    return out;
  }

  // The plain correct text, easy to select, copy or translate (one click selects it all).
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* not allowed */ }
      ta.remove();
      U.toast(ok ? 'Copied.' : 'Select the text and press Ctrl+C.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { U.toast('Copied.'); }, fallback);
    else fallback();
  }
  function translateUrl(text) {
    var lang = U.settings().l1 === 'ar' ? 'ar' : ((navigator.language || '').slice(0, 2) || 'ar');
    if (lang === 'en') lang = 'ar';
    return 'https://translate.google.com/?sl=en&tl=' + lang + '&op=translate&text=' + encodeURIComponent(text);
  }
  function plainBlock(label, text, after) {
    function back() { if (after) after(); }
    return h('div', { class: 'plain-text' }, [
      h('div', { class: 'row between' }, [
        h('span', { class: 'small muted', text: label }),
        h('span', { class: 'row' }, [
          h('button', { class: 'btn sm', type: 'button', onclick: function () { copyText(text); back(); } }, '📋 Copy'),
          h('a', { class: 'btn sm', href: translateUrl(text), target: '_blank', rel: 'noopener', onclick: function () { setTimeout(back, 0); } }, '🌐 Translate')
        ])
      ]),
      h('p', { class: 'copyable', text: text })
    ]);
  }
  function focusPrimary() { var b = U.$('#primary-action'); if (b) b.focus(); }

  function markKey() {
    return h('p', { class: 'small muted mark-key' }, [
      h('span', { class: 'tok spell' }, [h('span', { class: 'tw', text: 'word' }), h('span', { class: 'aw', text: 'yours' })]), ' misspelt   ',
      h('span', { class: 'tok missing', text: 'word' }), ' missed   ',
      h('span', { class: 'tok extra', text: '+word' }), ' extra   ',
      h('span', { class: 'tok case', text: 'Word' }), ' capital letter'
    ]);
  }

  function renderMarked(wrap, R) {
    var res = R.cur.res, errs = res.items.filter(isErr);
    var extras = res.items.filter(function (it) { return it.op === 'extra'; });
    var variants = res.items.filter(function (it) { return it.op === 'variant'; });
    var perfect = !errs.length && !extras.length;
    var card = h('div', { class: 'card qcard', 'aria-live': 'polite' }, [
      h('div', { class: 'row between' }, [
        h('div', { class: 'verdict ' + (perfect ? 'ok' : 'bad') }, perfect ? '✓ Every word is right' : res.right + ' of ' + res.total + ' words right'),
        U.audioBtn('🔊 Hear it again', function () {
          playSentence(R.sents[R.idx].s);
          var b = U.$('#primary-action');
          if (b) b.focus();   // so Enter still moves on
        })
      ]),
      markedSentence(res.items),
      R.cur.typed.trim() ? null : h('p', { class: 'small muted', text: 'Here is the sentence. Read it carefully, then write the words from memory.' }),
      plainBlock('Correct sentence', R.sents[R.idx].s, focusPrimary)
    ]);
    if (!perfect) card.appendChild(markKey());
    var whys = [];
    Object.keys(R.cur.notes).forEach(function (ti) {
      var c0 = R.cur.notes[ti].cats[0];
      var it = res.items.filter(function (x) { return x.ti === +ti && x.t; })[0];
      if (c0 && it && whys.length < 4) {
        whys.push(h('li', null, [h('a', { href: '#', onclick: function (ev) { ev.preventDefault(); U.openWord(it.t.key); } }, plain(it.t.raw)), ' ', U.catChip(c0), ' ', c0.why || '']));
      }
    });
    if (whys.length) card.appendChild(h('div', { class: 'why' }, h('ul', { class: 'plain' }, whys)));
    if (variants.length) card.appendChild(h('div', { class: 'note info small', text: 'Accepted, but not your target spelling: ' + variants.map(function (it) { return it.a.raw + ' → ' + it.t.raw; }).join(', ') + '. Stay consistent in your writing.' }));
    var last = R.idx + 1 >= R.sents.length;
    card.appendChild(h('div', { class: 'row', style: { marginTop: '14px' } }, errs.length ? [
      h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { R.phase = 'fix'; U.render(); } }, ['Write the missed words from memory', h('span', { class: 'kbd', text: 'Enter' })]),
      h('button', { class: 'btn', onclick: function () { nextSentence(R); } }, 'Skip')
    ] : [
      h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { nextSentence(R); } }, [last ? 'See the result' : 'Next sentence', h('span', { class: 'kbd', text: 'Enter' })])
    ]));
    wrap.appendChild(card);
  }

  // The sentence again with the missed words blanked out: write them from memory.
  function renderFix(wrap, R) {
    var inputs = [], checked = false;
    var line = h('p', { class: 'marked fix' });
    R.cur.res.items.forEach(function (it, k) {
      if (it.op === 'extra') return;
      if (k) line.appendChild(document.createTextNode(it.t.join ? '-' : ' '));
      var w = plain(it.t.raw);
      if (isErr(it) && w && !/^\d+$/.test(it.t.key)) {
        var at = it.t.raw.indexOf(w);
        if (at > 0) line.appendChild(document.createTextNode(it.t.raw.slice(0, at)));
        var inp = h('input', { type: 'text', class: 'blank', size: String(Math.max(4, w.length + 1)), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Missed word ' + (inputs.length + 1) });
        var ans = h('span', { class: 'fix-answer', hidden: true, text: w });
        var x = { inp: inp, it: it, ans: ans, word: w };
        // Hear the word, then write it: the gap is dictation, not a guessing game.
        var hear = h('button', { class: 'btn ghost sm say', type: 'button', tabindex: '-1', title: 'Listen (Shift+Enter)', 'aria-label': 'Listen to missed word ' + (inputs.length + 1),
          onclick: (function (y) { return function () { U.say(y.word); y.inp.focus(); }; })(x) }, '🔊');
        inputs.push(x);
        line.appendChild(h('span', { class: 'blank-wrap' }, [inp, hear, ans]));
        var tail = it.t.raw.slice(at + w.length);
        if (tail) line.appendChild(document.createTextNode(tail));
      } else {
        line.appendChild(document.createTextNode(it.t.raw));
      }
    });
    var last = R.idx + 1 >= R.sents.length;
    var btn = h('button', { class: 'btn primary', id: 'primary-action', onclick: check }, ['Check', h('span', { class: 'kbd', text: 'Enter' })]);
    function check() {
      if (checked) { nextSentence(R); return; }
      var allOk = true;
      inputs.forEach(function (x) {
        var key = (P.tokens(x.inp.value)[0] || {}).key || '';
        var ok = key === x.it.t.key || variantFn(key, x.it.t.key);
        x.inp.classList.toggle('ok', ok);
        x.inp.classList.toggle('bad', !ok);
        x.ans.hidden = ok;
        if (!ok) allOk = false;
      });
      if (allOk) { U.toast('All correct.'); nextSentence(R); return; }
      checked = true;
      btn.firstChild.textContent = last ? 'See the result' : 'Next sentence';
    }
    var auto = U.settings().autoPlay && SP.supported, cur = inputs[0];
    function goTo(x) { x.inp.focus(); if (auto) U.say(x.word); }
    // The sentence buttons play, then hand the focus back to the gap you were in.
    function sentence(how) { return function () { playSentence(R.sents[R.idx].s, how); if (cur) cur.inp.focus(); }; }
    inputs.forEach(function (x, i) {
      x.inp.addEventListener('focus', function () { cur = x; });
      x.inp.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' || ev.isComposing) return;
        ev.preventDefault();
        if (ev.shiftKey) { U.say(x.word); return; }
        if (!checked && i < inputs.length - 1 && !inputs[i + 1].inp.value) goTo(inputs[i + 1]);
        else check();
      });
    });
    wrap.appendChild(h('div', { class: 'card qcard' }, [
      h('div', { class: 'qtype', text: 'Listen and write the missed words' }),
      h('div', { class: 'audio-row' }, [
        U.audioBtn('🔊 Whole sentence', sentence()),
        U.audioBtn('🐢 Slow', sentence('slow'))
      ]),
      line,
      h('p', { class: 'small muted', text: 'Each gap plays its word' + (auto ? ' when you reach it' : '') + '; press 🔊 or Shift+Enter to hear it again. Enter moves to the next gap, then checks.' }),
      h('div', { class: 'row', style: { marginTop: '14px' } }, [btn, h('button', { class: 'btn', onclick: function () { nextSentence(R); } }, 'Skip')])
    ]));
    if (!inputs.length) { nextSentence(R); return; }
    setTimeout(function () { if (App.dict === R && R.phase === 'fix') goTo(inputs[0]); }, 250);
  }

  function nextSentence(R) {
    R.idx += 1;
    R.cur = null;
    if (R.idx >= R.sents.length) finishRun(R);
    else R.phase = R.mode === 'memory' ? 'show' : 'q';
    U.render();
  }

  function finishRun(R) {
    R.phase = 'summary';
    var right = 0, total = 0;
    R.results.forEach(function (r) { right += r.right; total += r.total; });
    R.score = total ? right / total : 0;
    var attempt = { at: new Date().toISOString(), d: App.today, mode: R.mode, score: Math.round(R.score * 1000) / 1000, n: total, missed: Object.keys(R.missed).slice(0, 25) };
    if (R.src.kind === 'passage') {
      var p = findPassage(R.src.id);
      if (p) p.attempts = (p.attempts || []).concat([attempt]).slice(-20);
    } else {
      attempt.part = R.src.part;
      var s = stats(R.src.id);
      s.attempts = s.attempts.concat([attempt]).slice(-20);
    }
    ST.saveNow();
  }

  function renderRunSummary(wrap, R) {
    var mins = Math.max(1, Math.round((Date.now() - R.startedAt) / 60000));
    var keys = Object.keys(R.missed);
    var known = keys.filter(function (k) { return App.words[k]; });
    var card = h('div', { class: 'card qcard stack' }, [
      h('h2', { text: R.mode === 'memory' ? 'Rewrite complete' : 'Dictation complete' }),
      h('div', { class: 'grid stats' }, [U.stat(pct(R.score), 'words right'), U.stat(R.sents.length, 'sentences'), U.stat(mins, mins === 1 ? 'minute' : 'minutes')])
    ]);
    if (keys.length) {
      card.appendChild(h('div', null, [
        h('h3', { text: 'Words to watch' }),
        h('div', { class: 'word-chips' }, keys.map(function (k) {
          if (App.words[k]) return h('a', { class: 'chip link', href: '#', onclick: function (ev) { ev.preventDefault(); U.openWord(k); } }, U.disp(App.words[k]));
          return h('span', { class: 'chip' }, [R.missed[k].word, h('button', { class: 'btn ghost sm', title: 'Add to my words', onclick: function () { SC.pages.addWord(k); } }, '+ Add')]);
        })),
        h('p', { class: 'small muted', text: known.length ? 'Misspelt words from the word list now come back in your reviews. Use "+ Add" for words that are not in the list yet.' : 'Use "+ Add" to put a word in your own list.' })
      ]));
    } else {
      card.appendChild(h('p', { class: 'verdict ok', text: '✓ No mistakes. Well done.' }));
    }
    card.appendChild(h('details', null, [h('summary', null, h('b', { text: 'Every sentence, marked' })), h('div', { class: 'stack' }, R.results.map(function (r) {
      return h('div', null, [markedSentence(r.items), h('div', { class: 'small muted', text: r.right + ' / ' + r.total + ' words' })]);
    }))]));
    card.appendChild(plainBlock('The whole text', R.text.replace(/\n\s*\n/g, '\n\n'), focusPrimary));
    card.appendChild(h('div', { class: 'row' }, [
      h('button', { class: 'btn primary', id: 'primary-action', onclick: function () { exitRun(R); } }, ['Done', h('span', { class: 'kbd', text: 'Enter' })]),
      known.length ? h('button', { class: 'btn', onclick: function () { App.dict = null; U.startSession('words', { ids: known, title: 'Words from the dictation' }); } }, 'Practise these words') : null,
      h('button', { class: 'btn', onclick: function () { startRun(R.src, R.text, R.title, R.mode, R.focus); } }, 'Do it again')
    ]));
    wrap.appendChild(card);
  }

  // Enter = the main button when the focus is not in a text field (the fields handle Enter themselves).
  document.addEventListener('keydown', function (ev) {
    if ((location.hash || '').indexOf('#dictate') !== 0 || ev.key !== 'Enter' || ev.isComposing) return;
    if (document.querySelector('.modal-backdrop')) return;
    var tag = (ev.target && ev.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(tag)) return;
    var b = U.$('#primary-action');
    if (b) { ev.preventDefault(); b.click(); }
  });

  // ------------------------------------------------------------------ Settings card
  function settingsCard() {
    var src = AI.keySource(), n = AI.keys().length, use = AI.usage(), resting = AI.resting();
    var ta = h('textarea', { rows: 3, spellcheck: 'false', placeholder: 'Paste a Gemini API key (one per line). Free keys: aistudio.google.com → Get API key' });
    var out = h('div', { 'aria-live': 'polite' });
    var keyText = n + ' API key' + (n === 1 ? '' : 's');
    return h('div', { class: 'card', id: 'ai-settings' }, [
      h('h2', { text: 'AI writing helper (Gemini)' }),
      h('p', { class: src === 'none' ? 'note warn small' : 'small', text: src === 'file' ? 'Using ' + keyText + ' from app/ai-keys.local.js.'
        : src === 'settings' ? 'Using ' + keyText + ' saved in this browser.'
        : 'No API key yet. Dictation still works offline with example sentences; AI texts and model answers need a key.' }),
      h('p', { class: 'small muted', text: 'Free models only. Model answers: ' + AI.MODELS.map(function (m) { return m.id; }).join(' → ') +
        '. Dictation texts: ' + AI.FAST.map(function (m) { return m.id; }).join(' → ') + '. When a model runs out of quota or does not answer, the next key, then the next model, takes over. gemini-3.8-flash allows only 20 requests a day per key.' }),
      Object.keys(use).length ? h('p', { class: 'small', text: 'Requests today: ' + Object.keys(use).map(function (k) { return k + ' ' + use[k]; }).join(', ') }) : null,
      resting.length ? h('ul', { class: 'small' }, resting.map(function (r) {
        return h('li', { text: r.model + (n > 1 ? ' (key ' + (r.key + 1) + ')' : '') + ': ' + ({ daily: 'daily limit used', minute: 'per-minute limit', slow: 'did not answer', server: 'server error', key: 'key refused' }[r.why] || r.why) + ', back at ' + r.at });
      })) : null,
      h('label', null, ['API keys', ta]),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', onclick: function () {
          var ks = ta.value.split(/\s+/).filter(Boolean);
          if (!ks.length) { U.toast('Paste at least one key.'); return; }
          AI.saveKeys(ks);
          U.toast('Saved ' + ks.length + ' key' + (ks.length === 1 ? '' : 's') + ' in this browser.');
          U.render();
        } }, 'Save keys in this browser'),
        src === 'settings' && AI.fileKeys().length ? h('button', { class: 'btn ghost', onclick: function () { AI.saveKeys([]); U.render(); } }, 'Use the keys from the file') : null,
        h('button', { class: 'btn', id: 'ai-test', onclick: function () {
          var t0 = Date.now();
          U.clear(out).appendChild(h('p', { class: 'small muted', text: 'Testing…' }));
          AI.generate({ prompt: 'Reply with {"ok": true}.', schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] }, thinking: 'low', fast: true }).then(function (r) {
            U.clear(out).appendChild(h('p', { class: 'note ok small', text: 'Connected: ' + r.model + ' (key ' + (r.key + 1) + ') answered in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s.' }));
          }, function (err) { U.clear(out).appendChild(h('p', { class: 'note bad small', text: err.message })); });
        } }, 'Test connection')
      ]),
      out,
      h('p', { class: 'small muted', style: { marginTop: '10px' }, text: 'Keys stay on this computer and are not included in backups. On the free tier Google may use requests to improve its products; the app sends only practice words and IELTS questions. Everything the AI writes is saved with your progress, so it is in your backups.' })
    ]);
  }

  SC.writing = { settingsCard: settingsCard, chartView: chartView, startRun: startRun, offlinePassage: offlinePassage, candidates: candidates };
})(window);
