'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../app/morphology.js');

// A mini lexicon is enough to test segmentation rules.
const LEX = new Set(['begin', 'hope', 'hop', 'happy', 'appear', 'necessary', 'govern', 'notice', 'travel', 'offer',
  'decide', 'permit', 'argue', 'number', 'numb', 'apply', 'apple', 'occur', 'commit', 'satisfy', 'dissatisfy',
  'write', 'writ', 'study', 'enjoy', 'final', 'basic', 'possible', 'define', 'definite', 'explain', 'pronounce',
  'recommend', 'commend', 'disappoint', 'appoint', 'busy', 'beauty', 'rely', 'relevant', 'mature', 'spell']);
const isWord = (w) => LEX.has(w);
const seg = (w, o) => M.segment(w, isWord, Object.assign({ allowStrict: true }, o || {}));
const sum = (w, o) => { const s = seg(w, o); return s ? s.parts.map((p) => p.s).join('+') : null; };
const rules = (w, o) => { const s = seg(w, o); return s ? s.rules : []; };

test('doubling rule: begin + ing', () => {
  assert.strictEqual(sum('beginning'), 'begin+ing');
  assert.ok(rules('beginning').includes('double'));
});

test('silent e: hoping comes from hope, not hop', () => {
  assert.strictEqual(sum('hoping'), 'hope+ing');
  assert.ok(rules('hoping').includes('edrop'));
  assert.strictEqual(sum('writing'), 'write+ing');
});

test('y to i: happiness, business, beautiful, reliable', () => {
  assert.strictEqual(sum('happiness'), 'happy+ness');
  assert.ok(rules('happiness').includes('ytoi'));
  assert.strictEqual(sum('business'), 'busy+ness');
  assert.strictEqual(sum('beautiful'), 'beauty+ful');
  assert.strictEqual(sum('reliable'), 'rely+able');
});

test('keep y before -ing and after a vowel', () => {
  assert.strictEqual(sum('studying'), 'study+ing');
  assert.ok(rules('studying').includes('keepy'));
  assert.strictEqual(sum('enjoyed'), 'enjoy+ed');
});

test('prefixes join without change and create double letters', () => {
  assert.strictEqual(sum('disappear'), 'dis+appear');
  assert.strictEqual(sum('unnecessary'), 'un+necessary');
  assert.ok(rules('unnecessary').includes('prefix-double'));
  assert.strictEqual(sum('irrelevant'), 'ir+relevant');
  assert.strictEqual(sum('immature'), 'im+mature');
  assert.strictEqual(sum('misspell'), 'mis+spell');
});

test('consonant suffix keeps the base: government, finally', () => {
  assert.strictEqual(sum('government'), 'govern+ment');
  assert.strictEqual(sum('finally'), 'final+ly');
  assert.strictEqual(sum('basically'), 'basic+ally');
});

test('keep e for soft c/g: noticeable', () => {
  assert.strictEqual(sum('noticeable'), 'notice+able');
  assert.ok(rules('noticeable').includes('keepe'));
});

test('British double l and no doubling when stress is earlier', () => {
  assert.strictEqual(sum('travelled'), 'travel+ed');
  assert.ok(rules('travelled').includes('double-l'));
  assert.strictEqual(sum('offered'), 'offer+ed');
  assert.ok(rules('offered').includes('nodouble'));
  assert.strictEqual(sum('occurrence'), 'occur+ence');
});

test('stem alternations: decision, permission, explanation, pronunciation', () => {
  assert.strictEqual(sum('decision'), 'decide+ion');
  assert.strictEqual(sum('permission'), 'permit+ion');
  assert.strictEqual(sum('explanation'), 'explain+ation');
  assert.strictEqual(sum('pronunciation'), 'pronounce+ation');
});

test('exceptions: argument drops the e', () => {
  assert.strictEqual(sum('argument'), 'argue+ment');
});

test('MorphoLex hints block false splits (number is not numb + er)', () => {
  assert.strictEqual(sum('number', { maxP: 0, maxS: 0 }), null);
});

test('no "apple + ly" for apply', () => {
  assert.strictEqual(sum('apply'), null);
});

test('recursive sums: recommendation = re + commend + ation; dissatisfied = dis + satisfy + ed', () => {
  assert.strictEqual(sum('recommendation'), 're+commend+ation');
  assert.strictEqual(sum('dissatisfied'), 'dis+satisfy+ed');
});

test('pattern tags', () => {
  const t = (w) => M.tagsFor(w, { seg: seg(w) });
  assert.ok(t('accommodation').includes('hidden-double'));
  assert.ok(t('receive').includes('ceive'));
  assert.ok(t('permission').includes('suffix-tion'));
  assert.ok(t('possible').includes('suffix-able'));
  assert.ok(t('beginning').includes('rule-double'));
  assert.ok(t('unnecessary').includes('prefix-double'));
  assert.ok(!t('unnecessary').includes('hidden-double'));
  assert.ok(t('knowledge').includes('silent-letter'));
});
