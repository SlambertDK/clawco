import { PRODUKT } from './navn.ts';

/** KC-0094: the page the service worker shows when the app cannot be reached (Tailscale off).
 *  Self-contained on purpose: at that moment no other file is reachable. Colours are the dark
 *  tokens of public/app.css; the script brings the page back by itself when the server answers. */
export function renderUdenForbindelse(): string {
  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0E1210">
<title>${PRODUKT} kan ikke nås</title>
<style>
:root { color-scheme: dark; --ground: #121614; --surface: #1C211E; --line: #2F3733; --ink: #E8EBE7; --muted: #9AA39D; --handling-bg: #4FB3D1; --handling-ink: #0B1A1F; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--ground); color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 16px; line-height: 1.5; }
main { width: 100%; max-width: 420px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 28px 24px; display: flex; flex-direction: column; gap: 12px; }
h1 { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
p { margin: 0; color: var(--muted); }
button { margin-top: 8px; min-height: 48px; border: 0; border-radius: 10px; background: var(--handling-bg); color: var(--handling-ink); font: inherit; font-weight: 600; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
</style>
</head>
<body>
<main>
<h1>${PRODUKT} kan ikke nås lige nu</h1>
<p>Er Tailscale tændt på telefonen? Siden prøver selv igen, når forbindelsen er tilbage.</p>
<button type="button" id="igen">Prøv igen</button>
</main>
<script>
(function () {
  var her = location.pathname === '/uden-forbindelse';
  function tilbage() { if (her) location.replace('/'); else location.reload(); }
  function tjek() {
    fetch('/health', { cache: 'no-store' }).then(function (r) { if (r.ok) tilbage(); }, function () {});
  }
  document.getElementById('igen').addEventListener('click', function () { location.reload(); });
  window.addEventListener('online', tjek);
  setInterval(tjek, 10000);
})();
</script>
</body>
</html>`;
}
