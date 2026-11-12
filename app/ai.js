/* Spelling Coach - AI writing material from the Google Gemini API (free tier).
   Builds the prompts, calls the API with model and key fallback, and checks what comes back.
   Shared by the browser and build/gen_writing.js (Node). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SC = root.SC || {}; root.SC.ai = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  // Free-tier text models (ai.google.dev/gemini-api/docs/pricing, checked 2026-10-17), best first.
  // 'think' models accept thinkingLevel; 'low' makes short texts about four times faster.
  var MODELS = [
    { id: 'gemini-3.8-flash', think: true },
    { id: 'gemini-3.6-flash', think: true },
    { id: 'gemini-3.5-flash-lite' },
    { id: 'gemini-3.1-flash-lite' }
  ];
  // Free daily limits are small (gemini-3.8-flash: 20 requests per day per project, seen 2026-10-18), so short
  // texts go to gemini-3.6-flash first and gemini-3.8-flash is kept for model answers.
  var FAST = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].map(function (id) {
    return MODELS.filter(function (m) { return m.id === id; })[0];
  });
  // How long to wait for a model before trying the next one (some calls hang without an answer).
  var WAIT = { fast: 30000, slow: 90000 };
  var LS_KEY = 'spellingCoach.ai';   // keys and usage counts; kept out of progress backups

  var SYSTEM = 'You write study material for an adult whose first language is Arabic and who is preparing for IELTS Academic, ' +
    'aiming for band 8. Use British spelling throughout (for example organise, analyse, colour, centre, travelled, programme, ' +
    'licence as a noun, practise as a verb, per cent). Write natural, accurate, formal English without contractions. Reply with JSON only.';
  // For learners who chose American spelling in Settings.
  var SYSTEM_US = SYSTEM.replace(/Use British spelling[^)]*\)/, 'Use American spelling throughout (for example organize, analyze, color, center, traveled, program, percent)');
  function system(us) { return us ? SYSTEM_US : SYSTEM; }

  var TOPICS = ['education', 'technology', 'the environment', 'health', 'work and employment', 'cities and housing', 'transport',
    'crime and punishment', 'government spending', 'globalisation', 'the media and advertising', 'family and children', 'tourism',
    'culture and language', 'science and research', 'sport and leisure', 'an ageing population', 'food and agriculture', 'energy', 'water'];

  var LENGTHS = {
    sentences: { label: 'Separate sentences', words: 6, ask: 'between 4 and 6 separate sentences of 10 to 18 words each, all on one topic' },
    short: { label: 'Short paragraph', words: 8, ask: 'one paragraph of 60 to 90 words' },
    paragraph: { label: 'Long paragraph', words: 12, ask: 'one paragraph of 120 to 160 words' }
  };

  var CHARTS = {
    line: { label: 'Line graph', ask: 'a line graph', data: 'labels = 5 to 8 points in time (for example years); series = 2 to 4 lines, each with one value per label' },
    bar: { label: 'Bar chart', ask: 'a bar chart', data: 'labels = 4 to 6 categories; series = 1 to 3 groups (for example two years), each with one value per label' },
    pie: { label: 'Pie charts', ask: 'two pie charts', data: 'labels = 4 to 6 categories; series = exactly 2 pies (for example two years); each pie\'s values are percentages that add up to 100' },
    table: { label: 'Table', ask: 'a table', data: 'labels = 4 to 6 rows; series = 3 or 4 columns, each with one value per row' },
    process: { label: 'Process diagram', ask: 'a process diagram', data: 'steps = 6 to 10 stages in order, 3 to 8 words each; labels and series are empty and unit is empty' }
  };
  var ESSAYS = {
    opinion: { label: 'Opinion', ask: 'an opinion essay that ends with "To what extent do you agree or disagree?"' },
    discussion: { label: 'Discussion', ask: 'a discussion essay that ends with "Discuss both these views and give your own opinion."' },
    advantages: { label: 'Advantages and disadvantages', ask: 'an advantages and disadvantages essay (for example "Do the advantages of this outweigh the disadvantages?")' },
    problem: { label: 'Problem and solution', ask: 'a problem and solution essay (for example "What problems does this cause? What solutions can you suggest?")' },
    twopart: { label: 'Two-part question', ask: 'a two-part question essay with two direct questions' }
  };

  // ------------------------------------------------------------------ schemas (Gemini OpenAPI subset)
  var STR = { type: 'STRING' };
  var STRS = { type: 'ARRAY', items: STR };
  function obj(props) { return { type: 'OBJECT', properties: props, required: Object.keys(props) }; }
  var PASSAGE_SCHEMA = obj({ title: STR, text: STR, used: STRS });
  var CHART_SCHEMA = obj({
    type: { type: 'STRING', enum: Object.keys(CHARTS) }, title: STR, unit: STR, labels: STRS,
    series: { type: 'ARRAY', items: obj({ name: STR, values: { type: 'ARRAY', items: { type: 'NUMBER' } } }) },
    steps: STRS
  });
  var TASK1_SCHEMA = obj({ question: STR, chart: CHART_SCHEMA, answer: STR, tips: STRS, phrases: STRS });
  var TASK2_SCHEMA = obj({ question: STR, answer: STR, tips: STRS, phrases: STRS });
  var OWN_SCHEMA = obj({ task: { type: 'INTEGER' }, question: STR, answer: STR, tips: STRS, phrases: STRS });

  // ------------------------------------------------------------------ keys and usage (browser)
  function cfg() {
    try { return JSON.parse(root.localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function setCfg(c) {
    try { root.localStorage.setItem(LS_KEY, JSON.stringify(c)); return true; } catch (e) { return false; }
  }
  function ownKeys() { return (cfg().keys || []).filter(Boolean); }
  function fileKeys() { return (root.SC_AI_KEYS || []).filter(Boolean); }
  // Keys saved in Settings win over app/ai-keys.local.js.
  function keys() { var k = ownKeys(); return k.length ? k : fileKeys(); }
  function keySource() { return ownKeys().length ? 'settings' : fileKeys().length ? 'file' : 'none'; }
  function saveKeys(list) {
    var c = cfg();
    c.keys = (list || []).map(function (k) { return String(k).trim(); }).filter(Boolean);
    return setCfg(c);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function countUse(model) {
    var c = cfg();
    if (!c.usage || c.usage.day !== today()) c.usage = { day: today(), n: {} };
    c.usage.n[model] = (c.usage.n[model] || 0) + 1;
    setCfg(c);
  }
  function usage() { var c = cfg(); return c.usage && c.usage.day === today() ? c.usage.n : {}; }

  // ------------------------------------------------------------------ resting models
  // A model+key pair that hit its daily limit is skipped until Google's reset time; one that hit the per-minute limit,
  // timed out or had a server error rests briefly. Kept in localStorage (browser) and in memory (Node, private mode).
  var memCool = {};
  function coolId(model, key) { return model + '|' + String(key).slice(-8); }
  function cooling() {
    var all = Object.assign({}, memCool, cfg().cool || {}), now = Date.now(), out = {};
    Object.keys(all).forEach(function (k) { if (all[k].until > now) out[k] = all[k]; });
    return out;
  }
  function rest(model, key, ms, why) {
    var k = coolId(model, key), v = { until: Date.now() + ms, why: why };
    memCool[k] = v;
    var c = cfg();
    c.cool = cooling();
    c.cool[k] = v;
    setCfg(c);
  }
  function resetCooldowns() { memCool = {}; var c = cfg(); if (c.cool) { delete c.cool; setCfg(c); } }
  function clock(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  // For Settings: which models are resting on which key.
  function resting() {
    var c = cooling(), ks = keys(), out = [];
    MODELS.forEach(function (m) {
      ks.forEach(function (k, i) { var v = c[coolId(m.id, k)]; if (v) out.push({ model: m.id, key: i, why: v.why, until: v.until, at: clock(v.until) }); });
    });
    return out;
  }

  // ------------------------------------------------------------------ the API call
  function aiError(code, message) { var e = new Error(message); e.code = code; return e; }

  function parseResponse(j) {
    var c = j && j.candidates && j.candidates[0];
    var parts = (c && c.content && c.content.parts) || [];
    var text = parts.filter(function (p) { return !p.thought && typeof p.text === 'string'; }).map(function (p) { return p.text; }).join('');
    if (!text) throw aiError('empty', 'The model returned no text' + (c && c.finishReason ? ' (' + c.finishReason + ')' : '') + '.');
    text = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(text); } catch (e) { throw aiError('bad-json', 'The model did not return valid JSON.'); }
  }

  function call(f, model, key, req, noThink, timeout) {
    var gc = { responseMimeType: 'application/json', temperature: req.temperature != null ? req.temperature : 0.8 };
    if (req.schema) gc.responseSchema = req.schema;
    if (model.think && req.thinking && !noThink) gc.thinkingConfig = { thinkingLevel: req.thinking };
    var parts = [{ text: req.prompt }];
    (req.images || []).forEach(function (im) { parts.push({ inlineData: { mimeType: im.mime, data: im.data } }); });
    var body = { contents: [{ role: 'user', parts: parts }], generationConfig: gc };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout || 120000) : null;
    return f(API + model.id + ':generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.text().then(function (txt) { return { status: r.status, txt: txt }; });
    }, function (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw aiError('timeout', 'No answer within ' + Math.round((timeout || 120000) / 1000) + ' seconds.');
      throw aiError('offline', 'Cannot reach the Gemini API. Check the internet connection.');
    }).then(function (r) {
      clearTimeout(timer);
      var j = null;
      try { j = JSON.parse(r.txt); } catch (e) { /* not JSON */ }
      if (r.status !== 200) {
        var msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
        var code = r.status === 429 ? 'quota' : r.status === 400 && /thinking/i.test(msg) ? 'thinking'
          : r.status === 401 || r.status === 403 ? 'key' : r.status >= 500 ? 'server' : 'bad-request';
        var err = aiError(code, msg.slice(0, 220));
        if (r.status === 429) {
          // Google says which quota ran out (per day or per minute) and when to retry ("25487s").
          var det = (j && j.error && j.error.details) || [];
          err.daily = det.some(function (d) { return (d.violations || []).some(function (v) { return /PerDay/i.test(v.quotaId || ''); }); });
          var delay = det.map(function (d) { return d.retryDelay; }).filter(Boolean)[0];
          err.retryMs = delay ? parseFloat(delay) * 1000 : null;
        }
        throw err;
      }
      return parseResponse(j);
    });
  }

  function keyName(t, n) { return n > 1 ? ' (key ' + (t.i + 1) + ')' : ''; }
  function why(err, t, n) {
    var who = t.m.id + keyName(t, n);
    if (err.code === 'quota') return who + (err.daily ? ' has used its free daily limit' + (err.retryMs ? ' (back at ' + clock(Date.now() + err.retryMs) + ')' : '') : ' is busy (per-minute limit)') + '.';
    if (err.code === 'timeout') return who + ' did not answer in time.';
    if (err.code === 'server') return who + ' had a server error.';
    if (err.code === 'key') return who + ' refused the key.';
    return who + ' failed: ' + err.message;
  }

  /* generate(req, opts) -> Promise<{data, model, key}>
     req: {prompt, system, schema, images:[{mime, data(base64)}], thinking:'low'|undefined, temperature, fast}
     opts: {keys, fetch, models, timeout, onStatus(text)}. The same model is tried on every key (each key's project
     has its own free quota) before the next model. Resting pairs are skipped (see rest()); being offline stops at once. */
  function generate(req, opts) {
    opts = opts || {};
    var ks = opts.keys || keys();
    var f = opts.fetch || root.fetch || (typeof fetch === 'function' ? fetch : null);
    var say = opts.onStatus || function () {};
    if (!ks.length) return Promise.reject(aiError('nokey', 'No Gemini API key. Add one in Settings → AI writing helper.'));
    if (!f) return Promise.reject(aiError('offline', 'This browser cannot make network requests.'));
    var wait = opts.timeout || (req.fast ? WAIT.fast : WAIT.slow);
    var cool = cooling(), ready = [], later = [], spent = [];
    (opts.models || (req.fast ? FAST : MODELS)).forEach(function (m) {
      ks.forEach(function (k, i) {
        var c = cool[coolId(m.id, k)], t = { m: m, k: k, i: i };
        if (!c) ready.push(t);
        else if (c.why === 'daily') spent.push(c.until);
        else later.push(t);   // briefly resting: still worth a try if nothing else is left
      });
    });
    var tries = ready.concat(later), errors = [];
    if (!tries.length) {
      return Promise.reject(aiError('quota', 'Every free model has used its daily limit. They are back at ' + clock(Math.min.apply(null, spent)) + '.'));
    }
    function attempt(n, noThink) {
      if (n >= tries.length) {
        var quota = errors.length && errors.every(function (e) { return e.code === 'quota'; });
        var back = errors.filter(function (e) { return e.retryMs; }).map(function (e) { return e.retryMs; });
        return Promise.reject(aiError(quota ? 'quota' : 'failed', quota
          ? 'Every free model is out of quota right now.' + (back.length ? ' The first is back at ' + clock(Date.now() + Math.min.apply(null, back)) + '.' : '')
          : 'Every model failed. Last error: ' + (errors.length ? errors[errors.length - 1].message : 'unknown')));
      }
      var t = tries[n];
      if (n === 0) say('Asking ' + t.m.id + keyName(t, ks.length) + '…');
      return call(f, t.m, t.k, req, noThink, wait).then(function (data) {
        if (!opts.keys) countUse(t.m.id);
        return { data: data, model: t.m.id, key: t.i };
      }, function (err) {
        if (err.code === 'offline') throw err;
        if (err.code === 'thinking' && !noThink) return attempt(n, true);
        errors.push(err);
        if (err.code === 'quota') rest(t.m.id, t.k, err.retryMs || (err.daily ? 3600000 : 60000), err.daily ? 'daily' : 'minute');
        // A silent model tends to stay silent (gemini-3.8-flash on one key hung on every call, 2026-10-17).
        else if (err.code === 'timeout') rest(t.m.id, t.k, 3 * 3600000, 'slow');
        else if (err.code === 'server' || err.code === 'key') rest(t.m.id, t.k, 120000, err.code);
        var next = tries[n + 1];
        if (next) say(why(err, t, ks.length) + ' Trying ' + next.m.id + keyName(next, ks.length) + '…');
        return attempt(n + 1);
      });
    }
    return attempt(0);
  }

  // ------------------------------------------------------------------ British spelling safety net
  // US forms that are also correct British words (practice, program, licence/license, draft, meter...) or whose
  // British form is archaic (ancle, gaol, waggon) are left alone.
  var STOP = /^(programs?|practices?|licens(e|es|ed|ing)|drafts?|tons?|filters?|reflections?|deflections?|medieval|tires?|disks?|ankles?|griffins?|wagons?|(kilo|milli)?grams?|biased|dispatch(es|ed)?|chili|yogurt|jail(s|ed|break)?|annex|carcass|groin|slough|almanac|gypsies|ecumenical|meters?|sulf(ur|ate)s?|savory|analog|story|stories|checks?|curbs?|inquir(y|ies)|dialogs?)$/;
  function toBritish(text, map) {
    if (!map) return String(text || '');
    return String(text || '').replace(/[A-Za-z]+/g, function (w) {
      var lw = w.toLowerCase();
      var uk = Object.prototype.hasOwnProperty.call(map, lw) ? map[lw] : null;
      if (!uk || STOP.test(lw)) return w;
      if (w.length > 1 && w === w.toUpperCase()) return uk.toUpperCase();
      if (w[0] !== w[0].toLowerCase()) return uk[0].toUpperCase() + uk.slice(1);
      return uk;
    });
  }

  // ------------------------------------------------------------------ text helpers
  function clean(text) {
    return String(text || '').replace(/\r/g, '').replace(/[*_#`]+/g, '').replace(/[ \t]+/g, ' ')
      .split(/\n\s*\n/).map(function (p) { return p.replace(/\s*\n\s*/g, ' ').trim(); }).filter(Boolean).join('\n\n');
  }
  function wordCount(text) { return (String(text || '').match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length; }
  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function hasWord(text, w) { return new RegExp('(^|[^A-Za-z\'’])' + escapeRe(w) + '(?![A-Za-z])', 'i').test(text); }
  function list(xs, n) { return (Array.isArray(xs) ? xs : []).map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, n || 12); }

  // ------------------------------------------------------------------ dictation from my mistakes
  function passageRequest(words, opts) {
    opts = opts || {};
    var L = LENGTHS[opts.length] || LENGTHS.short;
    return {
      system: system(opts.us), schema: PASSAGE_SCHEMA, thinking: 'low', temperature: 0.9, fast: true,
      prompt: [
        'Write a dictation text for spelling practice: ' + L.ask + '.',
        opts.topic ? 'The topic is ' + opts.topic + '.' : 'Choose one common IELTS topic (for example education, the environment, health, work, technology, travel or city life).',
        'The text must contain EVERY one of these target words, spelled exactly as given and in exactly this form (do not change the ending): ' + words.join(', ') + '.',
        'Use each target word naturally, in a meaning that fits, and spread them across the text. The other words can be ordinary academic English.',
        'Do not use lists, headings, quotation marks, brackets or abbreviations.',
        'Return title (3 to 6 words), text, and used (the target words exactly as they appear in the text).'
      ].join('\n')
    };
  }

  function checkPassage(data, words, map) {
    var text = toBritish(clean(data && data.text), map);
    return {
      title: String((data && data.title) || 'Dictation').trim().slice(0, 80),
      text: text,
      missing: words.filter(function (w) { return !hasWord(text, w); })
    };
  }

  /* makePassage(words, opts) -> Promise<passage>. Asks again once if more than a quarter of the words are missing. */
  function makePassage(words, opts) {
    opts = opts || {};
    function once() {
      return generate(passageRequest(words, opts), opts).then(function (r) {
        var p = checkPassage(r.data, words, opts.map);
        p.model = r.model;
        return p;
      });
    }
    return once().then(function (p) {
      if (p.text && p.missing.length <= words.length / 4) return p;
      return once().then(function (q) { return q.missing.length < p.missing.length ? q : p; }, function () { return p; });
    }).then(function (p) {
      if (!p.text) throw aiError('empty', 'The model returned an empty text.');
      return { kind: 'mistakes', title: p.title, text: p.text, words: words.slice(), missing: p.missing, model: p.model, created: new Date().toISOString() };
    });
  }

  // ------------------------------------------------------------------ IELTS Writing tasks
  function task1Request(type, topic, us) {
    var C = CHARTS[type] || CHARTS.line;
    return {
      system: system(us), schema: TASK1_SCHEMA, temperature: 0.9,
      prompt: [
        'Create one IELTS Academic Writing Task 1 question based on ' + C.ask + ' about ' + topic + ', with realistic invented data.',
        'question: the usual exam wording, for example "The graph below shows ... Summarise the information by selecting and reporting the main features, and make comparisons where relevant."',
        'chart: type "' + type + '"; title; unit (for example "%", "millions", "tonnes"; empty if not numeric); ' + C.data + '. Use round, believable numbers.',
        'answer: a model answer that would score band 9: 170 to 200 words in 4 paragraphs separated by a blank line (an introduction that paraphrases the question, an overview of the main features, and two body paragraphs that group the information and quote accurate figures from the data). Describe only what the data shows: no opinions and no causes.',
        'tips: 3 or 4 short notes on what makes this answer band 9.',
        'phrases: 6 to 8 useful phrases taken from the answer.'
      ].join('\n')
    };
  }

  function task2Request(type, topic, us) {
    var E = ESSAYS[type] || ESSAYS.opinion;
    return {
      system: system(us), schema: TASK2_SCHEMA, temperature: 0.9,
      prompt: [
        'Create one IELTS Academic Writing Task 2 question: ' + E.ask + ' on the topic of ' + topic + '.',
        'question: the real exam wording: one or two sentences that state the issue, then the instruction, then "Give reasons for your answer and include any relevant examples from your own knowledge or experience."',
        'answer: a model answer that would score band 9: 270 to 310 words in 4 or 5 paragraphs separated by a blank line (an introduction with a clear position, body paragraphs that each develop one main idea with an explanation and an example, and a conclusion). Answer every part of the question.',
        'tips: 3 or 4 short notes on what makes this answer band 9.',
        'phrases: 6 to 8 useful phrases taken from the answer.'
      ].join('\n')
    };
  }

  function ownRequest(question, image, us) {
    var req = {
      system: system(us), schema: OWN_SCHEMA, temperature: 0.7,
      prompt: [
        'Here is an IELTS Writing question' + (image ? ' and an image of its chart, table or diagram' : '') + ':',
        question ? '"""' + question + '"""' : '(The question is in the image.)',
        'Decide whether it is Task 1 (describe visual information) or Task 2 (an essay).',
        'Write a model answer that would score band 9. Task 1: 170 to 200 words in 4 paragraphs (introduction, overview, two body paragraphs with accurate figures; only what the data shows). Task 2: 270 to 310 words in 4 or 5 paragraphs. Separate paragraphs with a blank line.',
        'Return task (1 or 2), question (the question text, tidied; if it is only in the image, copy its wording from the image), answer, tips (3 or 4 notes on what makes the answer band 9) and phrases (6 to 8 useful phrases from the answer).',
        'If the input is not an IELTS Writing question or the image cannot be read, return an empty answer.'
      ].join('\n')
    };
    if (image) req.images = [image];
    return req;
  }

  function validateChart(c) {
    var errs = [];
    if (!c || !CHARTS[c.type]) return ['unknown chart type'];
    if (c.type === 'process') {
      if (list(c.steps, 20).length < 3) errs.push('a process needs at least 3 steps');
      return errs;
    }
    var labels = list(c.labels, 20);
    if (labels.length < 2) errs.push('too few labels');
    if (!Array.isArray(c.series) || !c.series.length) errs.push('no data series');
    (c.series || []).forEach(function (s) {
      var v = s && s.values;
      if (!Array.isArray(v) || v.length !== labels.length) errs.push('series "' + (s && s.name) + '" has ' + (v ? v.length : 0) + ' values for ' + labels.length + ' labels');
      else if (!v.every(function (x) { return typeof x === 'number' && isFinite(x); })) errs.push('series "' + s.name + '" has a value that is not a number');
      else if (c.type === 'pie' && Math.abs(v.reduce(function (a, b) { return a + b; }, 0) - 100) > 3) errs.push('pie "' + s.name + '" does not add up to 100');
    });
    return errs;
  }

  function tidyChart(c) {
    var out = { type: c.type, title: String(c.title || '').trim(), unit: String(c.unit || '').trim() };
    if (c.type === 'process') { out.steps = list(c.steps, 20); return out; }
    out.labels = list(c.labels, 20);
    out.series = c.series.slice(0, c.type === 'pie' ? 3 : 6).map(function (s) {
      return { name: String(s.name || '').trim(), values: s.values.map(Number) };
    });
    return out;
  }

  function checkTask(data, task, map) {
    var problems = [];
    var answer = toBritish(clean(data && data.answer), map);
    var wc = wordCount(answer);
    var min = task === 1 ? 150 : 250;
    if (!answer) problems.push('no model answer');
    else if (wc < min) problems.push('model answer has only ' + wc + ' words');
    var out = {
      task: task,
      question: toBritish(clean(data && data.question), map),
      answer: answer,
      words: wc,
      tips: list(data && data.tips, 6).map(function (t) { return toBritish(t, map); }),
      phrases: list(data && data.phrases, 10).map(function (t) { return toBritish(t, map); })
    };
    if (!out.question) problems.push('no question');
    if (task === 1 && data && data.chart) {
      var errs = validateChart(data.chart);
      if (errs.length) problems = problems.concat(errs);
      else out.chart = tidyChart(data.chart);
    } else if (task === 1 && data && 'chart' in data) {
      problems.push('no chart data');
    }
    return { task: out, problems: problems };
  }

  /* makeTask(task, type, topic, opts) -> Promise<task item>. Up to 3 attempts until the data and answer check out. */
  function makeTask(task, type, topic, opts) {
    opts = opts || {};
    topic = topic || TOPICS[Math.floor(Math.random() * TOPICS.length)];
    var req = task === 1 ? task1Request(type, topic, opts.us) : task2Request(type, topic, opts.us);
    var last = null;
    function attempt(n) {
      return generate(req, opts).then(function (r) {
        var c = checkTask(r.data, task, opts.map);
        c.task.model = r.model;
        if (!c.problems.length || n >= 2) {
          if (c.problems.length && (!c.task.answer || (task === 1 && !c.task.chart))) throw aiError('invalid', 'The model\'s task did not check out: ' + c.problems.join('; '));
          return c.task;
        }
        last = c;
        return attempt(n + 1);
      });
    }
    return attempt(0).then(function (t) {
      return Object.assign(t, { type: type, topic: topic, source: 'mine', created: new Date().toISOString() });
    }, function (e) {
      if (last && last.task.answer && (task === 2 || last.task.chart)) return Object.assign(last.task, { type: type, topic: topic, source: 'mine', created: new Date().toISOString() });
      throw e;
    });
  }

  /* answerOwn(question, image, opts) -> Promise<task item> for a question the learner brings (text and/or a chart image). */
  function answerOwn(question, image, opts) {
    opts = opts || {};
    return generate(ownRequest(String(question || '').trim(), image, opts.us), opts).then(function (r) {
      var task = r.data && +r.data.task === 1 ? 1 : 2;
      var c = checkTask(r.data, task, opts.map);
      if (!c.task.answer) throw aiError('invalid', 'The model could not read this as an IELTS Writing question.');
      return Object.assign(c.task, { type: 'own', topic: '', source: 'own', model: r.model, created: new Date().toISOString() });
    });
  }

  return {
    MODELS: MODELS, FAST: FAST, TOPICS: TOPICS, LENGTHS: LENGTHS, CHARTS: CHARTS, ESSAYS: ESSAYS, STOP: STOP, SYSTEM: SYSTEM,
    keys: keys, keySource: keySource, saveKeys: saveKeys, fileKeys: fileKeys, usage: usage, resting: resting, resetCooldowns: resetCooldowns,
    generate: generate, parseResponse: parseResponse, toBritish: toBritish, clean: clean, wordCount: wordCount, hasWord: hasWord,
    passageRequest: passageRequest, checkPassage: checkPassage, makePassage: makePassage,
    task1Request: task1Request, task2Request: task2Request, ownRequest: ownRequest,
    validateChart: validateChart, checkTask: checkTask, makeTask: makeTask, answerOwn: answerOwn
  };
});
