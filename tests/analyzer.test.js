'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../app/analyzer.js');

// Entries in the same shape as data/words.js (sum parts: [type, text, rule, note]).
const E = {
  accommodate: { id: 'accommodate', w: 'accommodate', tags: ['hidden-double'] },
  receive: { id: 'receive', w: 'receive' },
  definitely: { id: 'definitely', w: 'definitely', syl: 'def·i·nite·ly', st: 0, sum: [['b', 'definite', '', ''], ['s', 'ly', 'nochange', 'just join']] },
  government: { id: 'government', w: 'government', sum: [['b', 'govern', '', ''], ['s', 'ment', 'nochange', 'just join']], sil: { l: 'n', note: 'govern + ment: the n belongs to govern.' } },
  hoping: { id: 'hoping', w: 'hoping', sum: [['b', 'hope', '', ''], ['s', 'ing', 'edrop', 'drop the silent e']] },
  beginning: { id: 'beginning', w: 'beginning', sum: [['b', 'begin', '', ''], ['s', 'ing', 'double', 'double']] },
  occurred: { id: 'occurred', w: 'occurred', sum: [['b', 'occur', '', ''], ['s', 'ed', 'double', 'double']] },
  happiness: { id: 'happiness', w: 'happiness', sum: [['b', 'happy', '', ''], ['s', 'ness', 'ytoi', 'y becomes i']] },
  disappear: { id: 'disappear', w: 'disappear', sum: [['p', 'dis', 'prefix', 'join'], ['b', 'appear', '', '']] },
  noticeable: { id: 'noticeable', w: 'noticeable', sum: [['b', 'notice', '', ''], ['s', 'able', 'keepe', 'keep the e']] },
  independent: { id: 'independent', w: 'independent' },
  february: { id: 'february', w: 'February', sil: { l: 'r', note: 'Feb-ru-ar-y' } },
  problem: { id: 'problem', w: 'problem' },
  there: { id: 'there', w: 'there', cue: 'in that place' },
  centre: { id: 'centre', w: 'centre', us: 'center' },
  organise: { id: 'organise', w: 'organise' },
  judgement: { id: 'judgement', w: 'judgement', alt: ['judgment'] },
  museums: { id: 'museums', w: 'museums' },
  developing: { id: 'developing', w: 'developing' },
  separate: { id: 'separate', w: 'separate', syl: 'sep·a·rate', st: 0 }
};
const ctx = { isWord: (w) => ['their', 'there', 'hopping'].includes(w), groups: [['their', 'there', "they're"]], l1: 'ar' };
const primary = (typed, id) => A.classify(typed, E[id], ctx).primary;
const keys = (typed, id) => A.classify(typed, E[id], ctx).cats.map((c) => c.key);

test('check: exact, case-insensitive, variants and alternatives', () => {
  assert.strictEqual(A.check('Receive', E.receive).status, 'correct');
  assert.strictEqual(A.check('  receive ', E.receive).status, 'correct');
  const v = A.check('center', E.centre);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.status, 'variant');
  assert.match(v.note, /American/);
  assert.strictEqual(A.check('organize', E.organise).status, 'variant');
  assert.strictEqual(A.check('judgment', E.judgement).status, 'alt');
  assert.strictEqual(A.check('', E.receive).status, 'blank');
  assert.strictEqual(A.check('recieve', E.receive).ok, false);
});

test('check: American target standard flips the variant', () => {
  assert.strictEqual(A.check('center', E.centre, { standard: 'us' }).status, 'correct');
  const v = A.check('centre', E.centre, { standard: 'us' });
  assert.strictEqual(v.status, 'variant');
  assert.match(v.note, /British/);
});

test('hidden double consonant: accomodate', () => {
  assert.strictEqual(primary('accomodate', 'accommodate'), 'double');
});

test('ie/ei swap: recieve', () => {
  assert.strictEqual(primary('recieve', 'receive'), 'ie-ei');
});

test('unstressed vowel: definately, seperate', () => {
  assert.strictEqual(primary('definately', 'definitely'), 'schwa');
  assert.strictEqual(primary('seperate', 'separate'), 'schwa');
});

test('silent letter: goverment', () => {
  assert.strictEqual(primary('goverment', 'government'), 'silent');
});

test('silent-e rule: hopeing', () => {
  assert.strictEqual(primary('hopeing', 'hoping'), 'rule-edrop');
});

test('keep the e for a soft c: noticable', () => {
  assert.strictEqual(primary('noticable', 'noticeable'), 'rule-edrop');
});

test('doubling rule: begining, occured', () => {
  assert.strictEqual(primary('begining', 'beginning'), 'rule-double');
  assert.strictEqual(primary('occured', 'occurred'), 'rule-double');
});

test('extra doubling where the rule says no: hopping for hoping', () => {
  assert.strictEqual(primary('hopping', 'hoping'), 'rule-edrop');
});

test('y to i rule: happyness', () => {
  assert.strictEqual(primary('happyness', 'happiness'), 'rule-ytoi');
});

test('prefix + base: dissapear', () => {
  assert.strictEqual(primary('dissapear', 'disappear'), 'prefix');
});

test('suffix choice: independant', () => {
  assert.strictEqual(primary('independant', 'independent'), 'suffix-choice');
  assert.strictEqual(A.classify('independant', E.independent, ctx).cats[0].unit, 11);
});

test('February missing r is a silent/hidden sound', () => {
  assert.ok(['silent', 'missing'].includes(primary('Febuary', 'february')));
});

test('p/b swap for Arabic speakers: broblem', () => {
  const r = A.classify('broblem', E.problem, ctx);
  assert.strictEqual(r.primary, 'pb-fv');
  assert.match(r.l1note, /Arabic/);
});

test('homophone: their for there', () => {
  assert.strictEqual(primary('their', 'there'), 'wrong-word');
});

test('missing plural ending: museum for museums', () => {
  assert.strictEqual(primary('museum', 'museums'), 'ending');
});

test('extra e after a consonant suffix: developeing is flagged', () => {
  assert.ok(keys('developeing', 'developing').length >= 1);
});

test('marks point at the wrong letters', () => {
  const r = A.classify('recieve', E.receive, ctx);
  assert.deepStrictEqual(r.marks.target, [3, 4]);
});

test('alignment distance', () => {
  assert.strictEqual(A.align('receive', 'recieve').distance, 1);
  assert.strictEqual(A.align('necessary', 'neccessary').distance, 1);
  assert.strictEqual(A.align('abc', '').distance, 3);
});
