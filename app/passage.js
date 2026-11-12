/* Spelling Coach - passage dictation: sentence splitting and word-by-word marking of what was typed.
   Shared by the browser and the Node tests. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SC = root.SC || {}; root.SC.passage = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ABBR = /(^|\s)(e\.g|i\.e|etc|vs|approx|Mr|Mrs|Ms|Dr|Prof|St|No)\.$/i;

  /* split(text) -> [{s, p}]: sentences with their paragraph number. Paragraphs are separated by blank lines. */
  function split(text) {
    var out = [];
    String(text || '').replace(/\r/g, '').split(/\n\s*\n/).forEach(function (para, p) {
      var buf = '';
      para.replace(/\s+/g, ' ').trim().split(/(?<=[.!?]["'’”)]?)\s+(?=["'‘“(]?[A-Z0-9])/).forEach(function (piece) {
        buf = buf ? buf + ' ' + piece : piece;
        if (ABBR.test(buf)) return;
        out.push({ s: buf.trim(), p: p });
        buf = '';
      });
      if (buf.trim()) out.push({ s: buf.trim(), p: p });
    });
    return out.filter(function (x) { return x.s; });
  }

  var BREAK_BEFORE = /^(and|but|or|which|that|who|whose|because|while|although|whereas|when|where|if|so|to|of|in|on|for|with|by|from|as|than)$/i;
  /* chunks(sentence) -> phrases of about max words for phrase-by-phrase dictation (split at punctuation first). */
  function chunks(s, max) {
    max = max || 7;
    var out = [];
    String(s || '').split(/(?<=[,;:])\s+/).forEach(function (piece) {
      var w = piece.split(/\s+/).filter(Boolean);
      while (w.length > max + 2) {
        var cut = max;
        for (var i = max; i >= 3; i--) if (BREAK_BEFORE.test(w[i])) { cut = i; break; }
        out.push(w.slice(0, cut).join(' '));
        w = w.slice(cut);
      }
      if (w.length) out.push(w.join(' '));
    });
    return out;
  }

  // ------------------------------------------------------------------ tokens
  var NUM = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
    eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20' };

  // Same normalisation on both sides, so "25%", "25 percent" and "25 per cent" all compare equal.
  function prep(text) {
    return String(text || '')
      .replace(/[‘’ʼ`]/g, '\'').replace(/[“”]/g, '"').replace(/[‐‑‒–—―]/g, '-')
      .replace(/(\d),(?=\d{3}\b)/g, '$1')
      .replace(/(\d)\s*%/g, '$1 per cent')
      .replace(/\bpercent\b/gi, 'per cent');
  }

  /* tokens(text) -> [{raw, key, join}]. Hyphenated words become separate tokens (join: true on the part after the
     hyphen), so "well-known" and "well known" match. key is lower-case, without outer punctuation. */
  function tokens(text) {
    var out = [];
    prep(text).split(/\s+/).forEach(function (chunk) {
      if (!chunk) return;
      chunk.split(/(?<=[A-Za-z0-9'])-(?=[A-Za-z0-9])/).forEach(function (raw, i) {
        var key = raw.toLowerCase().replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
        if (!key) return;
        if (NUM[key]) key = NUM[key];
        out.push({ raw: raw, key: key, join: i > 0 });
      });
    });
    return out;
  }

  // Edit distance with adjacent swaps counted as one edit (recieve -> receive = 1).
  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length, pp = null, prev = [], cur, i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur = [i];
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (pp && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      }
      pp = prev;
      prev = cur;
    }
    return prev[n];
  }

  function close(a, b) {
    var d = lev(a, b), L = Math.max(a.length, b.length);
    if (L <= 3) return d <= 1 && a[0] === b[0];
    return d <= Math.max(1, Math.floor(L * 0.4)) || (a[0] === b[0] && d <= L / 2);
  }
  // Spelling by sound: ph/f, ck/k and double letters, so "fenominm" is still a try at "phenomenon".
  function sound(s) { return s.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/([a-z])\1/g, '$1'); }
  // A misspelling of the target rather than a different word: close in letters or in sound.
  function similar(a, b) { return close(a, b) || close(sound(a), sound(b)); }

  function letters(s) { return s.replace(/[^A-Za-z]/g, ''); }
  function hasCap(s) { return /[A-Z]/.test(letters(s)); }

  /* compare(target, typed, opts) -> {items, total, right, score}
     items, in reading order: {op, t (target token), a (typed token)} where op is
       ok | variant (accepted other spelling) | case (right letters, wrong capital) | spell (misspelt) |
       wrong (a different word) | missing (target word not typed) | extra (typed word not in the target).
     opts.variant(typedKey, targetKey) -> true when the typed form is an accepted variant (e.g. organize for organise). */
  function compare(target, typed, opts) {
    opts = opts || {};
    var T = tokens(target), A = tokens(typed);
    var n = T.length, m = A.length, i, j;
    var cost = [], back = [];
    for (i = 0; i <= n; i++) { cost.push(new Array(m + 1)); back.push(new Array(m + 1)); }
    cost[0][0] = 0;
    for (i = 1; i <= n; i++) { cost[i][0] = i; back[i][0] = 'missing'; }
    for (j = 1; j <= m; j++) { cost[0][j] = j; back[0][j] = 'extra'; }
    var SUB = { ok: 0, variant: 0.1, spell: 0.6, wrong: 1.8 };
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var t = T[i - 1].key, a = A[j - 1].key;
        var op = t === a ? 'ok' : (opts.variant && opts.variant(a, t)) ? 'variant' : similar(a, t) ? 'spell' : 'wrong';
        // A different word costs more the less it looks like the target, so a typed word pairs with the closest one.
        var sub = op === 'wrong' ? 1.2 + 0.7 * lev(a, t) / Math.max(a.length, t.length) : SUB[op];
        var best = cost[i - 1][j - 1] + sub, how = op;
        if (cost[i - 1][j] + 1 < best) { best = cost[i - 1][j] + 1; how = 'missing'; }
        if (cost[i][j - 1] + 1 < best) { best = cost[i][j - 1] + 1; how = 'extra'; }
        cost[i][j] = best;
        back[i][j] = how;
      }
    }
    var items = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      var b = back[i][j];
      if (b === 'missing') { items.push({ op: 'missing', t: T[i - 1], ti: i - 1 }); i--; }
      else if (b === 'extra') { items.push({ op: 'extra', a: A[j - 1], ai: j - 1 }); j--; }
      else { items.push({ op: b, t: T[i - 1], a: A[j - 1], ti: i - 1, ai: j - 1 }); i--; j--; }
    }
    items.reverse();
    // Capitals: only inside the sentence (the first word may be either) and only where the letters already match.
    items.forEach(function (it) {
      if (it.op !== 'ok' || it.ti === 0) return;
      if (hasCap(it.t.raw) !== hasCap(it.a.raw)) it.op = 'case';
    });
    var right = items.filter(function (it) { return it.op === 'ok' || it.op === 'variant' || it.op === 'case'; }).length;
    return { items: items, total: n, right: right, score: n ? right / n : 1 };
  }

  return { split: split, chunks: chunks, tokens: tokens, compare: compare, lev: lev, similar: similar };
});
