'use strict';
// Runs the error analyzer over real misspellings (Birkbeck + Wikipedia corpora, downloaded by the
// build into build/raw). Checks robustness and that most errors get a meaningful category.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../app/analyzer.js');

const RAW = path.join(__dirname, '..', 'build', 'raw');
const files = ['birkbeck.dat', 'wikipedia_missp.dat'].map((f) => path.join(RAW, f)).filter((f) => fs.existsSync(f));

function pairs() {
  const out = [];
  files.forEach((f) => {
    let cur = null;
    fs.readFileSync(f, 'latin1').split(/\r?\n/).forEach((line) => {
      line = line.trim();
      if (!line) return;
      if (line[0] === '$') cur = line.slice(1).replace(/_/g, ' ');
      else if (cur && /^[a-z]+$/.test(cur) && /^[a-z]+$/i.test(line)) out.push([cur, line.toLowerCase()]);
    });
  });
  return out;
}

test('analyzer handles every corpus misspelling and categorises most of them', { skip: !files.length && 'corpora not downloaded' }, () => {
  const ps = pairs();
  assert.ok(ps.length > 10000, 'expected a large corpus, got ' + ps.length);
  const counts = {};
  let total = 0;
  ps.forEach(([target, typed]) => {
    if (target === typed) return;
    const r = A.classify(typed, { id: target, w: target }, {});
    assert.ok(r && r.cats.length, 'no category for ' + target + ' / ' + typed);
    counts[r.primary] = (counts[r.primary] || 0) + 1;
    total += 1;
  });
  const vague = ((counts.other || 0) + (counts.major || 0)) / total;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(1)}%`).join(', ');
  console.log(`  ${total} misspellings: ${top}`);
  assert.ok(vague < 0.35, `too many vague categories: ${(100 * vague).toFixed(1)}%`);
});
