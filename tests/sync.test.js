'use strict';
const test = require('node:test');
const assert = require('node:assert');
const SY = require('../app/sync.js');

const T = 20000;
const clone = (x) => JSON.parse(JSON.stringify(x));

function baseState() {
  return {
    v: 1, created: T - 10, lastBackup: null,
    settings: { standard: 'uk', rate: 0.9, theme: 'auto' },
    progress: { receive: { b: 1, due: T + 1, reps: 1, last: T, ok: 0, bad: 1 } },
    userWords: { u_foo: { id: 'u_foo', w: 'foo' } },
    edits: {},
    errors: [{ d: T, id: 'receive', a: 'recieve', c: 'ie-ei' }],
    daily: { [T]: { n: 5, ok: 3, new: 2, ms: 1000 } },
    units: { diagDone: true, diag: {}, current: 3, order: [1, 2, 3], strong: {}, seenLesson: { 1: true }, skip: {}, include: {} },
    library: { passages: [{ id: 'p1', text: 'a' }], tasks: [], stats: {} }
  };
}

test('a side that did not change takes the other side', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  r.progress.receive = { b: 2, due: T + 3, reps: 2, last: T + 1, ok: 1, bad: 1 };
  r.units.current = 4;
  const m = SY.merge(b, l, r);
  assert.strictEqual(m.progress.receive.reps, 2);
  assert.strictEqual(m.units.current, 4);
  assert.ok(SY.eq(SY.merge(b, b, b), b));
});

test('a word reviewed on both devices keeps the copy with more reviews', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  l.progress.receive = { b: 2, due: T + 3, reps: 2, last: T + 1 };
  r.progress.receive = { b: 3, due: T + 7, reps: 3, last: T + 2 };
  l.progress.beginning = { b: 2, reps: 1, last: T + 1 };
  r.progress.necessary = { b: 1, reps: 1, last: T + 2 };
  const m = SY.merge(b, l, r);
  assert.strictEqual(m.progress.receive.reps, 3);
  assert.ok(m.progress.beginning && m.progress.necessary);
});

test('daily counts from both devices on the same day add up', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  l.daily[T] = { n: 8, ok: 5, new: 3, ms: 1500 };   // +3 on the computer
  r.daily[T] = { n: 9, ok: 6, new: 2, ms: 2000 };   // +4 on the phone
  r.daily[T + 1] = { n: 2, ok: 2, new: 0, ms: 300 };
  const m = SY.merge(b, l, r);
  assert.deepStrictEqual(m.daily[T], { n: 12, ok: 8, new: 3, ms: 2500 });
  assert.deepStrictEqual(m.daily[T + 1], { n: 2, ok: 2, new: 0, ms: 300 });
});

test('without a base (first sync on a device) daily counts take the larger value', () => {
  const l = baseState(), r = baseState();
  r.daily[T] = { n: 7, ok: 4, new: 2, ms: 900 };
  const m = SY.merge(null, l, r);
  assert.deepStrictEqual(m.daily[T], { n: 7, ok: 4, new: 2, ms: 1000 });
});

test('error logs are combined without duplicates', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  l.errors.push({ d: T + 1, id: 'beginning', a: 'begining', c: 'double' });
  r.errors.push({ d: T + 1, id: 'necessary', a: 'neccessary', c: 'double' });
  const m = SY.merge(b, l, r);
  assert.strictEqual(m.errors[0].id, 'receive');   // sorted by day
  assert.deepStrictEqual(m.errors.map((e) => e.id).sort(), ['beginning', 'necessary', 'receive']);
  assert.strictEqual(SY.merge(null, l, clone(l)).errors.length, 2);
});

test('deletions on one side stay deleted', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  delete l.userWords.u_foo;
  l.library.passages = [];
  r.progress.receive.reps = 2;
  const m = SY.merge(b, l, r);
  assert.strictEqual(m.userWords.u_foo, undefined);
  assert.strictEqual(m.library.passages.length, 0);
  assert.strictEqual(m.progress.receive.reps, 2);
});

test('a word deleted on one device but edited on the other is kept', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  delete l.userWords.u_foo;
  r.userWords.u_foo.w = 'foo2';
  assert.strictEqual(SY.merge(b, l, r).userWords.u_foo.w, 'foo2');
});

test('settings merge field by field; this device wins a real conflict', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  l.settings.rate = 1.1;
  r.settings.theme = 'dark';
  l.settings.standard = 'us'; r.settings.standard = 'uk-strict';
  const m = SY.merge(b, l, r);
  assert.deepStrictEqual([m.settings.rate, m.settings.theme, m.settings.standard], [1.1, 'dark', 'us']);
});

test('new library items from both sides are kept, newest first', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  l.library.passages.unshift({ id: 'p2', text: 'b' });
  r.library.passages.unshift({ id: 'p3', text: 'c' });
  r.library.stats.p1 = { runs: 1 };
  const m = SY.merge(b, l, r);
  assert.deepStrictEqual(m.library.passages.map((p) => p.id), ['p3', 'p2', 'p1']);
  assert.deepStrictEqual(m.library.stats.p1, { runs: 1 });
});

test('created keeps the earliest day and lastBackup the latest', () => {
  const b = baseState(), l = clone(b), r = clone(b);
  r.created = T - 30; l.lastBackup = T; r.lastBackup = T - 2;
  const m = SY.merge(b, l, r);
  assert.deepStrictEqual([m.created, m.lastBackup], [T - 30, T]);
});

test('eq ignores key order', () => {
  assert.ok(SY.eq({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }));
  assert.ok(!SY.eq({ a: 1 }, { a: 2 }));
});
