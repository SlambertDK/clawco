// `npm run betaling:tjek [-- --dry-run]` (KC-0193), started by scripts/betaling-tjek.mjs. Wiring only; the logic is
// koerBetalingsTjek in test/abonnement/betaling/tjek.ts. The key comes from KC_STRIPE_SECRET_KEY in the environment
// only (no --env-file: the run must never pick up Sky's own key by accident).
import { koerBetalingsTjek } from '../test/abonnement/betaling/tjek.ts';

process.exitCode = await koerBetalingsTjek({ argv: process.argv.slice(2), env: process.env, skriv: (linje) => console.log(linje) });
