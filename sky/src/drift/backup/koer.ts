// One copy, and one night's run (KC-0185, spec §2 `drift/`). A tenant: its volume read through the node
// (mounted read-only — the tenant's JSON files are written atomically, AGENTS §4 r5, so a file-level copy of a
// running tenant is consistent; nothing is excluded, hemmeligheder.enc is in it, encrypted twice), its
// manifest taken, gzip'd, sealed under its own `backup` key and uploaded. Sky's database: pg_dump sealed under
// the master-derived dump key. Order is the invariant: upload, then record, then (only after that success)
// prune copies older than 30 days — a failed run never deletes anything.
import { createHash, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { forsegl } from './krypto.ts';
import { manifestFraTar, type Manifest } from './manifest.ts';
import { purgeSlettet, snapshotId, snapshotTid, udloebne } from './opbevaring.ts';
import { forsinkede, levendeOmfang, naerGratisGraense, skyldige, type Omfang } from './planlaeg.ts';
import { glemSnapshot, kopiTilstand, noterFejl, noterForsoeg, noterSucces, samletBytes } from './tilstand.ts';
import type { KopiDeps } from './typer.ts';

export const DB = 'db';

export function praefiks(omfang: string): string {
  return omfang === DB ? 'db/' : `tenant/${omfang}/`;
}

export function objektNoegle(omfang: string, id: string): string {
  return `${praefiks(omfang)}${id}.ckb`;
}

export type Kopi = { id: string; bytes: number; manifest: Manifest };

const tilfaeldig = (d: KopiDeps) => (d.tilfaeldig ?? (() => randomBytes(4).toString('hex')))();

/** Deletes a scope's copies older than 30 days (never the newest): object first, then its row. Returns how many. */
async function beskaer(d: KopiDeps, omfang: string): Promise<number> {
  const ids = (await d.lager.liste(praefiks(omfang))).map((o) => o.noegle.slice(praefiks(omfang).length).replace(/\.ckb$/, ''));
  return slet(d, omfang, udloebne(ids, d.nu()));
}

async function slet(d: KopiDeps, omfang: string, ids: string[]): Promise<number> {
  for (const id of ids) {
    await d.lager.slet(objektNoegle(omfang, id));
    await glemSnapshot(d.db, omfang, id);
  }
  return ids.length;
}

async function gem(d: KopiDeps, omfang: string, lav: (id: string) => Promise<{ blob: Buffer; manifest: Manifest; kekVersion: number }>): Promise<Kopi> {
  const nu = d.nu();
  await noterForsoeg(d.db, omfang, nu);
  let kopi: Kopi;
  try {
    const id = snapshotId(nu, tilfaeldig(d));
    const { blob, manifest, kekVersion } = await lav(id);
    await d.lager.put(objektNoegle(omfang, id), blob);
    await noterSucces(d.db, { omfang, id, tid: snapshotTid(id)!, bytes: blob.length, manifest, kekVersion }, nu);
    kopi = { id, bytes: blob.length, manifest };
  } catch (err) {
    await noterFejl(d.db, omfang, (err as Error).message, nu);
    throw err;
  }
  // Pruning is after the success is recorded; a failure here leaves extra copies, never fewer.
  try { await beskaer(d, omfang); } catch (err) { d.log?.(`oprydning efter en kopi fejlede: ${(err as Error).name}`); }
  return kopi;
}

/** One tenant's sealed copy `id`: its volume's tar (read-only), its manifest, gzip, sealed under its own backup key.
 *  Shared by the nightly copy and an upgrade's restore point (KC-0186), so both are the same bytes. */
export async function forseglTenant(d: { node: Pick<KopiDeps['node'], 'pak'>; noegler: Pick<KopiDeps['noegler'], 'tenant'> }, slug: string, id: string): Promise<{ blob: Buffer; manifest: Manifest }> {
  const tar = await d.node.pak(slug);
  const manifest = manifestFraTar(tar);
  const noegle = await d.noegler.tenant(slug);
  try {
    return { blob: forsegl(noegle, { omfang: slug, id }, gzipSync(tar)), manifest };
  } finally { noegle.oedelaeg(); }
}

export async function kopierTenant(d: KopiDeps, slug: string): Promise<Kopi> {
  return gem(d, slug, async (id) => ({ ...(await forseglTenant(d, slug, id)), kekVersion: 0 }));
}

export async function kopierDb(d: KopiDeps): Promise<Kopi> {
  if (!d.dump) throw new Error('ingen pg_dump på denne vært: databasen kopieres ikke');
  const dump = d.dump;
  return gem(d, DB, async (id) => {
    const data = await dump.dump();
    const manifest = { antal: 1, digest: createHash('sha256').update(data).digest('hex') };
    const { version, noegle } = d.noegler.db();
    return { blob: forsegl(noegle, { omfang: DB, id }, gzipSync(data), version), manifest, kekVersion: version };
  });
}

export type NatResultat = { ok: number; fejlede: number; purget: number; forsinkede: number; bytes: number };

/** One pass: every due scope (live tenants and the database), then deleted tenants' purge, then the alerts. */
export async function koerNat(d: KopiDeps): Promise<NatResultat> {
  const log = d.log ?? (() => {});
  const nu = d.nu();
  const tenanter = await d.tenanter();
  const tilstand = await kopiTilstand(d.db);
  const omfang: Omfang[] = levendeOmfang(tenanter);
  omfang.push({ omfang: DB, siden: tilstand.get(DB)?.oprettet ?? nu });
  const r: NatResultat = { ok: 0, fejlede: 0, purget: 0, forsinkede: 0, bytes: 0 };
  for (const o of skyldige(omfang, tilstand, nu)) {
    try {
      if (o === DB) await kopierDb(d); else await kopierTenant(d, o);
      r.ok++;
    } catch { r.fejlede++; } // recorded on the scope's row; the others still run
  }
  for (const k of await d.slettedeNoegler()) {
    const ids = (await d.lager.liste(praefiks(k.tenant))).map((o) => o.noegle.slice(praefiks(k.tenant).length).replace(/\.ckb$/, ''));
    const ud = purgeSlettet(ids, k, nu);
    if (ud.length) { await slet(d, k.tenant, ud); r.purget++; }
  }
  r.forsinkede = forsinkede(omfang, await kopiTilstand(d.db), d.nu());
  r.bytes = await samletBytes(d.db);
  if (r.ok || r.fejlede) log(`sikkerhedskopier: ${r.ok} ok, ${r.fejlede} fejlede`);
  if (r.purget) log(`sikkerhedskopier: kopierne af ${r.purget} slettede ${r.purget === 1 ? 'kunde' : 'kunder'} slettet efter 30 dage`);
  // KC-0187 (the alert channel) is not built yet: the condition is a function and a log line, counts only.
  if (r.forsinkede) log(`ADVARSEL: ${r.forsinkede} ${r.forsinkede === 1 ? 'sikkerhedskopi' : 'sikkerhedskopier'} uden succes i over 36 timer`);
  if (naerGratisGraense(r.bytes)) log(`ADVARSEL: kopierne fylder ${Math.round(r.bytes / 1e9)} GB af R2's gratis 10 GB — opdater omkostningslisten`);
  return r;
}
