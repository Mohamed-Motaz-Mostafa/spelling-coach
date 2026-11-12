'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../app/passage.js');

const ops = (target, typed, opts) => P.compare(target, typed, opts).items.map((it) => it.op + ':' + (it.t ? it.t.key : '') + (it.a && it.op !== 'ok' ? '/' + it.a.key : ''));

test('split keeps abbreviations and decimals inside a sentence and numbers paragraphs', () => {
  const s = P.split('Dr. Smith arrived at 3.5 p.m. today. Prices rose by 2.5%! Next, e.g. Paris grew.\n\nA new paragraph.');
  assert.deepStrictEqual(s.map((x) => x.s), ['Dr. Smith arrived at 3.5 p.m. today.', 'Prices rose by 2.5%!', 'Next, e.g. Paris grew.', 'A new paragraph.']);
  assert.deepStrictEqual(s.map((x) => x.p), [0, 0, 0, 1]);
});

test('chunks splits long sentences at commas and before linking words', () => {
  const s = 'The proportion of households that recycle their waste increased significantly between 1990 and 2010, while landfill use fell.';
  const c = P.chunks(s);
  assert.ok(c.length >= 3);
  assert.ok(c.every((x) => x.split(' ').length <= 9), c.join(' | '));
  assert.strictEqual(c.join(' '), s);
});

test('a perfect answer scores 100% whatever the final punctuation', () => {
  const r = P.compare('The government provides accommodation.', 'The government provides accommodation');
  assert.strictEqual(r.score, 1);
  assert.ok(r.items.every((it) => it.op === 'ok'));
});

test('misspellings, missing and extra words are told apart', () => {
  assert.deepStrictEqual(ops('The government provides free accommodation.', 'The goverment provides acommodation for all'), [
    'ok:the', 'spell:government/goverment', 'ok:provides', 'missing:free', 'spell:accommodation/acommodation', 'extra:/for', 'extra:/all'
  ]);
});

test('a different word is "wrong", not a misspelling', () => {
  assert.deepStrictEqual(ops('The weather was cold.', 'The climate was cold.'), ['ok:the', 'wrong:weather/climate', 'ok:was', 'ok:cold']);
});

test('per cent, percent, % and number words compare equal', () => {
  assert.strictEqual(P.compare('It rose by 25% in five years.', 'It rose by 25 percent in 5 years').score, 1);
  assert.strictEqual(P.compare('Sales fell by 1,200 units.', 'sales fell by 1200 units').score, 1);
  assert.strictEqual(P.compare('A well-known problem.', 'A well known problem').score, 1);
});

test('capital letters are noted inside the sentence but still count as right', () => {
  const r = P.compare('Many students study in London.', 'many students study in london');
  assert.deepStrictEqual(r.items.map((it) => it.op), ['ok', 'ok', 'ok', 'ok', 'case']);
  assert.strictEqual(r.score, 1);
});

test('accepted variants come from the caller', () => {
  const variant = (a, t) => a === 'organize' && t === 'organise';
  const r = P.compare('They organise events.', 'They organize events.', { variant });
  assert.strictEqual(r.items[1].op, 'variant');
  assert.strictEqual(r.score, 1);
});

test('edit distance counts a swap of neighbours as one edit', () => {
  assert.strictEqual(P.lev('recieve', 'receive'), 1);
  assert.strictEqual(P.lev('acommodation', 'accommodation'), 1);
  assert.strictEqual(P.lev('kitten', 'sitting'), 3);
  assert.ok(P.similar('goverment', 'government'));
  assert.ok(!P.similar('climate', 'weather'));
});

test('a typed word pairs with the target it resembles, also by sound (f for ph)', () => {
  // A learner stopped early and wrote "fenominm": it belongs to "phenomenon", not to the last word.
  const r = ops('a social phenomenon that requires careful planning.', 'a sochial fenominm');
  assert.deepStrictEqual(r, ['ok:a', 'spell:social/sochial', 'spell:phenomenon/fenominm', 'missing:that', 'missing:requires', 'missing:careful', 'missing:planning']);
  assert.ok(P.similar('fenominm', 'phenomenon'));
  assert.ok(!P.similar('fenominm', 'planning'));
});

test('an empty answer marks every word as missing', () => {
  const r = P.compare('Write every word.', '');
  assert.deepStrictEqual(r.items.map((it) => it.op), ['missing', 'missing', 'missing']);
  assert.strictEqual(r.score, 0);
});
