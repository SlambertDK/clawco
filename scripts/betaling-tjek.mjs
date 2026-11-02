#!/usr/bin/env node
// Usage: KC_STRIPE_SECRET_KEY=sk_test_… npm run betaling:tjek [-- --dry-run]
// KC-0193: plays a subscription's whole life in Stripe's test mode with test clocks — trial, 14 days, card or
// no card, plan change, cancellation, duplicate and late events — through Sky's own code (Checkout parameters,
// webhook handler, entitlements) and checks the entitlement row and the outbox after every step. The same
// scenario table runs against the fake client in `npm test`. Refuses any key that is not a test key (exit 1);
// the key is read from KC_STRIPE_SECRET_KEY only, never from a file, and never printed. Every object it creates
// carries metadata clawco_tjek=<run id>; its test clocks are deleted at the end, also after a failure.
// --dry-run prints the plan with no network and no key.
// The tenant never imports Sky code (sky/test/aftryk.test.ts), so this starts Sky's own script as a child process
// (like `npm run stripe:opsaet`); it needs `npm --prefix sky ci`.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sky = fileURLToPath(new URL('../sky/scripts/betaling-tjek.ts', import.meta.url));
const r = spawnSync(process.execPath, [sky, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exitCode = r.status ?? 1;
