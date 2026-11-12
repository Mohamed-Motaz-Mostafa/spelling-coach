'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ST = require('../app/store.js');

const T = 20000;

test('recordAnswer updates progress, error log and daily stats', () => {
  ST.load();
  ST.reset();
  ST.recordAnswer('receive', { ok: false, typed: 'recieve', ms: 4000, cats: [{ key: 'ie-ei', group: 'O', unit: 13 }] }, { today: T, rnd: 0.5 });
  ST.recordAnswer('beginning', { ok: true, ms: 3000 }, { today: T, rnd: 0.5 });
  const s = ST.state;
  assert.strictEqual(s.progress.receive.b, 1);
  assert.strictEqual(s.progress.beginning.b, 2);
  assert.strictEqual(s.errors.length, 1);
  assert.deepStrictEqual([s.errors[0].id, s.errors[0].c, s.errors[0].u], ['receive', 'ie-ei', 13]);
  assert.deepStrictEqual([s.daily[T].n, s.daily[T].ok, s.daily[T].new], [2, 1, 2]);
  const byId = ST.errorsById();
  assert.strictEqual(byId.receive.count, 1);
  assert.strictEqual(byId.receive.lastCat, 'ie-ei');
  assert.deepStrictEqual(ST.categoryCounts(), { 'ie-ei': 1 });
});

test('streak counts consecutive practice days', () => {
  ST.reset();
  ST.state.daily = { [T]: { n: 3 }, [T - 1]: { n: 1 }, [T - 2]: { n: 2 }, [T - 4]: { n: 1 } };
  assert.strictEqual(ST.streak(T), 3);
  assert.strictEqual(ST.streak(T + 1), 3);
  assert.strictEqual(ST.streak(T + 2), 0);
});

test('export and import round-trip; bad files are rejected', () => {
  ST.reset();
  ST.state.settings.newPerDay = 17;
  ST.state.userWords.ubiquitous = { id: 'ubiquitous', w: 'ubiquitous', d: ['Found everywhere.'], ex: [] };
  const json = ST.exportJSON();
  ST.reset();
  assert.strictEqual(ST.state.settings.newPerDay, 10);
  const r = ST.importJSON(json);
  assert.ok(r.ok);
  assert.strictEqual(ST.state.settings.newPerDay, 17);
  assert.ok(ST.state.userWords.ubiquitous);
  assert.strictEqual(ST.importJSON('not json').ok, false);
  assert.strictEqual(ST.importJSON('{"hello":1}').ok, false);
});

test('new settings keys get defaults when loading an older backup', () => {
  ST.reset();
  const r = ST.importJSON(JSON.stringify({ progress: {}, settings: { newPerDay: 12 } }));
  assert.ok(r.ok);
  assert.strictEqual(ST.state.settings.newPerDay, 12);
  assert.strictEqual(ST.state.settings.standard, 'uk');
  assert.ok(ST.state.units && ST.state.units.seenLesson);
});
