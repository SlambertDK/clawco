// "Lad support se med" (KC-0188, spec D15), Sky's half: the grant. Staff have no read access to a tenant; a grant is
// the only way in. Only the tenant's owner makes one, for one tenant, for 1, 4 or 24 hours (the constants below, the
// one place they live in Sky), with an optional one-line reason. It ends by clock or by revoke and is never extended.
// Only a staff account (konto.personale, made by sky/scripts/goer-personale.ts, never by sign-up) logged in by
// passkey can use it, and only the first staff account that opened it. Every grant, session start, revoke and expiry
// is a row in stoette_haendelse with the account's id.
//
// Invariant (AGENTS §0 r2/r7): stoetteGyldig says yes only for an unexpired, unrevoked grant for exactly this tenant,
// bound to exactly this staff account, while that account is staff, has a passkey, is logged in by passkey in this
// very session, and the tenant is still in the gateway. A bad clock or a database error throws (the gateway answers
// 503); nothing here ever turns support on by itself: givStoette is called only from the owner's switch (server.ts →
// gateway/stoette-vej.ts), which a test holds.
import type { Database } from '../db/pool.ts';
import type { Post } from '../delt/post.ts';
import { hentKonto } from './konto.ts';
import { hentProfil } from './profil.ts';

export const STOETTE_TIMER = [1, 4, 24] as const;
export const STOETTE_MAKS_TIMER = 24;
export const GRUND_MAKS = 120;
const TIME_MS = 3_600_000;

export type Adgang = {
  id: number; slug: string; givetAf: number; givet: Date; udloeber: Date; tilbagekaldt: Date | null; grund: string; personaleKontoId: number | null;
};
export type Haendelse = { slags: 'givet' | 'aabnet' | 'tilbagekaldt' | 'udloebet'; tid: Date; kontoId: number | null };
export type GivUdfald = { ok: true; adgang: Adgang } | { ok: false; grund: 'ikke-ejer' | 'ugyldig-tid' | 'ugyldig-grund' };

type Raekke = { id: unknown; tenant_id: string; givet_af: unknown; givet: Date; udloeber: Date; tilbagekaldt: Date | null; grund: string; personale_konto_id: unknown };
const KOLONNER = 'a.id, a.tenant_id, a.givet_af, a.givet, a.udloeber, a.tilbagekaldt, a.grund, a.personale_konto_id';
const somAdgang = (r: Raekke): Adgang => ({
  id: Number(r.id), slug: r.tenant_id, givetAf: Number(r.givet_af), givet: new Date(r.givet), udloeber: new Date(r.udloeber),
  tilbagekaldt: r.tilbagekaldt ? new Date(r.tilbagekaldt) : null, grund: r.grund, personaleKontoId: r.personale_konto_id === null ? null : Number(r.personale_konto_id),
});

/** The clock is a fact we act on: an invalid one is an error, never "not expired". */
function iso(nu: Date): string {
  if (!(nu instanceof Date) || !Number.isFinite(nu.getTime())) throw new Error('støtteadgang: uret er ugyldigt');
  return nu.toISOString();
}

// C0/C1 controls, line/paragraph separators and the bidi overrides/isolates.
const FORBUDT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

/** The reason as stored: trimmed, one line, at most GRUND_MAKS characters; null when it cannot be one. */
export function renGrund(v: unknown): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= GRUND_MAKS && !FORBUDT.test(t) ? t : null;
}

const erTimer = (v: unknown): v is (typeof STOETTE_TIMER)[number] => typeof v === 'number' && (STOETTE_TIMER as readonly number[]).includes(v);

async function erEjer(db: Database, slug: string, kontoId: number): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM flaade.tenant t JOIN konto k ON k.id = t.ejer_konto_id
      WHERE t.slug = $1 AND t.tilstand = 'klar' AND t.ejer_konto_id = $2 AND k.slettet_ved IS NULL`, [slug, kontoId]);
  return r.length === 1;
}

async function noter(db: Database, adgangId: number, slags: Haendelse['slags'], kontoId: number | null, nu: Date): Promise<void> {
  await db.query('INSERT INTO stoette_haendelse (adgang_id, tid, slags, konto_id) VALUES ($1, $2, $3, $4)', [adgangId, iso(nu), slags, kontoId]);
}

/** The owner turns support on for their own tenant. A grant that is still on is revoked first (one at a time). */
export async function givStoette(db: Database, a: { slug: string; kontoId: number; timer: unknown; grund?: unknown; nu: Date }): Promise<GivUdfald> {
  const tid = iso(a.nu);
  if (!erTimer(a.timer)) return { ok: false, grund: 'ugyldig-tid' };
  const grund = renGrund(a.grund);
  if (grund === null) return { ok: false, grund: 'ugyldig-grund' };
  if (!(await erEjer(db, a.slug, a.kontoId))) return { ok: false, grund: 'ikke-ejer' };
  const udloeber = new Date(a.nu.getTime() + a.timer * TIME_MS).toISOString();
  return db.transaction(async (tx) => {
    for (const id of await tilbagekaldAktive(tx, a.slug, tid)) await noter(tx, id, 'tilbagekaldt', a.kontoId, a.nu);
    const [r] = await tx.query<Raekke>(
      `INSERT INTO stoette_adgang AS a (tenant_id, givet_af, givet, udloeber, grund) VALUES ($1, $2, $3, $4, $5) RETURNING ${KOLONNER}`,
      [a.slug, a.kontoId, tid, udloeber, grund]);
    const adgang = somAdgang(r!);
    await noter(tx, adgang.id, 'givet', a.kontoId, a.nu);
    return { ok: true as const, adgang };
  });
}

async function tilbagekaldAktive(db: Database, slug: string, tid: string): Promise<number[]> {
  const r = await db.query<{ id: unknown }>(
    'UPDATE stoette_adgang SET tilbagekaldt = $2 WHERE tenant_id = $1 AND tilbagekaldt IS NULL AND udloeber > $2 RETURNING id', [slug, tid]);
  return r.map((x) => Number(x.id));
}

/** The owner's "Slå fra": every grant still on for this tenant ends now. null = not this tenant's owner. */
export async function tilbagekaldStoette(db: Database, a: { slug: string; kontoId: number; nu: Date }): Promise<number[] | null> {
  const tid = iso(a.nu);
  if (!(await erEjer(db, a.slug, a.kontoId))) return null;
  return db.transaction(async (tx) => {
    const ider = await tilbagekaldAktive(tx, a.slug, tid);
    for (const id of ider) await noter(tx, id, 'tilbagekaldt', a.kontoId, a.nu);
    return ider;
  });
}

/** Rolls a grant back when its start could not be completed (the tenant or the notice mail failed): no half state. */
export async function annullerStoette(db: Database, id: number, nu: Date): Promise<void> {
  const tid = iso(nu);
  const r = await db.query('UPDATE stoette_adgang SET tilbagekaldt = $2 WHERE id = $1 AND tilbagekaldt IS NULL RETURNING id', [id, tid]);
  if (r.length) await noter(db, id, 'tilbagekaldt', null, nu);
}

/** Staff, logged in by passkey in this session: the account is personale, not deleted, has a passkey, and the session
 *  is alive and was made by a passkey login. */
export async function erPersonale(db: Database, a: { kontoId: number; sessionId: number; nu: Date }): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM konto k JOIN session s ON s.konto_id = k.id
      WHERE k.id = $1 AND s.id = $2 AND k.personale AND k.slettet_ved IS NULL AND s.udloeber > $3 AND s.metode = 'passkey'
        AND EXISTS (SELECT 1 FROM passkey p WHERE p.konto_id = k.id)`, [a.kontoId, a.sessionId, iso(a.nu)]);
  return r.length === 1;
}

/** A staff member opens a grant from the staff page: binds it to them (the first opener only). null = no. */
export async function aabnStoette(db: Database, a: { id: number; personaleKontoId: number; sessionId: number; nu: Date }): Promise<Adgang | null> {
  const tid = iso(a.nu);
  if (!(await erPersonale(db, { kontoId: a.personaleKontoId, sessionId: a.sessionId, nu: a.nu }))) return null;
  const [r] = await db.query<Raekke>(
    `UPDATE stoette_adgang AS a SET personale_konto_id = $2
      WHERE a.id = $1 AND (a.personale_konto_id IS NULL OR a.personale_konto_id = $2) AND a.tilbagekaldt IS NULL AND a.udloeber > $3
        AND EXISTS (SELECT 1 FROM flaade.tenant t WHERE t.slug = a.tenant_id AND t.tilstand = 'klar')
      RETURNING ${KOLONNER}`, [a.id, a.personaleKontoId, tid]);
  return r ? somAdgang(r) : null;
}

/** The gateway's check on every request of a support session (no cache). */
export async function stoetteGyldig(db: Database, a: { id: number; slug: string; personaleKontoId: number; sessionId: number; nu: Date }): Promise<Adgang | null> {
  const tid = iso(a.nu);
  const [r] = await db.query<Raekke>(
    `SELECT ${KOLONNER} FROM stoette_adgang a
       JOIN flaade.tenant t ON t.slug = a.tenant_id AND t.tilstand = 'klar'
       JOIN konto k ON k.id = a.personale_konto_id AND k.personale AND k.slettet_ved IS NULL
       JOIN session s ON s.konto_id = k.id AND s.id = $4 AND s.udloeber > $3 AND s.metode = 'passkey'
      WHERE a.id = $1 AND a.tenant_id = $2 AND a.personale_konto_id = $5 AND a.tilbagekaldt IS NULL AND a.udloeber > $3
        AND EXISTS (SELECT 1 FROM passkey p WHERE p.konto_id = k.id)`,
    [a.id, a.slug, tid, a.sessionId, a.personaleKontoId]);
  return r ? somAdgang(r) : null;
}

/** A support session started (the gateway exchanged a staff member's one-time code). */
export async function sessionStartet(db: Database, a: { id: number; personaleKontoId: number; nu: Date }): Promise<void> {
  await noter(db, a.id, 'aabnet', a.personaleKontoId, a.nu);
}

/** The grants that are on now (the staff page). */
export async function aktiveStoetter(db: Database, nu: Date): Promise<Adgang[]> {
  const r = await db.query<Raekke>(
    `SELECT ${KOLONNER} FROM stoette_adgang a WHERE a.tilbagekaldt IS NULL AND a.udloeber > $1 ORDER BY a.givet DESC`, [iso(nu)]);
  return r.map(somAdgang);
}

/** Records each expiry once (Sky's log); returns the grants that just expired. */
export async function noterUdloebne(db: Database, nu: Date): Promise<Adgang[]> {
  const tid = iso(nu);
  return db.transaction(async (tx) => {
    const r = await tx.query<Raekke>(
      `UPDATE stoette_adgang AS a SET udloeb_logget = $1 WHERE a.udloeb_logget IS NULL AND a.tilbagekaldt IS NULL AND a.udloeber <= $1 RETURNING ${KOLONNER}`, [tid]);
    const ud = r.map(somAdgang);
    for (const x of ud) await tx.query('INSERT INTO stoette_haendelse (adgang_id, tid, slags, konto_id) VALUES ($1, $2, $3, NULL)', [x.id, x.udloeber.toISOString(), 'udloebet']);
    return ud;
  });
}

const klokke = (d: Date): string => new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');

/** The notice to the owner that support just started (template stoette-startet), in the owner's language. Throws when
 *  it cannot be sent: the switch then rolls the grant back (no grant without its notice). */
export async function sendStoetteKvittering(d: { db: Database; post: Post }, kontoId: number, a: { timer: number; udloeber: Date }): Promise<void> {
  const k = await hentKonto(d.db, kontoId);
  if (!k) throw new Error('støtteadgang: ejeren findes ikke');
  const sprog = (await hentProfil(d.db, kontoId))?.sprog ?? 'da';
  await d.post.send({ til: k.email, skabelon: 'stoette-startet', sprog, data: { timer: String(a.timer), til: klokke(a.udloeber) } });
}

export async function stoetteHaendelser(db: Database, adgangId: number): Promise<Haendelse[]> {
  const r = await db.query<{ slags: Haendelse['slags']; tid: Date; konto_id: unknown }>(
    'SELECT slags, tid, konto_id FROM stoette_haendelse WHERE adgang_id = $1 ORDER BY id', [adgangId]);
  return r.map((x) => ({ slags: x.slags, tid: new Date(x.tid), kontoId: x.konto_id === null ? null : Number(x.konto_id) }));
}
