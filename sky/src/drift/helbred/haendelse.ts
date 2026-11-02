// The operator's incidents (KC-0189): a plain-text list the public feed shows, written by sky/scripts/haendelse.mjs.
// Automatic incidents are out of scope. The text is published as is, so anything that could name a customer or a
// machine (a tenant slug, an email address, an IP address) or markup is refused before it is stored.
import type { Database } from '../../db/pool.ts';
import { DAG_DAGE } from './historik.ts';

export type Haendelse = { titel: string; tekst: string; start: Date; slut: Date | null };
export type FeedHaendelse = { titel: string; tekst: string; start: string; slut: string | null };

const SLUG = /\bhus-[a-z2-7]{8}\b/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
// IPv4, or IPv6 with :: or at least four groups (so a clock time such as 10:30:00 passes).
const IP = /\b\d{1,3}(\.\d{1,3}){3}\b|[0-9a-f]{0,4}::[0-9a-f]{0,4}|\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/i;
const MARKUP = /[<>]/;
const KONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

/** null when the incident may be published, else why not (in Danish, for the operator). */
export function tjekHaendelse(h: Haendelse): string | null {
  for (const [navn, v, max] of [['titel', h.titel, 120], ['tekst', h.tekst, 2000]] as const) {
    if (!v.trim()) return `${navn} er tom`;
    if (v.length > max) return `${navn} er længere end ${max} tegn`;
    if (SLUG.test(v)) return `${navn} nævner en kundes adresse — skriv uden at nævne kunder`;
    if (EMAIL.test(v)) return `${navn} indeholder en mailadresse`;
    if (IP.test(v)) return `${navn} indeholder en IP-adresse`;
    if (MARKUP.test(v) || KONTROL.test(v)) return `${navn} må kun være almindelig tekst (ingen < > eller kontroltegn)`;
  }
  if (Number.isNaN(h.start.getTime()) || (h.slut && Number.isNaN(h.slut.getTime()))) return 'ugyldigt tidspunkt';
  if (h.slut && h.slut < h.start) return 'slut ligger før start';
  return null;
}

export async function nyHaendelse(db: Database, h: Haendelse, nu: Date): Promise<number> {
  const fejl = tjekHaendelse(h);
  if (fejl) throw new Error(fejl);
  const [r] = await db.query<{ id: number | string }>(
    'INSERT INTO drift.helbred_haendelse (titel, tekst, start, slut, oprettet) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [h.titel.trim(), h.tekst.trim(), h.start.toISOString(), h.slut ? h.slut.toISOString() : null, nu.toISOString()]);
  return Number(r!.id);
}

/** Ends an open incident. false when there is no such open incident. */
export async function afslutHaendelse(db: Database, id: number, slut: Date): Promise<boolean> {
  const r = await db.query('UPDATE drift.helbred_haendelse SET slut = $2 WHERE id = $1 AND slut IS NULL AND start <= $2 RETURNING id', [id, slut.toISOString()]);
  return r.length === 1;
}

/** The operator's own view (with ids, never published). */
export async function alleHaendelser(db: Database): Promise<(Haendelse & { id: number })[]> {
  const rows = await db.query<{ id: number | string; titel: string; tekst: string; start: Date | string; slut: Date | string | null }>(
    'SELECT id, titel, tekst, start, slut FROM drift.helbred_haendelse ORDER BY start DESC, id DESC LIMIT 50');
  return rows.map((r) => ({ id: Number(r.id), titel: r.titel, tekst: r.tekst, start: new Date(r.start), slut: r.slut ? new Date(r.slut) : null }));
}

/** Open incidents and those ended within 90 days, newest first, at most 20; no id. */
export async function haendelserTilFeed(db: Database, nu: Date): Promise<FeedHaendelse[]> {
  const rows = await db.query<{ titel: string; tekst: string; start: Date | string; slut: Date | string | null }>(
    'SELECT titel, tekst, start, slut FROM drift.helbred_haendelse WHERE start <= $1 AND (slut IS NULL OR slut >= $2) ORDER BY (slut IS NULL) DESC, start DESC, id DESC LIMIT 20',
    [nu.toISOString(), new Date(nu.getTime() - DAG_DAGE * 86_400_000).toISOString()]);
  return rows.map((r) => ({ titel: r.titel, tekst: r.tekst, start: new Date(r.start).toISOString(), slut: r.slut ? new Date(r.slut).toISOString() : null }));
}
