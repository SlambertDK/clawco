// Restore (KC-0185): a chosen copy (default: the newest) is fetched, opened with the tenant's own key, checked
// against the manifest taken at backup time, unpacked into a NEW volume and started in a NEW container from
// the same image (clawco-g-<tenant>-<8 hex>). The tenant's own volume and container are never written: the
// node seam has no call that could. Moving the tenant's gateway route onto the restored container (the owner's
// "Gendan til i går") is a follow-up; a deleted tenant is restored only by Henrik's explicit action (the
// script), and only until its key's purge date — after that the key is gone and nothing opens.
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { aabn, kekVersion } from './krypto.ts';
import { manifestFraTar, type Manifest } from './manifest.ts';
import { DB, objektNoegle, praefiks } from './koer.ts';
import { snapshotTid } from './opbevaring.ts';
import { snapshotsFor } from './tilstand.ts';
import type { KopiDeps } from './typer.ts';

export type Trin = 'start' | 'hentet' | 'aabnet' | 'manifest' | 'gendannet' | 'sund' | 'sammenlignet';
export type Gendannet = { navn: string; adresse: string; snapshot: string; manifest: Manifest };

export function nytNavn(art: 'g' | 'p', slug: string, tilfaeldig: string): string {
  if (!/^[0-9a-f]{8}$/.test(tilfaeldig)) throw new Error('et navn slutter med 8 hex-tegn');
  return `clawco-${art}-${slug}-${tilfaeldig}`;
}

/** The snapshot to use and the manifest recorded for it (null when only the object is known). */
export async function vaelgSnapshot(d: KopiDeps, slug: string, id?: string): Promise<{ id: string; manifest: string | null }> {
  const rows = await snapshotsFor(d.db, slug);
  if (id !== undefined) {
    if (!snapshotTid(id)) throw new Error('ugyldigt snapshot-id');
    return { id, manifest: rows.find((r) => r.id === id)?.manifest ?? null };
  }
  if (rows[0]) return { id: rows[0].id, manifest: rows[0].manifest };
  const ids = (await d.lager.liste(praefiks(slug))).map((o) => o.noegle.slice(praefiks(slug).length).replace(/\.ckb$/, '')).filter((x) => snapshotTid(x)).sort();
  const nyeste = ids.at(-1);
  if (!nyeste) throw new Error('der er ingen kopi af denne kunde');
  return { id: nyeste, manifest: null };
}

/** Fetches, opens and checks one copy; `trin` is told each step reached. */
export async function hentTar(d: KopiDeps, slug: string, valg: { id: string; manifest: string | null }, trin: (t: Trin) => void = () => {}): Promise<{ tar: Buffer; manifest: Manifest }> {
  const blob = await d.lager.hent(objektNoegle(slug, valg.id));
  if (!blob) throw new Error('der er ingen kopi med det id');
  trin('hentet');
  const noegle = await d.noegler.tenant(slug);
  let tar: Buffer;
  try { tar = gunzipSync(aabn(noegle, { omfang: slug, id: valg.id }, blob)); } finally { noegle.oedelaeg(); }
  trin('aabnet');
  const manifest = manifestFraTar(tar);
  if (valg.manifest !== null && manifest.digest !== valg.manifest) throw new Error('kopiens filer passer ikke med manifestet fra kopieringen');
  trin('manifest');
  return { tar, manifest };
}

export async function gendan(d: KopiDeps & { art?: 'g' | 'p' }, slug: string, id?: string, trin: (t: Trin) => void = () => {}): Promise<Gendannet> {
  const valg = await vaelgSnapshot(d, slug, id);
  const { tar, manifest } = await hentTar(d, slug, valg, trin);
  const navn = nytNavn(d.art ?? 'g', slug, (d.tilfaeldig ?? (() => randomBytes(4).toString('hex')))());
  try {
    await d.node.udpak(navn, slug, tar);
    const { adresse } = await d.node.start(navn, slug);
    trin('gendannet');
    return { navn, adresse, snapshot: valg.id, manifest };
  } catch (err) {
    await d.node.fjern(navn).catch(() => {});
    throw err;
  }
}

/** Sky's database dump `id` (default: the newest), opened under the master-key version it was sealed with and
 *  checked against the digest recorded at backup time. */
export async function aabnDbDump(d: KopiDeps, id?: string, trin: (t: Trin) => void = () => {}): Promise<{ id: string; dump: Buffer }> {
  const rows = await snapshotsFor(d.db, DB);
  const s = id === undefined ? rows[0] : rows.find((r) => r.id === id);
  if (!s) throw new Error('der er ingen kopi af databasen med det id');
  const blob = await d.lager.hent(objektNoegle(DB, s.id));
  if (!blob) throw new Error('kopien findes ikke i lageret');
  trin('hentet');
  const dump = gunzipSync(aabn(d.noegler.db(kekVersion(blob)).noegle, { omfang: DB, id: s.id }, blob));
  trin('aabnet');
  if (createHash('sha256').update(dump).digest('hex') !== s.manifest) throw new Error('dumpet passer ikke med sin kontrolsum');
  trin('manifest');
  return { id: s.id, dump };
}
