// Build helper: runs app/morphology.js over the selected words so the build and the app share one
// implementation. Usage: node build/segment.js <in.json> <out.json>
'use strict';
const fs = require('fs');
const path = require('path');
const morph = require(path.join(__dirname, '..', 'app', 'morphology.js'));

const [inPath, outPath] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const lex = new Set(input.lexicon);
const freq = input.freq || {};
const us = new Set(input.us || []);
const isWord = (w) => lex.has(w);
const fq = (w) => (freq[w] == null ? 0 : freq[w]);

const roots = input.roots || {};

const out = {};
for (const item of input.words) {
  const known = item.maxP != null;
  const seg = morph.segment(item.w, isWord, {
    maxP: item.maxP, maxS: item.maxS, allowStrict: known, strict: !known, freq: fq, isUS: (w) => us.has(w)
  });
  // Roots: the same matcher the app uses, plus build-only evidence (Greek etymology, MorphoLex morphemes,
  // Latin roots confirmed by the Latin source word).
  const rts = morph.findRoots(item.w, roots, { minLen: 5, greek: !!item.greek, ml: item.ml || [], lat: item.lat || [] });
  const ctx = Object.assign({ seg, roots: rts }, item.ctx || {});
  out[item.w] = {
    sum: seg ? seg.parts.map((p) => [p.t, p.s, p.r || '', p.n || '']) : null,
    rules: seg ? seg.rules : [],
    tags: morph.tagsFor(item.w, ctx),
    root: rts
  };
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('segmented', Object.keys(out).length, 'words;', Object.values(out).filter((o) => o.sum).length, 'with word sums');
