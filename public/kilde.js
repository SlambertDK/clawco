/* KC-0128: Start's connect cards. Pure helpers, no DOM: the card's form becomes the body of
   POST /api/kilder/:id/forbind ({ felter, zone }; Start never handles a secret itself), and the
   answer says where the browser goes next — the provider's login, the card's destination (Nu,
   where the first value stands), or the page again. Loaded as a classic script before app.js;
   tests import it for KCKilde. */
(function (root) {
  'use strict';

  // [[name, value], ...] from FormData -> { felter: {...}, zone? }. The zone is Start's choice, not a card field.
  function krop(par) {
    var felter = {};
    var zone;
    for (var i = 0; i < par.length; i++) {
      if (par[i][0] === 'zone') zone = String(par[i][1]);
      else felter[par[i][0]] = String(par[i][1]);
    }
    return zone ? { felter: felter, zone: zone } : { felter: felter };
  }

  // A same-origin path ("/x", never "//host") or an http(s) address; anything else is not followed.
  function sikker(url) {
    return typeof url === 'string' && (/^\/(?!\/)/.test(url) || /^https?:\/\//i.test(url));
  }

  function naeste(svar, efter, her) {
    if (svar && sikker(svar.omdiriger)) return svar.omdiriger;
    if (sikker(efter)) return efter;
    return her;
  }

  root.KCKilde = { krop: krop, naeste: naeste };
})(typeof window !== 'undefined' ? window : globalThis);
