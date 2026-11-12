/* Spelling Coach - morphology: word sums, suffix-rule detection and pattern tags.
   Shared by the browser (window.SC.morph) and the Node build/tests (require). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SC = root.SC || {}; root.SC.morph = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isVowel(c) { return 'aeiou'.indexOf(c) >= 0; }
  function isCons(c) { return !!c && /[a-z]/.test(c) && !isVowel(c); }

  // Inflectional endings are always allowed; every other suffix counts against opts.maxS.
  var INFLECTIONAL = { s: 1, es: 1, ed: 1, ing: 1 };

  // Surface suffixes, longest first so that '-ation' is tried before '-ion'.
  var SUFFIXES = ['ition', 'ation', 'itive', 'ative', 'ness', 'ment', 'ship', 'hood', 'less',
    'able', 'ible', 'ance', 'ence', 'ally', 'ious', 'eous', 'ful', 'ant', 'ent', 'ion', 'ian',
    'ial', 'ual', 'ous', 'ive', 'ise', 'ize', 'ity', 'ism', 'ist', 'ify', 'ure', 'age', 'ery',
    'ary', 'ory', 'ite', 'ing', 'est', 'al', 'ic', 'ly', 'er', 'or', 'ed', 'es', 'ee', 'th', 's'];

  // Consonant suffixes after which a final e is (exceptionally) dropped: argument, truly, ninth, awful.
  var EDROP_EXCEPTION = { argument: 1, truly: 1, duly: 1, wholly: 1, ninth: 1, awful: 1, judgment: 1, acknowledgment: 1 };

  // Suffixes that can replace a final y outright (economy -> economic, library -> librarian).
  var YDROP_SUFFIX = { ic: 1, ical: 1, ist: 1, ise: 1, ize: 1, ism: 1, ian: 1, al: 1 };

  // Stem alternations: [derived ending, base ending, suffix to show, note].
  var ALT = [
    ['ission', 'it', 'ion', 't becomes ss'],
    ['nsion', 'nd', 'ion', 'd becomes s'],
    ['rsion', 'rt', 'ion', 't becomes s'],
    ['sion', 'de', 'ion', 'de becomes s'],
    ['ription', 'ribe', 'ion', 'b becomes p'],
    ['ption', 'ive', 'ion', 'ive becomes pt'],
    ['uction', 'uce', 'ion', 'ce becomes ct'],
    ['unciation', 'ounce', 'ation', 'the o of pronounce disappears'],
    ['anation', 'ain', 'ation', 'the i disappears'],
    ['amation', 'aim', 'ation', 'the i disappears'],
    ['enance', 'ain', 'ance', 'ai becomes e'],
    ['etition', 'eat', 'ition', 'ea becomes e'],
    ['ification', 'ify', 'ation', 'y becomes ic'],
    ['ication', 'y', 'ation', 'y becomes ic'],
    ['icant', 'y', 'ant', 'y becomes ic'],
    ['icable', 'y', 'able', 'y becomes ic'],
    ['ificant', 'ify', 'ant', 'y becomes ic'],
    ['ificance', 'ify', 'ance', 'y becomes ic'],
    ['ability', 'able', 'ity', 'le becomes il'],
    ['ibility', 'ible', 'ity', 'le becomes il'],
    ['ency', 'ent', 'cy', 't is replaced by cy'],
    ['ancy', 'ant', 'cy', 't is replaced by cy'],
    ['ntial', 'nce', 'ial', 'ce becomes t'],
    ['orous', 'our', 'ous', 'British u disappears'],
    ['orious', 'our', 'ious', 'British u disappears'],
    ['ician', 'ics', 'ian', 's disappears'],
    ['ibly', 'ible', 'ly', 'le becomes ly'],
    ['ably', 'able', 'ly', 'le becomes ly'],
    ['tly', 'tle', 'ly', 'le becomes ly'],
    ['dly', 'dle', 'ly', 'le becomes ly'],
    ['ery', 'er', 'y', '']
  ];

  // Prefixes. before/notBefore restrict the next letter; strict ones are only used when the
  // build supplies a MorphoLex prefix count (too many false splits otherwise).
  var PREFIXES = [
    { p: 'counter' }, { p: 'inter' }, { p: 'trans' }, { p: 'under' }, { p: 'super' }, { p: 'over' },
    { p: 'anti' }, { p: 'auto' }, { p: 'semi' }, { p: 'multi' }, { p: 'micro' }, { p: 'fore' },
    { p: 'post' }, { p: 'with' }, { p: 'out' }, { p: 'mis' }, { p: 'dis' }, { p: 'non' },
    { p: 'pre' }, { p: 're' }, { p: 'un' }, { p: 'sub' },
    { p: 'im', before: 'bmp' }, { p: 'il', before: 'l' }, { p: 'ir', before: 'r' },
    { p: 'in', notBefore: 'bmplr' }, { p: 'co', before: 'aeiou' },
    { p: 'pro', strict: true }, { p: 'de', strict: true }, { p: 'ex', strict: true },
    { p: 'con', strict: true }, { p: 'com', strict: true }, { p: 'en', strict: true },
    { p: 'em', before: 'bp', strict: true }, { p: 'be', strict: true }, { p: 'ad', strict: true }
  ];

  var RULE_NOTES = {
    'nochange': 'just join',
    'edrop': 'drop the silent e',
    'edrop-exc': 'e dropped (exception)',
    'keepe': 'keep the e',
    'double': 'double the final consonant',
    'double-l': 'British: double the l',
    'nodouble': 'no doubling (stress not on the last syllable)',
    'ytoi': 'y changes to i',
    'ydrop': 'y is replaced',
    'keepy': 'keep the y',
    'ic-ally': '-ic words take -ally',
    'add-k': 'add k to keep the c hard',
    'prefix': 'prefix + base: just join',
    'prefix-double': 'prefix + base: letters meet, so a double letter'
  };

  function syllableGroups(w) {
    var m = w.replace(/e$/, '').match(/[aeiouy]+/g);
    return m ? m.length : 1;
  }

  // Short CVC ending on a one-syllable word: a vowel suffix would have doubled it (hop -> hopping).
  function needsDoubling(base) {
    var n = base.length;
    if (n < 3) return false;
    var a = base[n - 3], b = base[n - 2], c = base[n - 1];
    return syllableGroups(base) === 1 && isCons(a) && isVowel(b) && isCons(c) && 'wxy'.indexOf(c) < 0;
  }

  function endsShortVC(base) {
    var n = base.length;
    return n >= 3 && isVowel(base[n - 2]) && !isVowel(base[n - 3]) && isCons(base[n - 1]) && 'wxy'.indexOf(base[n - 1]) < 0;
  }

  function suffixCandidates(w, isWord, freq, opts) {
    var out = [];
    var minBase = opts.strict ? 4 : 3;
    function push(base, sfx, rule, note, alt) {
      if (base === w) return;
      var infl = !!INFLECTIONAL[sfx];
      if (!infl && opts.maxS === 0) return;
      var need = infl ? Math.min(minBase, 3) : minBase;
      if (base.length < need && !(infl && (base === 'be' || base === 'go' || base === 'do'))) return;
      if (!isWord(base)) return;
      // Without a MorphoLex hint, insist the base is a reasonably common word (avoids numb + er = number).
      if (opts.strict && !infl && freq && (freq(base) < 2.5 || freq(base) < freq(w) - 2)) return;
      var score = base.length * 3 + (freq ? freq(base) : 0) + (rule === 'nochange' ? 0.5 : 0) - (alt ? 0.5 : 0) -
        (opts.isUS && opts.isUS(base) ? 5 : 0);
      out.push({ base: base, sfx: sfx, rule: rule, note: note || RULE_NOTES[rule] || '', infl: infl, score: score });
    }

    ALT.forEach(function (a) {
      if (w.length > a[0].length + 1 && w.slice(-a[0].length) === a[0]) {
        push(w.slice(0, -a[0].length) + a[1], a[2], 'alt', a[3], true);
      }
    });

    SUFFIXES.forEach(function (sfx) {
      if (w.length <= sfx.length + 1 || w.slice(-sfx.length) !== sfx) return;
      var stem = w.slice(0, -sfx.length);
      var vowelSfx = /^[aeiouy]/.test(sfx);
      var last = stem[stem.length - 1], prev = stem[stem.length - 2];

      // 1. No change.
      if (vowelSfx) {
        if (!needsDoubling(stem)) {
          var r = 'nochange';
          if (last === 'e') r = 'keepe';
          else if (last === 'y') r = 'keepy';
          else if (endsShortVC(stem) && syllableGroups(stem) > 1) r = 'nodouble';
          push(stem, sfx, r);
        }
      } else {
        var r2 = 'nochange';
        if (last === 'y' && isCons(prev) && syllableGroups(stem) > 1) r2 = 'keepy-odd';
        if (r2 !== 'keepy-odd') push(stem, sfx, last === 'y' ? 'keepy' : r2);
      }
      // 2. Silent e dropped before a vowel suffix (hope + ing, argue + ing), or exceptionally before a
      //    consonant suffix (argue + ment, true + ly).
      if (vowelSfx && (isCons(last) || last === 'u') && last !== 'y') push(stem + 'e', sfx, 'edrop');
      else if (!vowelSfx && EDROP_EXCEPTION[w]) push(stem + 'e', sfx, 'edrop-exc');
      // 3. Doubled consonant (begin + n + ing).
      if (vowelSfx && stem.length >= 3 && last === prev && isCons(last) && 'wxyh'.indexOf(last) < 0) {
        var undoubled = stem.slice(0, -1);
        if (endsShortVC(undoubled) || undoubled.length >= 3 && isVowel(undoubled[undoubled.length - 2])) {
          push(undoubled, sfx, last === 'l' ? 'double-l' : 'double');
        }
      }
      // 4. y changed to i (happy + ness).
      if (last === 'i' && isCons(prev) && sfx[0] !== 'i') push(stem.slice(0, -1) + 'y', sfx, 'ytoi');
      // 5. y replaced by the suffix (economy + ic).
      if (YDROP_SUFFIX[sfx] && last !== 'i') push(stem + 'y', sfx, 'ydrop');
      // 6. -ic + -ally (basic + ally).
      if (sfx === 'ally') push(stem, 'ally', 'ic-ally');
      // 7. panic + k + ed.
      if (vowelSfx && /ck$/.test(stem)) push(stem.slice(0, -1), sfx, 'add-k');
    });
    return out;
  }

  function prefixCandidates(w, isWord, freq, opts) {
    var out = [];
    if (opts.maxP === 0) return out;
    PREFIXES.forEach(function (pr) {
      if (pr.strict && !opts.allowStrict) return;
      var p = pr.p;
      if (w.length < p.length + 3 || w.slice(0, p.length) !== p) return;
      var rest = w.slice(p.length);
      var next = rest[0];
      if (pr.before && pr.before.indexOf(next) < 0) return;
      if (pr.notBefore && pr.notBefore.indexOf(next) >= 0) return;
      if (rest.length < (opts.strict ? 4 : 3) || !isWord(rest)) return;
      var dbl = p[p.length - 1] === next;
      out.push({ prefix: p, base: rest, rule: dbl ? 'prefix-double' : 'prefix',
        score: rest.length * 3 + (freq ? freq(rest) : 0) });
    });
    return out;
  }

  function best(list) {
    var b = null;
    list.forEach(function (c) { if (!b || c.score > b.score) b = c; });
    return b;
  }

  /* segment(word, isWord, opts) -> { parts, rules, base } or null.
     parts: [{t:'p'|'b'|'s', s, r?, n?}] in reading order; base parts show the base word's own spelling.
     opts: { maxP, maxS (MorphoLex counts, undefined = unknown), allowStrict, strict, freq(word) } */
  function segment(word, isWord, opts) {
    opts = opts || {};
    var w = String(word || '').toLowerCase();
    if (!/^[a-z]+$/.test(w) || w.length < 4) return null;
    var budget = { maxP: opts.maxP, maxS: opts.maxS };
    var prefixes = [], suffixes = [];
    var cur = w;
    for (var depth = 0; depth < 5; depth++) {
      var o = { maxP: budget.maxP, maxS: budget.maxS, allowStrict: opts.allowStrict, strict: opts.strict, isUS: opts.isUS };
      var sc = best(suffixCandidates(cur, isWord, opts.freq, o));
      var pc = best(prefixCandidates(cur, isWord, opts.freq, o));
      var step = null;
      if (sc && (!pc || sc.score >= pc.score - 1)) step = { kind: 's', c: sc };
      else if (pc) step = { kind: 'p', c: pc };
      if (!step) break;
      if (step.kind === 's') {
        suffixes.unshift({ t: 's', s: step.c.sfx, r: step.c.rule, n: step.c.note });
        if (!step.c.infl && budget.maxS != null) budget.maxS -= 1;
        cur = step.c.base;
      } else {
        prefixes.push({ t: 'p', s: step.c.prefix, r: step.c.rule, n: RULE_NOTES[step.c.rule] });
        if (budget.maxP != null) budget.maxP -= 1;
        cur = step.c.base;
      }
      if (cur.length < 3) break;
    }
    if (!prefixes.length && !suffixes.length) return null;
    var parts = prefixes.concat([{ t: 'b', s: cur }], suffixes);
    var rules = [];
    parts.forEach(function (p) { if (p.r && rules.indexOf(p.r) < 0) rules.push(p.r); });
    return { parts: parts, rules: rules, base: cur };
  }

  function sumText(seg) {
    return seg ? seg.parts.map(function (p) { return p.s; }).join(' + ') : '';
  }

  // Rule tags (drive units 4-8) derived from a segmentation.
  function ruleTags(seg) {
    var tags = [];
    if (!seg) return tags;
    seg.parts.forEach(function (p) {
      switch (p.r) {
        case 'double': tags.push('rule-double'); break;
        case 'double-l': tags.push('rule-double', 'rule-double-l'); break;
        case 'nodouble': tags.push('rule-nodouble'); break;
        case 'edrop': case 'edrop-exc': tags.push('rule-edrop'); break;
        case 'keepe': tags.push('rule-keepe'); break;
        case 'ytoi': tags.push('rule-ytoi'); break;
        case 'keepy': tags.push('rule-keepy'); break;
        case 'prefix': tags.push('prefix-join'); break;
        case 'prefix-double': tags.push('prefix-join', 'prefix-double'); break;
        case 'nochange': case 'ic-ally':
          if (p.t === 's' && !/^[aeiouy]/.test(p.s) && !INFLECTIONAL[p.s]) tags.push('rule-nochange');
          break;
      }
      if (p.t === 's') {
        if (p.s === 'ly' || p.s === 'ally') tags.push('suffix-ly');
        if (p.s === 'ment') tags.push('suffix-ment');
        if (p.s === 'ful') tags.push('suffix-ful');
      }
    });
    return tags;
  }

  var HIDDEN_DOUBLE = /^(acc|add|aff|agg|all|ann|app|arr|ass|att|coll|comm|corr|eff|ill|imm|irr|occ|off|opp|succ|suff|sugg|summ|supp|surr)/;
  var SILENT_RX = /^(kn|wr|gn|ps|pn|rh|hon|hour|heir)|mb$|mn$|[^n]gn$|stle$|bt|ght|sc[eiy]|^w?h?ole|lk$|lm$|^two$/;
  var NOT_ISE = { promise: 1, premise: 1, praise: 1, raise: 1, noise: 1, cruise: 1, paradise: 1, precise: 1, concise: 1, wise: 1, rise: 1, arise: 1, poise: 1, otherwise: 0 };

  /* Pattern tags for a word. ctx: { seg, variant (bool), confusable (bool), silent (bool), roots: [root strings] } */
  function tagsFor(word, ctx) {
    ctx = ctx || {};
    var w = String(word).toLowerCase();
    var tags = ruleTags(ctx.seg);
    var hasPrefixDouble = tags.indexOf('prefix-double') >= 0;
    if (HIDDEN_DOUBLE.test(w) && !hasPrefixDouble) tags.push('hidden-double');
    if (/(tion|sion|cian)(s|al|ally)?$/.test(w) && w.length >= 6) tags.push('suffix-tion');
    if (/(able|ible|ably|ibly|ability|ibility)$/.test(w) && w.length >= 6) tags.push('suffix-able');
    if (/[a-z]{3}(ance|ence|ancy|ency|ant|ent)(s|ly)?$/.test(w) && w.length >= 7) tags.push('suffix-ance');
    if (/(ise|ize|yse|yze|ised|ized|ising|izing|isation|ization)$/.test(w) && w.length >= 6 && !NOT_ISE[w]) tags.push('suffix-ise');
    if (/(ous|ously)$/.test(w)) tags.push('suffix-ous');
    if (/[a-z]{3}(ary|ery|ory)$/.test(w)) tags.push('suffix-ary');
    if (/[a-z]{3}(le|el)$/.test(w) && !/(ible|able)$/.test(w)) tags.push('suffix-le');
    if (/cei(ve|pt|t|ving|ved|ver)/.test(w)) tags.push('ceive');
    if (/ei|ie[^sd]|ie$/.test(w) && !/(ies|ied|ier|iest)$/.test(w)) tags.push('ie-ei');
    if (ctx.silent || SILENT_RX.test(w)) tags.push('silent-letter');
    if (/ph|^ps|sc[eiy]|que$|dge/.test(w)) tags.push('multi-spelling');
    if (ctx.variant) tags.push('uk-us');
    if (ctx.confusable) tags.push('confusable');
    if (ctx.roots && ctx.roots.length) tags.push('root');
    var seen = {};
    return tags.filter(function (t) { if (seen[t]) return false; seen[t] = 1; return true; });
  }

  // Which unit teaches each tag (see data/lessons.js).
  var TAG_UNIT = {
    'elision': 1, 'vowel-letter': 2, 'consonant-pair': 3, 'multi-spelling': 3,
    'rule-nochange': 4, 'suffix-ly': 4, 'suffix-ment': 4, 'suffix-ful': 4,
    'rule-edrop': 5, 'rule-keepe': 5, 'rule-double': 6, 'rule-double-l': 6, 'rule-nodouble': 6,
    'rule-ytoi': 7, 'rule-keepy': 7, 'prefix-join': 8, 'prefix-double': 8, 'hidden-double': 9,
    'suffix-tion': 10, 'suffix-able': 11, 'suffix-ance': 11, 'suffix-ise': 12, 'suffix-ous': 12,
    'suffix-ary': 12, 'suffix-le': 12, 'ie-ei': 13, 'ceive': 13, 'silent-letter': 14, 'schwa': 15,
    'confusable': 16, 'uk-us': 17, 'root': 18, 'ielts-listening': 19
  };

  // English prefixes that may come before a Greek prefix: un-sym-pathetic, a-sym-metry.
  var LEAD = /^(un|non|in|im|dis|re|pre|mis|over|under|super|sub|de|a|an)$/;
  function isGreek(info) { return info.o === 'Greek' || /from Greek$/.test(info.o || ''); }
  function anyMatch(list, w) { return (list || []).some(function (p) { return new RegExp(p).test(w); }); }
  function startsAfterLead(w, s) {
    var i = w.indexOf(s);
    return i === 0 || (i > 0 && LEAD.test(w.slice(0, i)));
  }

  /* Find curated roots inside a word: at most 3, longest first, no overlaps, returned in word order.
     opts: a number (minimum length, as before) or { minLen, greek, ml, lat }:
       greek - the word's etymology mentions Greek (known at build time only);
       ml    - the word's MorphoLex morphemes (build time only);
       lat   - Latin roots whose Latin source word (entry 'src') is in the etymology (build time only).
     Latin entries need a MorphoLex or Latin-source match when ml is given, otherwise minLen letters.
     Greek prefixes match only at the start of the word (or after un-, dis- ...). Other Greek
     entries need evidence (greek, ml or minLen letters) unless marked safe. Entry fields 'no'
     (regexes) and 'only' (word starts) rule out look-alikes such as apology for -logy. */
  function findRoots(word, rootMap, opts) {
    if (!opts || typeof opts !== 'object') opts = { minLen: opts };
    var minLen = opts.minLen || 4;
    var w = String(word).toLowerCase();
    var ml = opts.ml || null;
    var lat = opts.lat || [];
    function mlHas(r, loose) {
      return !!ml && ml.some(function (m) { return m === r || (loose && m.length >= 3 && (m.indexOf(r) === 0 || r.indexOf(m) === 0)); });
    }
    var cands = [], hidden = [];
    Object.keys(rootMap || {}).forEach(function (r) {
      var info = rootMap[r] || {};
      var at = w.indexOf(r);
      if (anyMatch(info.no, w)) return;
      if (at < 0 || r === w) {
        // MorphoLex can name a root whose letters changed (reducing: duct) or the whole word (port).
        if (mlHas(r)) hidden.push({ r: r, at: at < 0 ? w.length : at, info: info });
        return;
      }
      if (info.only && !info.only.some(function (o) { return startsAfterLead(w, o); })) return;
      var ok;
      if (!isGreek(info)) {
        if (!ml) ok = r.length >= minLen;
        else if (mlHas(r)) ok = true;
        else ok = lat.indexOf(r) >= 0 && (info.k !== 'prefix' || startsAfterLead(w, r));
      } else if (info.k === 'prefix') ok = startsAfterLead(w, r);
      else ok = !!(info.safe || info.only || opts.greek || mlHas(r, true) || r.length >= minLen);
      cands.push({ r: r, at: at, ok: ok, latin: !isGreek(info), info: info });
    });
    cands.sort(function (a, b) { return b.r.length - a.r.length || (a.r < b.r ? -1 : 1); });
    var picked = [];
    // No overlaps, except that a prefix may share one letter with the next part: tran(s)cribe = trans + scrib.
    function free(c) {
      return !picked.some(function (p) {
        var overlap = Math.min(c.at + c.r.length, p.at + p.r.length) - Math.max(c.at, p.at);
        return overlap > 0 && !(overlap === 1 && (c.info.k === 'prefix' || p.info.k === 'prefix') && c.at !== p.at);
      });
    }
    cands.forEach(function (c) { if (c.ok && picked.length < 3 && free(c)) picked.push(c); });
    // Only prefixes so far (trans-, a-): add MorphoLex roots that are not spelled out (transcribe: script).
    if (picked.every(function (p) { return p.info.k === 'prefix'; })) {
      hidden.forEach(function (c) { if (picked.length < 3) picked.push(c); });
    }
    // Build fallback: nothing matched, so take the longest Latin root of 5+ letters that has no
    // Latin source pattern to check it against (entries with 'src' were already checked above).
    if (ml && !picked.length) {
      var fb = cands.filter(function (c) { return c.latin && c.r.length >= 5 && !c.info.src; })[0];
      if (fb) picked.push(fb);
    }
    return picked.sort(function (a, b) { return a.at - b.at; }).map(function (c) { return c.r; });
  }

  // How a root is written for learners: syn- (prefix), -logy (suffix), psych (root).
  function rootLabel(r, info) {
    var k = info && info.k;
    if (info && info.lab) return info.lab;
    return k === 'prefix' ? r + '-' : k === 'suffix' ? '-' + r : r;
  }

  return {
    segment: segment,
    sumText: sumText,
    ruleTags: ruleTags,
    tagsFor: tagsFor,
    findRoots: findRoots,
    rootLabel: rootLabel,
    TAG_UNIT: TAG_UNIT,
    RULE_NOTES: RULE_NOTES,
    needsDoubling: needsDoubling
  };
});
