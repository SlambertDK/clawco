// The sign-up page's only script (KC-0198): while Stripe or the fleet is working, ask the server which screen
// to show and reload when it changes. The server decides the step; this never stores or computes one. After
// 30 s on the payment screen the "waiting for Stripe" line appears; polling goes on (every 5 s), never a dead end.
(() => {
  const p = document.querySelector('[data-poll]');
  if (!p) return;
  const url = p.getAttribute('data-poll');
  const noegle = p.getAttribute('data-noegle');
  const vent = document.querySelector('[data-efter-30s]');
  const start = Date.now();
  async function tjek() {
    try {
      const r = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' }, cache: 'no-store' });
      const j = await r.json();
      if (j && typeof j.noegle === 'string' && j.noegle !== noegle) { location.reload(); return; }
    } catch { /* offline for a moment: try again */ }
    const gaaet = Date.now() - start;
    if (vent && gaaet >= 30_000) vent.hidden = false;
    setTimeout(tjek, gaaet < 30_000 ? 2_000 : 5_000);
  }
  setTimeout(tjek, 2_000);
})();
