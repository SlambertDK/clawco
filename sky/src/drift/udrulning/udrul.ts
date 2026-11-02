// A rollout (KC-0186, spec §2 `drift/`): a release goes to the klar tenants cohort by cohort — intern, kanari,
// alle — a few at a time per node. Per tenant, in this order: its current image and sha are recorded (the rollback
// target; a tenant that does not answer now is skipped, never upgraded into a state nobody can tell from broken), a
// fresh restore point is taken (none → skipped with an ADVARSEL, never upgraded), the gateway shows "Opdaterer, et
// øjeblik", the container is replaced with the release's image id on the same volume, the lager key is delivered
// again, and the tenant counts as upgraded only when its own /health shows the release's sha within 60 s. Anything
// else rolls that tenant back (tilbagerul.ts) and halts the rollout.
//
// Invariant (AGENTS §0 r2; a "Ready" deploy has shipped nothing before): a tenant is `opgraderet` only after its own
// /health showed the expected sha; a rollout never moves past a cohort with an unhealthy tenant (each cohort soaks,
// hold.ts PROEVETID_MS, re-checked on every pass); no upgrade runs without a restore point.
//
// `fremad` is one pass: it does what can be done now and says until when the soak runs. State is in Postgres and
// every step is conditional, so a killed command run again continues: a tenant whose container already runs the
// release and answers is finished without another restart, a taken-but-untouched one starts over.
import { HOLD, GATEWAY_CACHE_MS, PROEVE_FRIST, PROEVETID_MS, kanariMangler, naesteHold, samtidige, type Hold } from './hold.ts';
import { genopretningspunkt, rydGenopretning } from './genopret.ts';
import { medLaas } from './laas.ts';
import { tilbageAlle, tilbagerulTenant } from './tilbagerul.ts';
import {
  afslutTenant, aktivUdrulning, gribTenant, hentUdrulning, noterFra, noterGenopret, opretUdrulning, saetUdrulning, senesteUdrulning,
  standsVed, tenanterI, type TenantTrin, type UdrulTenant, type UdrulTilstand, type Udrulning,
} from './tilstand.ts';
import type { UdrulDeps } from './typer.ts';
import { registrerUdgave, tjekKompatibilitet, ventPaaSha } from './udgave.ts';

export type Pass = { tilstand: UdrulTilstand | null; ventTil: Date | null };
type Udfald = 'opgraderet' | 'sprunget-over' | 'uden-genopret' | 'standset' | 'ingen';

/** Records the release, fills kanari, plans every klar tenant not on the release (in cohort order) and proves the
 *  release can be rolled back from (old-on-new for every image a planned tenant runs) — before any row is made. */
export async function startUdrulning(d: UdrulDeps, tag: string): Promise<{ id: number | null; planlagt: number; kanari: string[] }> {
  const aktiv = await aktivUdrulning(d.db);
  if (aktiv) throw new Error(`udrulning ${aktiv.id} (${aktiv.udgave.tag}) er allerede i gang: fortsaet eller tilbage først`);
  const udgave = await registrerUdgave(d, tag);
  const klare = await d.tenanter.klare();
  const kanari = kanariMangler(klare);
  for (const slug of kanari) await d.tenanter.saetHold(slug, 'kanari');
  const hold = (slug: string, h: Hold): Hold => (kanari.includes(slug) ? 'kanari' : h);
  const plan = klare.filter((t) => t.release !== udgave.sha).map((t) => ({ slug: t.slug, hold: hold(t.slug, t.hold) }));
  if (!plan.length) return { id: null, planlagt: 0, kanari };
  const gamle = new Set<string>();
  for (const t of plan) {
    const b = await d.flaade.beholder(t.slug);
    if (b && b.billede !== udgave.billedeId) gamle.add(b.billede);
  }
  for (const g of gamle) {
    const info = await d.koerer.info(g);
    if (!info) throw new Error('et billede, som en kunde kører nu, findes ikke længere på værten: en tilbagerulning ville ikke kunne starte det');
    await tjekKompatibilitet(d, { id: udgave.billedeId, sha: udgave.sha }, info);
  }
  plan.sort((a, b) => HOLD.indexOf(a.hold) - HOLD.indexOf(b.hold));
  const id = await opretUdrulning(d.db, { udgave: udgave.tag, hold: 'intern', tenanter: plan, nu: d.nu() });
  d.log?.(`udrulning ${id} af ${udgave.tag}: ${plan.length} ${plan.length === 1 ? 'kunde' : 'kunder'} planlagt (${HOLD.map((h) => `${h} ${plan.filter((t) => t.hold === h).length}`).join(', ')})`);
  return { id, planlagt: plan.length, kanari };
}

/** One pass over the active rollout: as far as it can go now. */
export async function fremad(d: UdrulDeps): Promise<Pass> {
  try { await rydGenopretning(d); } catch (err) { d.log?.(`oprydning af gamle genopretningspunkter fejlede: ${(err as Error).name}`); }
  const u = await aktivUdrulning(d.db);
  if (!u) return { tilstand: (await senesteUdrulning(d.db))?.tilstand ?? null, ventTil: null };
  if (u.tilstand === 'standset') return { tilstand: 'standset', ventTil: null };
  return medLaas(d, u.id, async () => {
    if (u.tilstand === 'tilbagerulles') { await tilbageAlle(d, u); return { tilstand: 'tilbagerullet', ventTil: null }; }
    return koer(d, u.id);
  });
}

/** The operator's `fortsaet`: a halted rollout runs again (the failed tenants stay on their previous release). */
export async function fortsaet(d: UdrulDeps): Promise<Pass> {
  const u = await aktivUdrulning(d.db);
  if (u?.tilstand === 'standset') await saetUdrulning(d.db, u.id, ['standset'], { tilstand: 'koerer', grund: null }, d.nu());
  return fremad(d);
}

async function koer(d: UdrulDeps, id: number): Promise<Pass> {
  for (;;) {
    const u = (await hentUdrulning(d.db, id))!;
    if (u.tilstand !== 'koerer') return { tilstand: u.tilstand, ventTil: null };
    const iHold = (await tenanterI(d.db, id)).filter((t) => t.hold === u.hold);
    const aabne = iHold.filter((t) => t.tilstand === 'venter' || t.tilstand === 'igang');
    if (aabne.length) {
      await kohort(d, u, aabne);
      continue;
    }
    const opgraderede = iHold.filter((t) => t.tilstand === 'opgraderet');
    let start = u.holdFaerdig;
    if (opgraderede.length && !start) {
      start = d.nu();
      await saetUdrulning(d.db, id, ['koerer'], { holdFaerdig: start }, d.nu());
    }
    // The soak: every upgraded tenant of the cohort must still answer with the release's sha, on every pass.
    for (const t of opgraderede) {
      const fejl = await ikkeSund(d, t.slug, u.udgave.sha);
      if (fejl) { await rulTilbageOgStands(d, u, t, `ikke sund i prøvetiden: ${fejl}`); return { tilstand: 'standset', ventTil: null }; }
    }
    if (opgraderede.length && start) {
      const slut = new Date(start.getTime() + PROEVETID_MS[u.hold]);
      if (d.nu() < slut) return { tilstand: 'koerer', ventTil: slut };
    }
    const naeste = naesteHold(u.hold);
    if (!naeste) {
      await saetUdrulning(d.db, id, ['koerer'], { tilstand: 'faerdig', slut: d.nu() }, d.nu());
      const alle = await tenanterI(d.db, id);
      d.log?.(`udrulning ${id} af ${u.udgave.tag} færdig: ${alle.filter((t) => t.tilstand === 'opgraderet').length} opdateret, ${alle.filter((t) => t.tilstand !== 'opgraderet').length} ikke`);
      return { tilstand: 'faerdig', ventTil: null };
    }
    await saetUdrulning(d.db, id, ['koerer'], { hold: naeste, holdFaerdig: null }, d.nu());
  }
}

/** The cohort's open tenants, a few at a time on the node; no new one starts once the rollout halted. Waits for every
 *  started tenant before returning (or throwing the first unexpected error), so none is left half-way by this run. */
async function kohort(d: UdrulDeps, u: Udrulning, aabne: UdrulTenant[]): Promise<void> {
  const n = samtidige((await d.tenanter.klare()).length);
  const koe = [...aabne];
  const udfald: Udfald[] = [];
  let standset = false;
  let fejl: unknown = null;
  const arbejder = async () => {
    for (let t = koe.shift(); t && !standset && !fejl; t = koe.shift()) {
      try {
        const r = await opgraderEn(d, u, t);
        udfald.push(r);
        if (r === 'standset') standset = true;
      } catch (err) { fejl ??= err; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, koe.length) }, arbejder));
  const uden = udfald.filter((r) => r === 'uden-genopret').length;
  if (uden) d.log?.(`ADVARSEL: ${uden} ${uden === 1 ? 'kunde' : 'kunder'} sprunget over uden genopretningspunkt (ingen opdatering uden et)`);
  const sprunget = udfald.filter((r) => r === 'sprunget-over').length;
  if (sprunget) d.log?.(`${sprunget} ${sprunget === 1 ? 'kunde' : 'kunder'} sprunget over: svarede ikke før opdateringen`);
  if (fejl) throw fejl;
}

async function opgraderEn(d: UdrulDeps, u: Udrulning, t: UdrulTenant): Promise<Udfald> {
  const { slug } = t;
  const maal = u.udgave;
  const afslut = (til: TenantTrin, fejl: string | null = null) => afslutTenant(d.db, u.id, slug, ['igang'], til, d.nu(), fejl);
  if (t.tilstand === 'venter' && !(await gribTenant(d.db, u.id, slug, d.nu()))) return 'ingen';
  const b = await d.flaade.beholder(slug);
  let fra = t.fraBillede && t.fraSha ? { billede: t.fraBillede, sha: t.fraSha } : null;
  if (!fra) {
    const s = b ? await d.sundhed(b.adresse) : { ok: false, sha: null };
    if (!b || !s.ok || !s.sha) { await afslut('sprunget-over', 'svarede ikke før opdateringen'); return 'sprunget-over'; }
    if (s.sha === maal.sha) { await afslut('opgraderet', 'kørte allerede udgaven'); return 'opgraderet'; }
    fra = { billede: b.billede, sha: s.sha };
    await noterFra(d.db, u.id, slug, fra);
  } else if (b && b.billede === maal.billedeId && t.genopret) {
    // Resumed after a kill: already replaced. Finish it without a second restart when it answers as it should.
    const s = await d.sundhed(b.adresse);
    if (s.ok && s.sha === maal.sha) { await faerdig(d, u, slug, b.adresse); return 'opgraderet'; }
  }
  if (!t.genopret) {
    try {
      const p = await genopretningspunkt(d, slug);
      await noterGenopret(d.db, u.id, slug, p);
    } catch (err) {
      await afslut('sprunget-over', `intet genopretningspunkt: ${(err as Error).message}`);
      return 'uden-genopret';
    }
  }
  await d.tenanter.opdateres(slug, true);
  await d.vent(GATEWAY_CACHE_MS);
  let adresse: string;
  try {
    const k = await d.flaade.opgrader({ id: slug, billede: maal.billedeId });
    await d.noegler.lever(slug, k.container);
    await ventPaaSha(d, k.adresse, maal.sha);
    adresse = k.adresse;
  } catch (err) {
    await rulTilbageOgStands(d, u, { ...t, fraBillede: fra.billede, fraSha: fra.sha }, `opdateringen fejlede: ${(err as Error).message}`);
    return 'standset';
  }
  await faerdig(d, u, slug, adresse);
  return 'opgraderet';
}

/** The route follows the new container; after the gateway's cache has seen it, the update page goes. */
async function faerdig(d: UdrulDeps, u: Udrulning, slug: string, adresse: string): Promise<void> {
  await d.tenanter.noterKoersel(slug, { billede: u.udgave.billedeId, release: u.udgave.sha, adresse });
  await d.vent(GATEWAY_CACHE_MS);
  await d.tenanter.opdateres(slug, false);
  await afslutTenant(d.db, u.id, slug, ['igang'], 'opgraderet', d.nu());
}

/** null when the tenant answers with `sha` (a few tries), else what was wrong. */
async function ikkeSund(d: UdrulDeps, slug: string, sha: string): Promise<string | null> {
  const b = await d.flaade.beholder(slug);
  if (!b) return 'beholderen kører ikke';
  try { await ventPaaSha(d, b.adresse, sha, PROEVE_FRIST); return null; } catch (err) { return (err as Error).message; }
}

async function rulTilbageOgStands(d: UdrulDeps, u: Udrulning, t: UdrulTenant, grund: string): Promise<void> {
  if (!t.fraBillede || !t.fraSha) { await standsVed(d.db, u.id, t.slug, 'fejlet', `${grund}; intet at rulle tilbage til`, d.nu()); return; }
  try {
    await tilbagerulTenant(d, t.slug, { billede: t.fraBillede, sha: t.fraSha });
    await standsVed(d.db, u.id, t.slug, 'tilbagerullet', grund, d.nu());
    d.log?.(`udrulning ${u.id} standset: ${t.slug} er rullet tilbage til ${t.fraSha} (${grund.slice(0, 200)})`);
  } catch (err) {
    await standsVed(d.db, u.id, t.slug, 'fejlet', `${grund}; tilbagerulning fejlede: ${(err as Error).message}`, d.nu());
    // Never a stuck "Opdaterer" page over a tenant that is down: the gateway's normal error shows instead.
    await d.tenanter.opdateres(t.slug, false).catch(() => {});
    d.log?.('ADVARSEL: 1 kunde kunne ikke rulles tilbage og svarer ikke — se udrul.ts status');
  }
}

export type Status = {
  udrulning: Udrulning | null;
  antal: Record<Hold, Partial<Record<TenantTrin, number>>>;
  problemer: { slug: string; tilstand: TenantTrin; fejl: string | null }[];
  ventTil: Date | null;
};

export async function udrulStatus(d: Pick<UdrulDeps, 'db' | 'nu'>): Promise<Status> {
  const u = (await aktivUdrulning(d.db)) ?? (await senesteUdrulning(d.db));
  const antal: Status['antal'] = { intern: {}, kanari: {}, alle: {} };
  if (!u) return { udrulning: null, antal, problemer: [], ventTil: null };
  const rows = await tenanterI(d.db, u.id);
  for (const t of rows) antal[t.hold][t.tilstand] = (antal[t.hold][t.tilstand] ?? 0) + 1;
  const problemer = rows.filter((t) => t.tilstand === 'tilbagerullet' || t.tilstand === 'fejlet' || t.tilstand === 'sprunget-over').map((t) => ({ slug: t.slug, tilstand: t.tilstand, fejl: t.fejl }));
  const slut = u.tilstand === 'koerer' && u.holdFaerdig ? new Date(u.holdFaerdig.getTime() + PROEVETID_MS[u.hold]) : null;
  return { udrulning: u, antal, problemer, ventTil: slut && slut > d.nu() ? slut : null };
}
