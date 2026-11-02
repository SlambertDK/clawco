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
import { alleTrin, NIVEAUER, trinStatus, type ModelSyn, type Niveau, type TrinKontekst } from './trin.ts';
import { erRejsenFaerdig } from './rejsen.ts';
import { foreslaaTilfoejelse } from './forslag.ts';
import { renderStart, testTekst, type StartVisning } from './render.ts';
import { ventendeForslag } from './regelforslag.ts';
import { buildStartChatRun, KORSEL } from './prompt.ts';
import { envVaerdi, hentModelNavne, udbyderAf } from './udbydere.ts';
import { MODEL_FEJL, modelFejlArt, type ModelFejlArt } from './modelfejl.ts';
import { MODEL_TEST } from '../../agent/prompt.ts';
import type { AgentStatus } from '../../agent/types.ts';
import { kildeKontekst, kildeVisning, springOver } from './vaerdi.ts';
import { flereKilderKoe } from './trin.ts';
import { IMPORT_AKTIONER, IMPORT_LABEL, importAktion, importFortryd, importKvitteringer, rydGamleUploads, type Hjaelp as ImportHjaelp } from './import/handlinger.ts';
import type { ImportVisning } from './import/render.ts';
import { visTailscaleKort } from './tailscalekort.ts';
import { TsFejl } from '../../shell/tailscale.ts';
import { STANDARD_SPROG, tekst } from '../../shell/tekster.ts';

const RUM = 'start';
/** How long worked-out suggestions are kept before the sources are asked again. */
const FORSLAG_GYLDIG_MS = 15 * 60_000;
const SPROG_NAVN = { da: 'dansk', en: 'engelsk' } as const;

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
  try { kilder = await deps.rejse.kilder(); } catch { return []; } // a registry that cannot be read suggests nothing (fail closed)
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
  await deps.store.appendLog(RUM, { kilde: 'system', zone: KORSEL, tekst: 'Rejsen er gennemført.' }); // KC-0130
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
    klar: await skriver.klar().catch(() => false), kanLavMappe: Boolean(skriver.lavMappe), udbyder: u ? { navn: u.navn, lokal: !u.kraeverNoegle } : null,
    ...(s.import?.bunke ? { bunke: s.import.bunke } : {}), gemt: s.import?.gemt ?? [],
    laeser: deps.runs.igang(RUM).some((r) => r.label === IMPORT_LABEL), kanGemme: kan(deps.person.rolle, 'aendre-indstillinger'),
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
  return {
    main: renderStart({
      foersteRet: await foersteRetSyn(deps, s),
      ...(await importSyn(deps, s, ctx.model)),
      ...(await tailscaleSyn(deps, faerdig)),
      ...(await digitalPostSyn(deps)),
      ...(deps.laptop?.() ? { laptop: true } : {}),
      trin, profil: ctx.profil, forslag, log, now: deps.now(), igang: deps.runs.igang(RUM), venter,
      standardNavn: p.rolle === 'ejer' && p.id !== ENEBRUGER.id ? p.navn : '',
      kanGemme: kan(p.rolle, 'aendre-indstillinger') && Boolean(deps.profil),
      ...(ctx.model ? { model: { syn: ctx.model, agent, ...(s.model ? { gemt: s.model } : {}), kanGemme: kan(p.rolle, 'aendre-indstillinger') } } : {}),
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
  if (name === 'velkommen-gem') {
    if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren kan gemme profilen.');
    const lager = deps.profil;
    if (!lager) throw new ActionError('Clawco har ingen datamappe, så profilen kan ikke gemmes.');
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
        tekst: `Gemte profilen: ${profil.navn}, Hermes svarer på ${SPROG_NAVN[profil.sprog]}${deps.laptop?.() ? '' : `, ${profil.husstand === 'husstand' ? 'en husstand' : 'alene'}`}.`, // KC-0160: no household wording in laptop mode
      });
      // KC-0170: a new screen language reloads the page (no profile was shown in the standard language).
      const svar = await faerdigt(deps, 'Gemt. Velkommen.');
      return profil.sprog === (forrige?.sprog ?? STANDARD_SPROG) ? svar : { ...svar, genindlaes: true };
    }, { room: RUM, label: 'Start: gemmer profilen' });
  }
  if (name === 'forslag-afvis') {
    const kildeId = str(body['kildeId'], 40);
    const f = (await rejsen(deps)).forslag.find((x) => x.kildeId === kildeId);
    if (!f) throw new ActionError('Forslaget findes ikke i rummet');
    return deps.runs.local('afvis', async () => {
      const s = (await laesState(deps)) ?? ny(deps.now());
      const forslag = s.forslag ? { ...s.forslag, liste: s.forslag.liste.filter((x) => x.kildeId !== kildeId) } : undefined;
      await deps.store.writeState(RUM, { ...s, afvist: { ...s.afvist, [kildeId]: deps.now().toISOString() }, ...(forslag ? { forslag } : {}) });
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: `Lagde forslaget om ${f.navn} væk i 30 dage.` });
      return faerdigt(deps, 'Lagt væk.');
    }, { room: RUM, label: 'Start: lægger forslaget væk' });
  }
  if (name === 'ret-spring-over') {
    if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren kan springe trinnet over.');
    const { trin } = await trinNu(deps, await laesState(deps));
    const status = trin.find((x) => x.trin.id === 'foerste-ret')?.status;
    if (status === 'klaret') throw new ActionError('Trinnet er allerede klaret.');
    if (status === 'sprunget-over') throw new ActionError('Trinnet er allerede sprunget over.');
    return deps.runs.local('afvis', async () => {
      const s = (await laesState(deps)) ?? ny(deps.now());
      const titel = alleTrin().find((t) => t.id === 'foerste-ret')?.titel ?? 'Ret én ting';
      await deps.store.writeState(RUM, { ...s, trin: { ...s.trin, 'foerste-ret': { status: 'sprunget-over', tid: deps.now().toISOString() } } });
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: `Sprang »${titel}« over. Rejsen er først færdig, når du har rettet noget.` });
      return faerdigt(deps, 'Sprunget over.');
    }, { room: RUM, label: 'Start: springer et trin over' });
  }
  if ((IMPORT_AKTIONER as readonly string[]).includes(name)) {
    const t = name === 'import-spring-over' ? (await trinNu(deps, await laesState(deps))).trin.find((x) => x.trin.id === 'import') : undefined;
    return importAktion(deps, name, body, importHjaelp, { status: t?.status, titel: t?.trin.titel ?? 'Tag det med' });
  }
  if (name === 'model-gem' || name === 'model-test' || name === 'model-agent-noegle') return modelAktion(deps, name, body);
  if (name === 'tailscale-del') return tailscaleDel(deps, body);
  if (name === 'post-afsender-gem' || name === 'post-ikke-nu') return digitalPostAktion(deps, name, body);
  if (name === 'kilde-spring-over') {
    if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren vælger kilderne.');
    const kildeId = str(body['kildeId'], 40);
    const s = await laesState(deps);
    const { ctx } = await trinNu(deps, s);
    if (!flereKilderKoe(s, ctx).some((k) => k.id === kildeId)) throw new ActionError('Kilden er ikke tilbudt i rummet');
    return deps.runs.local('afvis', async () => faerdigt(deps, `${await springOver(deps, kildeId, ctx)} er sprunget over.`), { room: RUM, label: 'Start: springer en kilde over' });
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
  if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren vælger afsenderen.', 403);
  const dm = deps.danmark;
  if (!dm) throw new ActionError('Clawco har ingen datamappe, så valget kan ikke gemmes.');
  if (name === 'post-ikke-nu') {
    await dm.ikkeNu();
    return deps.runs.local('afvis', async () => {
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: name, tekst: 'Lagde trinnet om Digital Post væk i 30 dage.' });
      return faerdigt(deps, 'Lagt væk.');
    }, { room: RUM, label: 'Start: lægger Digital Post-trinnet væk' });
  }
  const afsender = str(body['egen'], 200) || str(body['afsender'], 200);
  await dm.gem(afsender, str(body['viser'], 20));
  return deps.runs.local('gem', async () => {
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: name, tekst: `Valgte afsenderen til Digital Post: ${afsender.toLowerCase()}.` });
    return faerdigt(deps, 'Gemt. Nu lægger Clawco et kort i Nu, når der kommer ny Digital Post.');
  }, { room: RUM, label: 'Start: gemmer Digital Post-afsenderen' });
}

/**
 * KC-0161: "Del Clawco på dit tailnet" — `tailscale serve --bg <port>` for the configured port, nothing else. It got
 * here only through the policy layer with a redeemed human-tap token (aktionTap); the body must name exactly the port
 * the card showed, and the state must still be klar. Tailscale's own text never reaches the page (TsFejl is ours).
 */
async function tailscaleDel(deps: RoomDeps, body: Record<string, unknown>): Promise<RunRecord> {
  const p = deps.person;
  const t = deps.tailscale;
  if (!t) throw new ActionError('Clawco kan ikke dele på tailnettet fra den her installation.');
  if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren kan dele Clawco på tailnettet.');
  const felter = Object.keys(body).filter((k) => k !== 'ja');
  if (felter.length !== 1 || felter[0] !== 'port' || body['port'] !== t.port) throw new ActionError(`Knappen passer ikke til Clawcos port (${t.port}). Åbn Start igen.`);
  if ((await t.laes()).tilstand !== 'klar') throw new ActionError('Clawco kan kun deles, når Tailscale er logget ind, og Clawco ikke allerede er delt.');
  return deps.runs.local('gem', async () => {
    try {
      const efter = await t.del();
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, handlingId: 'tailscale-del', tekst: `Delte Clawco på tailnettet (tailscale serve --bg ${t.port})${efter.adresse ? `: ${efter.adresse}` : ''}.` });
      return faerdigt(deps, efter.tilstand === 'delt' ? 'Clawco er delt på dit tailnet.' : 'Kommandoen er kørt. Åbn Start igen for at se, om Tailscale har delt Clawco.');
    } catch (err) {
      if (!(err instanceof TsFejl)) throw err;
      await deps.store.appendLog(RUM, { kilde: 'system', zone: KORSEL, ejer: p.id, handlingId: 'tailscale-del', tekst: `Ikke gjort: ${err.message}` });
      throw new Error(err.message);
    }
  }, { room: RUM, label: 'Start: deler Clawco på tailnettet' });
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
  const [lille, taenker] = r.map((x) => testTekst(x).replace(/^Virker · /, ''));
  return fejl ? testTekst(fejl) : `Virker: den hurtige svarede på ${lille}, den grundige på ${taenker}.`;
}

/** Which model a tier gets: the posted one for the same provider, else the provider's default (or the first discovered when the default is not offered). */
function modelTil(n: Niveau, o: { samme: boolean; posted: string; nu: ModelSyn; std: string; navne?: string[] }): string {
  if (o.samme && o.posted) return o.posted;
  if (o.samme && o.nu.modeller[n]) return o.nu.modeller[n];
  return o.navne?.length && !o.navne.includes(o.std) ? o.navne[0]! : o.std;
}

async function modelAktion(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord> {
  const p = deps.person;
  if (!kan(p.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren kan vælge modellen.');
  const m = deps.model;
  if (!m) throw new ActionError('Clawco har ingen datamappe, så modellen kan ikke gemmes.');

  if (name === 'model-agent-noegle') {
    const v = str(body['noegle'], 2001);
    if (!v) throw new ActionError('Indsæt nøglen til Hermes.');
    return deps.runs.local('gem', async () => {
      const r = await m.saetAgentNoegle(v);
      await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: `Gemte nøglen til Hermes (${r.laengde} tegn).` });
      return faerdigt(deps, `Gemt (${r.laengde} tegn).`);
    }, { room: RUM, label: 'Start: gemmer nøglen til Hermes' });
  }

  if ((await deps.hermes.status()) === 'mangler-noegle') throw new ActionError(`${MODEL_FEJL['agent-noegle']} Indsæt den først.`);

  if (name === 'model-test') {
    const niveau = body['tier'];
    if (!(NIVEAUER as readonly unknown[]).includes(niveau)) throw new ActionError('Ukendt niveau');
    const n = niveau as Niveau;
    if (!(await m.laes()).modeller[n]) throw new ActionError('Vælg en model først.');
    return deps.runs.local('test', async () => faerdigt(deps, testTekst(await testNiveau(deps, n))), { room: RUM, label: 'Start: prøver modellen' });
  }

  // model-gem: the provider, the key (or a local address) to the agent, the models, then both tiers tested at once.
  const u = udbyderAf(str(body['udbyder'], 40));
  if (!u) throw new ActionError('Vælg en udbyder fra listen.');
  const raa = u.kraeverNoegle ? str(body['noegle'], 2001) : str(body['url'], 200);
  const vaerdi = u.kraeverNoegle && !raa ? null : envVaerdi(u, raa);
  if (!u.kraeverNoegle && !vaerdi) throw new ActionError(`Adressen skal være en http-adresse, fx ${u.standardUrl ?? 'http://127.0.0.1'}.`);
  if (u.kraeverNoegle && raa && !vaerdi) throw new ActionError('Nøglen er for lang.');
  const posted = { lille: str(body['lille'], 80), taenker: str(body['taenker'], 80) };
  return deps.runs.local('gem', async () => {
    const nu = await m.laes();
    const s = (await laesState(deps)) ?? ny(deps.now());
    const forrige = s.model?.udbyder === u.id ? s.model : undefined;
    let gemt: StartModel = forrige ?? { udbyder: u.id };
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
    const hvad = gemt.noegle ? `, nøglen er givet til Hermes (${gemt.noegle.laengde} tegn)` : gemt.url ? `, adressen ${gemt.url}` : '';
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: p.id, tekst: `Valgte ${u.navn}${hvad}: ${valg('lille')} og ${valg('taenker')}.` });
    if (gemt.kommando && vaerdi) return faerdigt(deps, 'Kør kommandoen på Hermes’ maskine, og tryk så Test.');
    return faerdigt(deps, await testBegge(deps));
  }, { room: RUM, label: 'Start: gemmer og prøver modellen' });
}

async function startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null> {
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
    await deps.store.appendLog(RUM, { kilde: 'henrik', zone: KORSEL, ejer: deps.person.id, tekst: forrige ? `Satte profilen tilbage til ${forrige.navn}.` : 'Fjernede profilen igen.' });
    const svar = await faerdigt(deps, 'Fortrudt.');
    return (nu?.sprog ?? STANDARD_SPROG) === (forrige?.sprog ?? STANDARD_SPROG) ? svar : { ...svar, genindlaes: true }; // KC-0170
  }, { room: RUM, label: 'Start: fortryder' });
}

async function startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const { trin } = await trinNu(deps, await laesState(deps));
  await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst } : { fra: 'henrik', tekst: besked });
  return deps.runs.start({
    kind: 'chat',
    spec: buildStartChatRun(besked, kontekst, trin.map((x) => ({ titel: x.trin.titel, status: x.status }))),
    onDone: async (output) => {
      const text = output.replace(/```(?:json)?\s*[\s\S]*?```/i, '').trim() || '(intet svar)';
      await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text });
      return { text };
    },
  });
}

export const startRoom: RoomModule = {
  id: RUM,
  korsel: KORSEL,
  aktionVerber: { 'velkommen-gem': 'bogfoer', 'forslag-afvis': 'sorter', 'model-gem': 'bogfoer', 'model-test': 'laes', 'model-agent-noegle': 'bogfoer', 'kilde-spring-over': 'sorter', 'ret-spring-over': 'sorter', 'import-laes': 'laes', 'import-gem': 'bogfoer', 'import-gem-alle': 'bogfoer', 'import-opdater': 'udfoer-med-fortryd', 'import-spring': 'sorter', 'import-annuller': 'sorter', 'import-spring-over': 'sorter', 'import-lav-mappe': 'bogfoer', 'tailscale-del': 'udfoer-med-fortryd', 'post-afsender-gem': 'bogfoer', 'post-ikke-nu': 'sorter' },
  aktionTap: ['tailscale-del'],
  view,
  startOpdater: async () => null,
  startHandling: async () => null,
  startFortryd,
  startChat,
  startAction,
  tik: async (deps) => { await rydGamleUploads(deps).catch(() => 0); }, // KC-0129: an upload never outlives an hour
  venter: async (deps) => (await aabneObligatoriske(deps)).length,
  hjemVenter: async (deps) => (await aabneObligatoriske(deps)).map((titel) => ({ roomId: RUM, tekst: `Start: ${titel}` })),
};
