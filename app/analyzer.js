/* Spelling Coach - answer checking and error analysis.
   Errors are classified with the phonological / orthographic / morphological framework used in
   spelling-error research (POMAS; O'Brien et al. 2020), extended with Arabic-L1 categories. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SC = root.SC || {}; root.SC.analyzer = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CATS = {
    'wrong-word': { label: 'Wrong word (meaning decides)', group: 'M', unit: 16 },
    'ending': { label: 'Missing or extra ending', group: 'M', unit: 19 },
    'rule-double': { label: 'Doubling rule', group: 'M', unit: 6 },
    'rule-edrop': { label: 'Silent-e rule', group: 'M', unit: 5 },
    'rule-ytoi': { label: 'y to i rule', group: 'M', unit: 7 },
    'nochange': { label: 'Consonant suffix: just join', group: 'M', unit: 4 },
    'prefix': { label: 'Prefix + base', group: 'M', unit: 8 },
    'suffix-choice': { label: 'Suffix choice', group: 'M', unit: 11 },
    'ie-ei': { label: 'ie / ei', group: 'O', unit: 13 },
    'root': { label: 'Root spelling (Greek / Latin part)', group: 'M', unit: 18 },
    'double': { label: 'Double letters', group: 'O', unit: 9 },
    'silent': { label: 'Silent letter', group: 'O', unit: 14 },
    'schwa': { label: 'Unstressed vowel', group: 'O', unit: 15 },
    'vowel': { label: 'Vowel letter', group: 'P', unit: 2 },
    'missing': { label: 'Missing sound or syllable', group: 'P', unit: 1 },
    'pb-fv': { label: 'p/b or f/v', group: 'P', unit: 3 },
    'sound-spelling': { label: 'Same sound, different letters', group: 'O', unit: 3 },
    'order': { label: 'Letters in the wrong order', group: 'O', unit: null },
    'other': { label: 'Other letter error', group: 'P', unit: null },
    'major': { label: 'Several changes - relearn the word', group: 'P', unit: null }
  };
  var PRIORITY = ['wrong-word', 'ending', 'rule-double', 'rule-edrop', 'rule-ytoi', 'nochange', 'prefix',
    'suffix-choice', 'ie-ei', 'root', 'double', 'silent', 'schwa', 'vowel', 'missing', 'pb-fv', 'sound-spelling',
    'order', 'other', 'major'];

  // Same display as SC.morph.rootLabel: syn- (prefix), -logy (suffix), psych (root).
  function rootLabel(r, info) {
    return info.lab || (info.k === 'prefix' ? r + '-' : info.k === 'suffix' ? '-' + r : r);
  }

  var VOWEL = /[aeiouy]/;
  var SUFFIX_FAMILIES = [
    { rx: /(able|ible|ably|ibly|ability|ibility)$/, unit: 11, name: '-able / -ible' },
    { rx: /(ance|ence|ancy|ency|ant|ent|antly|ently)$/, unit: 11, name: '-ance / -ence, -ant / -ent' },
    { rx: /(tion|sion|ssion|cian|tions|sions)$/, unit: 10, name: '-tion / -sion / -ssion / -cian' },
    { rx: /(ary|ery|ory)$/, unit: 12, name: '-ary / -ery / -ory' },
    { rx: /(ous|ious|eous|ously)$/, unit: 12, name: '-ous / -ious / -eous' },
    { rx: /(ise|ize|yse|ised|ising|isation)$/, unit: 12, name: '-ise / -yse' },
    { rx: /(al|el|le|ally)$/, unit: 12, name: '-al / -el / -le' }
  ];

  function normalize(s) {
    return String(s || '').toLowerCase()
      .replace(/[‘’ʼ`]/g, "'")
      .replace(/[‐-―]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // UK -ise/-isation <-> -ize/-ization, used when no explicit US variant is listed.
  function izeForm(w) {
    var m = w.match(/^(.*[a-z]{2})is(e|ed|es|ing|er|ers|ation|ations|able)$/);
    return m ? m[1] + 'iz' + m[2] : null;
  }

  /* check(typed, entry, opts) -> { ok, status: 'correct'|'variant'|'alt'|'wrong'|'blank', note }
     opts.standard: 'uk' (default) or 'us' - which spelling is the learner's target. */
  function check(typed, entry, opts) {
    var us = opts && opts.standard === 'us' && entry.us;
    var a = normalize(typed);
    var t = normalize(us ? entry.us : (entry.id || entry.w));
    var other = us ? normalize(entry.id || entry.w) : (entry.us ? normalize(entry.us) : null);
    var shown = us ? entry.us : (entry.w || t);
    if (!a) return { ok: false, status: 'blank' };
    if (a === t) return { ok: true, status: 'correct' };
    if (other && a === other) {
      return { ok: true, status: 'variant', note: (us ? 'British' : 'American') + ' spelling - accepted in IELTS. Your target style is ' +
        (us ? 'American' : 'British') + ': ' + shown + '. Stay consistent in your writing.' };
    }
    if (!us && izeForm(t) === a) {
      return { ok: true, status: 'variant', note: '-ize is accepted in IELTS (American and Oxford spelling). Your target style is -ise: ' + shown + '.' };
    }
    var alts = (entry.alt || []).map(normalize);
    if (alts.indexOf(a) >= 0) return { ok: true, status: 'alt', note: 'Also correct. The form used in this app is ' + (entry.w || t) + '.' };
    if (a.replace(/[-\s]/g, '') === t.replace(/[-\s]/g, '') && /[-\s]/.test(t + a)) {
      return { ok: false, status: 'wrong', note: 'Check the hyphen or space.' };
    }
    return { ok: false, status: 'wrong' };
  }

  /* Damerau-Levenshtein alignment. ops: {op:'eq'|'sub'|'del'|'ins'|'swap', t, a, tc, ac}
     t = index in target, a = index in typed; del = a target letter is missing from the typed word,
     ins = an extra typed letter (t = target position it was inserted before). */
  function align(target, typed) {
    var n = target.length, m = typed.length;
    var d = [];
    for (var i = 0; i <= n; i++) { d.push(new Array(m + 1).fill(0)); d[i][0] = i; }
    for (var j = 0; j <= m; j++) d[0][j] = j;
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var cost = target[i - 1] === typed[j - 1] ? 0 : 1;
        var v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && target[i - 1] === typed[j - 2] && target[i - 2] === typed[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
        d[i][j] = v;
      }
    }
    var ops = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      // On ties prefer a missing/extra letter over a substitution: "dissapear" is an extra s and a
      // missing p, not two unrelated letter swaps.
      if (i > 0 && j > 0 && target[i - 1] === typed[j - 1] && d[i][j] === d[i - 1][j - 1]) {
        ops.push({ op: 'eq', t: i - 1, a: j - 1, tc: target[i - 1], ac: typed[j - 1] }); i--; j--;
      } else if (i > 1 && j > 1 && target[i - 1] === typed[j - 2] && target[i - 2] === typed[j - 1] && d[i][j] === d[i - 2][j - 2] + 1) {
        ops.push({ op: 'swap', t: i - 2, a: j - 2, tc: target.substr(i - 2, 2), ac: typed.substr(j - 2, 2) }); i -= 2; j -= 2;
      } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
        ops.push({ op: 'del', t: i - 1, a: j, tc: target[i - 1], ac: '' }); i--;
      } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
        ops.push({ op: 'ins', t: i, a: j - 1, tc: '', ac: typed[j - 1] }); j--;
      } else {
        ops.push({ op: 'sub', t: i - 1, a: j - 1, tc: target[i - 1], ac: typed[j - 1] }); i--; j--;
      }
    }
    ops.reverse();
    return { ops: ops, distance: d[n][m] };
  }

  /* Rebuild the surface string from the word sum to find where morphemes meet in the target. */
  function junctions(target, sum) {
    if (!sum || !sum.length) return [];
    var surface = '', out = [];
    for (var k = 0; k < sum.length; k++) {
      var t = sum[k][0], s = sum[k][1], rule = sum[k][2];
      if (t === 's') {
        if (rule === 'edrop' || rule === 'edrop-exc' || rule === 'ydrop') surface = surface.slice(0, -1);
        else if (rule === 'double' || rule === 'double-l') surface += surface[surface.length - 1];
        else if (rule === 'ytoi') surface = surface.slice(0, -1) + 'i';
        else if (rule === 'add-k') surface += 'k';
        out.push({ pos: surface.length, rule: rule, kind: 's', left: sum.slice(0, k).map(function (p) { return p[1]; }).join(''), sfx: s });
        surface += s;
      } else {
        if (k > 0) out.push({ pos: surface.length, rule: sum[k - 1][2], kind: 'p', sfx: s });
        surface += s;
      }
    }
    if (surface !== target) {
      // Alternations (decide -> decision) do not rebuild exactly: approximate the last junction.
      var lastS = sum[sum.length - 1];
      if (lastS[0] === 's') return [{ pos: target.length - lastS[1].length, rule: lastS[2], kind: 's', sfx: lastS[1], approx: true }];
      return [];
    }
    return out;
  }

  // tol: how far (in letters) an error may sit from the junction; a doubled pair spans two letters.
  function nearJunction(js, pos, kind, tol) {
    for (var k = 0; k < js.length; k++) {
      if ((!kind || js[k].kind === kind) && Math.abs(js[k].pos - pos) <= (tol || 1)) return js[k];
    }
    return null;
  }

  function syllableOf(entry, pos) {
    if (!entry.syl) return null;
    var parts = entry.syl.split('·'), acc = 0;
    for (var k = 0; k < parts.length; k++) {
      acc += parts[k].length;
      if (pos < acc) return k;
    }
    return parts.length - 1;
  }

  function suffixFamilyAt(target, pos) {
    for (var k = 0; k < SUFFIX_FAMILIES.length; k++) {
      var m = target.match(SUFFIX_FAMILIES[k].rx);
      if (m && pos >= target.length - m[0].length - 1) return SUFFIX_FAMILIES[k];
    }
    return null;
  }

  var SILENT_AT = [/kn/, /wr/, /mb$/, /mn$/, /gn/, /^ps/, /^pn/, /rh/, /xh/, /gh/, /sc[eiy]/, /stle/, /bt/, /lk/, /lm/, /lf/, /^h/, /ui/, /gu[aeiy]/];

  function isSilentPos(entry, target, pos, ch) {
    if (entry.sil && entry.sil.l && entry.sil.l.indexOf(ch) >= 0) return true;
    for (var k = 0; k < SILENT_AT.length; k++) {
      var rx = new RegExp(SILENT_AT[k].source, 'g'), m;
      while ((m = rx.exec(target))) {
        if (pos >= m.index && pos < m.index + m[0].length) return true;
      }
    }
    return false;
  }

  var SOUND_PAIRS = ['cs', 'ck', 'sz', 'gj', 'kq', 'cq', 'xs', 'td', 'ws', 'ij', 'yi'];
  function soundAlike(x, y) {
    return SOUND_PAIRS.indexOf(x + y) >= 0 || SOUND_PAIRS.indexOf(y + x) >= 0;
  }

  /* classify(typed, entry, ctx) -> { cats: [{key,label,group,unit,why}], primary, distance, marks }
     ctx: { isWord(w) -> bool, confusables: {word: cue}, groups: [[w...]], l1: 'ar', roots: {root: {m, o, ex, sp}} } */
  function classify(typed, entry, ctx) {
    ctx = ctx || {};
    var t = normalize(entry.id || entry.w);
    var a = normalize(typed);
    var found = {};
    var why = {};
    function hit(key, text) {
      found[key] = (found[key] || 0) + 1;
      if (text && !why[key]) why[key] = text;
    }
    var al = align(t, a);
    var js = junctions(t, entry.sum);
    var display = entry.w || t;
    var sumText = entry.sum && entry.sum.length ? entry.sum.map(function (p) { return p[1]; }).join(' + ') + ' → ' + display : display;

    // Wrong but real word: meaning confusion (their/there) or a different word.
    var group = null;
    (ctx.groups || []).forEach(function (g) {
      var lg = g.map(normalize);
      if (lg.indexOf(t) >= 0 && lg.indexOf(a) >= 0) group = lg;
    });
    if (group) {
      hit('wrong-word', 'You wrote "' + a + '"' + (ctx.confusables && ctx.confusables[a] ? ' (' + ctx.confusables[a] + ')' : '') +
        '. This sentence needs "' + display + '"' + (entry.cue ? ' (' + entry.cue + ')' : '') + '. The meaning decides the spelling.');
    }

    // Missing or extra ending (IELTS: a missing plural s scores zero).
    var endings = ['s', 'es', 'ed', 'd', 'ing', 'ly'];
    endings.forEach(function (e) {
      if (t === a + e) hit('ending', 'The ending "-' + e + '" is missing. In IELTS a missing ending makes the answer wrong - listen for it.');
      else if (a === t + e) hit('ending', 'You added "-' + e + '". Write exactly the form you hear.');
    });

    // An error inside a known root is explained by the root: phon = sound, and Greek /f/ is ph.
    var spans = (entry.root || []).map(function (r) {
      return { r: r, at: t.indexOf(r), info: (ctx.roots || {})[r] };
    }).filter(function (s) { return s.at >= 0 && s.info; });
    // clue: the root's own spelling clue (sp), or for an error in the ending after it, its ending clue (sx).
    function rootWhy(s, clue) {
      var head = spans.length > 1
        ? display + ' = ' + spans.map(function (x) { return rootLabel(x.r, x.info) + ' (' + x.info.m + ')'; }).join(' + ') + '. '
        : rootLabel(s.r, s.info) + ' = ' + s.info.m + ' (' + s.info.o + '). ';
      var ex = (s.info.ex || []).filter(function (x) { return x !== t; }).slice(0, 3);
      return head + (clue || 'This part keeps its spelling in every word of its family' + (ex.length ? ': ' + ex.join(', ') : '') + '.');
    }

    // A root with a spelling clue (Greek ph, y, -yse ...) outranks the generic suffix and letter categories.
    var rootStrong = false;

    if (!found.ending && !found['wrong-word']) {
      al.ops.forEach(function (o) {
        if (o.op === 'eq') return;
        var inRoot = spans.filter(function (s) { return o.t >= s.at && o.t < s.at + s.r.length; })[0];
        if (inRoot && !(o.op === 'swap' && /^(ie|ei)$/.test(o.tc))) {
          var strong = !!inRoot.info.sp;
          if (!found.root || (strong && !rootStrong)) why.root = rootWhy(inRoot, inRoot.info.sp);
          found.root = (found.root || 0) + 1;
          rootStrong = rootStrong || strong;
        } else if (!inRoot && suffixFamilyAt(t, o.t)) {
          // An ending right after a root with an ending clue (consist|ent, aud|ible): a useful second reason.
          var before = spans.filter(function (s) { return s.info.sx && s.at + s.r.length === o.t; })[0];
          if (before && !found.root) { why.root = rootWhy(before, before.info.sx); found.root = 1; }
        }
        var j = nearJunction(js, o.t);
        var jS = nearJunction(js, o.t, 's');
        var jP = nearJunction(js, o.t, 'p');

        if (o.op === 'swap') {
          if (/^(ie|ei)$/.test(o.tc)) hit('ie-ei', /cei/.test(t) ? 'After c in the -ceive family the spelling is cei (receive, receipt, perceive).' : 'This word is spelled with ' + o.tc + '. Learn it with its family, not with the old rhyme.');
          else hit('order', 'Two letters are swapped: "' + o.ac + '" should be "' + o.tc + '".');
          return;
        }

        var isDoubleCtx = (o.op === 'del' && (t[o.t - 1] === o.tc || t[o.t + 1] === o.tc)) ||
          (o.op === 'ins' && (t[o.t - 1] === o.ac || t[o.t] === o.ac || a[o.a - 1] === o.ac || a[o.a + 1] === o.ac));

        if (isDoubleCtx) {
          var missingDouble = o.op === 'del';
          jS = nearJunction(js, o.t, 's', 2);
          jP = nearJunction(js, o.t, 'p', 2);
          if (jP && missingDouble) {
            hit('prefix', 'Prefix + base: just join them. ' + sumText + ' - the letters meet, so you get a double letter.');
          } else if (jP && !missingDouble) {
            hit('prefix', 'Prefix + base: just join them (' + sumText + '). No extra letter is added.');
          } else if (jS && (jS.rule === 'double' || jS.rule === 'double-l') && missingDouble) {
            hit('rule-double', sumText + ': ' + (jS.rule === 'double-l' ? 'British English doubles the final l before a vowel suffix.' : 'one short vowel + one consonant in a stressed syllable, so double the consonant before the vowel suffix.'));
          } else if (jS && !missingDouble) {
            var r = jS.rule;
            if (r === 'edrop') hit('rule-edrop', sumText + ': the base ends in a silent e - drop the e and do not double (' + display + ').');
            else hit('rule-double', sumText + ': no doubling here' + (r === 'nodouble' ? ' - the stress is not on the last syllable of the base.' : ' - the suffix starts with a consonant or the base does not end in one vowel + one consonant.'));
          } else {
            hit('double', missingDouble ? 'A double letter is missing: "' + o.tc + o.tc + '".' + (entry.tip ? ' ' + entry.tip : '') : 'This word has a single "' + o.ac + '" here, not a double.' + (entry.tip ? ' ' + entry.tip : ''));
          }
          return;
        }

        // Silent e and y/i at a suffix junction.
        if (jS && (o.tc === 'e' || o.ac === 'e') && o.op !== 'sub') {
          if (o.op === 'ins' && jS.rule === 'edrop') { hit('rule-edrop', sumText + ': drop the silent e before a vowel suffix.'); return; }
          if (o.op === 'del' && jS.rule === 'keepe') { hit('rule-edrop', sumText + ': keep the e here' + (/[cg]e$/.test(jS.left) ? ' so the ' + jS.left.slice(-2, -1) + ' stays soft.' : '.')); return; }
          if (o.op === 'del' && (jS.rule === 'nochange' || !VOWEL.test(jS.sfx[0]))) { hit('rule-edrop', sumText + ': keep the e before a consonant suffix.'); return; }
          if (o.op === 'ins' && jS.rule === 'edrop-exc') { hit('rule-edrop', sumText + ': this is an exception - the e is dropped.'); return; }
        }
        if (jS && o.op === 'sub' && /^[iy]$/.test(o.tc) && /^[iy]$/.test(o.ac)) {
          hit('rule-ytoi', jS.rule === 'ytoi' ? sumText + ': consonant + y, so change y to i before the suffix.' : sumText + ': keep the y here (before -ing, or after a vowel).');
          return;
        }
        if (jS && o.op === 'ins' && jS.rule === 'nochange' && !VOWEL.test(jS.sfx[0])) {
          hit('nochange', sumText + ': with a consonant suffix just join - add nothing.');
          return;
        }
        if (jS && o.op === 'del' && !VOWEL.test((jS.sfx || 'x')[0]) && (o.tc === 'l' || o.tc === jS.sfx[0])) {
          hit('nochange', sumText + ': just join the parts - keep every letter of both.');
          return;
        }

        var tcV = VOWEL.test(o.tc), acV = VOWEL.test(o.ac);
        if (o.op === 'sub') {
          if (tcV && acV) {
            var fam = suffixFamilyAt(t, o.t);
            var syl = syllableOf(entry, o.t);
            if (fam) hit('suffix-choice', 'Suffix choice (' + fam.name + '): this word takes "' + t.slice(t.length - (t.match(fam.rx) || [''])[0].length) + '". See the unit on these endings.');
            else if (entry.st != null && syl != null && syl !== entry.st) hit('schwa', 'This vowel is in an unstressed syllable, so it sounds like "uh". ' + (entry.tip || 'Find a related word where the vowel is stressed.'));
            else hit('vowel', 'Wrong vowel letter: "' + o.ac + '" should be "' + o.tc + '". Say it slowly: ' + (entry.syl || display) + '.');
          } else if (/^[pb]$/.test(o.tc) && /^[pb]$/.test(o.ac) || /^[fv]$/.test(o.tc) && /^[fv]$/.test(o.ac)) {
            hit('pb-fv', '"' + o.ac + '" and "' + o.tc + '" are different sounds in English. Here it is "' + o.tc + '"' +
              (o.tc === 'p' || o.tc === 'f' ? ' (voiceless - no buzz).' : ' (voiced - you feel a buzz).'));
          } else if (soundAlike(o.tc, o.ac)) {
            var fam2 = suffixFamilyAt(t, o.t);
            if (fam2) hit('suffix-choice', 'Suffix choice (' + fam2.name + '): this word takes "' + t.slice(t.length - (t.match(fam2.rx) || [''])[0].length) + '".');
            else hit('sound-spelling', 'Right sound, different letter: this word uses "' + o.tc + '", not "' + o.ac + '".');
          } else {
            hit('other', '"' + o.ac + '" should be "' + o.tc + '".');
          }
        } else if (o.op === 'del') {
          if (isSilentPos(entry, t, o.t, o.tc) && !tcV || (entry.sil && entry.sil.l === o.tc)) {
            hit('silent', 'You missed a silent letter: "' + o.tc + '". ' + (entry.sil && entry.sil.note ? entry.sil.note : (entry.tip || '')));
          } else if (tcV) {
            hit('missing', 'A vowel is missing. Say every syllable: ' + (entry.syl || display) + '.');
          } else if (o.tc === 'h' && /[cpgrw]/.test(t[o.t - 1] || '')) {
            hit('sound-spelling', 'This word uses "' + t[o.t - 1] + 'h" here.');
          } else {
            hit('missing', 'A sound is missing: "' + o.tc + '". Say it slowly: ' + (entry.syl || display) + '.');
          }
        } else if (o.op === 'ins') {
          if (acV) {
            var fam3 = suffixFamilyAt(t, o.t);
            if (fam3) hit('suffix-choice', 'Suffix choice (' + fam3.name + '): this word takes "' + t.slice(t.length - (t.match(fam3.rx) || [''])[0].length) + '".');
            else hit('vowel', 'There is an extra vowel "' + o.ac + '". Say it slowly: ' + (entry.syl || display) + '.');
          } else {
            hit('other', 'There is an extra letter "' + o.ac + '".');
          }
        }
      });
    }

    // Real but different word, not a known confusable pair.
    if (!found['wrong-word'] && !found.ending && ctx.isWord && ctx.isWord(a) && a !== t) {
      why['wrong-word-note'] = '"' + a + '" is a real word, but a different one.';
    }

    // Arabic-L1 note: research links these error types to Arabic writing (short vowels unwritten; no p or v).
    var l1note = '';
    if (ctx.l1 === 'ar' && (found.vowel || found.missing || found.schwa || found['pb-fv'])) {
      l1note = found['pb-fv'] ? 'Common for Arabic speakers: Arabic has no p or v sound.' :
        'Common for Arabic speakers: Arabic writing leaves short vowels out, so English vowel letters need extra attention.';
    }

    var keys = Object.keys(found);
    var kinds = keys.filter(function (k) { return k !== 'root'; }).length;
    if (al.distance >= 3 && kinds >= 3) { found.major = 1; why.major = 'Several letters differ. Study the word card, then try again from memory.'; keys.push('major'); }
    function rank(k) { return k === 'root' && rootStrong ? PRIORITY.indexOf('suffix-choice') - 0.5 : PRIORITY.indexOf(k); }
    keys.sort(function (x, y) { return rank(x) - rank(y); });
    var cats = keys.map(function (k) {
      var c = CATS[k];
      var unit = c.unit;
      if (k === 'suffix-choice') {
        var famU = SUFFIX_FAMILIES.filter(function (f) { return f.rx.test(t); })[0];
        if (famU) unit = famU.unit;
      }
      if (ctx.l1 !== 'ar' && (k === 'vowel' || k === 'pb-fv')) unit = k === 'vowel' ? 15 : 3;
      return { key: k, label: c.label, group: c.group, unit: unit, why: why[k] || '' };
    });
    var marks = { target: [], typed: [] };
    al.ops.forEach(function (o) {
      if (o.op === 'eq') return;
      if (o.op === 'del' || o.op === 'sub') marks.target.push(o.t);
      if (o.op === 'swap') marks.target.push(o.t, o.t + 1);
      if (o.op === 'ins' || o.op === 'sub') marks.typed.push(o.a);
      if (o.op === 'swap') marks.typed.push(o.a, o.a + 1);
      if (o.op === 'ins') marks.target.push(Math.max(0, Math.min(t.length - 1, o.t)));
    });
    return {
      cats: cats,
      primary: cats.length ? cats[0].key : 'other',
      distance: al.distance,
      marks: marks,
      realWordNote: why['wrong-word-note'] || '',
      l1note: l1note
    };
  }

  return { normalize: normalize, check: check, align: align, classify: classify, junctions: junctions, CATS: CATS, PRIORITY: PRIORITY };
});
