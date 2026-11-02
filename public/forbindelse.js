/* KC-0072: what Henrik reads when something fails. Pure logic, no DOM.
   A request that never reached the server, or an HTML error page where JSON
   was expected (Tailscale Serve answers 502 while the service restarts), is a
   lost connection — app.js shows the calm band and retries; everything else
   keeps the server's own text. Never "Failed to fetch".
   Loaded as a classic script before app.js; tests import it for KCForbindelse. */
(function (root) {
  'use strict';
  // KC-0121: the product's name is read from the page (<meta name="application-name">, written by
  // the layout from PRODUKT) at the moment it is needed, so no script spells it.
  function produkt() {
    var d = root.document;
    var m = d && typeof d.querySelector === 'function' ? d.querySelector('meta[name="application-name"]') : null;
    return (m && m.getAttribute('content')) || '';
  }
  // KC-0170: a word of the page's table (window.KC_TEKST, the shell table's `klient` part), read when it is needed, or
  // today's Danish word when the page has none (a test, an old page).
  function t(k, dansk) { var T = root.KC_TEKST; return T && typeof T[k] === 'string' ? T[k] : dansk; }
  function ingenForbindelse() { var p = produkt(); return p ? t('ingenForbindelseTil', 'Ingen forbindelse til ') + p : t('ingenForbindelse', 'Ingen forbindelse'); }
  function svarerIkke() { return (produkt() || t('serveren', 'Serveren')) + t('svarerIkkeNu', ' svarer ikke lige nu'); }
  // A reconnect usually takes a second; the band only shows when the drop lasts.
  var VENT_FOER_BAAND = 3000;
  function navn(err) { return err && typeof err === 'object' ? String(err.name || '') : ''; }
  function besked(err) { return err && typeof err === 'object' ? String(err.message || '') : ''; }
  function erNetfejl(err) {
    var n = navn(err);
    return n === 'TypeError' || n === 'SyntaxError' || /^HTTP 5\d\d$/.test(besked(err));
  }
  function fejlTekst(err) {
    var n = navn(err);
    if (n === 'TypeError') return ingenForbindelse();
    if (n === 'SyntaxError' || /^HTTP 5\d\d$/.test(besked(err))) return svarerIkke();
    if (n === 'NotAllowedError') return t('ikkeGivetLov', 'du har ikke givet lov');
    if (n === 'NotFoundError') return t('ingenMikrofonFundet', 'ingen mikrofon fundet');
    return besked(err) || t('noegetGikGalt', 'Noget gik galt');
  }
  root.KCForbindelse = { fejlTekst: fejlTekst, erNetfejl: erNetfejl, ingenForbindelse: ingenForbindelse, VENT_FOER_BAAND: VENT_FOER_BAAND };
})(typeof window !== 'undefined' ? window : globalThis);
