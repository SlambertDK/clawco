// The connector registry (KC-0132): which connectors exist (registered by the
// composition root), which are connected ($KC_DATA_DIR/kilder.json — which
// connectors, zone, options; never a secret), connect/disconnect with a log
// line each (store room `kilder`), the first read announced on the live bus,
// and act() only through a declared verb and the policy layer (spec D5).
//
// Invariants: unknown id → 404, invalid body → 400, never a default; a declared
// verb is on the policy list and never pays, sends to others, deletes or
// crosses zones; every read passes renLaesning (no mail bodies, always uklar).

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RumLager } from '../store/types.ts';
import { erDataZone, type DataZone } from '../identitet/zoner.ts';
import type { Person } from '../identitet/husstand.ts';
import { erVerb } from '../graenser/verber.ts';
import { afgoer, type Kontekst } from '../graenser/afgoer.ts';
import type { Kanal, Revisionslog } from '../graenser/revisionslog.ts';
import { fjernKildeHemmelighed, gemKildeHemmelighed, HemmelighedFejl, laesKildeHemmelighed, saetMiljoeNoegle } from './hemmeligheder.ts';
import { antalI, renLaesning } from './laesning.ts';
import { kilderTekst, slagsNavn } from './tekster.ts';
import { AUTH, erSlags, KildeFejl, KILDE_ID, virker, type Felt, type Helbred, type Kilde, type KildeKontekst, type KildeKort, type Laesning, type Resultat, type Slags } from './types.ts';

/** The live-bus channel a successful first read is announced on (KC-0128 listens). */
export const FOERSTE_LAESNING = 'foerste-laesning';
/** The store room whose log holds every connect and disconnect. */
export const KILDER_LOG = 'kilder';

/** Verbs a connector may never declare: the policy layer's limits (the conformance suite checks against it too). */
export const FORBUDTE_VERBER: ReadonlySet<string> = new Set(['betal', 'send-til-andre', 'slet', 'kopier-paa-tvaers']);
const OAUTH_LEVETID_MS = 10 * 60_000;
const HELBRED_MAKS_MS = 2000;
const FELT_MAKS = 500;

export type KonfigPost = { id: string; status: 'forbundet' | 'frakoblet'; zone: DataZone; valg: Record<string, string>; tid: string; af: string };
export type KilderKonfig = { kilder: KonfigPost[] };
export type FoersteLaesning = { slags: Slags; hentet: string; antal: number };
/** `opsat` (KC-0136): what the source's setup did, in a sentence (e.g. which folders it added). */
export type Forbundet = { forbundet: true; foersteLaesning: FoersteLaesning | null; opsat?: string };
export type KildeOversigt = {
  id: string; navn: string; slags: Slags; zone: DataZone; auth: Kilde['auth']; tillid: 'uklar';
  forbundet: boolean; helbred: Helbred | null; kort: KildeKort; verber: { navn: string; verb: string; tekst: string }[];
  /** KC-0120: when this app last read the source through the registry (since start), else null. */
  sidstLaest: string | null;
};

export class KonfigFejl extends Error {
  constructor(besked: string) { super(besked); this.name = 'KonfigFejl'; }
}

// ---------- kilder.json ----------

const konfigFil = (dataDir: string): string => path.join(dataDir, 'kilder.json');
const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validerKonfig(raw: unknown): KilderKonfig {
  if (!erObj(raw) || !Array.isArray(raw['kilder'])) throw new KonfigFejl('kilder.json mangler kilder');
  const kilder = raw['kilder'].map((p, i): KonfigPost => {
    const o = erObj(p) ? p : {};
    const { id, status, zone, valg, tid, af } = o;
    if (typeof id !== 'string' || !KILDE_ID.test(id)) throw new KonfigFejl(`kilder.json post ${i}: ugyldigt id`);
    if (status !== 'forbundet' && status !== 'frakoblet') throw new KonfigFejl(`kilder.json ${id}: ugyldig status`);
    if (!erDataZone(zone)) throw new KonfigFejl(`kilder.json ${id}: ugyldig zone`);
    if (!erObj(valg) || !Object.values(valg).every((v) => typeof v === 'string')) throw new KonfigFejl(`kilder.json ${id}: ugyldige valg`);
    if (typeof tid !== 'string' || typeof af !== 'string') throw new KonfigFejl(`kilder.json ${id}: mangler tid eller af`);
    return { id, status, zone, valg: valg as Record<string, string>, tid, af };
  });
  if (new Set(kilder.map((k) => k.id)).size !== kilder.length) throw new KonfigFejl('kilder.json har en kilde to gange');
  return { kilder };
}

/** The connected sources. No file = none; a file that cannot be read fails closed (KonfigFejl), never "none". */
export async function laesKonfig(dataDir: string): Promise<KilderKonfig> {
  let tekst: string;
  try { tekst = await readFile(konfigFil(dataDir), 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kilder: [] };
    throw new KonfigFejl(`kilder.json kunne ikke læses: ${(err as NodeJS.ErrnoException).code ?? 'fejl'}`);
  }
  let raw: unknown;
  try { raw = JSON.parse(tekst); } catch { throw new KonfigFejl('kilder.json er ikke gyldig JSON'); }
  return validerKonfig(raw);
}

/** laesKonfig for a caller that cannot wait (KC-0136: the vault paths a room reads); same rules, fail closed. */
export function laesKonfigSync(dataDir: string): KilderKonfig {
  let tekst: string;
  try { tekst = readFileSync(konfigFil(dataDir), 'utf8'); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kilder: [] };
    throw new KonfigFejl(`kilder.json kunne ikke læses: ${(err as NodeJS.ErrnoException).code ?? 'fejl'}`);
  }
  let raw: unknown;
  try { raw = JSON.parse(tekst); } catch { throw new KonfigFejl('kilder.json er ikke gyldig JSON'); }
  return validerKonfig(raw);
}

/** Validates and writes kilder.json atomically (tmp file + rename). */
export async function skrivKonfig(dataDir: string, k: KilderKonfig): Promise<void> {
  const ren = validerKonfig(k);
  await mkdir(dataDir, { recursive: true });
  const tmp = `${konfigFil(dataDir)}.tmp-${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(ren, null, 2), 'utf8');
  await rename(tmp, konfigFil(dataDir));
}

// ---------- the registry ----------

export type RegisterDeps = {
  dataDir: string;
  store: RumLager;
  nu?: () => Date;
  /** KC-0124: one audit line per act() decision. */
  revision?: Pick<Revisionslog, 'skriv'>;
  live?: { notify(kanal: string): void };
  /** The app's canonical address (KC_ADRESSE), so an OAuth provider can send the browser back. */
  adresse?: string;
  /** How long a health check may take before it reads as langsomt (default 2 s). */
  helbredMaksMs?: number;
  /**
   * KC-0139: what every read through the registry came to (the health state remembers it, and after a failure asks the
   * connector what is wrong). Awaited, so the state is written before the caller sees the outcome (a page refreshed at
   * once shows it); a throw or a rejection is ignored — health is a nicety to a read, never a reason for it to fail.
   */
  efterLaesning?(id: string, ok: boolean): void | Promise<void>;
  /**
   * KC-0128: called with the cleaned first read right after a connect (before the connect answers), so the first
   * value can be shown at once. `forbundet` is when the connection was recorded. A throw never fails the connect.
   */
  foersteLaesning?(h: { kilde: Kilde; laesning: Laesning; zone: DataZone; forbundet: string; person: Person }): Promise<void>;
  /** KC-0133: where a card field with `miljoe` is set (saetMiljoeNoegle; default KC_ENV_FILE / .env and process.env). */
  miljoe?: { fil?: string; env?: Record<string, string | undefined> };
};

type Venter = { id: string; person: string; zone: DataZone; valg: Record<string, string>; hemmelige: Record<string, string>; udloeber: number };

const KANAL: Record<Kontekst['kanal'], Kanal> = { knap: 'knap', stemme: 'stemme', chat: 'chat', baggrund: 'planlagt' };

function tjekKilde(k: Kilde): void {
  if (!KILDE_ID.test(k.id)) throw new Error(`ugyldigt kilde-id: ${String(k.id).slice(0, 40)}`);
  if (!erSlags(k.slags)) throw new Error(`${k.id}: ugyldig slags`);
  if (!erDataZone(k.zone)) throw new Error(`${k.id}: ugyldig zone`);
  if (!(AUTH as readonly string[]).includes(k.auth)) throw new Error(`${k.id}: ugyldig auth`);
  if (k.auth === 'oauth' && !k.oauth) throw new Error(`${k.id}: auth oauth kræver oauth.start og oauth.tilbage`);
  const verber = Object.entries(k.verber ?? {});
  if (verber.length && !k.act) throw new Error(`${k.id}: erklærede verber kræver act()`);
  if (k.act && !verber.length) throw new Error(`${k.id}: act() kræver erklærede verber`);
  for (const [navn, spec] of verber) {
    if (!erVerb(spec.verb)) throw new Error(`${k.id}.${navn}: ukendt verbum ${String(spec.verb).slice(0, 40)}`);
    if (FORBUDTE_VERBER.has(spec.verb)) throw new Error(`${k.id}.${navn}: en forbindelse må ikke ${spec.verb}`);
  }
}

/** Checks a connect body against the card's declared fields. Returns options (kilder.json), secrets (secret file) and app keys (env file, KC-0133) apart. */
function tjekFelter(felter: Felt[], raw: unknown): { valg: Record<string, string>; hemmelige: Record<string, string>; miljoe: Record<string, string> } {
  const ind = raw === undefined ? {} : raw;
  if (!erObj(ind)) throw new KildeFejl(400, kilderTekst().feltetSkalVaereObjekt);
  const kendte = new Map(felter.map((f) => [f.navn, f]));
  for (const navn of Object.keys(ind)) if (!kendte.has(navn) || kendte.get(navn)?.skjult) throw new KildeFejl(400, kilderTekst().ukendtFelt(navn.slice(0, 40)));
  const valg: Record<string, string> = {};
  const hemmelige: Record<string, string> = {};
  const miljoe: Record<string, string> = {};
  for (const f of felter) {
    const v = ind[f.navn];
    if (v === undefined || v === '') {
      if (f.paakraevet) throw new KildeFejl(400, kilderTekst().feltMangler(f.etiket));
      continue;
    }
    // KC-0137: a file or a several-lines field carries line breaks and tabs; nothing else below space is allowed anywhere.
    const kontrol = f.type === 'fil' || f.flere ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (typeof v !== 'string' || v.length > (f.maks ?? FELT_MAKS) || kontrol.test(v)) throw new KildeFejl(400, kilderTekst().feltUgyldigt(f.etiket));
    if (f.muligheder && !f.muligheder.some((m) => m.vaerdi === v.trim())) throw new KildeFejl(400, kilderTekst().feltIkkeEtAfValgene(f.etiket));
    if (f.miljoe) { miljoe[f.miljoe] = v.trim(); continue; }
    (f.type === 'hemmelig' ? hemmelige : valg)[f.navn] = f.type === 'hemmelig' ? v : v.trim();
  }
  return { valg, hemmelige, miljoe };
}

export function lavRegister(deps: RegisterDeps) {
  const nu = deps.nu ?? (() => new Date());
  const kilder = new Map<string, Kilde>();
  const venter = new Map<string, Venter>();
  const sidstLaest = new Map<string, string>();
  const helbredMaks = deps.helbredMaksMs ?? HELBRED_MAKS_MS;

  const hentKilde = (id: string): Kilde => {
    const k = kilder.get(id);
    if (!k) throw new KildeFejl(404, kilderTekst().ukendtForbindelse);
    return k;
  };
  const post = async (id: string): Promise<KonfigPost | undefined> => (await laesKonfig(deps.dataDir)).kilder.find((p) => p.id === id);
  const forbundet = (k: Kilde, p: KonfigPost | undefined): boolean => (p ? p.status === 'forbundet' : k.standard === 'forbundet');
  const kontekst = (k: Kilde, p: KonfigPost | undefined): KildeKontekst => ({
    nu: nu(), zone: p?.zone ?? k.zone, valg: { ...(p?.valg ?? {}) },
    hemmelighed: () => laesKildeHemmelighed(deps.dataDir, k.id),
    erForbundet: async (id) => { const andre = kilder.get(id); return andre ? forbundet(andre, await post(id)) : false; },
  });

  async function gemPost(p: KonfigPost): Promise<void> {
    const k = await laesKonfig(deps.dataDir);
    await skrivKonfig(deps.dataDir, { kilder: [...k.kilder.filter((x) => x.id !== p.id), p] });
  }

  const meld = async (id: string, ok: boolean): Promise<void> => { try { await deps.efterLaesning?.(id, ok); } catch { /* the health state is a nicety to a read */ } };

  async function laesRen(k: Kilde, p: KonfigPost | undefined): Promise<Laesning> {
    let l: Laesning;
    try {
      let raw: unknown;
      try { raw = await k.read(kontekst(k, p)); } catch (err) {
        if (err instanceof KildeFejl) throw err;
        throw new KildeFejl(502, kilderTekst().kunneIkkeLaeses(k.navn));
      }
      l = renLaesning(k, raw);
    } catch (err) { await meld(k.id, false); throw err; }
    sidstLaest.set(k.id, nu().toISOString());
    await meld(k.id, true);
    return l;
  }

  /** The source's health; a throwing check reads as nede, one that hangs past the limit as langsomt. */
  async function maalHelbred(k: Kilde, ctx: KildeKontekst): Promise<Helbred> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const langsom = new Promise<Helbred>((res) => { timer = setTimeout(() => res({ status: 'langsomt' }), helbredMaks); });
    try { return await Promise.race([k.helbred(ctx).catch((): Helbred => ({ status: 'nede' })), langsom]); } finally { clearTimeout(timer); }
  }

  /** Records the connection, logs it, then reads once and announces a successful first read. */
  async function blivForbundet(k: Kilde, person: Person, zone: DataZone, valg: Record<string, string>, hemmelige: Record<string, string>, opsat?: string): Promise<Forbundet> {
    // KC-0139: "Log ind igen" reconnects a source that is already connected; that is a repair, not a first look.
    const igen = (await laesKonfig(deps.dataDir)).kilder.some((x) => x.id === k.id && x.status === 'forbundet');
    if (Object.keys(hemmelige).length) await gemKildeHemmelighed(deps.dataDir, k.id, hemmelige);
    const p: KonfigPost = { id: k.id, status: 'forbundet', zone, valg, tid: nu().toISOString(), af: person.id };
    await gemPost(p);
    await deps.store.appendLog(KILDER_LOG, { kilde: 'henrik', tekst: kilderTekst().logForbandt(person.navn, k.navn, slagsNavn(k.slags), opsat ?? ''), zone, ejer: person.id });
    let foerste: FoersteLaesning | null = null;
    let laesning: Laesning | null = null;
    try {
      laesning = await laesRen(k, p);
      foerste = { slags: laesning.slags, hentet: laesning.hentet, antal: antalI(laesning) };
    } catch { /* connected; the health check (KC-0139) says what is wrong */ }
    if (laesning && deps.foersteLaesning && !igen) {
      try { await deps.foersteLaesning({ kilde: k, laesning, zone, forbundet: p.tid, person }); } catch (err) { console.error('kilder: første værdi kunne ikke vises:', err instanceof Error ? err.message : err); }
    }
    if (foerste) deps.live?.notify(FOERSTE_LAESNING);
    return { forbundet: true, foersteLaesning: foerste, ...(opsat ? { opsat } : {}) };
  }

  /** What a setup or a later change of options may answer: a sentence and options that are the card's own non-secret fields, within their size, without control characters. */
  function renValg(k: Kilde, felter: Felt[], r: unknown): { tekst: string; valg: Record<string, string> } {
    const tilladt = new Map(felter.filter((f) => f.type !== 'hemmelig').map((f) => [f.navn, f.maks ?? FELT_MAKS]));
    const o = erObj(r) ? r : {};
    const valg = erObj(o['valg']) ? o['valg'] : null;
    const ok = typeof o['tekst'] === 'string' && valg !== null
      && Object.entries(valg).every(([n, v]) => tilladt.has(n) && typeof v === 'string' && v.length <= (tilladt.get(n) ?? FELT_MAKS) && !/[\u0000-\u001f\u007f]/.test(v));
    if (!ok) throw new KildeFejl(502, kilderTekst().ugyldigeValg(k.navn));
    return { tekst: (o['tekst'] as string).slice(0, 500), valg: valg as Record<string, string> };
  }

  /** KC-0136: the source's own setup before it is recorded; what it returns must be the card's non-secret options. */
  async function opsaet(k: Kilde, ctx: KildeKontekst, felter: Felt[]): Promise<{ tekst: string; valg: Record<string, string> } | null> {
    if (!k.opsaet) return null;
    let r: unknown;
    try { r = await k.opsaet(ctx); } catch (err) {
      if (err instanceof KildeFejl) throw err;
      throw new KildeFejl(502, kilderTekst().kunneIkkeSaettesOp(k.navn));
    }
    return renValg(k, felter, r);
  }

  /** KC-0222: changes of one source's options run one after the other (each reads the options the one before wrote). */
  const aendringer = new Map<string, Promise<unknown>>();

  return {
    registrer(k: Kilde): void {
      tjekKilde(k);
      if (kilder.has(k.id)) throw new Error(`kilden ${k.id} findes allerede`);
      kilder.set(k.id, k);
    },
    liste(): Kilde[] { return [...kilder.values()]; },
    hent(id: string): Kilde | undefined { return kilder.get(id); },

    /** KC-0148: the zone a source reads into and who connected it (null = the host's own source). Unknown → 404. */
    async hvor(id: string): Promise<{ zone: DataZone; af: string | null }> {
      const k = hentKilde(id);
      const p = await post(id);
      return { zone: p?.zone ?? k.zone, af: p?.af ?? null };
    },

    /** KC-0139: every connected source (health polling walks these). */
    async forbundneAlle(): Promise<Kilde[]> {
      const k = await laesKonfig(deps.dataDir);
      return [...kilder.values()].filter((x) => forbundet(x, k.kilder.find((p) => p.id === x.id)));
    },

    /** KC-0139: a connected source as a reconnect needs it: its own card, the options stored at the first connect, its zone and who connected it. null = unknown or not connected. */
    async forbindelse(id: string): Promise<{ kilde: Kilde; kort: KildeKort; valg: Record<string, string>; zone: DataZone; af: string | null } | null> {
      const k = kilder.get(id);
      if (!k) return null;
      const p = await post(id);
      if (!forbundet(k, p)) return null;
      const ctx = kontekst(k, p);
      return { kilde: k, kort: await k.kort(ctx), valg: { ...(p?.valg ?? {}) }, zone: ctx.zone, af: p?.af ?? null };
    },

    /** KC-0139: one connected source's health now (a throwing check reads as nede, a hanging one as langsomt); null = unknown or not connected. */
    async helbredFor(id: string): Promise<Helbred | null> {
      const k = kilder.get(id);
      if (!k) return null;
      const p = await post(id);
      return forbundet(k, p) ? maalHelbred(k, kontekst(k, p)) : null;
    },

    /** The connected sources of one slags, in registration order. */
    async forbundne(slags: Slags): Promise<Kilde[]> {
      const k = await laesKonfig(deps.dataDir);
      return [...kilder.values()].filter((x) => x.slags === slags && forbundet(x, k.kilder.find((p) => p.id === x.id)));
    },

    /**
     * A connected, working source's read, cleaned (renLaesning). Unknown → 404, not connected → 409, a source whose
     * health is not working (KC-0120 invariant: it contributes nothing, read() is not even called) or fails → 502.
     */
    async laes(id: string): Promise<Laesning> {
      const k = hentKilde(id);
      const p = await post(id);
      if (!forbundet(k, p)) throw new KildeFejl(409, kilderTekst().ikkeForbundet(k.navn));
      if (!virker(await maalHelbred(k, kontekst(k, p)))) throw new KildeFejl(502, kilderTekst().virkerIkkeNu(k.navn));
      return laesRen(k, p);
    },

    /** Every registered source: card, connection, and health for the connected ones (a throwing or hanging check reads as nede/langsomt). */
    async oversigt(): Promise<KildeOversigt[]> {
      const konfig = await laesKonfig(deps.dataDir);
      return Promise.all([...kilder.values()].map(async (k): Promise<KildeOversigt> => {
        const p = konfig.kilder.find((x) => x.id === k.id);
        const ctx = kontekst(k, p);
        const er = forbundet(k, p);
        const helbred = er ? await maalHelbred(k, ctx) : null;
        return {
          id: k.id, navn: k.navn, slags: k.slags, zone: ctx.zone, auth: k.auth, tillid: k.tillid ?? 'uklar', forbundet: er, helbred, kort: await k.kort(ctx),
          verber: Object.entries(k.verber ?? {}).map(([navn, s]) => ({ navn, verb: s.verb, tekst: s.tekst })),
          sidstLaest: sidstLaest.get(k.id) ?? null,
        };
      }));
    },

    /**
     * Connects `id` with the body `{ felter?, zone? }`, validated against the card. An oauth source answers with the
     * provider's URL (and a one-time state); every other kind is connected at once.
     */
    async forbind(id: string, body: unknown, person: Person): Promise<Forbundet | { omdiriger: string }> {
      const k = hentKilde(id);
      if (!erObj(body)) throw new KildeFejl(400, kilderTekst().ugyldigForespoergsel);
      for (const navn of Object.keys(body)) if (navn !== 'felter' && navn !== 'zone') throw new KildeFejl(400, kilderTekst().ukendtFelt(navn.slice(0, 40)));
      if (body['zone'] !== undefined && !erDataZone(body['zone'])) throw new KildeFejl(400, kilderTekst().ukendtZone);
      const p = await post(id);
      const zone = (body['zone'] as DataZone | undefined) ?? p?.zone ?? k.zone;
      const kort = await k.kort(kontekst(k, p));
      const { valg, hemmelige, miljoe } = tjekFelter(kort.felter, body['felter']);
      // KC-0133: app keys (an OAuth client) are set first, so the provider URL below is made with them.
      for (const [noegle, v] of Object.entries(miljoe)) {
        try { await saetMiljoeNoegle(noegle, v, deps.miljoe ?? {}); } catch (err) {
          if (err instanceof HemmelighedFejl) throw new KildeFejl(400, err.message);
          throw err;
        }
      }
      if (k.auth === 'oauth' && k.oauth) {
        const state = randomBytes(24).toString('hex');
        for (const [s, v] of venter) if (v.udloeber < nu().getTime()) venter.delete(s);
        venter.set(state, { id, person: person.id, zone, valg, hemmelige, udloeber: nu().getTime() + OAUTH_LEVETID_MS });
        const tilbage = `${(deps.adresse ?? '').replace(/\/+$/, '')}/api/kilder/${id}/tilbage`;
        const { url } = await k.oauth.start(state, tilbage, { ...kontekst(k, p), zone, valg });
        return { omdiriger: url };
      }
      // KC-0134: the setup may check a login, so it sees the secrets typed now (not stored until it succeeds).
      const ctx = kontekst(k, p);
      const nye = Object.keys(hemmelige).length ? async () => ({ ...((await ctx.hemmelighed()) ?? {}), ...hemmelige }) : ctx.hemmelighed;
      const sat = await opsaet(k, { ...ctx, zone, valg, hemmelighed: nye }, kort.felter);
      return sat ? blivForbundet(k, person, zone, sat.valg, hemmelige, sat.tekst) : blivForbundet(k, person, zone, valg, hemmelige);
    },

    /** The OAuth redirect: the state must be one this app issued, for this source and this person, not expired — once. */
    async tilbage(id: string, state: string, kode: string, person: Person): Promise<Forbundet> {
      const k = hentKilde(id);
      const v = venter.get(state);
      if (!v || v.id !== id || v.person !== person.id || v.udloeber < nu().getTime() || !k.oauth) throw new KildeFejl(400, kilderTekst().forbindelsenIkkeBekraeftet);
      venter.delete(state);
      if (!kode || kode.length > 2000) throw new KildeFejl(400, kilderTekst().ingenKode);
      let adgang: Record<string, string>;
      try { adgang = await k.oauth.tilbage(kode, { ...kontekst(k, await post(id)), zone: v.zone, valg: v.valg }, state); } catch (err) {
        if (err instanceof KildeFejl) throw err;
        throw new KildeFejl(502, kilderTekst().afvisteForbindelsen(k.navn));
      }
      return blivForbundet(k, person, v.zone, v.valg, { ...v.hemmelige, ...adgang });
    },

    /**
     * KC-0222: changes the options of a connected source after the connection (e.g. the news feeds), by the connector's
     * own function: it gets the connection as it is now and answers the options to store and a sentence for the log
     * (a KildeFejl passes through and nothing is written); the options are checked as a setup's are. The connection's
     * time and owner stay. Serial per source. Returns what the function answered.
     */
    async aendreValg<T extends { tekst: string; valg: Record<string, string> }>(id: string, person: Person, fn: (ctx: KildeKontekst) => Promise<T>): Promise<T> {
      const k = hentKilde(id);
      const gang = (aendringer.get(id) ?? Promise.resolve()).catch(() => undefined).then(async (): Promise<T> => {
        const p = await post(id);
        if (!forbundet(k, p)) throw new KildeFejl(409, kilderTekst().ikkeForbundet(k.navn));
        const ctx = kontekst(k, p);
        let svar: T;
        try { svar = await fn(ctx); } catch (err) {
          if (err instanceof KildeFejl) throw err;
          throw new KildeFejl(502, kilderTekst().kunneIkkeAendres(k.navn));
        }
        const ren = renValg(k, (await k.kort(ctx)).felter, svar);
        await gemPost({ id, status: 'forbundet', zone: ctx.zone, valg: ren.valg, tid: p?.tid ?? nu().toISOString(), af: p?.af ?? person.id });
        await deps.store.appendLog(KILDER_LOG, { kilde: 'henrik', tekst: kilderTekst().logAendrede(person.navn, k.navn, ren.tekst), zone: ctx.zone, ejer: person.id });
        return svar;
      });
      aendringer.set(id, gang);
      return gang;
    },

    /** Disconnects: logs first (AGENTS §4 r5), then marks it frakoblet, lets the connector revoke (KC-0133, best effort) and removes its credentials. */
    async frakobl(id: string, person: Person): Promise<void> {
      const k = hentKilde(id);
      const p = await post(id);
      if (!forbundet(k, p)) throw new KildeFejl(409, kilderTekst().ikkeForbundet(k.navn));
      const zone = p?.zone ?? k.zone;
      await deps.store.appendLog(KILDER_LOG, { kilde: 'henrik', tekst: kilderTekst().logFrakoblede(person.navn, k.navn, slagsNavn(k.slags)), zone, ejer: person.id });
      await gemPost({ id, status: 'frakoblet', zone, valg: p?.valg ?? {}, tid: nu().toISOString(), af: person.id });
      if (k.frakobl) { try { await k.frakobl(kontekst(k, p)); } catch { /* the provider may keep the grant; ours is gone below */ } }
      await fjernKildeHemmelighed(deps.dataDir, id);
    },

    /** Runs a declared action on a connected source, after the policy layer said yes (spec D5). One audit line per decision. */
    async handl(id: string, navn: string, args: unknown, i: { person: Person; kanal: Kontekst['kanal'] }): Promise<Resultat> {
      const k = hentKilde(id);
      const spec = k.verber && Object.hasOwn(k.verber, navn) ? k.verber[navn] : undefined;
      if (!spec || !k.act) throw new KildeFejl(400, kilderTekst().kanIkke(k.navn, navn.slice(0, 40)));
      const p = await post(id);
      if (!forbundet(k, p)) throw new KildeFejl(409, kilderTekst().ikkeForbundet(k.navn));
      const ctx = kontekst(k, p);
      const a = afgoer({ rum: `kilde:${id}`, id: navn, verb: spec.verb, zoner: [ctx.zone] }, { person: i.person, kanal: i.kanal, ja: false });
      await deps.revision?.skriv({
        person: i.person.id, kanal: KANAL[i.kanal], rum: `kilde:${id}`, verb: spec.verb, udfald: a.udfald === 'afvis' ? 'afvist' : a.udfald,
        hvorfor: a.hvorfor, handlingId: navn.slice(0, 200), zoner: [ctx.zone], kilde: 'graense',
      });
      if (a.udfald !== 'tillad') throw new KildeFejl(403, a.hvorfor);
      return k.act(navn, args, ctx);
    },
  };
}

export type KildeRegister = ReturnType<typeof lavRegister>;
