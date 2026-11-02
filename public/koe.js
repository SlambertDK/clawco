/* KC-0100: the Kø panel in plain Danish (KC-0170: or English). Pure helpers, no DOM: a model id becomes a human name
   (derived from the id's pattern, never from a list of models), and a run becomes the status
   words of its row. The words are read from the page's table (window.KC_TEKST, set in <head> from the shell table's
   `klient` part) at the moment they are needed; without a table the Danish words below stand. Loaded as a classic
   script before app.js; tests import it for KCKoe. */
(function (root) {
  'use strict';
  // A word of the page's table, or today's Danish one when the page has none (a test, an old page); `{n}` is replaced.
  function t(k, dansk, n) {
    var T = root.KC_TEKST;
    var s = T && typeof T[k] === 'string' ? T[k] : dansk;
    return n === undefined ? s : s.replace('{n}', n);
  }
  function stil(slags) { return slags === 'haiku' ? t('koeHurtig', ' — hurtig') : slags === 'opus' ? t('koeGrundig', ' — grundig') : ''; }

  // "claude-haiku-5.5" -> "Haiku 5.5 — hurtig"; empty -> Hermes' own choice; anything unknown stays as typed.
  function modelNavn(id) {
    var s = String(id || '').trim();
    if (!s) return t('koeStandard', "Hermes' standard");
    var m = /(?:^|\/)(?:claude-)?(haiku|sonnet|opus)-(\d+)(?:[.-](\d+))?/i.exec(s);
    if (!m) return s;
    var slags = m[1].toLowerCase();
    return slags.charAt(0).toUpperCase() + slags.slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '') + stil(slags);
  }

  // The words on a queue row: waiting, how long it has been going, or how it ended.
  // `begyndt` is when it left the queue (absent = fall back to when it was created); `nu` is the page's clock.
  function status(r, nu) {
    if (r.status === 'queued') return t('koeIKoe', 'i kø');
    if (r.status === 'done') return t('koeKlar', 'klar');
    if (r.status === 'failed') return t('koeMislykkedes', 'mislykkedes');
    var min = Math.floor((nu - (r.begyndt || r.startedAt)) / 60000);
    if (min < 1) return t('koeLigeStartet', 'lige startet');
    if (min < 60) return t('koeStartetMin', 'startet for {n} min siden', min);
    var timer = Math.floor(min / 60);
    return t(timer === 1 ? 'koeStartetTime' : 'koeStartetTimer', timer === 1 ? 'startet for {n} time siden' : 'startet for {n} timer siden', timer);
  }

  root.KCKoe = { modelNavn: modelNavn, status: status };
})(typeof window !== 'undefined' ? window : globalThis);
