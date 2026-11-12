'use strict';
// The Gemini client with a fake fetch: no network, no quota used.
const test = require('node:test');
const { beforeEach } = require('node:test');
const assert = require('node:assert');
const AI = require('../app/ai.js');

beforeEach(() => AI.resetCooldowns());

const ok = (data) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] } });
const fail = (status, message) => ({ status, body: { error: { code: status, message } } });

// fakeFetch(handler) records every call as {model, key, body} and answers with handler(call, n).
function fakeFetch(handler) {
  const calls = [];
  const f = (url, init) => {
    const call = { model: url.match(/models\/([^:]+):/)[1], key: init.headers['x-goog-api-key'], body: JSON.parse(init.body) };
    calls.push(call);
    const r = handler(call, calls.length);
    if (r instanceof Error) return Promise.reject(r);
    if (r === 'hang') {
      return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return Promise.resolve({ status: r.status, text: () => Promise.resolve(JSON.stringify(r.body)) });
  };
  f.calls = calls;
  return f;
}

test('the same model is tried on the second key before a weaker model', async () => {
  const f = fakeFetch((c) => (c.key === 'k1' ? fail(429, 'Resource has been exhausted') : ok({ ok: true })));
  const r = await AI.generate({ prompt: 'x' }, { keys: ['k1', 'k2'], fetch: f });
  assert.deepStrictEqual(f.calls.map((c) => c.model + '/' + c.key), ['gemini-3.8-flash/k1', 'gemini-3.8-flash/k2']);
  assert.strictEqual(r.model, 'gemini-3.8-flash');
  assert.strictEqual(r.key, 1);
});

test('when every key is out of quota the next free model takes over', async () => {
  const f = fakeFetch((c) => (c.model === 'gemini-3.8-flash' ? fail(429, 'quota') : ok({ ok: true })));
  const r = await AI.generate({ prompt: 'x' }, { keys: ['k1', 'k2'], fetch: f });
  assert.strictEqual(r.model, 'gemini-3.6-flash');
  assert.strictEqual(f.calls.length, 3);
});

test('all quotas used up gives a quota error; being offline stops at once', async () => {
  const f = fakeFetch(() => fail(429, 'quota'));
  await assert.rejects(AI.generate({ prompt: 'x' }, { keys: ['k1'], fetch: f }), (e) => e.code === 'quota');
  assert.strictEqual(f.calls.length, AI.MODELS.length);
  const off = fakeFetch(() => new TypeError('Failed to fetch'));
  await assert.rejects(AI.generate({ prompt: 'x' }, { keys: ['k1', 'k2'], fetch: off }), (e) => e.code === 'offline');
  assert.strictEqual(off.calls.length, 1);
  await assert.rejects(AI.generate({ prompt: 'x' }, { keys: [], fetch: off }), (e) => e.code === 'nokey');
});

// The real 429 body for a used-up daily limit (gemini-3.8-flash, 2026-10-18).
const daily = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] },
  { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '25487s' }] } } };

test('a used-up daily limit rests that model on that key, and the next request skips it', async () => {
  const steps = [];
  const f = fakeFetch((c) => (c.model === 'gemini-3.8-flash' && c.key === 'k1' ? daily : ok({ ok: true })));
  const r = await AI.generate({ prompt: 'x' }, { keys: ['k1', 'k2'], fetch: f, onStatus: (s) => steps.push(s) });
  assert.strictEqual(r.key, 1);
  assert.match(steps[0], /^Asking gemini-3.8-flash \(key 1\)/);
  assert.match(steps[1], /^gemini-3.8-flash \(key 1\) has used its free daily limit \(back at \d\d:\d\d\)\. Trying gemini-3.8-flash \(key 2\)/);
  const g = fakeFetch(() => ok({ ok: true }));
  await AI.generate({ prompt: 'x' }, { keys: ['k1', 'k2'], fetch: g });
  assert.deepStrictEqual(g.calls.map((c) => c.model + '/' + c.key), ['gemini-3.8-flash/k2']);
});

test('when every model has used its daily limit, nothing is sent and the reset time is given', async () => {
  await assert.rejects(AI.generate({ prompt: 'x' }, { keys: ['k1'], fetch: fakeFetch(() => daily) }), (e) => e.code === 'quota');
  const g = fakeFetch(() => ok({ ok: true }));
  await assert.rejects(AI.generate({ prompt: 'x' }, { keys: ['k1'], fetch: g }), (e) => e.code === 'quota' && /back at \d\d:\d\d/.test(e.message));
  assert.strictEqual(g.calls.length, 0);
});

test('a model that does not answer is given up after the timeout, and dictation texts start on gemini-3.6-flash', async () => {
  const steps = [];
  const f = fakeFetch((c) => (c.model === 'gemini-3.6-flash' ? 'hang' : ok({ title: 'T', text: 'Accommodation is necessary.', used: [] })));
  const p = await AI.makePassage(['accommodation', 'necessary'], { keys: ['k1'], fetch: f, timeout: 50, onStatus: (s) => steps.push(s) });
  assert.deepStrictEqual(f.calls.map((c) => c.model), ['gemini-3.6-flash', 'gemini-3.8-flash']);
  assert.strictEqual(p.model, 'gemini-3.8-flash');
  assert.match(steps[1], /gemini-3.6-flash did not answer in time\. Trying gemini-3.8-flash/);
  // The silent model rests, but is still tried as a last resort.
  const g = fakeFetch(() => ok({ ok: true }));
  await AI.generate({ prompt: 'x', fast: true }, { keys: ['k1'], fetch: g, models: [AI.FAST[0]] });
  assert.strictEqual(g.calls.length, 1);
});

test('thinking level is sent only to models that accept it, and dropped if refused', async () => {
  const f = fakeFetch((c, n) => (n === 1 ? fail(400, 'Thinking level LOW is not supported for this model.') : ok({ ok: true })));
  await AI.generate({ prompt: 'x', thinking: 'low' }, { keys: ['k1'], fetch: f });
  assert.deepStrictEqual(f.calls[0].body.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  assert.strictEqual(f.calls[1].model, 'gemini-3.8-flash');
  assert.strictEqual(f.calls[1].body.generationConfig.thinkingConfig, undefined);
  const lite = fakeFetch(() => ok({ ok: true }));
  await AI.generate({ prompt: 'x', thinking: 'low' }, { keys: ['k1'], fetch: lite, models: [{ id: 'gemini-3.5-flash-lite' }] });
  assert.strictEqual(lite.calls[0].body.generationConfig.thinkingConfig, undefined);
});

test('the request carries the system prompt, JSON schema and images', async () => {
  const f = fakeFetch(() => ok({ ok: true }));
  await AI.generate({ prompt: 'p', system: 's', schema: { type: 'OBJECT' }, images: [{ mime: 'image/jpeg', data: 'AAAA' }] }, { keys: ['k'], fetch: f });
  const b = f.calls[0].body;
  assert.strictEqual(b.systemInstruction.parts[0].text, 's');
  assert.strictEqual(b.generationConfig.responseMimeType, 'application/json');
  assert.deepStrictEqual(b.generationConfig.responseSchema, { type: 'OBJECT' });
  assert.deepStrictEqual(b.contents[0].parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
});

test('responses: thought parts are skipped and code fences removed', () => {
  const j = { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '```json\n{"a": 1}\n```' }] } }] };
  assert.deepStrictEqual(AI.parseResponse(j), { a: 1 });
  assert.throws(() => AI.parseResponse({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }), /SAFETY/);
});

test('British safety net: converts American forms but leaves ambiguous ones', () => {
  const map = { color: 'colour', organize: 'organise', analyze: 'analyse', practice: 'practise', program: 'programme', license: 'licence', meter: 'metre' };
  assert.strictEqual(AI.toBritish('Color helps us Organize and ANALYZE.', map), 'Colour helps us Organise and ANALYSE.');
  assert.strictEqual(AI.toBritish('Medical practice, a computer program, a driving license and a parking meter.', map),
    'Medical practice, a computer program, a driving license and a parking meter.');
});

test('passage prompt lists every word; the check finds the missing ones', () => {
  const req = AI.passageRequest(['accommodation', 'necessary'], { length: 'short', topic: 'education' });
  assert.match(req.prompt, /accommodation, necessary/);
  assert.match(req.prompt, /education/);
  assert.match(req.system, /British spelling/);
  assert.match(AI.passageRequest(['x'], { us: true }).system, /American spelling/);
  const p = AI.checkPassage({ title: 'T', text: 'It is **necessary** to find a flat.' }, ['accommodation', 'necessary']);
  assert.deepStrictEqual(p.missing, ['accommodation']);
  assert.strictEqual(p.text, 'It is necessary to find a flat.');
  assert.ok(!AI.hasWord('Necessarily so.', 'necessary'));
  assert.ok(AI.hasWord('Necessary, yes.', 'necessary'));
});

test('makePassage asks again once when too many words are missing', async () => {
  const f = fakeFetch((c, n) => ok(n === 1 ? { title: 'A', text: 'Only one word: necessary.', used: [] } : { title: 'B', text: 'Accommodation is necessary for every guest.', used: [] }));
  const p = await AI.makePassage(['accommodation', 'necessary'], { keys: ['k'], fetch: f });
  assert.strictEqual(f.calls.length, 2);
  assert.strictEqual(p.title, 'B');
  assert.deepStrictEqual(p.missing, []);
  assert.strictEqual(p.kind, 'mistakes');
});

const words = (n) => Array(n).fill('word').join(' ');
test('charts are checked: lengths, numbers and pie totals', () => {
  assert.deepStrictEqual(AI.validateChart({ type: 'line', labels: ['2000', '2010'], series: [{ name: 'A', values: [1, 2] }] }), []);
  assert.match(AI.validateChart({ type: 'bar', labels: ['a', 'b', 'c'], series: [{ name: 'A', values: [1, 2] }] })[0], /2 values for 3 labels/);
  assert.match(AI.validateChart({ type: 'pie', labels: ['a', 'b'], series: [{ name: '1990', values: [50, 40] }] })[0], /add up to 100/);
  assert.deepStrictEqual(AI.validateChart({ type: 'process', steps: ['cut', 'dry', 'pack'] }), []);
  assert.ok(AI.validateChart({ type: 'map' }).length);
});

test('a Task 1 with bad data is asked for again; a good one is tidied', async () => {
  const bad = { question: 'Q', chart: { type: 'bar', title: 'T', unit: '%', labels: ['a', 'b'], series: [{ name: 'S', values: [1] }], steps: [] }, answer: words(180), tips: [], phrases: [] };
  const good = Object.assign({}, bad, { chart: Object.assign({}, bad.chart, { series: [{ name: 'S', values: [1, 2] }] }) });
  const f = fakeFetch((c, n) => ok(n === 1 ? bad : good));
  const t = await AI.makeTask(1, 'bar', 'energy', { keys: ['k'], fetch: f });
  assert.strictEqual(f.calls.length, 2);
  assert.deepStrictEqual(t.chart, { type: 'bar', title: 'T', unit: '%', labels: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] });
  assert.strictEqual(t.words, 180);
  assert.strictEqual(t.task, 1);
  assert.strictEqual(t.source, 'mine');
});

test('a Task 2 answer under 250 words is flagged', () => {
  const c = AI.checkTask({ question: 'Q?', answer: words(200), tips: ['t'], phrases: ['p'] }, 2);
  assert.match(c.problems.join(), /only 200 words/);
  assert.strictEqual(AI.checkTask({ question: 'Q?', answer: words(260) }, 2).problems.length, 0);
});

test('own questions: the model decides Task 1 or 2; an empty answer is an error', async () => {
  const f = fakeFetch(() => ok({ task: 1, question: 'The chart shows...', answer: words(170), tips: [], phrases: [] }));
  const t = await AI.answerOwn('', { mime: 'image/jpeg', data: 'AAAA' }, { keys: ['k'], fetch: f });
  assert.strictEqual(t.task, 1);
  assert.strictEqual(t.source, 'own');
  assert.ok(f.calls[0].body.contents[0].parts[1].inlineData);
  const g = fakeFetch(() => ok({ task: 2, question: '', answer: '', tips: [], phrases: [] }));
  await assert.rejects(AI.answerOwn('hello', null, { keys: ['k'], fetch: g }), (e) => e.code === 'invalid');
});
