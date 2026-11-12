'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../app/scheduler.js');

const T = 20000; // a fixed day number

test('new word answered correctly goes to box 2 (due in 3 days)', () => {
  const s = S.review(null, { ok: true }, T, 0.5);
  assert.strictEqual(s.b, 2);
  assert.strictEqual(s.due, T + 3);
  assert.strictEqual(s.lapses, 0);
});

test('new word answered correctly but slowly goes to box 1', () => {
  const s = S.review(null, { ok: true, hard: true }, T, 0.5);
  assert.strictEqual(s.b, 1);
  assert.strictEqual(s.due, T + 1);
});

test('new word answered wrongly: due tomorrow, no lapse counted yet', () => {
  const s = S.review(null, { ok: false }, T, 0.5);
  assert.strictEqual(s.b, 1);
  assert.strictEqual(s.due, T + 1);
  assert.strictEqual(s.lapses, 0);
  assert.strictEqual(s.bad, 1);
});

test('correct reviews climb the boxes with expanding intervals', () => {
  let s = S.review(null, { ok: true }, T, 0.5);
  s = S.review(s, { ok: true }, T + 3, 0.5);
  assert.strictEqual(s.b, 3);
  assert.strictEqual(s.due, T + 3 + 7);
  s = S.review(s, { ok: true }, s.due, 0.5);
  assert.strictEqual(s.b, 4);
});

test('intervals are fuzzed by at most 10%', () => {
  const base = { b: 4, due: T, reps: 5, lapses: 0, ok: 5, bad: 0, first: T - 30 };
  const lo = S.review(base, { ok: true }, T, 0);
  const hi = S.review(base, { ok: true }, T, 1);
  assert.ok(lo.due - T >= 27 && hi.due - T <= 33, `${lo.due - T} ${hi.due - T}`);
});

test('hard answer keeps the box', () => {
  const base = { b: 4, due: T, reps: 5, lapses: 0, ok: 5, bad: 0, first: T - 30 };
  assert.strictEqual(S.review(base, { ok: true, hard: true }, T, 0.5).b, 4);
});

test('a lapse sends the word back to box 1 and counts', () => {
  const base = { b: 5, due: T, reps: 6, lapses: 0, ok: 6, bad: 0, first: T - 60 };
  const s = S.review(base, { ok: false }, T, 0.5);
  assert.strictEqual(s.b, 1);
  assert.strictEqual(s.due, T + 1);
  assert.strictEqual(s.lapses, 1);
});

test('status: mastered at box 6+, trouble after 4 lapses', () => {
  assert.strictEqual(S.status(null, T), 'new');
  assert.strictEqual(S.status({ reps: 3, b: 6, lapses: 0 }, T), 'mastered');
  assert.strictEqual(S.status({ reps: 9, b: 2, lapses: 4 }, T), 'trouble');
  assert.strictEqual(S.status({ reps: 2, b: 2, lapses: 0 }, T), 'learning');
});

function fixture() {
  const words = {};
  ['a1', 'a2', 'a3', 'b1', 'b2', 'r1', 'r2'].forEach((id) => { words[id] = { id, w: id, ex: ['A sentence with ' + id + '.'], d: ['def'], u: [id[0] === 'a' ? 4 : 5] }; });
  const meta = { unitPools: { 4: { core: ['a1', 'a2', 'a3'], more: [] }, 5: { core: ['b1', 'b2'], more: [] } }, lists: [], tagUnit: {} };
  return { words, meta };
}

test('today session: due reviews first, then new words from the current unit', () => {
  const { words, meta } = fixture();
  const progress = { r1: { b: 2, due: T, reps: 2, lapses: 0, ok: 2, bad: 0 }, r2: { b: 3, due: T + 5, reps: 3, lapses: 0, ok: 3, bad: 0 } };
  const out = S.buildSession({ mode: 'today', words, progress, settings: { newPerDay: 2, reviewCap: 80, l1: 'ar' }, today: T, meta,
    unitState: { order: [4, 5], current: 4, seenLesson: {}, skip: {} }, rnd: () => 0.3 });
  assert.deepStrictEqual(out.items.map((i) => i.id), ['r1', 'a1', 'a2']);
  assert.strictEqual(out.lessonUnit, 4);
  assert.deepStrictEqual(out.newIds, ['a1', 'a2']);
});

test('today session moves on to the next unit when the current one is used up', () => {
  const { words, meta } = fixture();
  const progress = { a1: { b: 2, due: T + 3, reps: 1 }, a2: { b: 2, due: T + 3, reps: 1 } };
  const out = S.buildSession({ mode: 'today', words, progress, settings: { newPerDay: 3, l1: 'ar' }, today: T, meta,
    unitState: { order: [4, 5], current: 4, seenLesson: { 4: true }, skip: {} }, rnd: () => 0.3 });
  assert.deepStrictEqual(out.newIds, ['a3', 'b1', 'b2']);
  assert.strictEqual(out.unitAdvance, 5);
  assert.strictEqual(out.lessonUnit, 5);
});

test('daily new-word limit counts words already introduced today', () => {
  const { words, meta } = fixture();
  const out = S.buildSession({ mode: 'today', words, progress: {}, settings: { newPerDay: 3, l1: 'ar' }, today: T, meta,
    unitState: { order: [4, 5], current: 4, seenLesson: {} }, introducedToday: 2, rnd: () => 0.3 });
  assert.strictEqual(out.newIds.length, 1);
});

test('placement results: full marks mark a unit strong; Arabic units only for Arabic L1', () => {
  const r = S.unitOrderFromDiagnostic({ 1: [2, 2], 2: [1, 2], 3: [0, 2] }, 'ar');
  assert.ok(r.strong[1]);
  assert.strictEqual(r.current, 2);
  assert.ok(r.order.includes(2));
  const o = S.unitOrderFromDiagnostic({}, 'other');
  assert.ok(!o.order.includes(2) && !o.order.includes(3));
});

test('interleaving avoids long runs from the same unit', () => {
  const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  const out = S.interleave(ids, (id) => id[0], () => 0.5);
  for (let i = 1; i < 4; i++) assert.notStrictEqual(out[i][0], out[i - 1][0]);
});

test('day numbers round-trip through ISO dates', () => {
  assert.strictEqual(S.isoToDay(S.dayToISO(T)), T);
});
