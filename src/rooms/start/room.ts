// The Start room (KC-0126, spec §3): the journey from a fresh install, one card
// per step. It shows while the journey is not Done and afterwards only when a
// source is worth adding; Done is latched in its state, so an empty Nu later
// does not bring onboarding back. What it reads of the rest of the app comes
// through RoomDeps.rejse (the composition root), the profile through
// RoomDeps.profil.

import type { RoomDeps, RoomModule, RoomView } from '../module.ts';
import { ActionError } from '../module.ts';
import type { DoneResult, RunRecord } from '../../runs.ts';
import { synligFor } from '../../identitet/zoner.ts';
import { kan } from '../../identitet/roller.ts';
import { ENEBRUGER } from '../../identitet/identitet.ts';
import { parseStartState, ProfilFejl, validerProfil, type Forslag, type Profil, type StartModel, type StartState } from './schema.ts';
import { alleTrin, NIVEAUER, PAKKE_KILDER, trinStatus, utenPakke, type ModelSyn, type Niveau, type TrinKontekst } from './trin.ts';
import { erRejsenFaerdig } from './rejsen.ts';
import { foreslaaTilfoejelse } from './forslag.ts';
import { renderStart, sek, testTekst, type StartVisning } from './render.ts';
import { ventendeForslag } from './regelforslag.ts';
import { buildStartChatRun, KORSEL } from './prompt.ts';
import { envVaerdi, hentModelNavne, UDBYDERE, udbyderAf } from './udbydere.ts';
import { modelFejlArt, type ModelFejlArt } from './modelfejl.ts';
import { MODEL_TEST } from '../../agent/prompt.ts';
import type { AgentStatus } from '../../agent/types.ts';
import { kildeKontekst, kildeVisning, springOver } from './vaerdi.ts';
import type { KildeVisning } from './kilderender.ts';
import { flereKilderKoe } from './trin.ts';
import { IMPORT_AKTIONER, erImportLabel, importAktion, importFortryd, importKvitteringer, rydGamleUploads, type Hjaelp as ImportHjaelp } from './import/handlinger.ts';
import type { ImportVisning } from './import/render.ts';
import { visTailscaleKort } from './tailscalekort.ts';
import { TsFejl } from '../../shell/tailscale.ts';
import { STANDARD_SPROG, tekst } from '../../shell/tekster.ts';
import { startTekst } from './tekster.ts';

const RUM = 'start';
/** How long worked-out suggestions are kept before the sources are asked again. */
const FORSLAG_GYLDIG_MS = 15 * 60_000;

const ny = (nu: Date): StartState => ({ startet: nu.toISOString(), trin: {}, afvist: {} });
const laesState = async (deps: RoomDeps): Promise<StartState | null> => parseStartState(await deps.store.readState(RUM));

/** The profile, or null — also when the file cannot be read (step 1 is then open again; nothing is overwritten unasked). */
async function profilAf(deps: RoomDeps): Promise<Profil | null> {
  try { return (await deps.profil?.laes()) ?? null; } catch (err) {
    if (err instanceof ProfilFejl) return null;
    throw err;
  }
}

/** Suggestions now: the cached ones while fresh (less what was dismissed), else asked again; cached only once Start has a state. */
async function forslagAf(deps: RoomDeps, s: StartState | null): Promise<Forslag[]> {
  if (!deps.rejse) return [];
  const nu = deps.now();
  if (s?.forslag && nu.getTime() - Date.parse(s.forslag.tid) < FORSLAG_GYLDIG_MS) return s.forslag.liste.filter((f) => !s.afvist[f.kildeId]);
  let kilder;
  try { kilder = utenPakke(await deps.rejse.kilder()); } catch { return []; } // a registry that cannot be read suggests nothing (fail closed); the Danmark-pakke's sources have their own group (KC-0236)
  const liste = await foreslaaTilfoejelse({ kilder, mail: () => deps.rejse!.mail(), nu, afvist: s?.afvist ?? {} });
  if (s) await deps.store.writeState(RUM, { ...s, forslag: { tid: nu.toISOString(), liste } });
  return liste;
}

// One chain per store for the writes that must happen once even when two requests race (the Done line, a rule from a Ja).
const kaeder = new WeakMap<object, Promise<unknown>>();
function enAdGangen<T>(deps: RoomDeps, fn: () => Promise<T>): Promise<T> {
  const foer = kaeder.get(deps.store) ?? Promise.resolve();
  const nu = foer.then(fn, fn);
  kaeder.set(deps.store, nu.catch(() => undefined));
  return nu;
}

/** Writes the Done latch and its one log line, unless another request already did. */
const laasFaerdig = (deps: RoomDeps): Promise<StartState> => enAdGangen(deps, async () => {
  const nyeste = await laesState(deps);
  if (nyeste?.faerdig) return nyeste;
  const laast = { ...(nyeste ?? ny(deps.now())), faerdig: deps.now().toISOString() };
  await deps.store.writeState(RUM, laast);
  await deps.store.appendLog(RUM, { kilde: 'system', zone: KORSEL, tekst: startTekst().akt.rejsenGennemfoert }); // KC-0130
  return laast;
});

/**
 * Whether the journey is Done (latched the first time it is), and the sources worth adding now. Done is derived
 * (spec §3): an element in Nu and a Ret / Ikke relevant — what Nu's own record says, or step 6's recorded first one.
 */
export async function rejsen(deps: RoomDeps): Promise<{ faerdig: boolean; forslag: Forslag[] }> {
  let s = await laesState(deps);
  if (!s?.faerdig && deps.rejse) {
    const input = await deps.rejse.faerdigInput();
    if (erRejsenFaerdig({ ...input, rettet: input.rettet || Boolean(s?.ret) })) s = await laasFaerdig(deps);
  }
  return { faerdig: Boolean(s?.faerdig), forslag: await forslagAf(deps, s) };
}

/** First run: Start has no state yet and the journey is not Done. GET / then lands in Start. */
export async function erFoersteGang(deps: RoomDeps): Promise<boolean> {
  if (await laesState(deps)) return false;
  return !(await rejsen(deps)).faerdig;
}

async function trinNu(deps: RoomDeps, s: StartState | null) {
  const model = await deps.model?.laes();
  const ctx: TrinKontekst = { profil: await profilAf(deps), ...(model ? { model } : {}), ...(await kildeKontekst(deps)) };
  return { ctx, trin: alleTrin().map((t) => ({ trin: t, status: trinStatus(t, s, ctx) })) };
}

async function aabneObligatoriske(deps: RoomDeps): Promise<string[]> {
  if ((await rejsen(deps)).faerdig) return [];
  const { trin } = await trinNu(deps, await laesState(deps));
  return trin.filter((x) => x.trin.krav === 'obligatorisk' && x.status !== 'klaret').map((x) => x.trin.titel);
}

/** Step 6's view: what Nu has to point at (asked only while the step is open), the recorded Ret, the rule proposals waiting for an answer (the ones Nu shows). */
async function foersteRetSyn(deps: RoomDeps, s: StartState): Promise<NonNullable<StartVisning['foersteRet']>> {
  let punkt: { titel: string | null } | null = null;
  if (!s.ret && deps.rejse) {
    const nuInput = await deps.rejse.faerdigInput().catch(() => null);
    if (nuInput && nuInput.nuElementer >= 1) punkt = { titel: (await deps.rejse.foersteKort?.().catch(() => null))?.titel ?? null };
  }
  const forslag = await ventendeForslag(deps, s);
  return { punkt, ...(s.ret ? { ret: s.ret } : {}), ...(forslag.length ? { forslag } : {}), kanSpringeOver: kan(deps.person.rolle, 'aendre-indstillinger') };
}

/** KC-0129: step 5's card data — a vault to write into, who reads the text, the pile, what was saved. Nothing without the writer seam. */
async function importSyn(deps: RoomDeps, s: StartState, model: ModelSyn | undefined): Promise<{ import: ImportVisning } | Record<string, never>> {
  const skriver = deps.importSkriver;
  if (!skriver) return {};
  const u = model?.udbyder ? udbyderAf(model.udbyder) : undefined;
  return { import: {
    klar: await skriver.klar().catch(() => false), kanLavMappe: Boolean(skriver.lavMappe), udbyder: u ? { navn: startTekst().udbyderNavn(u), lokal: !u.kraeverNoegle } : null,
    ...(s.import?.bunke ? { bunke: s.import.bunke } : {}), gemt: s.import?.gemt ?? [],
    laeser: deps.runs.igang(RUM).some((r) => erImportLabel(r.label)), kanGemme: kan(deps.person.rolle, 'aendre-indstillinger'),
  } };
}

/** KC-0161: the Tailscale card's data — the CLI's state now, shown only while it is relevant (tailscalekort.ts visTailscaleKort). */
async function tailscaleSyn(deps: RoomDeps, faerdig: boolean): Promise<Pick<StartVisning, 'tailscale'>> {
  const syn = await deps.tailscale?.laes().catch(() => null);
  if (!syn || !visTailscaleKort(syn, faerdig)) return {};
  return { tailscale: { syn, kanDele: kan(deps.person.rolle, 'aendre-indstillinger') } };
}

/** KC-0233: the Danmark-pakke step's data — shown only while the window says it is open (never an error on Start). */
async function digitalPostSyn(deps: RoomDeps): Promise<Pick<StartVisning, 'digitalPost'>> {
  const syn = await deps.danmark?.start().catch(() => null);
  return syn ? { digitalPost: { ...syn, kanGemme: kan(deps.person.rolle, 'aendre-indstillinger') } } : {};
}

/**
 * KC-0236: Aula's card in the Danmark-pakke group — the owner's (the one who connects), while no Aula source is connected and
 * the card was not put away less than 30 days ago. Without the window (no data folder) there is no card: nowhere to keep "Ikke nu".
 */
async function aulaSyn(deps: RoomDeps, kilder: KildeVisning | undefined): Promise<Pick<StartVisning, 'aula'>> {
  if (!deps.danmark || !kilder?.kanForbinde) return {};
  const k = kilder.kort.find((x) => PAKKE_KILDER.includes(x.id));
  if (!k || k.forbundet) return {};
  if (await deps.danmark.aulaUdsat().catch(() => false)) return {};
  return { aula: { kort: k, ...(kilder.laptop ? { laptop: true as const } : {}) } };
}

async function view(deps: RoomDeps): Promise<RoomView> {
  let s = await laesState(deps);
  if (!s) { s = ny(deps.now()); await deps.store.writeState(RUM, s); } // the first visit: the journey has begun
  const { faerdig, forslag } = await rejsen(deps);
  s = (await laesState(deps)) ?? s;
  const { ctx, trin: alle } = await trinNu(deps, s);
  // KC-0128: step 4 is relevant only once the first source works (KC-0052: absent before, not greyed out).
  // KC-0129: step 5 follows the same rule (and stays once it has been done).
  const foersteKlaret = alle.some((y) => y.trin.id === 'foerste-kilde' && y.status === 'klaret');
  const trin = alle.filter((x) => (x.trin.id !== 'flere-kilder' && x.trin.id !== 'import') || foersteKlaret || (x.trin.id === 'import' && x.status === 'klaret'));
  const kilder = await kildeVisning(deps, s, ctx);
  // One count for the nav and the room (KC-0093): open mandatory steps until the journey is Done.
  const venter = faerdig ? 0 : trin.filter((x) => x.trin.krav === 'obligatorisk' && x.status !== 'klaret').length;
  const p = deps.person;
  const log = (await deps.store.readLog(RUM, 20)).filter((e) => synligFor(p, e));
  // KC-0127: the agent is asked only while step 2 is open (a health check per page otherwise).
  const modelAaben = trin.some((x) => x.trin.id === 'model' && x.status !== 'klaret');
  const agent: AgentStatus = ctx.model && modelAaben ? await deps.hermes.status() : 'klar';
  // KC-0263: the GitHub sign-in beside the built-in agent (a store read, no network).
  const github = ctx.model && deps.hermes.mode === 'direkte' && deps.model?.github ? await deps.model.github.status().catch(() => undefined) : undefined;
  return {
    main: renderStart({
      foersteRet: await foersteRetSyn(deps, s),
      ...(await importSyn(deps, s, ctx.model)),
      ...(await tailscaleSyn(deps, faerdig)),
      ...(await digitalPostSyn(deps)),
      ...(await aulaSyn(deps, kilder)),
      ...(deps.laptop?.() ? { laptop: true } : {}),
      trin, profil: ctx.profil, forslag, log, now: deps.now(), igang: deps.runs.igang(RUM), venter,
      standardNavn: p.rolle === 'ejer' && p.id !== ENEBRUGER.id ? p.navn : '',
      kanGemme: kan(p.rolle, 'aendre-indstillinger') && Boolean(deps.profil),
      ...(ctx.model ? { model: { syn: ctx.model, agent, ...(s.model ? { gemt: s.model } : {}), kanGemme: kan(p.rolle, 'aendre-indstillinger'), ...(deps.hermes.mode === 'direkte' ? { direkte: true } : {}), ...(github ? { github } : {}) } } : {}),
      ...(kilder ? { kilder } : {}),
    }),
    hermesStatus: tekst().klar,
  };
}

async function faerdigt(deps: RoomDeps, text: string): Promise<DoneResult> {
  deps.live.notify(RUM);
  return { html: String((await view(deps)).main), text };
}

const str = (v: unknown, maks: number): string => (typeof v === 'string' ? v.trim().slice(0, maks) : '');

/** KC-0129: what the import's handlings need of this file (they import nothing from it). */
const importHjaelp: ImportHjaelp = { laesState, ny, enAdGangen, faerdigt, korsel: KORSEL };

async function startAction(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null> {
  const p = deps.person;
  const T = startTekst();
  const A = T.akt;
  if (name === 'velkommen-gem') {
    if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError(A.kunEjerenGemmerProfil);
    const lager = deps.profil;
    if (!lager) throw new ActionError(A.ingenDatamappeProfil);
    let profil: Profil;
    try { profil = validerProfil(body); } catch (err) {
      if (err instanceof ProfilFejl) throw new ActionError(err.message);
      throw err;
    }
    return deps.runs.local('gem', async () => {
      const forrige = await lager.laes().catch(() => null);
      await lager.skriv(profil);
      const s = (await laesState(deps)) ?? ny(deps.now());
      await deps.store.writeState(RUM, { ...s, trin: { ...s.trin, velkommen: { status: 'klaret', tid: deps.now().toISOString() } } });
      // AGENTS §1: the undo restores the previous profile (none = back to no profile).
      await deps.store.appendLog(RUM, {
        kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: 'velkommen-gem', fortryd: `lokal:${JSON.stringify({ forrige })}`,
        tekst: A.gemteProfil(profil.navn, profil.sprog, deps.laptop?.() ? null : profil.husstand), // KC-0160: no household wording in laptop mode
      });
      // KC-0170: a new screen language reloads the page (no profile was shown in the standard language).
      const svar = await faerdigt(deps, A.gemtVelkommen);
      return profil.sprog === (forrige?.sprog ?? deps.standardSprog?.() ?? STANDARD_SPROG) ? svar : { ...svar, genindlaes: true };
    }, { room: RUM, label: T.label.profil });
  }
  if (name === 'forslag-afvis') {
    const kildeId = str(body['kildeId'], 40);
    const f = (await rejsen(deps)).forslag.find((x) => x.kildeId === kildeId);
    if (!f) throw new ActionError(A.forslagFindesIkke);
    return deps.runs.local('afvis', async () => {
      const s = (await laesState(deps)) ?? ny(deps.now());
      const forslag = s.forslag ? { ...s.forslag, liste: s.forslag.liste.filter((x) => x.kildeId !== kildeId) } : undefined;
      await deps.store.writeState(RUM, { ...s, afvist: { ...s.afvist, [kildeId]: deps.now().toISOString() }, ...(forslag ? { forslag } : {}) });
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: A.lagdeForslagVaek(f.navn) });
      return faerdigt(deps, A.lagtVaek);
    }, { room: RUM, label: T.label.forslag });
  }
  if (name === 'ret-spring-over') {
    if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError(A.kunEjerenSpringerOver);
    const { trin } = await trinNu(deps, await laesState(deps));
    const status = trin.find((x) => x.trin.id === 'foerste-ret')?.status;
    if (status === 'klaret') throw new ActionError(A.trinKlaret);
    if (status === 'sprunget-over') throw new ActionError(A.trinSprunget);
    return deps.runs.local('afvis', async () => {
      const s = (await laesState(deps)) ?? ny(deps.now());
      const titel = T.trin['foerste-ret'].titel;
      await deps.store.writeState(RUM, { ...s, trin: { ...s.trin, 'foerste-ret': { status: 'sprunget-over', tid: deps.now().toISOString() } } });
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: A.sprangRet(titel) });
      return faerdigt(deps, A.sprunget);
    }, { room: RUM, label: T.label.trin });
  }
  if ((IMPORT_AKTIONER as readonly string[]).includes(name)) {
    const t = name === 'import-spring-over' ? (await trinNu(deps, await laesState(deps))).trin.find((x) => x.trin.id === 'import') : undefined;
    return importAktion(deps, name, body, importHjaelp, { status: t?.status, titel: t?.trin.titel ?? T.trin['import'].titel });
  }
  if (name === 'model-gem' || name === 'model-test' || name === 'model-agent-noegle' || name === 'github-start' || name === 'github-ud') return modelAktion(deps, name, body);
  if (name === 'tailscale-del') return tailscaleDel(deps, body);
  if (name === 'post-afsender-gem' || name === 'post-ikke-nu') return digitalPostAktion(deps, name, body);
  if (name === 'aula-ikke-nu') return aulaIkkeNu(deps);
  if (name === 'kilde-spring-over') {
    if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError(A.kunEjerenKilder);
    const kildeId = str(body['kildeId'], 40);
    const s = await laesState(deps);
    const { ctx } = await trinNu(deps, s);
    if (!flereKilderKoe(s, ctx).some((k) => k.id === kildeId)) throw new ActionError(A.kildeIkkeTilbudt);
    return deps.runs.local('afvis', async () => faerdigt(deps, A.kildeSprunget(await springOver(deps, kildeId, ctx))), { room: RUM, label: T.label.kilde });
  }
  return null;
}

/**
 * KC-0233: the Danmark-pakke step. "Gem" confirms the notification sender (a typed address wins over the list) and the viewer;
 * the window refuses an address that is not a Digital Post sender with a plain sentence BEFORE anything is written. Only the
 * owner. Nothing here reaches Hermes or the mail: it is a setting.
 */
async function digitalPostAktion(deps: RoomDeps, name: 'post-afsender-gem' | 'post-ikke-nu', body: Record<string, unknown>): Promise<RunRecord> {
  const p = deps.person;
  const T = startTekst();
  const A = T.akt;
  if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError(A.kunEjerenAfsenderen, 403);
  const dm = deps.danmark;
  if (!dm) throw new ActionError(A.ingenDatamappeValg);
  if (name === 'post-ikke-nu') {
    await dm.ikkeNu();
    return deps.runs.local('afvis', async () => {
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: name, tekst: A.lagdePostVaek });
      return faerdigt(deps, A.lagtVaek);
    }, { room: RUM, label: T.label.postVaek });
  }
  const afsender = str(body['egen'], 200) || str(body['afsender'], 200);
  await dm.gem(afsender, str(body['viser'], 20));
  return deps.runs.local('gem', async () => {
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: name, tekst: A.valgteAfsender(afsender.toLowerCase()) });
    return faerdigt(deps, A.gemtPost);
  }, { room: RUM, label: T.label.postGem });
}

/** KC-0236: "Ikke nu" on the Aula card — a setting (30 days); it reaches neither Hermes nor Aula. Only the owner. */
async function aulaIkkeNu(deps: RoomDeps): Promise<RunRecord> {
  const p = deps.person;
  const T = startTekst();
  const A = T.akt;
  if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError(A.kunEjerenKilder, 403);
  const dm = deps.danmark;
  if (!dm) throw new ActionError(A.ingenDatamappeValg);
  await dm.aulaIkkeNu();
  return deps.runs.local('afvis', async () => {
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: 'aula-ikke-nu', tekst: A.lagdeAulaVaek });
    return faerdigt(deps, A.lagtVaek);
  }, { room: RUM, label: T.label.aulaVaek });
}

/**
 * KC-0161: "Del Clawco på dit tailnet" — `tailscale serve --bg <port>` for the configured port, nothing else. It got
 * here only through the policy layer with a redeemed human-tap token (aktionTap); the body must name exactly the port
 * the card showed, and the state must still be klar. Tailscale's own text never reaches the page (TsFejl is ours).
 */
async function tailscaleDel(deps: RoomDeps, body: Record<string, unknown>): Promise<RunRecord> {
  const p = deps.person;
  const t = deps.tailscale;
  const T = startTekst();
  const A = T.akt;
  if (!t) throw new ActionError(A.kanIkkeDeleHer);
  if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError(A.kunEjerenDeler);
  const felter = Object.keys(body).filter((k) => k !== 'ja');
  if (felter.length !== 1 || felter[0] !== 'port' || body['port'] !== t.port) throw new ActionError(A.knappenPasserIkke(t.port));
  if ((await t.laes()).tilstand !== 'klar') throw new ActionError(A.kanKunDeles);
  return deps.runs.local('gem', async () => {
    try {
      const efter = await t.del();
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: 'tailscale-del', tekst: A.deltLog(t.port, efter.adresse) });
      return faerdigt(deps, efter.tilstand === 'delt' ? A.erDelt : A.kommandoenKoert);
    } catch (err) {
      if (!(err instanceof TsFejl)) throw err;
      await deps.store.appendLog(RUM, { kilde: 'system', zone: KORSEL, ejer: p.id, handlingId: 'tailscale-del', tekst: A.ikkeGjort(err.message) });
      throw new Error(err.message);
    }
  }, { room: RUM, label: T.label.del });
}

/** KC-0127: one live test of a tier — one tiny run through the agent real runs use, stopped after testMs. Stored per revision; fail closed. */
async function testNiveau(deps: RoomDeps, niveau: Niveau): Promise<{ ok: boolean; ms: number; fejl?: ModelFejlArt }> {
  const m = deps.model!;
  const syn = await m.laes();
  const model = syn.modeller[niveau];
  const u = syn.udbyder ? udbyderAf(syn.udbyder) : undefined;
  const ac = new AbortController();
  let forSent = false;
  const timer = setTimeout(() => { forSent = true; ac.abort(); }, m.testMs);
  const start = performance.now();
  let fejl: ModelFejlArt | undefined;
  try {
    const r = await deps.hermes.run({ ...MODEL_TEST, ...(model ? { model } : {}), ...(u ? { provider: u.hermesProvider } : {}), signal: ac.signal });
    if (!r.output.trim()) fejl = 'tom';
  } catch (err) {
    // Only the kind is kept: the provider's text can echo a fragment of the key.
    fejl = modelFejlArt(err instanceof Error ? err.message : String(err), { tid: forSent });
  } finally { clearTimeout(timer); }
  const ms = Math.round(performance.now() - start);
  await m.saetTest(niveau, { ok: !fejl, tid: deps.now().toISOString(), ms, rev: syn.rev[niveau], ...(fejl ? { fejl } : {}) });
  return { ok: !fejl, ms, ...(fejl ? { fejl } : {}) };
}

async function testBegge(deps: RoomDeps): Promise<string> {
  const r: { ok: boolean; ms: number; fejl?: ModelFejlArt }[] = [];
  for (const n of NIVEAUER) r.push(await testNiveau(deps, n));
  const fejl = r.find((x) => !x.ok);
  const [lille, taenker] = r.map((x) => `${sek(x.ms)} s`);
  return fejl ? testTekst(fejl) : startTekst().akt.virkerBegge(lille!, taenker!);
}

/** Which model a tier gets: the posted one for the same provider, else the provider's default (or the first discovered when the default is not offered). */
function modelTil(n: Niveau, o: { samme: boolean; posted: string; nu: ModelSyn; std: string; navne?: string[] }): string {
  if (o.samme && o.posted) return o.posted;
  if (o.samme && o.nu.modeller[n]) return o.nu.modeller[n];
  return o.navne?.length && !o.navne.includes(o.std) ? o.navne[0]! : o.std;
}

async function modelAktion(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord> {
  const p = deps.person;
  const T = startTekst();
  const A = T.akt;
  if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError(A.kunEjerenModellen);
  const m = deps.model;
  if (!m) throw new ActionError(A.ingenDatamappeModel);

  if (name === 'model-agent-noegle') {
    const v = str(body['noegle'], 2001);
    if (!v) throw new ActionError(A.indsaetNoegle);
    return deps.runs.local('gem', async () => {
      const r = await m.saetAgentNoegle(v);
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: A.gemteNoegle(r.laengde) });
      return faerdigt(deps, A.gemtLaengde(r.laengde));
    }, { room: RUM, label: T.label.noegle });
  }

  if (name === 'github-start' || name === 'github-ud') return githubAktion(deps, name);

  if ((await deps.hermes.status()) === 'mangler-noegle') throw new ActionError(`${T.modelFejl['agent-noegle']} ${A.indsaetDenFoerst}`);

  if (name === 'model-test') {
    const niveau = body['tier'];
    if (!(NIVEAUER as readonly unknown[]).includes(niveau)) throw new ActionError(A.ukendtNiveau);
    const n = niveau as Niveau;
    if (!(await m.laes()).modeller[n]) throw new ActionError(A.vaelgModelFoerst);
    return deps.runs.local('test', async () => faerdigt(deps, testTekst(await testNiveau(deps, n))), { room: RUM, label: T.label.test });
  }

  // model-gem: the provider, the key (or a local address) to the agent, the models, then both tiers tested at once.
  const u = udbyderAf(str(body['udbyder'], 40));
  if (!u) throw new ActionError(A.vaelgUdbyder);
  if (deps.hermes.mode === 'direkte' && !u.direkte) throw new ActionError(T.modelFejl['kun-hermes']); // KC-0245: the built-in agent has no way to call it
  // KC-0263: Copilot beside the built-in agent signs in with GitHub; a pasted token is never taken.
  const github = deps.hermes.mode === 'direkte' && u.direkte?.api === 'copilot-sdk';
  const inde = github ? await m.github?.status().catch(() => undefined) : undefined;
  if (github && inde?.tilstand !== 'inde') throw new ActionError(A.logIndFoerst);
  const raa = github ? '' : u.kraeverNoegle ? str(body['noegle'], 2001) : str(body['url'], 200);
  const vaerdi = u.kraeverNoegle && !raa ? null : envVaerdi(u, raa);
  if (!u.kraeverNoegle && !vaerdi) throw new ActionError(A.adresseHttp(u.standardUrl ?? 'http://127.0.0.1'));
  if (u.kraeverNoegle && raa && !vaerdi) throw new ActionError(A.noegleForLang);
  const posted = { lille: str(body['lille'], 80), taenker: str(body['taenker'], 80) };
  return deps.runs.local('gem', async () => {
    const nu = await m.laes();
    const s = (await laesState(deps)) ?? ny(deps.now());
    const forrige = s.model?.udbyder === u.id ? s.model : undefined;
    let gemt: StartModel = forrige ?? { udbyder: u.id };
    if (inde?.tilstand === 'inde') gemt = { ...gemt, noegle: { laengde: inde.laengde, tid: gemt.noegle?.tid ?? deps.now().toISOString() } };
    if (vaerdi) {
      const svar = await deps.hermes.saetModelNoegle(u, vaerdi);
      gemt = svar.slags === 'gemt'
        ? { udbyder: u.id, ...(u.kraeverNoegle ? { noegle: { laengde: svar.laengde, tid: deps.now().toISOString() } } : { url: vaerdi }) }
        : { udbyder: u.id, kommando: svar.kommando, ...(u.kraeverNoegle ? {} : { url: vaerdi }) };
      const navne = await hentModelNavne(u, { ...(u.kraeverNoegle ? { noegle: vaerdi } : { baseUrl: vaerdi }), ...(m.fetchImpl ? { fetchImpl: m.fetchImpl } : {}) });
      if (navne.length) gemt.navne = navne;
      else if (forrige?.navne) gemt.navne = forrige.navne;
    }
    const samme = nu.udbyder === u.id;
    const valg = (n: Niveau): string => modelTil(n, { samme, posted: posted[n], nu, std: u.standardModeller[n], ...(gemt.navne ? { navne: gemt.navne } : {}) });
    await m.vaelg({ udbyder: u.id, lille: valg('lille'), taenker: valg('taenker') });
    await deps.store.writeState(RUM, { ...s, model: gemt });
    const hvad = github ? A.hvadGithub(gemt.github?.login) : gemt.noegle ? (deps.hermes.mode === 'direkte' ? A.hvadNoegleGemt : A.hvadNoegle)(gemt.noegle.laengde) : gemt.url ? A.hvadAdresse(gemt.url) : '';
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: A.valgteModel(T.udbyderNavn(u), hvad, valg('lille'), valg('taenker')) });
    if (gemt.kommando && vaerdi) return faerdigt(deps, A.koerKommandoen);
    return faerdigt(deps, await testBegge(deps));
  }, { room: RUM, label: T.label.modelGem });
}

/**
 * KC-0263: "Sign in with GitHub" for Copilot beside the built-in agent. github-start asks GitHub for a code and answers
 * the card with it at once; the wait goes on in the background (github-enhed.ts), and once the token is in the store the
 * choice is saved (the provider's default models), the login line is logged and both tiers are tested, each step
 * refreshing the room. github-ud removes the token and stops the Copilot client. Owner-only (modelAktion).
 */
async function githubAktion(deps: RoomDeps, name: 'github-start' | 'github-ud'): Promise<RunRecord> {
  const p = deps.person;
  const T = startTekst();
  const A = T.akt;
  const m = deps.model!;
  const gh = m.github;
  const u = UDBYDERE.find((x) => x.direkte?.api === 'copilot-sdk');
  if (deps.hermes.mode !== 'direkte' || !gh || !u) throw new ActionError(T.github.ikkeSatOp, 404);
  if (name === 'github-ud') {
    return deps.runs.local('gem', async () => {
      await gh.ud();
      // The model has no access now: a Copilot choice's tiers read as failed, so step 2 opens again with the reason.
      const syn = await m.laes();
      if (syn.udbyder === u.id) {
        for (const n of NIVEAUER) if (syn.modeller[n]) await m.saetTest(n, { ok: false, tid: deps.now().toISOString(), ms: 0, rev: syn.rev[n], fejl: 'model-noegle' });
      }
      const s = (await laesState(deps)) ?? ny(deps.now());
      if (s.model?.udbyder === u.id) { const { model: _vaek, ...uden } = s; await deps.store.writeState(RUM, uden); }
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: A.loggedeUd });
      return faerdigt(deps, A.loggedeUd);
    }, { room: RUM, label: T.label.githubUd });
  }
  if ((await gh.status()).tilstand === 'ikke-sat-op') throw new ActionError(T.github.ikkeSatOp, 409);
  return deps.runs.local('gem', async () => {
    const t = await gh.start(async ({ login, laengde }) => {
      const nu = await m.laes();
      const s = (await laesState(deps)) ?? ny(deps.now());
      await deps.store.writeState(RUM, { ...s, model: { udbyder: u.id, noegle: { laengde, tid: deps.now().toISOString() }, ...(login ? { github: { login } } : {}) } });
      const samme = nu.udbyder === u.id;
      await m.vaelg({ udbyder: u.id, lille: modelTil('lille', { samme, posted: '', nu, std: u.standardModeller.lille }), taenker: modelTil('taenker', { samme, posted: '', nu, std: u.standardModeller.taenker }) });
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: A.loggedeInd(login, laengde) });
      deps.live.notify(RUM);
      await testBegge(deps);
      deps.live.notify(RUM);
    });
    if (t.tilstand !== 'venter') throw new ActionError(t.tilstand === 'ikke-sat-op' ? T.github.ikkeSatOp : T.github.fejl);
    return faerdigt(deps, A.githubKodeKlar);
  }, { room: RUM, label: T.label.githubStart });
}

async function startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null> {
  const T = startTekst();
  const entry = (await deps.store.readLog(RUM, 200)).filter((e) => synligFor(deps.person, e)).find((e) => e.id === logId);
  const kvit = importKvitteringer(entry?.fortryd); // KC-0129: a saved import's Fortryd
  if (entry && kvit) return importFortryd(deps, entry, kvit, importHjaelp);
  const lager = deps.profil;
  if (!entry?.fortryd?.startsWith('lokal:') || entry.fortrudt || !lager || !kan(deps.person.rolle, 'aendre-indstillinger')) return null;
  let forrige: Profil | null;
  try {
    const gemt = (JSON.parse(entry.fortryd.slice(6)) as { forrige?: unknown }).forrige;
    forrige = gemt === null || gemt === undefined ? null : validerProfil(gemt);
  } catch { return null; }
  return deps.runs.local('fortryd', async () => {
    const nu = await lager.laes().catch(() => null);
    if (forrige) await lager.skriv(forrige); else await lager.fjern();
    await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: deps.person.id, tekst: forrige ? T.akt.satteProfilTilbage(forrige.navn) : T.akt.fjernedeProfil });
    const svar = await faerdigt(deps, T.akt.fortrudt);
    const std = deps.standardSprog?.() ?? STANDARD_SPROG;
    return (nu?.sprog ?? std) === (forrige?.sprog ?? std) ? svar : { ...svar, genindlaes: true }; // KC-0170
  }, { room: RUM, label: T.label.fortryd });
}

async function startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const ingenSvar = startTekst().akt.ingenSvar; // read now: the answer may arrive in another request's context
  const { trin } = await trinNu(deps, await laesState(deps));
  await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst } : { fra: 'henrik', tekst: besked });
  return deps.runs.start({
    kind: 'chat',
    spec: buildStartChatRun(besked, kontekst, trin.map((x) => ({ titel: x.trin.titel, status: x.status }))),
    onDone: async (output) => {
      const text = output.replace(/```(?:json)?\s*[\s\S]*?```/i, '').trim() || ingenSvar;
      await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text });
      return { text };
    },
  });
}

export const startRoom: RoomModule = {
  id: RUM,
  korsel: KORSEL,
  aktionVerber: { 'velkommen-gem': 'bogfoer', 'forslag-afvis': 'sorter', 'model-gem': 'bogfoer', 'model-test': 'laes', 'model-agent-noegle': 'bogfoer', 'github-start': 'bogfoer', 'github-ud': 'bogfoer', 'kilde-spring-over': 'sorter', 'ret-spring-over': 'sorter', 'import-laes': 'laes', 'import-gem': 'bogfoer', 'import-gem-alle': 'bogfoer', 'import-opdater': 'udfoer-med-fortryd', 'import-spring': 'sorter', 'import-annuller': 'sorter', 'import-spring-over': 'sorter', 'import-lav-mappe': 'bogfoer', 'tailscale-del': 'udfoer-med-fortryd', 'post-afsender-gem': 'bogfoer', 'post-ikke-nu': 'sorter', 'aula-ikke-nu': 'sorter' },
  aktionTap: ['tailscale-del'],
  view,
  startOpdater: async () => null,
  startHandling: async () => null,
  startFortryd,
  startChat,
  startAction,
  tik: async (deps) => { await rydGamleUploads(deps).catch(() => 0); }, // KC-0129: an upload never outlives an hour
  venter: async (deps) => (await aabneObligatoriske(deps)).length,
  hjemVenter: async (deps) => (await aabneObligatoriske(deps)).map((titel) => ({ roomId: RUM, tekst: startTekst().akt.nuLinje(titel) })),
};
