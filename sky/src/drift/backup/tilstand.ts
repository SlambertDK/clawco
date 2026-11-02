// The backup state in Postgres (KC-0185, migration 0008): per scope the last attempt and success, and every
// snapshot with the manifest taken at backup time; every drill. Only this file writes the drift schema's backup tables (the rollout's are drift/udrulning/tilstand.ts).
import type { Database } from '../../db/pool.ts';
import type { Manifest } from './manifest.ts';

export type KopiRaekke = {
  omfang: string;
  oprettet: Date;
  sidsteForsoeg: Date | null;
  sidsteSucces: Date | null;
  sidsteFejl: string | null;
  snapshot: string | null;
  bytes: number | null;
};

export type Snapshot = { omfang: string; id: string; tid: Date; bytes: number; antalFiler: number; manifest: string; kekVersion: number };

const dato = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string));

export async function noterForsoeg(db: Database, omfang: string, nu: Date): Promise<void> {
  await db.query(
    'INSERT INTO drift.kopi (omfang, oprettet, sidste_forsoeg) VALUES ($1, $2, $2) ON CONFLICT (omfang) DO UPDATE SET sidste_forsoeg = $2',
    [omfang, nu.toISOString()],
  );
}

export async function noterFejl(db: Database, omfang: string, fejl: string, nu: Date): Promise<void> {
  await noterForsoeg(db, omfang, nu);
  await db.query('UPDATE drift.kopi SET sidste_fejl = $2 WHERE omfang = $1', [omfang, fejl.slice(0, 500)]);
}

/** After the object is uploaded: the snapshot row and the scope's last success, in one transaction. */
export async function noterSucces(db: Database, s: { omfang: string; id: string; tid: Date; bytes: number; manifest: Manifest; kekVersion: number }, nu: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await noterForsoeg(tx, s.omfang, nu);
    await tx.query(
      'INSERT INTO drift.snapshot (omfang, id, tid, bytes, antal_filer, manifest, kek_version) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [s.omfang, s.id, s.tid.toISOString(), s.bytes, s.manifest.antal, s.manifest.digest, s.kekVersion],
    );
    await tx.query('UPDATE drift.kopi SET sidste_succes = $2, sidste_fejl = NULL, snapshot = $3, bytes = $4 WHERE omfang = $1', [s.omfang, nu.toISOString(), s.id, s.bytes]);
  });
}

export async function kopiTilstand(db: Database): Promise<Map<string, KopiRaekke>> {
  const rows = await db.query('SELECT omfang, oprettet, sidste_forsoeg, sidste_succes, sidste_fejl, snapshot, bytes FROM drift.kopi');
  return new Map(rows.map((r) => [r['omfang'] as string, {
    omfang: r['omfang'] as string, oprettet: dato(r['oprettet'])!, sidsteForsoeg: dato(r['sidste_forsoeg']), sidsteSucces: dato(r['sidste_succes']),
    sidsteFejl: (r['sidste_fejl'] as string | null) ?? null, snapshot: (r['snapshot'] as string | null) ?? null, bytes: r['bytes'] === null ? null : Number(r['bytes']),
  }]));
}

/** A scope's snapshots, newest first. */
export async function snapshotsFor(db: Database, omfang: string): Promise<Snapshot[]> {
  const rows = await db.query('SELECT omfang, id, tid, bytes, antal_filer, manifest, kek_version FROM drift.snapshot WHERE omfang = $1 ORDER BY tid DESC, id DESC', [omfang]);
  return rows.map((r) => ({
    omfang: r['omfang'] as string, id: r['id'] as string, tid: dato(r['tid'])!, bytes: Number(r['bytes']),
    antalFiler: Number(r['antal_filer']), manifest: r['manifest'] as string, kekVersion: Number(r['kek_version']),
  }));
}

export async function glemSnapshot(db: Database, omfang: string, id: string): Promise<void> {
  await db.query('DELETE FROM drift.snapshot WHERE omfang = $1 AND id = $2', [omfang, id]);
}

/** Every recorded snapshot's bytes together (the R2 free tier check). */
export async function samletBytes(db: Database): Promise<number> {
  const [r] = await db.query<{ n: string | number | null }>('SELECT coalesce(sum(bytes), 0) AS n FROM drift.snapshot');
  return Number(r?.n ?? 0);
}

export type ProeveRaekke = { omfang: string; snapshot: string; startet: Date; slut: Date; ok: boolean; trin: string; fejl: string | null };

export async function noterProeve(db: Database, p: ProeveRaekke): Promise<void> {
  await db.query(
    'INSERT INTO drift.proeve (omfang, snapshot, startet, slut, ok, trin, fejl) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [p.omfang, p.snapshot, p.startet.toISOString(), p.slut.toISOString(), p.ok, p.trin, p.fejl ? p.fejl.slice(0, 500) : null],
  );
}

export async function proeverSiden(db: Database, siden: Date): Promise<ProeveRaekke[]> {
  const rows = await db.query('SELECT omfang, snapshot, startet, slut, ok, trin, fejl FROM drift.proeve WHERE startet >= $1 ORDER BY startet', [siden.toISOString()]);
  return rows.map((r) => ({ omfang: r['omfang'] as string, snapshot: r['snapshot'] as string, startet: dato(r['startet'])!, slut: dato(r['slut'])!, ok: r['ok'] as boolean, trin: r['trin'] as string, fejl: (r['fejl'] as string | null) ?? null }));
}
