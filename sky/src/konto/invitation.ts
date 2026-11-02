// Inviting a household member by mail (KC-0184, spec D12/D15). The owner writes the address, the name, the role and
// his own name as she knows him; he first sees the exact mail (rendered by the same template function that sends it,
// delt/skabeloner, so the preview and the sent mail cannot differ, the link included) and sends it with his own click.
// Nothing else creates or sends an invitation: no agent, no tenant code, no scheduled job (a test holds that only the
// account routes call send).
//
// The link carries 32 random bytes; only their SHA-256 is stored. A draft lives an hour (the preview); a sent
// invitation 7 days, once, for that address only (konto/medlemskab.ts accepts it). The owner can cancel a pending
// invitation; "Send igen" is a new draft whose send cancels the old one (a new token: the old link dies).
// Plan limits come through Entitlements.medlemmer(tenantId): the owner counts, so do members and pending invitations.
import { createHash } from 'node:crypto';
import type { Database } from '../db/pool.ts';
import type { Post } from '../delt/post.ts';
import { renderMail, type Mail } from '../delt/skabeloner/index.ts';
import { hentKonto, normaliserEmail } from './konto.ts';
import { hashToken, nytToken } from './token.ts';
import { taelOp } from './graenser.ts';

export const INVITATION_DAGE = 7;
export const UDKAST_MS = 60 * 60_000;
/** Invitation mails one household may send per window (graenser.ts' 15 minutes): a resend loop cannot spam anyone. */
export const INVITATIONER_PR_VINDUE = 10;
export const INVITER_ROLLER = ['medlem', 'barn', 'gaest'] as const;
export type InviterRolle = (typeof INVITER_ROLLER)[number];
export const erInviterRolle = (v: unknown): v is InviterRolle => typeof v === 'string' && (INVITER_ROLLER as readonly string[]).includes(v);

/** The plan's limit: how many people the household may hold in all, the owner included (Solo 1, Husstand 6). */
export type Entitlements = { medlemmer(tenantId: string): Promise<number> };

export type InvitationDeps = { db: Database; publicUrl: string; entitlements: Entitlements };

const FORBUDT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;
function navn(v: unknown): string | null {
  const t = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  return t && t.length <= 80 && !FORBUDT.test(t) ? t : null;
}

/** The owner's klar tenant (an owner never invites into anything else). */
export async function ejersTenant(db: Database, kontoId: number): Promise<{ slug: string; adresse: string } | null> {
  const [r] = await db.query<{ slug: string; adresse: string | null }>(
    `SELECT t.slug, t.adresse FROM flaade.tenant t JOIN konto k ON k.id = t.ejer_konto_id AND k.slettet_ved IS NULL
      WHERE t.ejer_konto_id = $1 AND t.tilstand = 'klar'`, [kontoId]);
  return r?.adresse ? { slug: r.slug, adresse: r.adresse } : null;
}

/** Places in use: the owner, the members, and sent invitations still pending (`uden`: one being replaced). */
export async function pladser(d: Pick<InvitationDeps, 'db' | 'entitlements'>, slug: string, nu: Date, uden: number | null = null): Promise<{ brugt: number; max: number }> {
  const [r] = await d.db.query<{ m: number; i: number }>(
    `SELECT (SELECT count(*)::int FROM medlemskab WHERE tenant_id = $1) AS m,
            (SELECT count(*)::int FROM invitation WHERE tenant_id = $1 AND sendt IS NOT NULL AND brugt IS NULL AND annulleret IS NULL
               AND udloeber > $2 AND id IS DISTINCT FROM $3::bigint) AS i`, [slug, nu.toISOString(), uden]);
  return { brugt: 1 + (r?.m ?? 0) + (r?.i ?? 0), max: await d.entitlements.medlemmer(slug) };
}

/** The genitive of a name, Danish style: "Ida" → "Idas", "Jens" → "Jens'". */
export const ejefald = (n: string): string => (/[sxz]$/i.test(n) ? `${n}'` : `${n}s`);

export const invitationLink = (publicUrl: string, token: string): string => {
  const u = new URL('/invitation', publicUrl);
  u.searchParams.set('t', token);
  return u.href;
};

type Raekke = { id: unknown; tenant_id: string; inviteret_af: unknown; email: string; navn: string; rolle: InviterRolle; inviterer: string; oprettet: Date | string; sendt: Date | string | null; udloeber: Date | string; brugt: unknown; annulleret: unknown; erstatter: unknown; hash: string };

/** The template's data for one invitation: the one place both the preview and the send take it from. */
export function invitationData(r: { inviterer: string }, link: string): Record<string, string> {
  return { link, inviterer: r.inviterer, husstand: `${ejefald(r.inviterer)} husstand`, dage: String(INVITATION_DAGE) };
}

export type Udkast = { id: number; token: string; til: string; mail: Mail };
export type ForberedFejl = 'ikke-ejer' | 'email' | 'navn' | 'rolle' | 'inviterer' | 'egen-email' | 'allerede-med' | 'ventende' | 'fuld';

/** Step 1, the owner's "Se mailen": a draft row (not sent) and the exact mail. `erstatter`: a resend of that one. */
export async function forbered(d: InvitationDeps, a: { ejerKontoId: number; email: unknown; navn: unknown; rolle: unknown; inviterer: unknown; erstatter?: number; nu: Date }): Promise<{ ok: true; udkast: Udkast } | { ok: false; grund: ForberedFejl; max?: number }> {
  const t = await ejersTenant(d.db, a.ejerKontoId);
  const ejer = await hentKonto(d.db, a.ejerKontoId);
  if (!t || !ejer) return { ok: false, grund: 'ikke-ejer' };
  const email = normaliserEmail(a.email);
  if (!email) return { ok: false, grund: 'email' };
  const hendes = navn(a.navn);
  if (!hendes) return { ok: false, grund: 'navn' };
  if (!erInviterRolle(a.rolle)) return { ok: false, grund: 'rolle' };
  const inviterer = navn(a.inviterer);
  // At most 60: the mail adds "s husstand" and a template name is at most 80 characters.
  if (!inviterer || inviterer.length > 60) return { ok: false, grund: 'inviterer' };
  if (email === ejer.email) return { ok: false, grund: 'egen-email' };
  if ((await d.db.query('SELECT 1 FROM medlemskab m JOIN konto k ON k.id = m.konto_id WHERE m.tenant_id = $1 AND k.email = $2', [t.slug, email])).length) return { ok: false, grund: 'allerede-med' };
  const ventende = await d.db.query<{ id: unknown }>(
    'SELECT id FROM invitation WHERE tenant_id = $1 AND email = $2 AND sendt IS NOT NULL AND brugt IS NULL AND annulleret IS NULL AND udloeber > $3', [t.slug, email, a.nu.toISOString()]);
  if (ventende.some((v) => Number(v.id) !== a.erstatter)) return { ok: false, grund: 'ventende' };
  const p = await pladser(d, t.slug, a.nu, a.erstatter ?? null);
  if (p.brugt + 1 > p.max) return { ok: false, grund: 'fuld', max: p.max };
  // Drafts nobody sent are worthless after their hour; clear them as we go.
  await d.db.query('DELETE FROM invitation WHERE sendt IS NULL AND oprettet < $1', [new Date(a.nu.getTime() - UDKAST_MS).toISOString()]);
  const token = nytToken();
  const [r] = await d.db.query<{ id: unknown }>(
    `INSERT INTO invitation (hash, tenant_id, inviteret_af, email, navn, rolle, inviterer, oprettet, udloeber, erstatter)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [hashToken(token), t.slug, a.ejerKontoId, email, hendes, a.rolle, inviterer, a.nu.toISOString(), new Date(a.nu.getTime() + UDKAST_MS).toISOString(), a.erstatter ?? null]);
  const id = Number(r!.id);
  return { ok: true, udkast: { id, token, til: email, mail: renderMail({ skabelon: 'invitation', data: invitationData({ inviterer }, invitationLink(d.publicUrl, token)) }) } };
}

/** "Send igen": a new draft with the old one's address, name, role and sender (its send cancels the old one). */
export async function gensend(d: InvitationDeps, a: { ejerKontoId: number; id: number; nu: Date }): Promise<{ ok: true; udkast: Udkast } | { ok: false; grund: ForberedFejl | 'ukendt' }> {
  const [r] = await d.db.query<Raekke>(
    `SELECT i.* FROM invitation i JOIN flaade.tenant t ON t.slug = i.tenant_id AND t.ejer_konto_id = $2
      WHERE i.id = $1 AND i.sendt IS NOT NULL AND i.brugt IS NULL AND i.annulleret IS NULL`, [a.id, a.ejerKontoId]);
  if (!r) return { ok: false, grund: (await ejersTenant(d.db, a.ejerKontoId)) ? 'ukendt' : 'ikke-ejer' };
  return forbered(d, { ejerKontoId: a.ejerKontoId, email: r.email, navn: r.navn, rolle: r.rolle, inviterer: r.inviterer, erstatter: a.id, nu: a.nu });
}

/** Step 2, the owner's own click on "Send invitation": the draft he saw, sent as he saw it. Checked again here. */
export async function send(d: InvitationDeps & { post: Post }, a: { ejerKontoId: number; id: number; token: unknown; nu: Date }): Promise<'sendt' | 'ikke-ejer' | 'ukendt' | 'fuld' | 'for-mange' | 'post-fejl'> {
  const t = await ejersTenant(d.db, a.ejerKontoId);
  if (!t) return 'ikke-ejer';
  if (typeof a.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(a.token)) return 'ukendt';
  const [r] = await d.db.query<Raekke>(
    `SELECT * FROM invitation WHERE id = $1 AND hash = $2 AND tenant_id = $3 AND inviteret_af = $4 AND sendt IS NULL AND annulleret IS NULL AND oprettet > $5`,
    [a.id, hashToken(a.token), t.slug, a.ejerKontoId, new Date(a.nu.getTime() - UDKAST_MS).toISOString()]);
  if (!r) return 'ukendt';
  const erstatter = r.erstatter === null || r.erstatter === undefined ? null : Number(r.erstatter);
  const p = await pladser(d, t.slug, a.nu, erstatter);
  if (p.brugt + 1 > p.max) return 'fuld';
  if (!(await taelOp(d.db, createHash('sha256').update(`invitation:${t.slug}`).digest('hex'), INVITATIONER_PR_VINDUE, a.nu))) return 'for-mange';
  try {
    await d.db.transaction(async (tx) => {
      const udloeber = new Date(a.nu.getTime() + INVITATION_DAGE * 86_400_000).toISOString();
      const [sendt] = await tx.query('UPDATE invitation SET sendt = $2, udloeber = $3 WHERE id = $1 AND sendt IS NULL RETURNING id', [a.id, a.nu.toISOString(), udloeber]);
      if (!sendt) throw new Error('allerede sendt');
      if (erstatter !== null) await tx.query('UPDATE invitation SET annulleret = $2 WHERE id = $1 AND annulleret IS NULL AND brugt IS NULL', [erstatter, a.nu.toISOString()]);
      // Inside the transaction: if the provider refuses, nothing is marked sent (never "sent" but not sent).
      await d.post.send({ til: r.email, skabelon: 'invitation', data: invitationData(r, invitationLink(d.publicUrl, a.token as string)) });
    });
  } catch {
    // Deliberately without the error text: a provider error could echo the message, link included.
    console.error('sky konto: en invitation kunne ikke sendes (intet markeret sendt)');
    return 'post-fejl';
  }
  return 'sendt';
}

/** The owner cancels a pending invitation: its link stops working at once. */
export async function annuller(db: Database, a: { ejerKontoId: number; id: number; nu: Date }): Promise<'ok' | 'ikke-ejer' | 'ukendt'> {
  if (!(await ejersTenant(db, a.ejerKontoId))) return 'ikke-ejer';
  const r = await db.query(
    `UPDATE invitation i SET annulleret = $3 FROM flaade.tenant t
      WHERE i.id = $1 AND t.slug = i.tenant_id AND t.ejer_konto_id = $2 AND i.brugt IS NULL AND i.annulleret IS NULL RETURNING i.id`,
    [a.id, a.ejerKontoId, a.nu.toISOString()]);
  return r.length ? 'ok' : 'ukendt';
}

export type InvitationVisning = { id: number; email: string; navn: string; rolle: InviterRolle; udloeber: Date };

/** The household's pending invitations (sent, not used, not cancelled, not expired), oldest first. */
export async function ventendeInvitationer(db: Database, slug: string, nu: Date): Promise<InvitationVisning[]> {
  const r = await db.query<Raekke>(
    `SELECT * FROM invitation WHERE tenant_id = $1 AND sendt IS NOT NULL AND brugt IS NULL AND annulleret IS NULL AND udloeber > $2 ORDER BY id`, [slug, nu.toISOString()]);
  return r.map((x) => ({ id: Number(x.id), email: x.email, navn: x.navn, rolle: x.rolle, udloeber: new Date(x.udloeber) }));
}

/** The owner's name from his last invitation (to prefill the form), or ''. */
export async function sidsteInviterer(db: Database, ejerKontoId: number): Promise<string> {
  const [r] = await db.query<{ inviterer: string }>('SELECT inviterer FROM invitation WHERE inviteret_af = $1 ORDER BY id DESC LIMIT 1', [ejerKontoId]);
  return r?.inviterer ?? '';
}

export type AabenInvitation = { id: number; tenantId: string; email: string; navn: string; rolle: InviterRolle; inviterer: string };

/** A sent invitation still open for its link (reading never spends it; mail scanners only GET). */
export async function findInvitation(db: Database, token: unknown, nu: Date): Promise<AabenInvitation | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [r] = await db.query<Raekke>(
    'SELECT * FROM invitation WHERE hash = $1 AND sendt IS NOT NULL AND brugt IS NULL AND annulleret IS NULL AND udloeber > $2', [hashToken(token), nu.toISOString()]);
  return r ? { id: Number(r.id), tenantId: r.tenant_id, email: r.email, navn: r.navn, rolle: r.rolle, inviterer: r.inviterer } : null;
}
