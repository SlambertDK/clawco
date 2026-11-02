// A release (KC-0186): a local tenant image tag (clawco:<sha>, built on the host by the operator, sky/deploy/README.md)
// recorded with the image id it points at and the git sha baked into it. Tenants run the id, never the tag. Before a
// rollout the release must prove that a rollback works (AGENTS §0 r1): the new image on a fresh scratch disk, then the
// previous image on that same disk, each until its own /health shows its own sha.
import { gemUdgave, type Udgave } from './tilstand.ts';
import { SUND_FRIST } from './hold.ts';
import type { UdrulDeps } from './typer.ts';

const TAG = /^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$/;

export async function registrerUdgave(d: Pick<UdrulDeps, 'db' | 'koerer' | 'nu'>, tag: string): Promise<Udgave> {
  if (!TAG.test(tag)) throw new Error('ugyldigt tag: skal være navn:tag, fx clawco:<sha>');
  const info = await d.koerer.info(tag);
  if (!info) throw new Error(`billedet ${tag} findes ikke på værten: byg det først (sky/deploy/README.md, Udrulning)`);
  return gemUdgave(d.db, { tag, sha: info.sha, billedeId: info.id }, d.nu());
}

/** Waits until <adresse>/health answers ok with `sha`; throws naming what it saw instead. */
export async function ventPaaSha(d: Pick<UdrulDeps, 'sundhed' | 'vent'>, adresse: string, sha: string, frist: { forsoeg: number; ms: number } = SUND_FRIST): Promise<void> {
  let sidst: { ok: boolean; sha: string | null } = { ok: false, sha: null };
  for (let i = 0; i < frist.forsoeg; i++) {
    sidst = await d.sundhed(adresse);
    if (sidst.ok && sidst.sha === sha) return;
    if (i < frist.forsoeg - 1) await d.vent(frist.ms);
  }
  const saa = sidst.ok ? `versionen ${sidst.sha ?? 'uden sha'}` : 'intet svar';
  throw new Error(`/health viste ${saa} i stedet for ${sha} inden for ${Math.round((frist.forsoeg * frist.ms) / 1000)} s`);
}

export async function tjekKompatibilitet(d: Pick<UdrulDeps, 'koerer' | 'sundhed' | 'vent'>, ny: { id: string; sha: string }, gammel: { id: string; sha: string }): Promise<void> {
  const k = d.koerer;
  const disk = await k.nyDisk(ny.id);
  let navn: string | null = null;
  let fejl: Error | null = null;
  try {
    try {
      const a = await k.start(ny.id, disk);
      navn = a.navn;
      await ventPaaSha(d, a.adresse, ny.sha);
    } catch (err) { throw new Error(`den nye udgave starter ikke på en ny disk: ${(err as Error).message}`); }
    await k.stop(navn);
    try {
      const b = await k.start(gammel.id, disk);
      navn = b.navn;
      await ventPaaSha(d, b.adresse, gammel.sha);
    } catch (err) {
      throw new Error(`udgaven kan ikke rulles tilbage: den forrige udgave (${gammel.sha}) starter ikke på data skrevet af ${ny.sha}: ${(err as Error).message}`);
    }
    await k.stop(navn);
  } catch (err) {
    fejl = err as Error;
  }
  // The check's own reason is what the operator needs; a cleanup failure is added to it, never put in its place.
  try {
    if (navn) await k.stop(navn).catch(() => {});
    await k.fjernDisk(disk);
  } catch (err) {
    if (!fejl) throw err;
    throw new Error(`${fejl.message}; oprydningen fejlede: ${(err as Error).message}`);
  }
  if (fejl) throw fejl;
}
