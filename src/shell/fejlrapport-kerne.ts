// KC-0187 (spec D16): the error report's allow-list scrubber, its Sentry envelope and the reporter around them.
// Byte-identical in src/shell/ and sky/src/delt/ with its rules file (test/fejlrapport.test.ts compares both), because
// Sky and the tenant share no import (KC-0176). No SDK: an event is built here from permitted fields only, so nothing
// an integration collects on its own (request, cookies, breadcrumbs, local variables) exists to be scrubbed.
// Invariant: nothing a customer typed or received leaves through a report; a scrubber that throws drops the event.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

type Form = 'type' | 'kode' | 'fil' | 'funktion' | 'tenant' | 'rute' | 'release' | 'miljoe' | 'alarm';
type Regler = {
  version: number;
  former: Record<Form, string>;
  forbudteNavne: string[];
  redaktioner: { navn: string; moenster: string; erstat: string }[];
  maks: { besked: number; rammer: number; varighedMs: number; perTiMinutter: number };
};

export const REGLER = JSON.parse(readFileSync(new URL('./fejlrapport-regler.json', import.meta.url), 'utf8')) as Regler;
const FORM = Object.fromEntries(Object.entries(REGLER.former).map(([k, v]) => [k, new RegExp(v)])) as Record<Form, RegExp>;
const REDAKTIONER = REGLER.redaktioner.map((r) => ({ re: new RegExp(r.moenster, 'g'), erstat: r.erstat }));
// C0/C1 controls, line/paragraph separators and the bidi overrides that can disguise text.
const KONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/g;
export const FJERNET = '[besked fjernet]';

/** The context a caller may add. Each value is checked against its form; one that does not match is left out. */
export type Kontekst = { tenant?: unknown; rute?: unknown; status?: unknown; varighedMs?: unknown; alarm?: unknown; niveau?: 'error' | 'warning' };
/** What reaches the scrubber: the thrown value, our context, and whatever else anyone attached (never read). */
export type RaaHaendelse = Kontekst & { fejl: unknown; release?: unknown; miljoe?: unknown; [andet: string]: unknown };

export type Ramme = { filename: string; function: string; lineno?: number; colno?: number; in_app: boolean };
/** The only event shape that leaves (Sentry's event payload, a subset). */
export type Haendelse = {
  event_id: string;
  timestamp: number;
  platform: 'node';
  level: 'error' | 'warning';
  release?: string;
  environment?: string;
  exception: { values: [{ type: string; value: string; stacktrace?: { frames: Ramme[] } }] };
  tags: Record<string, string>;
  contexts?: { clawco: { varighed_ms: number } };
};

const SIKKER = Symbol.for('clawco.fejlrapport.sikker-besked');

/** Marks a message our own code wrote (counts, ids, fixed words) as allowed to leave; it is still redacted. Any other
 *  message never leaves: a thrown error can carry a prompt, a mail or a key, and no redactor can recognise free text. */
export function medSikkerBesked<E extends Error>(fejl: E, besked: string): E {
  Object.defineProperty(fejl, SIKKER, { value: besked, enumerable: false });
  return fejl;
}

const passer = (form: Form, v: unknown): string | undefined => (typeof v === 'string' && FORM[form].test(v) ? v : undefined);

/** Redaction for a marked message: addresses, URLs, quotes, named secrets, long tokens, anything after a colon. */
export function rediger(besked: string): string {
  let t = besked.replace(KONTROL, ' ');
  for (const r of REDAKTIONER) t = t.replace(r.re, r.erstat);
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > REGLER.maks.besked ? `${t.slice(0, REGLER.maks.besked - 1)}…` : t;
}

/** A path from a stack line, without the machine's own directories (they name its user). */
function kortFil(f: string): string | undefined {
  let s = f.replace(/^file:\/\//, '').replace(/^node:/, 'node/').split('?')[0]!;
  for (const anker of ['/node_modules/', '/src/', '/test/', '/scripts/']) {
    const i = s.lastIndexOf(anker);
    if (i >= 0) { s = s.slice(i + 1); break; }
  }
  if (s.startsWith('/')) s = s.slice(s.lastIndexOf('/') + 1);
  return passer('fil', s);
}

const STAKLINJE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** Stack frames from V8's text: only the "at" lines (the first line repeats the message), oldest first. */
function rammer(stak: unknown): Ramme[] {
  if (typeof stak !== 'string') return [];
  const ud: Ramme[] = [];
  for (const linje of stak.split('\n')) {
    const m = STAKLINJE.exec(linje);
    if (!m) continue;
    const filename = kortFil(m[2]!) ?? '[ukendt]';
    const r: Ramme = { filename, function: passer('funktion', m[1] ?? '<anonymous>') ?? '[ukendt]', lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.startsWith('node/') && !filename.startsWith('node_modules/') && filename !== '[ukendt]' };
    ud.push(r);
    if (ud.length >= REGLER.maks.rammer) break;
  }
  return ud.reverse();
}

/** Every key in the rebuilt event: none may be named like content (a second line behind the allow-list). */
function selvtjek(v: unknown): void {
  if (v === null || typeof v !== 'object') return;
  for (const [k, u] of Object.entries(v)) {
    const lav = k.toLowerCase();
    if (REGLER.forbudteNavne.some((n) => lav.includes(n))) throw new Error('fejlrapport: et forbudt feltnavn i hændelsen');
    selvtjek(u);
  }
}

/** beforeSend: rebuilds the event from the permitted fields only. Throws on anything unexpected (the caller drops). */
export function rens(raa: RaaHaendelse, nu: Date = new Date()): Haendelse {
  const f = raa.fejl;
  const erFejl = f instanceof Error;
  // The class, never `name` (a caller can set that to anything).
  const type = erFejl ? (passer('type', f.constructor?.name) ?? 'Error') : 'IkkeEnFejl';
  const sikker = erFejl ? (f as unknown as Record<symbol, unknown>)[SIKKER] : undefined;
  const value = typeof sikker === 'string' ? rediger(sikker) : FJERNET;
  const frames = erFejl ? rammer(f.stack) : [];
  const tags: Record<string, string> = {};
  const tenant = passer('tenant', raa.tenant);
  if (tenant) tags['tenant'] = tenant;
  const rute = typeof raa.rute === 'string' ? passer('rute', raa.rute.split('?')[0]) : undefined;
  if (rute) tags['rute'] = rute;
  if (typeof raa.status === 'number' && Number.isInteger(raa.status) && raa.status >= 100 && raa.status <= 599) tags['status'] = String(raa.status);
  const kode = erFejl ? passer('kode', (f as Error & { code?: unknown }).code) : undefined;
  if (kode) tags['kode'] = kode;
  const alarm = passer('alarm', raa.alarm);
  if (alarm) tags['alarm'] = alarm;
  const h: Haendelse = {
    event_id: randomBytes(16).toString('hex'),
    timestamp: nu.getTime() / 1000,
    platform: 'node',
    level: raa.niveau === 'warning' ? 'warning' : 'error',
    exception: { values: [{ type, value, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    tags,
  };
  const release = passer('release', raa.release);
  if (release) h.release = release;
  const miljoe = passer('miljoe', raa.miljoe);
  if (miljoe) h.environment = miljoe;
  const v = raa.varighedMs;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= REGLER.maks.varighedMs) h.contexts = { clawco: { varighed_ms: Math.round(v) } };
  selvtjek(h);
  return h;
}

/** The DSN decides the endpoint, and with it the region (an EU Sentry project, or a self-hosted GlitchTip). Only the
 *  public key form is accepted; a DSN with a secret part, a query or plain http off loopback is refused (null). */
export function laesDsn(dsn: string): { endepunkt: string; noegle: string } | null {
  let u: URL;
  try { u = new URL(dsn.trim()); } catch { return null; }
  const lokal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && lokal)) return null;
  if (!/^[A-Za-z0-9]{8,64}$/.test(u.username) || u.password || u.search || u.hash) return null;
  const dele = u.pathname.split('/').filter(Boolean);
  const projekt = dele.pop();
  if (!projekt || !/^\d{1,20}$/.test(projekt)) return null;
  const sti = dele.length ? `/${dele.join('/')}` : '';
  return { endepunkt: `${u.protocol}//${u.host}${sti}/api/${projekt}/envelope/`, noegle: u.username };
}

/** Sentry's envelope: a header line, an item header line, the event. */
export function konvolut(h: Haendelse, nu: Date): string {
  return `${JSON.stringify({ event_id: h.event_id, sent_at: nu.toISOString() })}\n${JSON.stringify({ type: 'event', content_type: 'application/json' })}\n${JSON.stringify(h)}\n`;
}

/** The seam: tests pass a fake; production posts the envelope. `h` is the event the envelope carries. */
export type Transport = (konvolut: string, h: Haendelse) => Promise<void>;

/** One POST per event, 5 s at most. A refusal is an Error naming the status only (never the body sent or received). */
export function sentryTransport(dsn: string, fetchImpl: typeof fetch = fetch, timeoutMs = 5_000): Transport {
  const d = laesDsn(dsn);
  if (!d) throw new Error('fejlrapport: ugyldig DSN');
  return async (k) => {
    const r = await fetchImpl(d.endepunkt, {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_client=clawco/1, sentry_key=${d.noegle}` },
      body: k,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await r.body?.cancel();
    if (!r.ok) throw new Error(`fejlrapport: modtageren svarede ${r.status}`);
  };
}

export type Fejlrapport = {
  /** True when reports leave the process (a transport is configured). */
  aktiv: boolean;
  /** Never throws and never waits: the report is sent in the background. */
  rapporter(fejl: unknown, k?: Kontekst): void;
  /** Resolves when every report started so far has been sent or dropped (tests, shutdown). */
  vent(): Promise<void>;
};

export function ingenFejlrapport(): Fejlrapport {
  return { aktiv: false, rapporter() {}, async vent() {} };
}

/** The reporter around a transport. Fixed fields (release, environment, tenant) come from the caller's own config. */
export function lavFejlrapport(o: { transport: Transport | null; release?: string; miljoe?: string; tenant?: string; rens?: (r: RaaHaendelse, nu: Date) => Haendelse; nu?: () => Date; log?: (linje: string) => void }): Fejlrapport {
  const transport = o.transport;
  if (!transport) return ingenFejlrapport();
  const log = o.log ?? ((l: string) => { console.error(l); });
  const nu = o.nu ?? (() => new Date());
  const igang = new Set<Promise<void>>();
  let vindue = 0;
  let iVindue = 0;
  let sagtFra = false;
  return {
    aktiv: true,
    rapporter(fejl, k = {}) {
      const tid = nu();
      const v = Math.floor(tid.getTime() / 600_000);
      if (v !== vindue) { vindue = v; iVindue = 0; sagtFra = false; }
      if (iVindue >= REGLER.maks.perTiMinutter) {
        if (!sagtFra) { sagtFra = true; log(`fejlrapport: over ${REGLER.maks.perTiMinutter} på ti minutter, resten i dette vindue sendes ikke`); }
        return;
      }
      let h: Haendelse;
      try {
        h = (o.rens ?? rens)({ ...k, fejl, release: o.release, miljoe: o.miljoe, tenant: k.tenant ?? o.tenant }, tid);
      } catch {
        log('fejlrapport: rensningen fejlede, hændelsen er droppet');
        return;
      }
      iVindue += 1;
      const p = transport(konvolut(h, tid), h).catch((err: unknown) => {
        log(`fejlrapport: kunne ikke sendes (${err instanceof Error && /^fejlrapport: /.test(err.message) ? err.message.slice(13) : 'netværk'})`);
      }).finally(() => { igang.delete(p); });
      igang.add(p);
    },
    async vent() { while (igang.size) await Promise.all([...igang]); },
  };
}
