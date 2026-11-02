/* KC-0100: the Kø panel in plain Danish. Pure helpers, no DOM: a model id becomes a human name
   (derived from the id's pattern, never from a list of models), and a run becomes the status
   words of its row. Loaded as a classic script before app.js; tests import it for KCKoe. */
(function (root) {
  'use strict';
  var STIL = { haiku: ' — hurtig', sonnet: '', opus: ' — grundig' };

  // "claude-haiku-5.5" -> "Haiku 5.5 — hurtig"; empty -> Hermes' own choice; anything unknown stays as typed.
  function modelNavn(id) {
    var s = String(id || '').trim();
    if (!s) return "Hermes' standard";
    var m = /(?:^|\/)(?:claude-)?(haiku|sonnet|opus)-(\d+)(?:[.-](\d+))?/i.exec(s);
    if (!m) return s;
    var slags = m[1].toLowerCase();
    return slags.charAt(0).toUpperCase() + slags.slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '') + STIL[slags];
  }

  // The words on a queue row: waiting, how long it has been going, or how it ended.
  // `begyndt` is when it left the queue (absent = fall back to when it was created); `nu` is the page's clock.
  function status(r, nu) {
    if (r.status === 'queued') return 'i kø';
    if (r.status === 'done') return 'klar';
    if (r.status === 'failed') return 'mislykkedes';
    var min = Math.floor((nu - (r.begyndt || r.startedAt)) / 60000);
    if (min < 1) return 'lige startet';
    if (min < 60) return 'startet for ' + min + ' min siden';
    var t = Math.floor(min / 60);
    return 'startet for ' + t + (t === 1 ? ' time' : ' timer') + ' siden';
  }

  root.KCKoe = { modelNavn: modelNavn, status: status };
})(typeof window !== 'undefined' ? window : globalThis);
