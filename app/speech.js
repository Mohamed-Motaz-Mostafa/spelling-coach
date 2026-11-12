/* Spelling Coach - text-to-speech for dictation (Web Speech API).
   Prefers British voices; Edge's online "Natural" voices sound best. Degrades quietly without TTS. */
(function (root) {
  'use strict';
  var synth = root.speechSynthesis;
  var voices = [];
  var listeners = [];
  var token = 0;

  function load() {
    if (!synth) return;
    voices = synth.getVoices().filter(function (v) { return /^en([-_]|$)/i.test(v.lang); });
    listeners.forEach(function (fn) { try { fn(voices); } catch (e) { /* ignore listener errors */ } });
  }
  if (synth) {
    load();
    if ('onvoiceschanged' in synth) synth.onvoiceschanged = load;
    setTimeout(load, 400);
    setTimeout(load, 1500);
  }

  function accentOf(v) {
    var m = /^en[-_]?([a-z]{2})/i.exec(v.lang || '');
    return m ? m[1].toUpperCase() : 'EN';
  }

  function rank(v) {
    var s = 0;
    if (accentOf(v) === 'GB') s += 50;
    if (/natural/i.test(v.name)) s += 30;
    if (/online|google/i.test(v.name)) s += 12;
    if (v.localService) s += 2;
    return s;
  }

  function sorted() { return voices.slice().sort(function (a, b) { return rank(b) - rank(a); }); }

  function pick(settings, rotateIndex) {
    settings = settings || {};
    var list = sorted();
    if (!list.length) return null;
    if (settings.accentRotation && rotateIndex != null) {
      var byAccent = {};
      list.forEach(function (v) { var a = accentOf(v); if (!byAccent[a]) byAccent[a] = v; });
      var accents = ['GB', 'AU', 'IE', 'US', 'CA', 'NZ'].filter(function (a) { return byAccent[a]; });
      if (accents.length) return byAccent[accents[rotateIndex % accents.length]];
    }
    if (settings.voiceURI) {
      var chosen = list.filter(function (v) { return v.voiceURI === settings.voiceURI; })[0];
      if (chosen) return chosen;
    }
    return list[0];
  }

  // Speak one utterance; resolves when it ends (or after a safety timeout - some engines never fire onend).
  function speakRaw(text, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      if (!synth || !text) { resolve(false); return; }
      var u = new SpeechSynthesisUtterance(text);
      var v = opts.voice || pick(opts.settings, opts.rotateIndex);
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-GB'; }
      u.rate = opts.rate || (opts.settings && opts.settings.rate) || 0.9;
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(true); } };
      u.onend = finish;
      u.onerror = finish;
      setTimeout(finish, 2500 + text.length * 140);
      try {
        if (synth.paused) synth.resume();
        synth.speak(u);
      } catch (e) { finish(); }
    });
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* sequence([{text, rate?, pause?}], opts): speaks parts in order; any newer call cancels it. */
  function sequence(parts, opts) {
    stop();
    var my = token;
    var voice = pick(opts && opts.settings, opts && opts.rotateIndex);
    return parts.reduce(function (p, part) {
      return p.then(function (alive) {
        if (!alive || my !== token) return false;
        return speakRaw(part.text, Object.assign({}, opts, { voice: voice }, part.rate ? { rate: part.rate } : {})).then(function () {
          if (my !== token) return false;
          return part.pause ? wait(part.pause).then(function () { return my === token; }) : true;
        });
      });
    }, Promise.resolve(true));
  }

  function stop() {
    token += 1;
    if (synth) { try { synth.cancel(); } catch (e) { /* ignore */ } }
  }

  root.SC = root.SC || {};
  root.SC.speech = {
    supported: !!synth,
    voices: function () { return sorted(); },
    onVoices: function (fn) { listeners.push(fn); if (voices.length) fn(voices); },
    hasBritish: function () { return voices.some(function (v) { return accentOf(v) === 'GB'; }); },
    accentOf: accentOf,
    pick: pick,
    speak: function (text, opts) { stop(); return speakRaw(text, opts); },
    sequence: sequence,
    stop: stop
  };
})(typeof self !== 'undefined' ? self : this);
