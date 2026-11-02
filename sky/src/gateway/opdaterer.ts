// "Opdaterer, et øjeblik" (KC-0186): what a member sees while a rollout replaces their tenant's container, instead
// of an error. Calm and plain: no error code, no technical word, dark like every Clawco page, and it reloads itself.
// Self-contained (the tenant host has no /sky.css): its one inline style is allowed by its own CSP, nothing else is.
import type { ServerResponse } from 'node:http';

export const OPDATERER_SIDE = `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta http-equiv="refresh" content="10">
<title>Opdaterer · Clawco</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0f1115; color: #e7e9ee; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 420px; padding: 24px 16px; text-align: center; }
h1 { font-size: 1.4rem; margin: 0 0 8px; font-weight: 600; }
p { color: #9aa3b2; margin: 0; }
</style>
</head>
<body>
<main>
<h1>Opdaterer, et øjeblik</h1>
<p>Din Clawco får en ny version. Siden åbner af sig selv om lidt.</p>
</main>
</body>
</html>
`;

export function svarOpdaterer(res: ServerResponse): void {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(503, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'retry-after': '10',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
  });
  res.end(OPDATERER_SIDE);
}
