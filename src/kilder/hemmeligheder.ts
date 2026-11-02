// The one secret module (KC-0132). Two kinds of secrets, two places:
// (a) app-level keys (OAuth client ids/secrets) in the host's env file
//     (KC_ENV_FILE, default .env; never committed), allowlisted key names only;
// (b) per-source credentials in $KC_DATA_DIR/hemmeligheder/<kilde>.json,
//     outside the vault and out of the default export (KC-0108).
// (c) KC-0127: a model provider's key in the agent's own env file (Hermes'
//     .env), only names the caller allows (the providers' list).
// Every value that passes through here is registered with the one redactor (KC-0125), so no log line or
// error text elsewhere can carry it. All written atomically with mode 0600 (dir 0700). No function here returns
// a value to a caller that renders it: the setters answer key name + length,
// and no message or log line contains a value. Encryption at rest: E7.

import { randomUUID } from 'node:crypto';
import { access, chmod, constants, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registrerHemmelighed } from '../graenser/redaktion.ts';
import { kilderTekst } from './tekster.ts';
import { KILDE_ID } from './types.ts';

/** The app-level keys Start may set. A new provider adds its keys here. KC-0127: Clawco's own key to Hermes (a keyless install). */
export const TILLADTE_NOEGLER = ['KC_GOOGLE_CLIENT_ID', 'KC_GOOGLE_CLIENT_SECRET', 'KC_HERMES_API_KEY'] as const;

export class HemmelighedFejl extends Error {
  constructor(besked: string) { super(besked); this.name = 'HemmelighedFejl'; }
}

export type Laengde = { noegle: string; laengde: number };

/** A value the env file can hold as-is: no whitespace, quotes, '#' or control characters (anything else is refused, not escaped). */
const ENV_VAERDI = /^[!$-&(-~]+$/;
// The character class above is ! and $ … ~ without " (0x22), # (0x23) and ' (0x27).
const MAKS = 2000;
const FELT = /^[a-z][a-z0-9_-]{0,39}$/;

async function skrivPrivat(fil: string, indhold: string): Promise<void> {
  const tmp = `${fil}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, indhold, { encoding: 'utf8', mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, fil);
  } catch (err) {
    await rm(tmp, { force: true });
    throw new HemmelighedFejl(kilderTekst().hemmelighed.kunneIkkeSkrive(path.basename(fil), (err as NodeJS.ErrnoException).code ?? 'fejl'));
  }
}

/** Sets one KEY=value line in an env file (atomic, 0600). Returns the key name and the value's length only. */
async function skrivEnvLinje(fil: string, noegle: string, vaerdi: string): Promise<Laengde> {
  if (typeof vaerdi !== 'string' || vaerdi.length > MAKS || !ENV_VAERDI.test(vaerdi)) throw new HemmelighedFejl(kilderTekst().hemmelighed.vaerdiUbrugelig(noegle));
  let gammel = '';
  try { gammel = await readFile(fil, 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new HemmelighedFejl(kilderTekst().hemmelighed.kunneIkkeLaese(path.basename(fil), (err as NodeJS.ErrnoException).code ?? 'fejl'));
  }
  const linjer = gammel.split('\n').filter((l, i, a) => !(i === a.length - 1 && l === ''));
  const ny = `${noegle}=${vaerdi}`;
  // The first line for the key is replaced in place, any later duplicate dropped; a new key goes last.
  let sat = false;
  const ud = linjer.flatMap((l) => {
    if (!l.startsWith(`${noegle}=`)) return [l];
    if (sat) return [];
    sat = true;
    return [ny];
  });
  if (!sat) ud.push(ny);
  await skrivPrivat(fil, `${ud.join('\n')}\n`);
  registrerHemmelighed(vaerdi);
  return { noegle, laengde: vaerdi.length };
}

/**
 * Sets an allowlisted app-level key in the env file and in `env` (default process.env), so no restart is needed.
 * Returns the key name and the value's length only.
 */
export async function saetMiljoeNoegle(noegle: string, vaerdi: string, o: { fil?: string; env?: Record<string, string | undefined> } = {}): Promise<Laengde> {
  if (!(TILLADTE_NOEGLER as readonly string[]).includes(noegle)) throw new HemmelighedFejl(kilderTekst().hemmelighed.noegleForbudt(noegle.slice(0, 40)));
  const svar = await skrivEnvLinje(o.fil ?? (process.env['KC_ENV_FILE'] || '.env'), noegle, vaerdi);
  (o.env ?? process.env)[noegle] = vaerdi;
  return svar;
}

const AGENT_NAVN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * KC-0127: sets a model provider's key (or a local model's address) in the agent's own env file. Only names in
 * `tilladte` (the providers' list), never one of Clawco's own (KC_*); the value stays out of Clawco's environment.
 */
export async function saetAgentMiljoeNoegle(fil: string, noegle: string, vaerdi: string, tilladte: readonly string[]): Promise<Laengde> {
  if (!AGENT_NAVN.test(noegle) || noegle.startsWith('KC_') || !tilladte.includes(noegle)) throw new HemmelighedFejl(kilderTekst().hemmelighed.noegleForbudtAgent(noegle.slice(0, 40)));
  return skrivEnvLinje(fil, noegle, vaerdi);
}

/** True when the file can be written here: it exists and is writable, or its folder is. */
async function kanSkrive(fil: string): Promise<boolean> {
  try { await access(fil, constants.W_OK); return true; } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return false;
  }
  try { await access(path.dirname(fil), constants.W_OK); return true; } catch { return false; }
}

/**
 * KC-0127: the writer the composition root hands the agent (src/agent depends on nothing outside its folder):
 * saetAgentMiljoeNoegle bound to one file and allowlist; null when that file cannot be written here (the card then
 * shows the command to run on the agent's host).
 */
export function lavAgentNoegleSkriver(fil: string, tilladte: readonly string[]): (noegle: string, vaerdi: string) => Promise<Laengde | null> {
  return async (noegle, vaerdi) => ((await kanSkrive(fil)) ? saetAgentMiljoeNoegle(fil, noegle, vaerdi, tilladte) : null);
}

/** The folder in the data dir that holds the per-source credentials (b); KC-0146 keeps it out of the export. */
export const KILDE_HEMMELIGHEDER = 'hemmeligheder';

function kildeFil(dataDir: string, kildeId: string): string {
  if (!KILDE_ID.test(kildeId)) throw new HemmelighedFejl(kilderTekst().hemmelighed.ugyldigtKildeId);
  return path.join(dataDir, KILDE_HEMMELIGHEDER, `${kildeId}.json`);
}

/** Stores a source's credentials (replacing what it had). Returns each key with its value's length. */
export async function gemKildeHemmelighed(dataDir: string, kildeId: string, data: Record<string, string>): Promise<Laengde[]> {
  const fil = kildeFil(dataDir, kildeId);
  for (const [k, v] of Object.entries(data)) {
    if (!FELT.test(k) || typeof v !== 'string' || v.length > MAKS) throw new HemmelighedFejl(kilderTekst().hemmelighed.ugyldigtFelt(k.slice(0, 40)));
  }
  const mappe = path.dirname(fil);
  await mkdir(mappe, { recursive: true, mode: 0o700 });
  await chmod(mappe, 0o700);
  await skrivPrivat(fil, JSON.stringify(data));
  for (const v of Object.values(data)) registrerHemmelighed(v);
  return Object.entries(data).map(([noegle, v]) => ({ noegle, laengde: v.length }));
}

/** A source's credentials, for that connector only (through its KildeKontekst); null when it has none. */
export async function laesKildeHemmelighed(dataDir: string, kildeId: string): Promise<Record<string, string> | null> {
  const fil = kildeFil(dataDir, kildeId);
  let tekst: string;
  try { tekst = await readFile(fil, 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new HemmelighedFejl(kilderTekst().hemmelighed.kunneIkkeLaeses(kildeId));
  }
  let raw: unknown;
  try { raw = JSON.parse(tekst); } catch { throw new HemmelighedFejl(kilderTekst().hemmelighed.ikkeGyldig(kildeId)); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HemmelighedFejl(kilderTekst().hemmelighed.ikkeGyldig(kildeId));
  const ud = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
  for (const v of Object.values(ud)) registrerHemmelighed(v);
  return ud;
}

/** Removes a source's credentials (on disconnect). True when there was a file. */
export async function fjernKildeHemmelighed(dataDir: string, kildeId: string): Promise<boolean> {
  const fil = kildeFil(dataDir, kildeId);
  try { await rm(fil); return true; } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new HemmelighedFejl(kilderTekst().hemmelighed.kunneIkkeFjernes(kildeId));
  }
}
