/* Spelling Coach - sync between devices through a file in a private GitHub repo.
   One user, one file (progress.json.gz). A three-way merge with the last synced copy (the "base")
   keeps answers made on both devices between two syncs. The token never goes into backups. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.SC = root.SC || {}; root.SC.sync = api; }
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var CFG_KEY = 'spellingCoach.sync';
  var BASE_KEY = 'spellingCoach.syncBase';
  var FILE = 'progress.json.gz';
  var MAX_ERRORS = 3000;

  // ------------------------------------------------------------------ merge (pure)
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

  // JSON with sorted keys, so equal states compare equal whatever order their keys were written in.
  function stable(x) {
    if (x === undefined) return 'undefined';
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (isObj(x)) return '{' + Object.keys(x).sort().filter(function (k) { return x[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + stable(x[k]); }).join(',') + '}';
    return JSON.stringify(x);
  }
  function eq(a, b) { return stable(a) === stable(b); }

  // Default conflict rule: keep whatever still exists, merge objects key by key, otherwise this device wins.
  function defaultConflict(l, r, b) {
    if (l === undefined) return r;
    if (r === undefined) return l;
    if (isObj(l) && isObj(r)) return merge3(isObj(b) ? b : undefined, l, r, defaultConflict);
    return l;
  }

  // Three-way merge of two maps. A key changed on one side only takes that side (deletions too).
  function merge3(b, l, r, conflict) {
    b = b || {}; l = l || {}; r = r || {};
    var out = {}, keys = {};
    [b, l, r].forEach(function (o) { Object.keys(o).forEach(function (k) { keys[k] = 1; }); });
    Object.keys(keys).forEach(function (k) {
      var lv = l[k], rv = r[k], bv = b[k], v;
      if (eq(lv, rv)) v = lv;
      else if (eq(lv, bv)) v = rv;
      else if (eq(rv, bv)) v = lv;
      else v = (conflict || defaultConflict)(lv, rv, bv, k);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  // A word reviewed on both devices: the copy with more reviews wins, then the later review.
  function pickProgress(l, r) {
    if (l === undefined) return r;
    if (r === undefined) return l;
    if ((r.reps || 0) !== (l.reps || 0)) return (r.reps || 0) > (l.reps || 0) ? r : l;
    return (r.last || 0) > (l.last || 0) ? r : l;
  }

  // Daily counters are sums, so each side's practice since the base is added.
  function mergeDaily(b, l, r, hasBase) {
    b = b || {}; l = l || {}; r = r || {};
    var out = {}, days = {};
    Object.keys(l).concat(Object.keys(r)).forEach(function (d) { days[d] = 1; });
    Object.keys(days).forEach(function (d) {
      var lv = l[d] || {}, rv = r[d] || {}, bv = b[d] || {}, o = {}, fields = {};
      [lv, rv].forEach(function (x) { Object.keys(x).forEach(function (f) { fields[f] = 1; }); });
      Object.keys(fields).forEach(function (f) {
        var a = Number(lv[f]) || 0, c = Number(rv[f]) || 0, base = Number(bv[f]) || 0;
        o[f] = hasBase ? Math.max(0, c + a - base) : Math.max(a, c);
      });
      if (Object.keys(o).length) out[d] = o;
    });
    return out;
  }

  // Lists as multisets: an item survives unless it was in the base and one side removed it.
  function mergeList(b, l, r, keyOf) {
    function counted(list) {
      var seen = {}, out = [];
      (list || []).forEach(function (x) {
        var k = keyOf(x);
        seen[k] = (seen[k] || 0) + 1;
        out.push({ k: k + '#' + seen[k], v: x });
      });
      return out;
    }
    var B = {}, L = {}, R = {};
    counted(b).forEach(function (e) { B[e.k] = 1; });
    var lc = counted(l), rc = counted(r);
    lc.forEach(function (e) { L[e.k] = e.v; });
    rc.forEach(function (e) { R[e.k] = e.v; });
    function keep(k) { return (k in L && k in R) || !(k in B); }
    var out = [], used = {};
    // New items from the other device first (lists are newest-first), then this device's order.
    rc.forEach(function (e) { if (!(e.k in L) && !(e.k in B)) { out.push(e.v); used[e.k] = 1; } });
    lc.forEach(function (e) { if (!used[e.k] && keep(e.k)) { out.push(e.v); used[e.k] = 1; } });
    rc.forEach(function (e) { if (!used[e.k] && keep(e.k)) { out.push(e.v); used[e.k] = 1; } });
    return out;
  }

  function errKey(e) { return [e.d, e.id, e.a, e.c].join('|'); }
  function itemKey(x) { return x && x.id != null ? 'id:' + x.id : stable(x); }

  function num(fn, a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return fn(a, b);
  }

  // merge(base, local, remote) -> merged state. base may be null (first sync on this device).
  function merge(base, local, remote) {
    var hasBase = !!base;
    var b = base || {}, l = local || {}, r = remote || {};
    var out = merge3(b, l, r);
    out.progress = merge3(b.progress, l.progress, r.progress, pickProgress);
    out.daily = mergeDaily(b.daily, l.daily, r.daily, hasBase);
    var errs = mergeList(b.errors, l.errors, r.errors, errKey);
    errs.sort(function (x, y) { return (x.d || 0) - (y.d || 0); });
    if (errs.length > MAX_ERRORS) errs = errs.slice(errs.length - MAX_ERRORS);
    out.errors = errs;
    var bl = b.library || {}, ll = l.library || {}, rl = r.library || {};
    out.library = merge3(bl, ll, rl);
    out.library.passages = mergeList(bl.passages, ll.passages, rl.passages, itemKey);
    out.library.tasks = mergeList(bl.tasks, ll.tasks, rl.tasks, itemKey);
    out.created = num(Math.min, l.created, r.created);
    out.lastBackup = num(Math.max, l.lastBackup, r.lastBackup);
    if (out.lastBackup == null) out.lastBackup = null;
    return out;
  }

  // ------------------------------------------------------------------ storage helpers
  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function readJSON(key) { try { var s = ls(); var v = s && s.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeJSON(key, v) { try { var s = ls(); if (!s) return false; if (v == null) s.removeItem(key); else s.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }

  function config() { return readJSON(CFG_KEY) || {}; }
  function setConfig(patch) {
    var c = Object.assign(config(), patch || {});
    Object.keys(c).forEach(function (k) { if (c[k] === '' || c[k] == null) delete c[k]; });
    writeJSON(CFG_KEY, c);
    return c;
  }
  function configured() { var c = config(); return !!(c.owner && c.repo && c.token); }
  function forget() { writeJSON(CFG_KEY, null); writeJSON(BASE_KEY, null); }

  // ------------------------------------------------------------------ transport (browser)
  function b64FromBytes(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return root.btoa(s);
  }
  function bytesFromB64(b64) {
    var s = root.atob(String(b64).replace(/\s+/g, ''));
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function streamBytes(bytes, stream) {
    return new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function gzip(text) { return streamBytes(new TextEncoder().encode(text), new CompressionStream('gzip')); }
  function gunzip(bytes) { return streamBytes(bytes, new DecompressionStream('gzip')).then(function (b) { return new TextDecoder().decode(b); }); }

  function apiUrl(c) {
    return 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/' + FILE;
  }
  function headers(c) {
    return { 'Authorization': 'Bearer ' + c.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function httpError(res, what) {
    return res.json().catch(function () { return {}; }).then(function (j) {
      var msg = j && j.message ? j.message : res.statusText;
      if (res.status === 401) msg = 'the token was refused (expired or mistyped)';
      else if (res.status === 403) msg = 'the token has no write access to this repo (' + msg + ')';
      else if (res.status === 404 && what === 'repo') msg = 'repo not found, or the token cannot see it';
      var e = new Error(msg);
      e.status = res.status;
      throw e;
    });
  }

  function pull(c) {
    return root.fetch(apiUrl(c), { headers: headers(c), cache: 'no-store' }).then(function (res) {
      if (res.status === 404) {
        // No file yet is fine, but only if the repo itself is reachable.
        var repoUrl = 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo);
        return root.fetch(repoUrl, { headers: headers(c), cache: 'no-store' }).then(function (r2) {
          if (!r2.ok) return httpError(r2, 'repo');
          return { sha: null, state: null };
        });
      }
      if (!res.ok) return httpError(res);
      return res.json().then(function (j) {
        return gunzip(bytesFromB64(j.content)).then(function (text) {
          var data = JSON.parse(text);
          return { sha: j.sha, state: data && data.state ? data.state : data };
        });
      });
    });
  }

  function deviceName() {
    var ua = (root.navigator && root.navigator.userAgent) || '';
    return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'phone' : 'computer';
  }

  function push(c, state, sha) {
    var text = JSON.stringify({ app: 'spelling-coach', saved: new Date().toISOString(), from: deviceName(), state: state });
    return gzip(text).then(function (bytes) {
      var body = { message: 'Sync from ' + deviceName(), content: b64FromBytes(bytes) };
      if (sha) body.sha = sha;
      return root.fetch(apiUrl(c), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers(c)), body: JSON.stringify(body) });
    }).then(function (res) {
      if (!res.ok) return httpError(res);
      return res.json();
    });
  }

  // ------------------------------------------------------------------ sync
  var running = null;

  function store() { return (root.SC && root.SC.store) || null; }

  // Replace the contents of ST.state in place: other modules keep references to it.
  function applyState(ST, merged) {
    var s = ST.state;
    Object.keys(s).forEach(function (k) { delete s[k]; });
    var fresh = JSON.parse(JSON.stringify(merged));
    var def = ST.defaults();
    Object.keys(def).forEach(function (k) {
      if (fresh[k] === undefined) s[k] = def[k];
      else if (isObj(def[k]) && isObj(fresh[k])) s[k] = Object.assign({}, def[k], fresh[k]);
      else s[k] = fresh[k];
    });
    Object.keys(fresh).forEach(function (k) { if (!(k in s)) s[k] = fresh[k]; });
    ST.saveNow();
  }

  function attempt(c, ST, retry) {
    return pull(c).then(function (remote) {
      var local = JSON.parse(JSON.stringify(ST.state));
      var base = readJSON(BASE_KEY);
      var merged = remote.state ? merge(base, local, remote.state) : local;
      var localChanged = !eq(merged, local);
      var remoteChanged = !remote.state || !eq(merged, remote.state);
      var done = function () {
        if (localChanged) applyState(ST, merged);
        writeJSON(BASE_KEY, merged);
        setConfig({ lastSync: Date.now() });
        return { ok: true, changed: localChanged, pushed: remoteChanged };
      };
      if (!remoteChanged) return done();
      return push(c, merged, remote.sha).then(done, function (e) {
        // Someone else wrote the file since we read it: read, merge and try once more.
        if (retry && (e.status === 409 || e.status === 422)) return attempt(c, ST, false);
        throw e;
      });
    });
  }

  function now() {
    if (running) return running;
    var ST = store();
    if (!configured() || !ST || !ST.state) return Promise.resolve({ ok: false, error: 'Sync is not set up.' });
    if (typeof root.CompressionStream === 'undefined') return Promise.resolve({ ok: false, error: 'This browser is too old for sync.' });
    if (root.navigator && root.navigator.onLine === false) return Promise.resolve({ ok: false, offline: true, error: 'You are offline.' });
    ST.saveNow();
    running = attempt(config(), ST, true).catch(function (e) {
      return { ok: false, error: String(e && e.message || e) };
    }).then(function (res) { running = null; return res; });
    return running;
  }

  return {
    CFG_KEY: CFG_KEY, BASE_KEY: BASE_KEY, FILE: FILE,
    merge: merge, merge3: merge3, eq: eq,
    config: config, setConfig: setConfig, configured: configured, forget: forget,
    now: now, isRunning: function () { return !!running; }
  };
});
