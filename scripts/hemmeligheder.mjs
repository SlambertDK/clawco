#!/usr/bin/env node
// Usage: npm run hemmeligheder   (= node --env-file-if-exists=<the host's env file> scripts/hemmeligheder.mjs)
// KC-0125: which secrets are set on this host. Prints the NAME and the LENGTH of each, never a value (same hygiene
// as scripts/set-secret.sh). The expected names come from the template, .env.example; the values come from
// process.env only — this script never opens a file that could hold a value, node loads the env file itself.
// "mangler (påkrævet)" and exit 1: a name this host's mode needs is not set. "for kort": set, but shorter than the
// redactor's minimum, so a leak of it would not be masked (src/graenser/redaktion.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIN_LAENGDE, erHemmeligtNavn } from '../src/graenser/redaktion.ts';

const SKABELON = fileURLToPath(new URL('../.env.example', import.meta.url));
const env = process.env;
const sat = (n) => (env[n] ?? '').trim();

/** The names in the template: every NAME= at the start of a line (comments and values are skipped). */
function skabelonNavne() {
  return [...new Set(readFileSync(SKABELON, 'utf8').split('\n').map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1]).filter(Boolean))];
}

/** Names this host's mode cannot do without. */
function paakraevede() {
  const ud = new Set();
  const agent = sat('KC_AGENT') || (sat('KC_HERMES_MODE') === 'fake' ? 'fake' : 'hermes-http');
  if (agent === 'hermes-http') ud.add('KC_HERMES_API_KEY');
  if (sat('KC_IDENTITET') === 'konto') for (const n of ['KC_KONTO_TENANT', 'KC_KONTO_PUBKEY', 'KC_KONTO_GATEWAY']) ud.add(n);
  return ud;
}

const krav = paakraevede();
const navne = new Set([...skabelonNavne().filter(erHemmeligtNavn), ...krav]);
// Keys the template cannot list: the direct agent's model keys (KC-0180).
for (const n of Object.keys(env)) if (n.startsWith('KC_MODEL_NOEGLE_') && erHemmeligtNavn(n)) navne.add(n);

let mangler = 0;
const bredde = Math.max(...[...navne].map((n) => n.length));
for (const n of [...navne].sort()) {
  const l = sat(n).length;
  let tekst;
  if (!l) { tekst = krav.has(n) ? 'mangler (påkrævet)' : 'mangler'; if (krav.has(n)) mangler++; }
  else if (l < MIN_LAENGDE) tekst = `for kort (længde ${l}, maskeres ikke)`;
  else tekst = `sat (længde ${l})`;
  console.log(`${n.padEnd(bredde)}  ${tekst}`);
}
if (mangler) console.log(`\n${mangler} påkrævet navn mangler. Sæt det i værtens env-fil (scripts/set-secret.sh) og kør igen.`);
process.exit(mangler ? 1 : 0);
