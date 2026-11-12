/* Spelling Coach - dictionary for user-added words: bundled lexicon (offline, Open English
   WordNet) first, then Wiktionary's public REST API when online. */
(function (root) {
  'use strict';
  var wordSet = null, freqMap = null, usSet = null, lexPromise = null;

  function loadLexicon() {
    if (root.SC_LEX) return Promise.resolve(true);
    if (lexPromise) return lexPromise;
    lexPromise = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'data/lexicon.js';
      s.async = true;
      s.onload = function () { resolve(!!root.SC_LEX); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
    return lexPromise;
  }

  function index() {
    if (wordSet || !root.SC_LEX) return;
    var words = root.SC_LEX.words.split('|');
    var fq = root.SC_LEX.fq;
    wordSet = new Set(words);
    freqMap = new Map();
    for (var i = 0; i < words.length; i++) freqMap.set(words[i], (fq.charCodeAt(i) - 48) / 5);
    usSet = new Set((root.SC_LEX.us || '').split('|'));
    (root.SC_WORDS || []).forEach(function (w) { wordSet.add(w.id); });
  }

  function isWord(w) {
    index();
    return wordSet ? wordSet.has(String(w).toLowerCase()) : false;
  }
  function freq(w) { index(); return freqMap && freqMap.has(w) ? freqMap.get(w) : 0; }
  function isUS(w) { index(); return usSet ? usSet.has(w) : false; }

  var POS = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' };

  function offline(word) {
    index();
    var raw = root.SC_LEX && root.SC_LEX.defs[word.toLowerCase()];
    if (!raw) return null;
    var p = raw.split('|');
    var ex = p[2] ? p[2].charAt(0).toUpperCase() + p[2].slice(1) : '';
    if (ex && !/[.?!]$/.test(ex)) ex += '.';
    return { pos: POS[p[0]] || '', d: [p[1].charAt(0).toUpperCase() + p[1].slice(1) + '.'], ex: ex ? [ex] : [], source: 'WordNet' };
  }

  function textOf(htmlStr) {
    var doc = new DOMParser().parseFromString('<div>' + (htmlStr || '') + '</div>', 'text/html');
    doc.querySelectorAll('ol, ul, dl').forEach(function (n) { n.remove(); });
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  var BAD = /\b(obsolete|archaic|dated|rare|dialect|slang|vulgar|offensive|nonstandard|derogatory)\b/i;
  var FORM_OF = /^(simple past|past participle|present participle|plural|third-person singular|comparative|superlative|alternative spelling|alternative form|standard spelling|british spelling|non-oxford british spelling|american spelling|misspelling)[^.;]*?\bof ([A-Za-z][A-Za-z'-]*)/i;

  function fetchWikt(word) {
    var url = 'https://en.wiktionary.org/api/rest_v1/page/definition/' + encodeURIComponent(word.replace(/ /g, '_'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 8000);
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      clearTimeout(timer);
      return r.ok ? r.json() : null;
    }).catch(function () { clearTimeout(timer); return null; });
  }

  function parseWikt(data) {
    var out = [];
    ((data && data.en) || []).forEach(function (block) {
      (block.definitions || []).forEach(function (d) {
        var text = textOf(d.definition);
        if (!text) return;
        var labels = '';
        while (/^\(/.test(text)) {
          var m = /^\(([^()]*)\)\s*/.exec(text);
          if (!m) break;
          labels += m[1] + ' ';
          text = text.slice(m[0].length);
        }
        if (!text || BAD.test(labels)) return;
        out.push({ pos: (block.partOfSpeech || '').toLowerCase(), d: text, ex: (d.examples || []).map(textOf).filter(Boolean) });
      });
    });
    return out;
  }

  function online(word) {
    return fetchWikt(word).then(function (data) {
      var entries = parseWikt(data);
      if (!entries.length) return null;
      entries.word = word;
      var fo = FORM_OF.exec(entries[0].d);
      if (fo) {
        return fetchWikt(fo[2]).then(function (base) {
          var be = parseWikt(base);
          if (!be.length) return pack(entries, '');
          be.word = fo[2];
          var exs = entries.reduce(function (a, e) { return a.concat(e.ex); }, []).filter(function (s) { return neutral(s, word); });
          var res = pack(be, /spelling|form/i.test(fo[1]) ? '' : fo[1].toLowerCase() + ' ' + fo[2] + ': ');
          res.ex = exs.concat(res.ex).slice(0, 2);
          return res;
        });
      }
      return pack(entries, '');
    });
  }

  // Same idea as the build: keep example sentences neutral (no religion, politics, violence...).
  var SENSITIVE = /\b(kill\w*|murder\w*|suicide|dead|death|gun\w*|sex\w*|drunk\w*|hate\w*|stupid|idiot\w*|god|jesus|allah|christianity|hinduism|judaism|islam|religio\w*|church|mosque|war|hitler|nazi\w*|terror\w*|racis\w*|trump|obama|putin|propaganda|beer|wine|drug\w*|blood\w*|naked)\b/i;
  function neutral(s, word) {
    return !SENSITIVE.test(s.replace(new RegExp('\\b' + word.replace(/[^a-z]/gi, '') + '\\b', 'ig'), ' ')) && !/citations:|for quotations/i.test(s);
  }

  function pack(entries, note) {
    var defs = [], seen = {};
    entries.forEach(function (e) {
      if (defs.length >= 2 || FORM_OF.test(e.d) || (seen[e.pos] && defs.length && entries.some(function (x) { return !seen[x.pos]; }))) return;
      seen[e.pos] = true;
      var d = e.d.replace(/\.$/, '') + '.';
      defs.push(note ? note + d.charAt(0).toLowerCase() + d.slice(1) : d);
    });
    var word = entries.word || '';
    var exs = entries.reduce(function (a, e) { return a.concat(e.ex); }, []).filter(function (s) { return s.split(' ').length <= 25 && neutral(s, word); });
    return { pos: entries[0].pos, d: defs.map(function (d) { return d.charAt(0).toUpperCase() + d.slice(1); }), ex: exs.slice(0, 2), source: 'Wiktionary' };
  }

  /* lookup(word) -> Promise<{pos, d[], ex[], source}|null>; online result preferred when available. */
  function lookup(word, opts) {
    opts = opts || {};
    var w = String(word || '').trim();
    return loadLexicon().then(function () {
      var off = offline(w);
      if (opts.offlineOnly || !root.navigator || root.navigator.onLine === false) return off;
      return online(w).then(function (on) {
        if (!on) return off;
        if (off && !on.ex.length) on.ex = off.ex;
        return on;
      });
    });
  }

  /* analyse(word) -> {sum, tags} using the same morphology code as the build. */
  function analyse(word) {
    var M = root.SC.morph;
    var w = String(word).toLowerCase();
    var seg = M.segment(w, isWord, { strict: true, freq: freq, isUS: isUS });
    var roots = M.findRoots(w, (root.SC_META && root.SC_META.roots) || {}, 5);
    var tags = M.tagsFor(w, { seg: seg, roots: roots });
    return {
      sum: seg ? seg.parts.map(function (p) { return [p.t, p.s, p.r || '', p.n || '']; }) : null,
      tags: tags, root: roots.length ? roots : undefined
    };
  }

  root.SC = root.SC || {};
  root.SC.dict = { loadLexicon: loadLexicon, isWord: isWord, freq: freq, lookup: lookup, offline: offline, analyse: analyse };
})(typeof self !== 'undefined' ? self : this);
