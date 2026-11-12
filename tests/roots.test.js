'use strict';
// Greek and Latin roots: the matcher (app/morphology.js findRoots), the curated list
// (build/curated/roots.json) and root-based mistake feedback (app/analyzer.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const M = require('../app/morphology.js');
const A = require('../app/analyzer.js');

const R = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build', 'curated', 'roots.json'), 'utf8'));
const user = (w) => M.findRoots(w, R, 5);                         // a word the learner adds (no etymology)
const build = (w, greek, ml, lat) => M.findRoots(w, R, { minLen: 5, greek: greek, ml: ml || [], lat: lat || [] });

test('every curated root has a meaning, an origin and valid patterns', () => {
  Object.keys(R).forEach((k) => {
    const e = R[k];
    assert.ok(/^[a-z]+$/.test(k), k);
    assert.ok(e.m && e.o && Array.isArray(e.ex), k);
    (e.no || []).forEach((p) => new RegExp(p));
    if (e.k) assert.ok(['prefix', 'suffix'].includes(e.k), k);
  });
});

test('Greek roots and prefixes are found and returned in word order', () => {
  assert.deepStrictEqual(user('telephone'), ['tele', 'phon']);
  assert.deepStrictEqual(user('psychology'), ['psych', 'logy']);
  assert.deepStrictEqual(user('analyse'), ['ana', 'lys']);
  assert.deepStrictEqual(user('hypothesis'), ['hypo']);
  assert.deepStrictEqual(build('hypothesis', true), ['hypo', 'thes']);
  assert.deepStrictEqual(user('catastrophe'), ['cata', 'stroph']);
  assert.deepStrictEqual(user('psychological'), ['psych', 'logi']);
});

test('Greek prefixes match only at the start of a word', () => {
  assert.ok(user('symbol').includes('sym'));
  assert.ok(user('unsympathetic').includes('sym'));
  assert.ok(user('asymmetry').includes('sym'));
  assert.ok(!user('monopoly').includes('poly'));       // mono + pol (sell), not "many"
  assert.ok(!user('company').includes('pan'));
  assert.ok(!user('preparation').includes('para'));
  assert.ok(!user('imperial').includes('peri'));
});

test('look-alikes are excluded', () => {
  assert.ok(!user('apology').includes('logy'));        // apo + log (speech), not "study of"
  assert.ok(build('apology', true).includes('log'));
  assert.ok(!build('catastrophe', true).includes('astr'));
  assert.deepStrictEqual(build('search', true, ['search']), []);
  assert.ok(!build('academic', true).includes('dem'));
  assert.deepStrictEqual(user('furthermore'), []);
  assert.deepStrictEqual(user('cemetery'), []);
  assert.deepStrictEqual(user('hyphen'), []);
  assert.ok(!user('esophagus').includes('soph'));
  assert.deepStrictEqual(build('log', false, ['log']), []);
});

test('short Greek roots need etymology evidence; safe roots do not', () => {
  assert.ok(!user('biology').includes('bio'));          // bio is also in dubious
  assert.ok(build('biology', true).includes('bio'));
  assert.ok(build('biology', false, ['bio', 'log']).includes('bio'));
  assert.deepStrictEqual(user('rhythmic'), []);
  assert.ok(user('cycle').includes('cycl'));
  assert.ok(user('dynamic').includes('dyn'));
});

test('only-lists limit risky entries', () => {
  assert.ok(user('disaster').includes('aster'));
  assert.ok(!user('master').includes('aster'));
  assert.ok(user('school').includes('scho'));
  assert.ok(!user('scheme').includes('scho'));
  assert.ok(user('atom').includes('a'));
  assert.ok(!user('apple').includes('a'));
});

test('build keeps MorphoLex roots for Latin words, as before', () => {
  assert.deepStrictEqual(build('reducing', false, ['duct']), ['duct']);
  assert.deepStrictEqual(build('port', false, ['port']), ['port']);
  assert.deepStrictEqual(build('transcribe', false, ['script', 'trans']), ['trans', 'script']);
  assert.deepStrictEqual(build('kilometre', true, ['meter']), ['kilo', 'metr']);  // no duplicate meter
  assert.deepStrictEqual(build('structure', false, ['struct']), ['struct']);
  assert.deepStrictEqual(user('structure'), ['struct']);   // old numeric signature still works
});

test('Latin roots are attached when the Latin source word confirms them', () => {
  assert.deepStrictEqual(build('maintenance', false, ['maintain'], ['ten']), ['ten']);
  assert.deepStrictEqual(build('pronunciation', false, ['pronounce'], ['nunc']), ['nunc']);
  assert.deepStrictEqual(build('interview', false, ['interview'], ['inter']), ['inter']);
  assert.deepStrictEqual(build('opportunity', false, ['opportune'], []), []);      // portus (harbour), not port (carry)
  assert.deepStrictEqual(build('winter', false, ['winter'], []), []);             // the old 5-letter guess gave inter
  assert.deepStrictEqual(build('printer', false, [], ['inter']), []);             // Latin prefixes must start the word
  assert.deepStrictEqual(build('human', false, ['human'], ['man']), []);          // excluded look-alike
});

test('every Latin root has a source pattern; look-alikes are excluded', () => {
  Object.keys(R).filter((k) => R[k].o === 'Latin').forEach((k) => assert.ok(R[k].src, k + ' has no src'));
  ['festival', 'considerable', 'contract', 'magnet', 'medicine'].forEach((w) => {
    const lat = Object.keys(R).filter((k) => R[k].o === 'Latin' && w.includes(k));
    const got = build(w, false, [], lat);
    assert.ok(!got.some((r) => ['val', 'sid', 'vac', 'contra', 'magn', 'medi'].includes(r)), w + ' -> ' + got);
  });
});

test('Latin source patterns tell the real Latin word from a look-alike', () => {
  const src = (k, latin) => new RegExp(R[k].src).test(latin);
  assert.ok(src('port', 'transporto transportare') && !src('port', 'opportunitas'));   // carry, not harbour
  assert.ok(src('vac', 'vacuus') && !src('vac', 'vaccinus'));                            // empty, not cow
  assert.ok(src('nat', 'natura') && !src('nat', 'donatus'));                             // born, not -natus endings
  assert.ok(src('val', 'valere') && !src('val', 'vallis'));                              // strong, not valley
  assert.ok(src('ten', 'manus tenere') && !src('ten', 'attentio'));                      // hold, not stretch
  assert.ok(src('vit', 'vita') && !src('vit', 'activitas'));
});

test('a prefix may share one letter with the next root', () => {
  assert.deepStrictEqual(build('transcribe', false, [], ['trans', 'scrib']), ['trans', 'scrib']);
});

test('rootLabel writes prefixes and suffixes with a hyphen', () => {
  assert.strictEqual(M.rootLabel('syn', R.syn), 'syn-');
  assert.strictEqual(M.rootLabel('logy', R.logy), '-logy');
  assert.strictEqual(M.rootLabel('logi', R.logi), '-logy');
  assert.strictEqual(M.rootLabel('psych', R.psych), 'psych');
});

const ctx = { roots: R };
const entry = (w, root) => ({ id: w, w: w, root: root });

test('an error inside a Greek root is explained by the root', () => {
  const ph = A.classify('fonetic', entry('phonetic', ['phon']), ctx);
  assert.strictEqual(ph.primary, 'root');
  assert.match(ph.cats[0].why, /phon = sound \(Greek\)/);
  assert.match(ph.cats[0].why, /ph says \/f\//);

  const ps = A.classify('sycology', entry('psychology', ['psych', 'logy']), ctx);
  assert.strictEqual(ps.primary, 'root');
  assert.match(ps.cats[0].why, /psychology = psych \(mind, soul\) \+ -logy \(study of\)/);
  assert.match(ps.cats[0].why, /silent p/);

  const ly = A.classify('analise', entry('analyse', ['ana', 'lys']), ctx);
  assert.strictEqual(ly.primary, 'root');
  assert.match(ly.cats[0].why, /-yse/);
  assert.strictEqual(ly.cats[0].unit, 18);
});

test('a Latin root without a spelling clue points to its family', () => {
  const r = A.classify('perspictive', entry('perspective', ['spect']), ctx);
  assert.strictEqual(r.primary, 'root');
  assert.match(r.cats[0].why, /spect = look \(Latin\)\. This part keeps its spelling in every word of its family: inspect/);
});

test('Latin roots explain the classic family changes', () => {
  const cases = [
    ['pronounciation', 'pronunciation', ['nunc'], /the o drops out/],
    ['maintainance', 'maintenance', ['ten'], /ai becomes e/],
    ['extention', 'extension', ['tens'], /extend → extension/],
    ['permision', 'permission', ['miss'], /t becomes ss/],
    ['decition', 'decision', ['cis'], /d becomes s/],
    ['assumtion', 'assumption', ['sumpt'], /a p appears/]
  ];
  cases.forEach(([typed, word, root, rx]) => {
    const r = A.classify(typed, entry(word, root), ctx);
    assert.strictEqual(r.primary, 'root', word);
    assert.match(r.cats[0].why, rx, word);
  });
});

test('an ending clue is a second reason for an error right after the root', () => {
  const r = A.classify('consistant', entry('consistent', ['sist']), ctx);
  assert.strictEqual(r.primary, 'suffix-choice');
  assert.strictEqual(r.cats[1].key, 'root');
  assert.match(r.cats[1].why, /-ent \/ -ence/);
  const d = A.classify('differance', entry('difference', ['fer']), ctx);    // fer has no ending clue
  assert.ok(d.cats.every((c) => c.key !== 'root'));
});

test('specific rules still win, and errors outside the root are unchanged', () => {
  // ie/ei inside the -ceive root keeps its own, more precise explanation.
  assert.strictEqual(A.classify('recieve', entry('receive', ['ceive']), ctx).primary, 'ie-ei');
  // Missing ending outside the root.
  assert.strictEqual(A.classify('symbol', entry('symbols', ['sym']), ctx).primary, 'ending');
  // Without root data the analyzer behaves exactly as before.
  assert.ok(A.classify('fonetic', entry('phonetic', ['phon']), {}).cats.every((c) => c.key !== 'root'));
});
