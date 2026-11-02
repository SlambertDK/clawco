/* KC-0022: hands-free listening for Samtale with Hermes. Pure logic, no DOM:
   the page feeds the mic level (RMS 0..1) every ~50 ms and gets back whether
   Henrik is still quiet, talking, finished a sentence, or never said anything.
   Loaded as a classic script before app.js; tests import it for KCLyt. */
(function (root) {
  'use strict';
  function maaler(o) {
    o = o || {};
    var pauseMs = o.pauseMs || 1200;   // this long quiet after speech ends the sentence
    var stilleMs = o.stilleMs || 8000; // this long with no speech at all = silence
    var minTaleMs = o.minTaleMs || 250; // a click or a bump is not speech
    var faktor = o.faktor || 3;         // speech is this many times the room noise
    var minNiveau = o.minNiveau || 0.02;
    var t0 = null, prevT = null, floor = null, lastLoud = null, loudMs = 0, talking = false;
    return {
      feed: function (rms, t) {
        if (t0 === null) { t0 = t; prevT = t; }
        var dt = t - prevT; prevT = t;
        var threshold = Math.max(minNiveau, (floor === null ? 0 : floor) * faktor);
        if (rms > threshold) {
          loudMs += dt; lastLoud = t;
          if (loudMs >= minTaleMs) talking = true;
        } else {
          floor = floor === null ? rms : floor * 0.95 + rms * 0.05;
        }
        if (talking && t - lastLoud >= pauseMs) return 'faerdig';
        if (!talking && t - t0 >= stilleMs) return 'stille';
        return talking ? 'taler' : 'venter';
      }
    };
  }
  var STOP = ['stop', 'stop det', 'stop samtalen', 'slut', 'afslut', 'farvel', 'hej hej', 'det var det', 'det var alt', 'tak det var det', 'tak det var alt', 'tak det er nok', 'det er nok'];
  function erStop(tekst) {
    var s = String(tekst || '').toLowerCase().replace(/[^a-zæøå ]+/g, ' ').replace(/\s+/g, ' ').trim();
    return STOP.indexOf(s) >= 0;
  }
  root.KCLyt = { maaler: maaler, erStop: erStop };
})(typeof window !== 'undefined' ? window : globalThis);
