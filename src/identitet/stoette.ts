// "Lad support se med" (KC-0188, spec D15), the tenant's half. Staff at Clawco have no read access to a customer's
// Clawco; the owner's switch is the only way in, off by default, 1, 4 or 24 hours (the constants below, the one place
// they live in this app), logged, and ended by the owner or the clock.
//
// The grant lives in Sky (sky/src/konto/stoette.ts). This file holds this tenant's own record of it,
// $KC_DATA_DIR/stoette.json, written only by startStoette — which takes nothing but Sky's bevis: the grant signed with
// the gateway's key under its own prefix `s1.` (sky/src/gateway/signer.ts), so a Clawco-Konto header can never pass as
// one. Nothing the agent, a rule, the voice or a script can reach writes it (a test holds this).
//
// Invariant (AGENTS §0 r2/r7): a support identity (the gateway's claims sa/su/sn, src/identitet/konto.ts) is accepted
// only while this record names the same grant, is not revoked and has not passed udloeber by this tenant's own clock,
// and the claim's own end has not passed either — so a gateway bug cannot extend a grant. Anything unreadable or
// unexpected is no grant. The person it becomes is the owner's view in role `stoette` (roller.ts: read only).

import { verify } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { KontoIndstilling } from './konto.ts';
import type { Person } from './husstand.ts';

export const STOETTE_TIMER = [1, 4, 24] as const;
export const STOETTE_MAKS_TIMER = 24;
export const GRUND_MAKS = 120;
/** How long a bevis is good for after Sky signed it (the same window as a Clawco-Konto header). */
const BEVIS_VINDUE = 60;
const TIME_MS = 3_600_000;

/** This tenant's record of the grant. Times are ISO strings; `sessioner` = the support sessions already logged. */
export type StoetteAdgang = { id: string; givet: string; udloeber: string; timer: number; grund: string; tilbagekaldt?: string; udloebLogget?: string; sessioner: string[] };
/** What a support Person carries: the grant, the staff account (Sky konto id) and the session. */
export type StoetteKilde = { adgang: string; personale: string; session: string };
/** The gateway's support claims, as konto.ts read them from a verified header. */
export type StoetteKlaim = { adgang: string; udloeber: number; session: string; personale: string };

export class StoetteFejl extends Error {}

// C0/C1 controls, line/paragraph separators and the bidi overrides/isolates.
const FORBUDT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
const ID = /^\d{1,18}$/;
const SESSION = /^[a-f0-9]{16}$/;

const tid = (s: unknown): number => (typeof s === 'string' ? Date.parse(s) : Number.NaN);

/** On: a record, not revoked, before its udloeber by `nu`. A bad time anywhere is off. */
export function aktiv(a: StoetteAdgang | null | undefined, nu: Date): a is StoetteAdgang {
  if (!a || a.tilbagekaldt) return false;
  const slut = tid(a.udloeber);
  const n = nu.getTime();
  return Number.isFinite(slut) && Number.isFinite(n) && n < slut;
}

function valider(raw: unknown): StoetteAdgang {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new StoetteFejl('stoette.json er ikke et objekt');
  const o = raw as Record<string, unknown>;
  const kendte = new Set(['id', 'givet', 'udloeber', 'timer', 'grund', 'tilbagekaldt', 'udloebLogget', 'sessioner']);
  for (const k of Object.keys(o)) if (!kendte.has(k)) throw new StoetteFejl('stoette.json har et ukendt felt');
  const { id, givet, udloeber, timer, grund, tilbagekaldt, udloebLogget, sessioner } = o;
  if (typeof id !== 'string' || !ID.test(id)) throw new StoetteFejl('stoette.json: ugyldigt id');
  if (!Number.isFinite(tid(givet)) || !Number.isFinite(tid(udloeber))) throw new StoetteFejl('stoette.json: ugyldig tid');
  if (!(STOETTE_TIMER as readonly unknown[]).includes(timer) || tid(udloeber) - tid(givet) !== (timer as number) * TIME_MS) throw new StoetteFejl('stoette.json: ugyldig varighed');
  if (typeof grund !== 'string' || grund.length > GRUND_MAKS || FORBUDT.test(grund)) throw new StoetteFejl('stoette.json: ugyldig grund');
  for (const v of [tilbagekaldt, udloebLogget]) if (v !== undefined && !Number.isFinite(tid(v))) throw new StoetteFejl('stoette.json: ugyldig tid');
  if (!Array.isArray(sessioner) || sessioner.length > 200 || !sessioner.every((s) => typeof s === 'string' && SESSION.test(s))) throw new StoetteFejl('stoette.json: ugyldige sessioner');
  return o as StoetteAdgang;
}

/** The record on the data dir. `laes` throws StoetteFejl on anything it cannot trust (the caller refuses support). */
export function lavStoetteLager(dataDir: string) {
  const fil = path.join(dataDir, 'stoette.json');
  return {
    async laes(): Promise<StoetteAdgang | null> {
      let tekst: string;
      try { tekst = await readFile(fil, 'utf8'); } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new StoetteFejl(`stoette.json kunne ikke læses: ${(err as Error).message}`);
      }
      let raw: unknown;
      try { raw = JSON.parse(tekst); } catch { throw new StoetteFejl('stoette.json er ikke gyldig JSON'); }
      return valider(raw);
    },
    /** Validates and writes atomically (tmp file + rename). */
    async skriv(a: StoetteAdgang): Promise<void> {
      const ren = valider(a);
      await mkdir(dataDir, { recursive: true });
      const tmp = `${fil}.tmp-${process.pid}`;
      await writeFile(tmp, JSON.stringify(ren, null, 2), 'utf8');
      await rename(tmp, fil);
    },
  };
}
export type StoetteLager = ReturnType<typeof lavStoetteLager>;

const BEVIS = /^s1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{1,1400})\.([A-Za-z0-9_-]{86})$/;

/** Sky's bevis for a grant (sky/src/gateway/signer.ts signerStoetteBevis), checked with this tenant's gateway keys. */
export function verificerBevis(bevis: unknown, k: KontoIndstilling, nuSek: number): { ok: true; adgang: StoetteAdgang } | { ok: false; grund: string } {
  const m = typeof bevis === 'string' ? BEVIS.exec(bevis) : null;
  if (!m) return { ok: false, grund: 'beviset har forkert form' };
  const [, id, payload, signatur] = m as unknown as [string, string, string, string];
  const noegle = k.noegler.get(id);
  if (!noegle) return { ok: false, grund: 'ukendt nøgle-id' };
  if (!verify(null, Buffer.from(`s1.${id}.${payload}`), noegle, Buffer.from(signatur, 'base64url'))) return { ok: false, grund: 'signaturen holder ikke' };
  let p: Record<string, unknown>;
  try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return { ok: false, grund: 'beviset er ikke JSON' }; }
  if (typeof p !== 'object' || p === null || Array.isArray(p) || Object.keys(p).sort().join() !== 'a,g,h,iat,r,t,u') return { ok: false, grund: 'beviset har forkert form' };
  const { t, a, g, u, h, r, iat } = p;
  if (t !== k.tenant) return { ok: false, grund: 'en anden tenant' };
  if (![g, u, iat].every(Number.isSafeInteger) || typeof a !== 'string' || !ID.test(a)) return { ok: false, grund: 'beviset har forkert form' };
  const alder = nuSek - (iat as number);
  if (alder > BEVIS_VINDUE || alder < -10) return { ok: false, grund: 'beviset er for gammelt' };
  if (!(STOETTE_TIMER as readonly unknown[]).includes(h) || (u as number) - (g as number) !== (h as number) * 3600) return { ok: false, grund: 'ugyldig varighed' };
  if ((u as number) <= nuSek) return { ok: false, grund: 'allerede udløbet' };
  if (typeof r !== 'string' || r.length > GRUND_MAKS || FORBUDT.test(r)) return { ok: false, grund: 'ugyldig grund' };
  return { ok: true, adgang: { id: a, givet: new Date((g as number) * 1000).toISOString(), udloeber: new Date((u as number) * 1000).toISOString(), timer: h as number, grund: r, sessioner: [] } };
}

/**
 * The only way support is turned on in this app: the owner's request carrying Sky's valid bevis. Writes the record;
 * returns it. Throws StoetteFejl (the route answers 403) on anything else.
 */
export async function startStoette(lager: StoetteLager, o: { person: Person; bevis: unknown; konto: KontoIndstilling | undefined; nu: Date }): Promise<StoetteAdgang> {
  if (o.person.rolle !== 'ejer') throw new StoetteFejl('Kun ejeren kan slå support til.');
  if (!o.konto) throw new StoetteFejl('Support kan kun slås til gennem Clawco Sky.');
  const v = verificerBevis(o.bevis, o.konto, Math.floor(o.nu.getTime() / 1000));
  if (!v.ok) throw new StoetteFejl(`Support blev ikke slået til: ${v.grund}.`);
  await lager.skriv(v.adgang);
  return v.adgang;
}

/** The owner's "Slå fra": the record is marked revoked now. Returns the grant that was on, or null. */
export async function slaaStoetteFra(lager: StoetteLager, o: { person: Person; nu: Date }): Promise<StoetteAdgang | null> {
  if (o.person.rolle !== 'ejer') throw new StoetteFejl('Kun ejeren kan slå support fra.');
  const a = await lager.laes();
  if (!aktiv(a, o.nu)) return null;
  await lager.skriv({ ...a, tilbagekaldt: o.nu.toISOString() });
  return a;
}

/**
 * Who a verified support claim is: the owner's view in role stoette, or null (the caller refuses). `lokal` is this
 * tenant's record as read for this request ('ulaeselig' when it could not be read).
 */
export function stoettePerson(klaim: StoetteKlaim, lokal: StoetteAdgang | null | 'ulaeselig' | undefined, personer: readonly Person[], nuSek: number): Person | null {
  if (!lokal || lokal === 'ulaeselig') return null;
  if (!ID.test(klaim.adgang) || !SESSION.test(klaim.session) || !Number.isSafeInteger(klaim.udloeber)) return null;
  if (lokal.id !== klaim.adgang || klaim.udloeber <= nuSek || !aktiv(lokal, new Date(nuSek * 1000))) return null;
  const ejer = personer.find((p) => p.rolle === 'ejer');
  if (!ejer) return null;
  return { id: ejer.id, login: null, navn: 'Support', rolle: 'stoette', stoette: { adgang: klaim.adgang, personale: klaim.personale, session: klaim.session } };
}

/** The audit log's person for a staff account: never a household id (a colon is not allowed there). */
export const stoettePersonId = (personale: string): string => `stoette:${personale}`.slice(0, 40);
