// KC-0193: the wiring of `npm run betaling:tjek` (scripts/betaling-tjek.mjs). The logic and the scenario table are
// tested in sky (sky/test/abonnement/betaling-tjek.test.ts, scenarier.test.ts); here only that the real command
// refuses a non-test key with exit 1 without echoing it, and that --dry-run prints the plan without a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/betaling-tjek.mjs', import.meta.url));
const koer = (argv: string[], noegle?: string) => {
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '' };
  if (noegle !== undefined) env['KC_STRIPE_SECRET_KEY'] = noegle;
  return spawnSync(process.execPath, [SCRIPT, ...argv], { env, encoding: 'utf8', timeout: 60_000 });
};

test('betaling:tjek refuses a live key with exit 1 and never prints it', () => {
  for (const noegle of [['sk', 'live', 'SENT'].join('_') + 'INELbetaling0123456789', ['rk', 'live', 'SENT'].join('_') + 'INELbetaling0123456789']) { // fake keys, joined at run time so no key-shaped literal is published
    for (const argv of [[], ['--dry-run']]) {
      const r = koer(argv, noegle);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stdout, /ikke en testnøgle/);
      assert.ok(!`${r.stdout}${r.stderr}`.includes('SENTINEL'));
    }
  }
});

test('betaling:tjek --dry-run prints the scenario plan with no key; without --dry-run no key is exit 1', () => {
  const r = koer(['--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^S1 /m);
  assert.match(r.stdout, /tør kørsel/);
  assert.equal(koer([]).status, 1);
});
