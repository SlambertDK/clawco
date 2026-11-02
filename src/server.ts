// HTTP routes (Hono). Thin: parse, call the room, render. Start with
// `node src/server.ts`; tests build the app with createApp().

import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { execFile, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AgentClient } from './agent/types.ts';
import { createHermesHttp } from './agent/hermes-http.ts';
import { createFakeAgent } from './agent/fake.ts';
import { devAnswer } from './agent/devAnswers.ts';
import type { LogEntry, RumLager } from './store/types.ts';
import { createFileStore } from './store/fileStore.ts';
import { createRunRegistry, fraTelefonen, type RunRecord } from './runs.ts';
import { createLiveBus } from './live.ts';
import { konfliktDue, kuratorDue, parseFrontload, parseKonfliktPlan, parseKuratorPlan, startScheduler, startTik, type KonfliktPlan, type KuratorPlan } from './scheduler.ts';
import { createSettings, modelRevision, type Settings } from './settings.ts';
import { TIER_KINDS, CHAT_KINDS } from './runs.ts';
import { ROOMS } from './rooms/registry.ts';
import { shell } from './shell/layout.ts';
import { medSprog, STANDARD_SPROG, tekst } from './shell/tekster.ts';
import { html, type Markup } from './shell/html.ts';
import { renderIkkeFundet, ikkeFundetOverskrift, type IkkeFundetSlags } from './shell/ikkefundet.ts';
import { tenantFejlrapport, type Fejlrapport } from './shell/fejlrapport.ts';
import { renderUdenForbindelse } from './shell/udenforbindelse.ts';
import { findRoom } from './rooms/registry.ts';
import { UNIVERS, findUnivers, laesIndeks, laesUnivers, universRum } from './rooms/univers/lager.ts';
import { synligUnivers, universRoom } from './rooms/univers/room.ts';
import { renderMoedeVisning } from './rooms/univers/render.ts';
import { koerMoedeTik, startMoedeTik } from './rooms/univers/moedetik.ts';
import { getRoomModule, ROOM_MODULES } from './rooms/modules.ts';
import { ActionError, type RoomDeps } from './rooms/module.ts';
import { hjemEgne, kraeverIder, renderHjem, renderPlaceholder, type CcRaekke, type HjemData } from './rooms/hjem/render.ts';
import { udloebet, type Kort } from './rooms/hjem/kort.ts';
import { defaultRunner, type Runner } from './rooms/mail/source.ts';
import { devMailRunner, devMailStateDir } from './rooms/mail/devSource.ts';
import { RUM as DAGEN } from './rooms/dagen/room.ts';
import { StemmeError, type StemmeClient } from './stemme/types.ts';
import { createElevenLabs } from './stemme/elevenlabs.ts';
import { createFakeStemme } from './stemme/fake.ts';
import { AGENT_CONFIG, DEFAULT_VOICE_ID, KEYTERMS, antalTekst } from './stemme/agent.ts';
import { bygOversigt, medKildeHelbred, medKuratorKort } from './stemme/oversigt.ts';
import { vaelgSituation } from './situation/situation.ts';
import { SITUATIONER, type Situation } from './situation/regler.ts';
import type { Oversigt } from './stemme/types.ts';
import { buildHjemChatRun, RUM as HJEM } from './rooms/hjem/prompt.ts';
import { endreKurator, laesKurator, startKurator, synligKurator } from './kurator/kurator.ts';
import type { NyhederState } from './rooms/nyheder/schema.ts';
import { copenhagenDate } from './rooms/dagen/source.ts';
import { besvar as udviklingBesvar, forRepo as udviklingForRepo, send as udviklingSend, status as udviklingStatus } from './udvikling/udvikling.ts';
import { laesOpgaver } from './udvikling/lager.ts';
import { OPGAVE_ID, synlige, tillid } from './udvikling/opgaver.ts';
import { PROJEKTER, findProjekt } from './udvikling/projekter.ts';
import { antalVenter, START as START_RUM, synligeRum } from './shell/synlig.ts';
import { erFoersteGang, rejsen } from './rooms/start/room.ts';
import { lavImportSkriver } from './import-skriver.ts';
import { modtagRet } from './rooms/start/ret.ts';
import { lavRetBus } from './rooms/rethaendelse.ts';
import { forhaandsvisningerNu, koerselFaerdig, modtagFoersteLaesning } from './rooms/start/vaerdi.ts';
import { forhaandsvisningId, renderForhaandsvisning } from './rooms/start/forhaandsvisning.ts';
import { lavProfilLager } from './store/profil.ts';
import { medTesttilstand, testDataDir } from './testtilstand/kontakt.ts';
import { lavTestverden } from './testtilstand/verden.ts';
import { rumFraBesked, erHjaelp, erInviterBesked, erVidenBesked, hjaelpSvar } from './shell/aabn.ts';
import { laesAabnet, markerAabnet } from './store/aabnet.ts';
import { afgoerForslag, extractForslagBlok, fjernRegel, regelFortryd, saetStatus, type Regelforslag } from './tillid/forslag.ts';
import { maksTrinForForslag } from './tillid/trin.ts';
import { gemRegelforslag, kanForeslaa } from './kurator/regelforslag.ts';
import { fortrydLog, luk, regnskabFlyt, regnskabFortryd, regnskabVaelg, startKortHandling, udsaet, type Udfald } from './kurator/kortHandlinger.ts';
import { SENERE, synligeKort, type Senere } from './kurator/senere.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ENEBRUGER, erAfvist, HUSSTAND_ULAESELIG, INGEN, kunSigneret, peerAf, vaelgKigger, type Identitetsvalg, type Person } from './identitet/identitet.ts';
import { kontoFraMiljoe } from './identitet/konto.ts';
import { nonceLager, verificerKontrol } from './identitet/kontrol.ts';
import { INTERN_MAKS_BYTES, INTERN_STI, parseIntern } from './hushold/intern.ts';
import { InvitationFejl } from './hushold/invitation.ts';
import { bodyLimit } from 'hono/body-limit';
import { husstandSynlig, internMedlem, invitationKlar, invitationSend, inviterView, kanalSend, kanalSendKlar, vedBesoeg, weekendTjek } from './hushold/room.ts';
import { maaSe } from './hushold/rettigheder.ts';
import { KanalFejl, lavFakeKanal, lavHermesKanal, type KanalClient } from './hushold/kanal.ts';
import { laesLog as laesBeskedLog } from './kilder/beskeder/jsonl.ts';
import { delerTitelRegel, type OptagetKalender } from './hushold/konflikt.ts';
import type { KalenderLaesning } from './hushold/uge.ts';
import { synligFor, zoneAf } from './identitet/zoner.ts';
import { agentGulv, type Verb } from './graenser/verber.ts';
import { KORSEL as KORT_KORSEL } from './rooms/hjem/kort.ts';
import { aktionId, gennem, GraenseAfvist, TEGN } from './graenser/port.ts';
import { laptopFraMiljoe } from './identitet/laptop.ts';
import { delPaaTailnet, laesTailscale, lavTsKoerer, type TsKoerer, type TsSyn } from './shell/tailscale.ts';
import { HusstandFejl, laesHusstand, skrivHusstand } from './identitet/husstand.ts';
import { renderIngenAdgang } from './shell/adgang.ts';
import { lavPause, NodstopNaegtet, PauseFejl, PAUSE_TEKST, startIgen, stopAlt } from './graenser/nodstop.ts';
import { erNej, lavRevisionslog, type Revisionslinje } from './graenser/revisionslog.ts';
import { renderRevision } from './shell/revision.ts';
import { renderKilder } from './shell/kilder.ts';
import { renderOmkostninger } from './shell/omkostninger.ts';
import { daekning, laesOmkostningsfil, OmkostningsFejl, OMKOSTNINGSFIL, type Omkostninger } from './omkostninger/regnskab.ts';
import { lavRegnskabsfil } from './kurator/regnskabssti.ts';
import { lavReglerLager } from './tillid/lager.ts';
import { jaFraTryk, regelFraForslag } from './graenser/regelforslag.ts';
import { eksporter, opgoer, type Brugermappe } from './tillid/brugermappe.ts';
import { sletAlt } from './tillid/slet.ts';
import { renderSletAlt, renderViden, type Viden, type VidenKilde } from './tillid/viden.ts';
import { idagKbh } from './shell/tid.ts';
import { lavSkjulte } from './tillid/skjulte.ts';
import { aabenUge, besvar, lavStikbog, medStopTilbud, type Stikuge } from './tillid/stikproeve.ts';
import { soendagsTjek } from './tillid/soendag.ts';
import { skulleVises } from './kurator/stikproeve.ts';
import { erMandag, faerdigeDage, fortrudtPaaDag, lavDagstal, raekke as ugeraekke, ugeAf, ugeLinje, ugeVisning } from './tillid/dagstal.ts';
import { laesPersoner } from './kilder/noter/personer.ts';
import { kan } from './identitet/roller.ts';
import { aktiv, lavStoetteLager, slaaStoetteFra, startStoette, stoettePersonId, StoetteFejl, type StoetteAdgang } from './identitet/stoette.ts';
import { klokkeKbh } from './shell/revision.ts';
import { KonfigFejl, lavRegister } from './kilder/register.ts';
import { lavHelbredStyring, type HelbredStyring } from './kilder/helbred-fil.ts';
import { genforbindFelter, stemmeSaetning } from './kilder/helbred-tekst.ts';
import type { KildeHelbredKort } from './shell/kilde-helbred.ts';
import { erFrisk, kildeFriskhed, type KildeFriskhed } from './shell/friskhed.ts';
import { KildeFejl, type Kilde, type KildeKontekst } from './kilder/types.ts';
import { falskeKilder, kilderFraMiljoe, parseFalskTilstand } from './kilder/falsk/falsk.ts';
import { legacyKilder } from './kilder/legacy/legacy.ts';
import { lavVaultStier, NOTER_ID } from './kilder/noter/stier.ts';
import { noterKilde } from './kilder/noter/noter.ts';
import { mailImapKilde } from './kilder/mail-imap/mail-imap.ts';
import { nyhederRss, NYHEDER_RSS_ID, type NyhederRssKilde } from './kilder/nyheder-rss/kilde.ts';
import { aulaKalender, AULA_KALENDER_ID } from './kilder/aula-kalender/kilde.ts';
import { beskederKilde, BESKEDER_ID, type BeskederKilde } from './kilder/beskeder/kilde.ts';
import type { Kontakt } from './kilder/beskeder/besked.ts';
import { mailForbindelse } from './kilder/mail-vindue.ts';
import { KENDTE_DOMAENER } from './kilder/danmark/digital-post.ts';
import { googleKalender } from './kilder/google-kalender/kilde.ts';
import { mailGmail } from './kilder/mail-gmail/kilde.ts';
import { readNyhederSource } from './rooms/nyheder/source.ts';
import { parseAll } from './rooms/mail/source.ts';
import { falskKildeData } from './testtilstand/indhold/kilder.ts';
import { PRODUKT } from './shell/navn.ts';
import { hjaelpFraMiljoe } from './shell/hjaelp.ts';
import type { BetaIndstilling } from './beta/miljoe.ts';
import { betaFraMiljoe } from './beta/miljoe.ts';
import { BetaFejl, kortDue, lavBetaLager, utcDato, type FeedbackDag } from './beta/tilstand.ts';
import { parseFeedbackSvar } from './beta/feedback.ts';
import { byggMaal, dageFraDagstal, foersteVaerdiFraStart, type MaalKilder } from './beta/maal.ts';
import { laesBetaPriser } from './beta/priser.ts';
import { renderDeling } from './beta/side.ts';
import type { BetaVisning } from './rooms/hjem/beta.ts';
import type { PostVisning } from './rooms/hjem/digitalpost.ts';
import { aulaHaendelser, type AulaVisning } from './rooms/hjem/aula.ts';
import { DanmarkFejl, lavDanmarkLager } from './danmark/tilstand.ts';
import { DanmarkAfvist, lavDanmark, type MailSyn } from './danmark/vindue.ts';
import { parseStartState } from './rooms/start/schema.ts';
import { manifest } from './shell/manifest.ts';
import { MODEL_ENV_NOEGLER, udbyderAf, UDBYDERE } from './rooms/start/udbydere.ts';
import { MODEL_FEJL } from './rooms/start/modelfejl.ts';
import { modelKlaret, type ModelSyn } from './rooms/start/trin.ts';
import { createDirekte } from './agent/direkte.ts';
import { envNoegleLager } from './agent/noeglelager.ts';
import { filNoegleLager } from './hemmeligheder/lager-fil.ts';
import { registrerNoegleLager } from './hemmeligheder/registrer.ts';
import { redigerKonsol } from './graenser/redaktion.ts';
import { lavAgentNoegleSkriver, saetMiljoeNoegle } from './kilder/hemmeligheder.ts';

/** KC-0127: Hermes' provider id for the provider chosen in Start's step 2 (none chosen = Hermes' own default, as on kira-home). */
const hermesProvider = (s: Settings): string | undefined => (s.udbyder ? udbyderAf(s.udbyder)?.hermesProvider : undefined);

/** KC-0127: the model settings as Start reads them (each tier's test keyed to its revision); KC-0180 health reads the same. */
const modelSyn = (s: Settings): ModelSyn => ({
  ...(s.udbyder ? { udbyder: s.udbyder } : {}), modeller: s.modeller, test: s.modelTest ?? {},
  rev: { lille: modelRevision(s.udbyder, s.modeller.lille), taenker: modelRevision(s.udbyder, s.modeller.taenker) },
});

export type AppDeps = {
  store: RumLager;
  hermes: AgentClient;
  /**
   * KC-0127: Start's step 2. `fetchImpl` for model discovery (tests: a stub), `testMs` the live test's timeout
   * (default 20 s), `miljoe` where Clawco's own key to Hermes is saved (default KC_ENV_FILE / .env and process.env).
   */
  model?: { fetchImpl?: typeof fetch; testMs?: number; miljoe?: { fil?: string; env?: Record<string, string | undefined> } };
  sourceGlob: string;
  mailStateDir?: string;
  mailRunner?: Runner;
  himalaya?: string;
  vaultInbox?: string;
  /** KC-0142: the vault root (KC_VAULT_DIR, only when set); absent = the parent of vaultInbox, else the vault chosen on the notes card, else <dataDir>/vault (kilder/noter/stier.ts, KC-0213). */
  vaultDir?: string;
  maxParallel?: number;
  kalenderScript?: string;
  dataDir?: string;
  now?: () => Date;
  sha?: string;
  publicDir?: string;
  /** KC-0015: the voice. Absent = no voice in the UI and 503 on /api/stemme/*. */
  stemme?: StemmeClient;
  /** KC-0017: the canonical address (KC_ADRESSE). Short host names redirect here. */
  adresse?: string;
  /** KC-0023: the vault's people register (KC_PEOPLE_DIR) Hermes looks people up in. KC-0136: absent = the chosen vault's. */
  personer?: string;
  /** KC-0136: the inbox when neither KC_VAULT_INBOX nor a vault chosen on the notes card says where (npm run dev). */
  vaultInboxStandard?: string;
  /** KC-0116: a fixed person for every request (the test world's fictional owner); KC-0179: konto = the Sky gateway's signature; absent = the tailnet identity. */
  identitet?: Identitetsvalg;
  /** KC-0132: the connectors this app offers (fakes in dev and the test world, the host's legacy adapters otherwise). */
  kilder?: Kilde[];
  /**
   * KC-0138: the Beskeder connector, made here so it can read senders from the people register this app resolves
   * (KC-0136). Absent = no message source offered.
   */
  beskeder?: (o: { kontakter: () => Promise<Kontakt[]> }) => Kilde;
  /** KC-0212: the operator's cost ledger for the owner card in Kø, and paid MRR in øre (0 until billing feeds it). Absent = no card. */
  omkostninger?: { laes: () => Promise<Omkostninger | null>; mrr: () => number };
  /** KC-0129: where Start's import keeps raw uploads while a proposal is made (default `<os tmp>/clawco-import`); tests point it into their own dir. */
  importTmp?: string;
  /**
   * KC-0153: the go-between's channel (src/hushold/kanal.ts: hermes or fake). Only the human-tap send route holds it;
   * the rooms' clock gets its read side alone. Absent = no Send on a request (the route answers 503).
   */
  kanal?: KanalClient;
  /**
   * KC-0161: the local Tailscale for Start's card. `koerer` runs the CLI (src/shell/tailscale.ts; tests inject a stub),
   * `port` is what the button shares, `laptop` (KC-0160) says this is a laptop install, `cacheMs` how long a read is kept
   * (default none; the real app keeps 5 s so a page view is not two process starts). Absent = no card.
   */
  tailscale?: { koerer: TsKoerer; port: number; laptop?: () => boolean; cacheMs?: number };
  /** KC-0160: laptop mode (KC_LAPTOP=ja, src/identitet/laptop.ts): one owner, the identity header ignored, Start without the household question. */
  laptop?: boolean;
  /** KC-0201: under Clawco Sky (KC_SKY=ja, shell/hjaelp.ts) the account app's help page; the Kø panel shows "Få hjælp". Absent = no link. */
  hjaelp?: { href: string };
  /**
   * KC-0188: "Lad support se med" — where the owner's card and the band's Slå fra post to (under Sky: the gateway's
   * /_sky/stoette and /_sky/stoette/slaa-fra). Absent = no card, no band, and no support identity is ever accepted.
   */
  stoette?: { slaaTil: string; slaaFra: string };
  /** KC-0187: an unexpected 500 is reported, scrubbed (shell/fejlrapport.ts; off unless KC_FEJLRAPPORT_DSN is set). */
  fejlrapport?: Fejlrapport;
  /**
   * KC-0203: the closed beta (KC_BETA=ja, src/beta/miljoe.ts; Clawco Sky sets it when it provisions a beta household).
   * Absent = nothing of the beta exists: no card, no page, no link, no route. Needs `dataDir` (beta.json lives there).
   */
  beta?: BetaIndstilling;
  /**
   * KC-0233: the Danmark-pakke's Digital Post rule (src/danmark/). Always on with a data dir (it shows nothing until a mail
   * source is connected and the owner confirmed the notification sender). `domaener` adds to the hint domains (the test world's invented
   * one); `cacheMs` is how long one read of the mail is reused (default 2 minutes; 0 in the test world, whose moments change the mail).
   */
  danmark?: { domaener?: readonly string[]; cacheMs?: number };
};

/** KC-0116: who is looking, set once per request by the identity middleware. */
type Hvem = { person: Person; husstand: Person[] };
/** KC-0188: this tenant's record of a support grant, as read for this request (null = none or unreadable). */
type Env = { Variables: Hvem & { stoette: StoetteAdgang | null } };

/**
 * KC-0124: which audit lines a person reads. The owner reads all (the household's oversight; metadata only); a member
 * or child their own lines, the household's and every stop/resume. A guest reads none (the routes answer 403).
 */
function synligRevision(p: Person, e: Revisionslinje): boolean {
  if (p.rolle === 'gaest') return false;
  if (p.rolle === 'ejer' || e.person === p.id || e.kilde === 'nodstop') return true;
  return e.zoner.length > 0 && e.zoner.every((z) => z === 'husstand');
}
const START = Date.now();

/** What a run says it is doing, by kind (KC-0100: also the fallback in the Kø panel for runs no room tagged). */
const LABELS: Record<string, string> = { opdater: 'bygger rummet', handling: 'udfører en handling', fortryd: 'fortryder', chat: 'svarer i chatten', nyt: 'skriver udkast', forslag: 'laver forslag', brug: 'bruger forslag', afvis: 'afviser forslag', vaelg: 'skifter udkast', gem: 'gemmer', faerdig: 'rydder op', kladde: 'gemmer kladde', baggrund: 'flytter i baggrunden', frontload: 'bygger rummet (planlagt)', univers: 'svarer i universet', forbered: 'forbereder mødet', nytUnivers: 'opretter univers', placerMoede: 'lægger mødet i univers', skjulMoede: 'skjuler mødet', opgaveStatus: 'flytter opgaven', nytMoede: 'tilføjer mødet', arkiver: 'arkiverer universet', kurator: 'ordner kortene', laer: 'lærer af dit valg', send: 'sender et svar', afmeld: 'afmelder', analyse: 'analyserer' };

/** Nu's greeting: by the hour, to the profile's name (the reference installation has no profile: Henrik). */
function hilsen(now: Date, navn: string | undefined): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hour12: false }).format(now));
  return tekst().hilsen(h, navn ?? 'Henrik');
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  // KC-0124: the kill switch's pause and the audit log live on the data dir (none without one: in memory / off).
  // KC-0126: the profile from Start's step 1 (none without a data dir); every run is told it.
  const profil = deps.dataDir ? lavProfilLager(deps.dataDir) : undefined;
  // KC-0136: the inbox and the people register come from the vault chosen on the notes card (kilder.json);
  // vaultInbox / personer (KC_VAULT_INBOX / KC_PEOPLE_DIR) still win.
  const stier = lavVaultStier({ ...(deps.dataDir ? { dataDir: deps.dataDir } : {}), env: { KC_VAULT_DIR: deps.vaultDir, KC_VAULT_INBOX: deps.vaultInbox, KC_PEOPLE_DIR: deps.personer }, ...(deps.vaultInboxStandard ? { standardIndbakke: deps.vaultInboxStandard } : {}) });
  const personerNu = (): string | undefined => stier().personer || undefined;
  const runs = createRunRegistry(deps.hermes, { maxParallel: deps.maxParallel ?? 2, now, pause: lavPause(deps.dataDir), personer: () => stier().personer, ...(profil ? { profil: () => profil.laesNu() } : {}) });
  const revision = deps.dataDir ? lavRevisionslog(deps.dataDir, { nu: now }) : undefined;
  // KC-0142: the rules file in the vault; its integrity sha lives in the data dir (none without one: no rules).
  // KC-0213: the ONE vault root (stier().rod) — the rules file and the ledgers follow it, as do the inbox and the register.
  const vaultDir = (): string => stier().rod;
  const regler = vaultDir() && deps.dataDir ? lavReglerLager({ vaultDir: vaultDir(), dataDir: deps.dataDir }) : undefined;
  const regnskabsfil = lavRegnskabsfil({ dataDir: deps.dataDir, rod: vaultDir });
  // KC-0147: what required Henrik, per day (none without a data dir).
  const dagstal = deps.dataDir ? lavDagstal({ dir: deps.dataDir }) : undefined;
  // KC-0145: what the app kept off the screen, and the Sunday sample's ledger (none without a data dir).
  const skjulte = deps.dataDir ? lavSkjulte({ dir: deps.dataDir }) : undefined;
  const stikbog = deps.dataDir ? lavStikbog({ dir: deps.dataDir }) : undefined;
  const settings = createSettings(deps.dataDir ?? './data');
  void settings.read().then((s) => runs.setModels(s.modeller, hermesProvider(s)));
  const live = createLiveBus(Date.now());
  // KC-0117: the person of the request being served; `d.person` reads it, so rooms need no extra parameter.
  const hvemNu = new AsyncLocalStorage<Person>();
  /** KC-0160: laptop mode now (the test world's moments set it by a function, the real app by KC_LAPTOP at start). */
  const laptopNu = (): boolean => (deps.tailscale?.laptop ? deps.tailscale.laptop() : deps.laptop === true);
  const d: RoomDeps = {
    laptop: laptopNu,
    get person(): Person { return hvemNu.getStore() ?? INGEN; },
    live,
    store: deps.store, hermes: deps.hermes, runs, now,
    dagenSourceGlob: deps.sourceGlob,
    mailStateDir: deps.mailStateDir ?? '',
    mailRunner: deps.mailRunner ?? defaultRunner(),
    himalaya: deps.himalaya ?? 'himalaya',
    get vaultInbox(): string { return stier().indbakke; },
    get vaultRod(): string { return vaultDir(); },
    regnskabsfil,
    kalenderScript: deps.kalenderScript ?? '',
    ...(revision ? { revision } : {}),
    ...(regler ? { regler } : {}),
    ...(skjulte ? { skjulte } : {}),
    ...(profil ? { profil } : {}),
    retBus: lavRetBus(),
    regelforslag: { afventer: ventendeForslagNu }, // KC-0227: Start's step 6 reads the very list Nu's card is drawn from
    ...(deps.importTmp ? { importTmp: deps.importTmp } : {}),
  };
  // KC-0161: Start's Tailscale card — the read-only state and the one share command, both through the allow-listed runner.
  if (deps.tailscale) {
    const t = deps.tailscale;
    const laptop = laptopNu;
    let husket: { tid: number; syn: TsSyn } | undefined;
    d.tailscale = {
      port: t.port,
      laptop,
      async laes() {
        if (t.cacheMs && husket && Date.now() - husket.tid < t.cacheMs) return husket.syn;
        const syn = await laesTailscale(t.koerer, { port: t.port, laptop: laptop() });
        husket = t.cacheMs ? { tid: Date.now(), syn } : undefined;
        return syn;
      },
      async del() { husket = undefined; return delPaaTailnet(t.koerer, { port: t.port, laptop: laptop() }); },
    };
  }
  // KC-0130: Start's step 6 hears the first Ret / Ikke relevant (Luk, and Hjem's chat about a card).
  d.retBus!.lyt(modtagRet);
  // KC-0127: Start's window on the model settings (one store with the Kø panel); none without a data dir.
  if (deps.dataDir) {
    const miljoe = deps.model?.miljoe;
    d.model = {
      async laes() { return modelSyn(await settings.read()); },
      async vaelg(v) {
        const s = await settings.setModels({ lille: v.lille, taenker: v.taenker }, { udbyder: v.udbyder });
        runs.setModels(s.modeller, hermesProvider(s));
      },
      async saetTest(niveau, t) { await settings.setModelTest({ [niveau]: t }); },
      saetAgentNoegle: (vaerdi) => saetMiljoeNoegle('KC_HERMES_API_KEY', vaerdi, { ...(miljoe?.fil ? { fil: miljoe.fil } : {}), ...(miljoe?.env ? { env: miljoe.env } : {}) }),
      ...(deps.model?.fetchImpl ? { fetchImpl: deps.model.fetchImpl } : {}),
      testMs: deps.model?.testMs ?? 20_000,
    };
  }
  // KC-0132: the connector registry; which are connected lives in kilder.json on the data dir.
  // KC-0139: health state of the connected sources; a read through the registry tells it how it went (the controller is made below).
  const helbredRef: { styring?: HelbredStyring } = {};
  const kilder = lavRegister({
    dataDir: deps.dataDir ?? './data', store: deps.store, nu: now, live, efterLaesning: (id, ok) => helbredRef.styring?.laesning(id, ok).catch((err: unknown) => { console.error('helbred:', err instanceof Error ? err.message : err); }), ...(revision ? { revision } : {}), ...(deps.adresse ? { adresse: deps.adresse } : {}),
    // KC-0128: the first value without the agent — Start stores the preview from the read, then the matching
    // room rebuild and Kuratoren start (the preview stays until the rebuild lands; Start retires it).
    async foersteLaesning({ kilde: k, laesning, zone, forbundet, person }) {
      const { rum } = await modtagFoersteLaesning(d, { kilde: { id: k.id, navn: k.navn, slags: k.slags }, laesning, zone, ejer: person.id, forbundet });
      live.notify(HJEM);
      const mod = rum ? getRoomModule(rum) : undefined;
      if (mod && rum) {
        try { const run = await mod.opdater(d, 'opdater', { kanal: 'baggrund' }); if (run) tag(run, rum); } catch (err) { console.error('kilder: rummet kunne ikke bygges efter første læsning:', err instanceof Error ? err.message : err); }
      }
      void startKuratoren(false).catch(() => {});
    },
  });
  for (const k of deps.kilder ?? []) kilder.registrer(k);
  // KC-0138: messages read the people register for their senders (KC-0225: a person's per-channel ids stay inside the connector; only name and relation come out).
  if (deps.beskeder) {
    kilder.registrer(deps.beskeder({
      kontakter: async () => {
        const dir = personerNu();
        return dir ? (await laesPersoner(dir, { zone: 'privat' })).map((p) => ({ id: p.sti, navn: p.navn, relation: p.relation, kanaler: p.kanaler ?? {} })) : [];
      },
    }));
  }
  // KC-0138: Kuratoren's window on the chosen conversations — every connected message source, read through the registry.
  d.beskeder = async () => {
    const ud = [];
    for (const k of await kilder.forbundne('beskeder')) {
      try { const l = await kilder.laes(k.id); if (l.slags === 'beskeder') ud.push(...l.data); } catch { /* not readable now: the health check says why */ }
    }
    return ud;
  };
  const helbred = lavHelbredStyring({ dataDir: deps.dataDir ?? './data', nu: now, register: kilder, store: deps.store, live });
  helbredRef.styring = helbred;
  // KC-0137: Nyheder's own feeds — null = the connector is not connected; connected but unreadable = an empty list (health says why).
  d.rssNyheder = async () => {
    try {
      if (!(await kilder.forbundne('nyheder')).some((k) => k.id === NYHEDER_RSS_ID)) return null;
    } catch { return null; }
    try {
      const l = await kilder.laes(NYHEDER_RSS_ID);
      if (l.slags === 'nyheder') return { nyheder: l.data.nyheder, kilder: l.data.status };
    } catch { /* not readable now: the health check says why */ }
    return { nyheder: [], kilder: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } };
  };
  // KC-0233: the Danmark-pakke's Digital Post rule — a rule over the envelopes of the owner's own (privat) mail sources, read
  // through the registry like every read (so health, zones and the envelope-only cut apply). Not a connector: no access of its own.
  const danmark = deps.dataDir ? lavDanmark({
    lager: lavDanmarkLager({ dir: deps.dataDir }), nu: now,
    ...(deps.danmark?.domaener ? { domaener: [...KENDTE_DOMAENER, ...deps.danmark.domaener] } : {}),
    ...(deps.danmark?.cacheMs !== undefined ? { cacheMs: deps.danmark.cacheMs } : {}),
    async laesMail(): Promise<MailSyn> {
      try {
        const privat = [];
        for (const k of await kilder.forbundne('mail')) if ((await kilder.hvor(k.id).catch(() => null))?.zone === 'privat') privat.push(k);
        if (!privat.length) return { forbundet: false, kuverter: null };
        const svar = await Promise.allSettled(privat.map((k) => kilder.laes(k.id)));
        const ok = svar.flatMap((r) => (r.status === 'fulfilled' && r.value.slags === 'mail' ? [r.value.data] : []));
        return ok.length ? { forbundet: true, kuverter: ok.flat() } : { forbundet: true, kuverter: null };
      } catch { return { forbundet: false, kuverter: null }; } // a kilder.json that cannot be read: nothing here (the Kø panel says why)
    },
  }) : undefined;
  if (danmark) {
    const somFejl = <T>(f: () => Promise<T>): Promise<T> => f().catch((err: unknown) => { throw err instanceof DanmarkAfvist ? new ActionError(err.message, err.status === 409 ? 409 : 400) : err; });
    d.danmark = { start: () => danmark.start(), gem: (a, v) => somFejl(() => danmark.gem(a, v)), ikkeNu: () => danmark.ikkeNu(), aulaUdsat: () => danmark.aulaUdsat(), aulaIkkeNu: () => danmark.aulaIkkeNu() };
  }
  d.mailForbindelse = () => mailForbindelse(kilder); // KC-0214: Mail through the connector's verbs when no host mail source is connected
  // KC-0139: what the health state says — cards for Nu, freshness for the rooms, a sentence for the voice. Display only:
  // a kilder.json that cannot be read shows nothing here (the Kø panel says why), it never breaks a page.
  const kortTilstande: readonly string[] = ['snart-udloebet', 'log-ind-igen', 'nede'];
  /** Per connected source: what the health file remembers (sources never read nor checked have no entry). */
  async function kildeStand(): Promise<{ kilde: Kilde; vist: string; f: KildeFriskhed }[]> {
    try {
      const fil = await helbred.laes();
      return (await kilder.forbundneAlle()).flatMap((k) => {
        const p = fil[k.id];
        return p ? [{ kilde: k, vist: p.vist, f: { slags: k.slags, ...(p.sidstLaest ? { sidstLaest: p.sidstLaest } : {}), ok: p.vist === 'ok' || p.vist === 'snart-udloebet' } }] : [];
      });
    } catch (err) {
      if (!(err instanceof KonfigFejl)) throw err;
      return [];
    }
  }
  async function kildeHelbredNu(): Promise<KildeHelbredKort[]> {
    let fil: Awaited<ReturnType<typeof helbred.laes>>;
    try { fil = await helbred.laes(); } catch { return []; }
    const ud: KildeHelbredKort[] = [];
    for (const [id, p] of Object.entries(fil)) {
      if (!kortTilstande.includes(p.vist)) continue;
      let f: Awaited<ReturnType<typeof kilder.forbindelse>>;
      try { f = await kilder.forbindelse(id); } catch (err) {
        if (err instanceof KonfigFejl) return [];
        console.error(`helbred: kortet for ${id} kunne ikke bygges:`, err instanceof Error ? err.message : err); // a card that cannot be built never breaks the page
        continue;
      }
      if (!f) continue; // no longer connected: no card
      if (!synligFor(d.person, { zone: f.zone, ...(f.af ? { ejer: f.af } : {}) })) continue; // KC-0117: the count and the page show only what this person may see
      ud.push({
        id, navn: f.kilde.navn, slags: f.kilde.slags, auth: f.kilde.auth, vist: p.vist as KildeHelbredKort['vist'], zone: f.zone,
        ...(f.af ? { ejer: f.af } : {}), ...(p.sidstLaest ? { sidstLaest: p.sidstLaest } : {}), ...(p.udloeber ? { udloeber: p.udloeber } : {}),
        felter: genforbindFelter(f.kort.felter, f.valg), kanForbinde: kan(d.person.rolle, 'aendre-indstillinger'),
      });
    }
    return ud;
  }
  /** The source a room's label speaks of: the one not current (the oldest), else the most recently read; null = nothing to say. */
  d.kildeFriskhed = async (slags) => {
    const alle = (await kildeStand()).filter((s) => s.f.slags === slags).map((s) => s.f);
    const gamle = alle.filter((f) => !erFrisk(f, now()) && kildeFriskhed(f, now()).s !== '').sort((a, b) => (a.sidstLaest ?? '').localeCompare(b.sidstLaest ?? ''));
    return gamle[0] ?? alle.filter((f) => erFrisk(f, now())).sort((a, b) => (b.sidstLaest ?? '').localeCompare(a.sidstLaest ?? ''))[0] ?? null;
  };
  /** By slags: sources whose elements must not pass as current. */
  async function gamleNu(): Promise<Partial<Record<string, KildeFriskhed>>> {
    const ud: Partial<Record<string, KildeFriskhed>> = {};
    for (const slags of new Set((await kildeStand()).map((s) => s.f.slags))) {
      const f = await d.kildeFriskhed?.(slags as 'kalender' | 'mail');
      if (f && !erFrisk(f, now())) ud[slags] = f;
    }
    return ud;
  }
  /** One sentence per source that is log-ind-igen or nede (the voice says nothing of the rest). */
  async function stemmeHelbred(): Promise<string[]> {
    const ud: string[] = [];
    for (const s of await kildeStand()) {
      const t = stemmeSaetning(s.vist, s.kilde.auth, s.kilde.slags);
      const hvor = t ? await kilder.hvor(s.kilde.id).catch(() => null) : null;
      if (t && hvor && synligFor(d.person, { zone: hvor.zone, ...(hvor.af ? { ejer: hvor.af } : {}) })) ud.push(t);
    }
    return ud;
  }
  // KC-0133: Dagen's week from the connected calendar; one the user connected wins over the host's own (legacy) one.
  d.ugeKalender = async () => {
    try {
      const forbundne = await kilder.forbundne('kalender');
      // KC-0235: a calendar read into the household zone (Aula's) belongs to the shared week in Husstanden; it never hides a
      // personal one here, and builds the day only when it is the only calendar there is.
      const zoner = await Promise.all(forbundne.map(async (k) => (await kilder.hvor(k.id).catch(() => null))?.zone));
      const personlige = forbundne.filter((_k, i) => zoner[i] !== 'husstand');
      const kandidater = personlige.length ? personlige : forbundne;
      const valgt = kandidater.find((k) => k.standard !== 'forbundet') ?? kandidater[0];
      if (!valgt) return null;
      const l = await kilder.laes(valgt.id);
      return l.slags === 'kalender' ? { uge: l.data, fraVaerten: valgt.standard === 'forbundet' } : null;
    } catch { return null; /* not readable now: the health check (Kilder in Kø) says why; Dagen builds without a week */ }
  };
  // KC-0126: what Start reads of the rest of the app (spec §3 Done; the registry for "worth adding").
  d.rejse = {
    async faerdigInput() {
      const kurator = synligKurator(await laesKurator(deps.store), d.person);
      // Real elements: open Kuratoren cards, every other room's waiting lines, and the cards closed in Nu (each was one Nu showed).
      let venterLinjer = 0;
      for (const m of ROOM_MODULES) if (m.id !== START_RUM) venterLinjer += (await m.hjemVenter(d)).length;
      const lukket = kurator.lukket?.length ?? 0;
      // Ret = the card's ask control (a Hjem chat line about "Kortet: …"); Ikke relevant = Luk with a reason.
      const rettet = lukket > 0
        || (await deps.store.readLog(HJEM, 200)).some((e) => e.kilde === 'henrik' && e.tekst.startsWith('Lukkede "'))
        || (await deps.store.readChat(HJEM, 200)).some((e) => e.fra === 'henrik' && (e.kontekst ?? '').startsWith('Kortet: '));
      // KC-0128: a source's preview is a real element too (built from data actually read).
      const foerste = (await forhaandsvisningerNu(d)).length;
      return { nuElementer: synligeKort(kurator.kort, now()).length + venterLinjer + lukket + foerste, rettet };
    },
    // KC-0130: step 6 points at the first element that carries Ret: a source's preview, else Kuratoren's first card.
    async foersteKort() {
      const forhaand = (await forhaandsvisningerNu(d))[0];
      if (forhaand) return { titel: forhaand.titel };
      const kort = synligeKort(synligKurator(await laesKurator(deps.store), d.person).kort, now())[0];
      return kort ? { titel: kort.titel } : null;
    },
    async kilder() {
      const alle = kilder.liste();
      const forbundne = new Set<string>();
      for (const slags of new Set(alle.map((k) => k.slags))) for (const k of await kilder.forbundne(slags)) forbundne.add(k.id);
      return alle.map((k) => ({ id: k.id, navn: k.navn, slags: k.slags, forbundet: forbundne.has(k.id) }));
    },
    // KC-0128: the onboarding cards for Start's steps 3–4 (health only for connected sources).
    async kort() {
      return (await kilder.oversigt()).map((o) => ({ id: o.id, navn: o.navn, slags: o.slags, zone: o.zone, forbundet: o.forbundet, helbred: o.helbred, kort: o.kort }));
    },
    async mail() {
      const ud: { emne: string; modtaget: string }[] = [];
      for (const k of await kilder.forbundne('mail')) {
        try {
          const l = await kilder.laes(k.id);
          if (l.slags === 'mail') ud.push(...l.data.map((m) => ({ emne: m.emne, modtaget: m.modtaget })));
        } catch { /* a source that cannot be read adds nothing */ }
      }
      return ud;
    },
  };
  // KC-0148: what the household universe reads — the persons of husstand.json (E1) and the calendars connected in
  // the husstand zone (a calendar in privat or arbejde is not even read). A host calendar (nobody connected it) is the owner's.
  const personerIHusstand = async (): Promise<Person[]> => {
    try { return (await laesHusstand(deps.dataDir ?? './data'))?.personer ?? []; } catch (err) {
      if (err instanceof HusstandFejl) return []; // the identity middleware already answers 503 for a broken file
      throw err;
    }
  };
  d.husstand = {
    personer: personerIHusstand,
    // KC-0154: the owner's invite, role change and removal (the room calls it inside its queue); validated and atomic.
    gemPersoner: (personer) => skrivHusstand(deps.dataDir ?? './data', { personer }),
    async kalendere() {
      const ejer = (await personerIHusstand()).find((p) => p.rolle === 'ejer')?.id ?? null;
      const ud: KalenderLaesning[] = [];
      for (const k of await kilder.forbundne('kalender')) {
        try {
          const { zone, af } = await kilder.hvor(k.id);
          if (zone !== 'husstand') continue;
          const l = await kilder.laes(k.id);
          if (l.slags === 'kalender') ud.push({ zone, ejer: af ?? ejer, data: l.data });
        } catch { /* a calendar that cannot be read adds nothing */ }
      }
      return ud;
    },
    // KC-0152: every connected calendar of every zone for the Tuesday weekend check, which keeps busy blocks only (and a
    // title only from a husstand-zone calendar or an owner who shares titles). The rules file is the vault owner's, so
    // the title rule applies to the household's owner; any other member stays busy-only (fail closed).
    async alleKalendere() {
      const ejer = (await personerIHusstand()).find((p) => p.rolle === 'ejer')?.id ?? null;
      const l = regler ? await regler.laes() : undefined;
      const deler = l?.tilstand === 'ok' && delerTitelRegel(l.saet.regler);
      const ud: OptagetKalender[] = [];
      for (const k of await kilder.forbundne('kalender')) {
        try {
          const { zone, af } = await kilder.hvor(k.id);
          const laes = await kilder.laes(k.id);
          if (laes.slags !== 'kalender') continue;
          const hvem = af || ejer;
          ud.push({ zone, ejer: hvem, data: laes.data, delerTitel: deler && hvem !== null && hvem === ejer });
        } catch { /* a calendar that cannot be read adds nothing */ }
      }
      return ud;
    },
    synlig: () => husstandSynlig(d),
    // KC-0153: the channel's read side only — send stays with the human-tap route below.
    ...(deps.kanal ? { kanalSvar: (siden: string) => deps.kanal!.hentSvar(siden) } : {}),
  };
  // KC-0129: Start's import writes people and the profile through the notes connector's writers (the vault chosen on the
  // notes card, or the env paths); "Lav en mappe til mig" sets the notes connector up as the card does.
  d.importSkriver = lavImportSkriver({
    stier,
    ...(kilder.hent(NOTER_ID) ? { lavMappe: async () => { await kilder.forbind(NOTER_ID, { felter: { opsaetning: 'ny' } }, d.person); } } : {}),
  });
  // KC-0203: the closed beta's state (beta.json) and what it may send. Nothing exists without deps.beta; in the test world
  // (kunMedFil) the beta is on only while its data folder carries beta.json, which a moment writes (src/testtilstand).
  const betaLager = deps.beta && deps.dataDir ? lavBetaLager({ dir: deps.dataDir, nu: now, samtykkeStart: deps.beta.samtykkeStart, ...(deps.beta.kunMedFil ? { kunMedFil: true } : {}) }) : undefined;
  const betaFil = path.join(deps.dataDir ?? './data', 'beta.json');
  const betaPaa = (): boolean => !!betaLager && (!deps.beta!.kunMedFil || existsSync(betaFil));
  /** The beta's state, or null when it is off. A damaged file is logged and read as "no beta now" for Nu (never breaks it). */
  async function betaNu() {
    if (!betaLager || !betaPaa()) return null;
    try { return await betaLager.laes(); } catch (err) {
      if (!(err instanceof BetaFejl)) throw err;
      console.error('beta:', err.message);
      return null;
    }
  }
  /** The numbers the pull route and "Hvad deler jeg?" show, read lazily: with consent off they are not even read. */
  const maalKilder = (t: NonNullable<Awaited<ReturnType<typeof betaNu>>>): MaalKilder => ({
    tilstand: t,
    foersteVaerdi: async () => foersteVaerdiFraStart(parseStartState(await deps.store.readState('start')), t.startet),
    dage: async () => (dagstal ? dageFraDagstal(await dagstal.dage(), idagKbh(now())) : []),
  });
  /** KC-0233: what Nu is told about Digital Post (the owner's): unseen notices, "kan ikke se", or nothing. A damaged state file reads as nothing here. */
  async function postVisning(): Promise<PostVisning | undefined> {
    if (!danmark || d.person.rolle !== 'ejer') return undefined;
    try { return (await danmark.nu()) ?? undefined; } catch (err) {
      if (!(err instanceof DanmarkFejl)) throw err;
      console.error('danmark:', err.message);
      return undefined;
    }
  }
  /**
   * KC-0236: what Nu is told about Aula — today's and tomorrow's events, for whoever the shared week is for (src/hushold/rettigheder.ts
   * `maaSe`, the same check as the week's: owner, member and child yes, a guest no; in the zone the connection was made in, so a
   * connection moved to privat is its owner's alone). The events come through the registry like every read. Nothing due, not
   * connected or not readable = nothing here (the Kø panel and Nu's connection card say why).
   */
  async function aulaVisning(): Promise<AulaVisning | undefined> {
    try {
      const k = (await kilder.forbundne('kalender')).find((x) => x.id === AULA_KALENDER_ID);
      if (!k) return undefined;
      const { zone, af } = await kilder.hvor(k.id);
      if (!maaSe(d.person, { slags: 'uge', zone, ...(af ? { ejer: af } : {}) })) return undefined;
      const l = await kilder.laes(k.id);
      if (l.slags !== 'kalender') return undefined;
      const haendelser = aulaHaendelser(l.data, now());
      return haendelser.length ? { haendelser, zone } : undefined;
    } catch { return undefined; }
  }
  /** KC-0203: what Nu is told about the beta: the plain card first, else the feedback card that is due; the owner's only. */
  async function betaVisning(): Promise<BetaVisning | undefined> {
    if (d.person.rolle !== 'ejer') return undefined;
    const t = await betaNu();
    if (!t) return undefined;
    if (!t.betaKortLukket) return { kort: true };
    const dag = kortDue(t, now());
    if (dag === null) return undefined;
    return { feedback: { dag, priser: dag === 14 ? await laesBetaPriser(deps.beta!.priserFil) : null } };
  }

  const app = new Hono<Env>();

  // KC-0017: a MagicDNS short name (`kontrol/`, plain http) goes to the canonical https address.
  if (deps.adresse) {
    const adresse = deps.adresse.replace(/\/+$/, '');
    app.use('/*', async (c, next) => {
      const url = new URL(c.req.url);
      const kort = !url.hostname.includes('.') && !url.hostname.includes(':') && !url.hostname.startsWith('[') && url.hostname !== 'localhost';
      if (kort) return c.redirect(adresse + url.pathname + url.search, 301);
      await next();
    });
  }

  // KC-0184: Clawco Sky's control call (identitet/kontrol.ts) — an accepted invitation, a removal, a member leaving, a
  // role change. Before the identity middleware: it carries no person, and a person's Clawco-Konto never opens it.
  // Only under konto identity; the gateway never forwards /intern/ from outside (sky/src/gateway/forbud.ts).
  const kontrolKonto = deps.identitet && 'konto' in deps.identitet ? deps.identitet.konto : undefined;
  const kontrolNonces = nonceLager();
  // The body is read only up to its limit (bodyLimit stops a larger one while it streams), never whole.
  const internGraense = bodyLimit({ maxSize: INTERN_MAKS_BYTES, onError: (c) => c.json({ error: 'For stor' }, 413) });
  app.post(INTERN_STI, async (c, next) => (kontrolKonto ? next() : c.json({ error: 'Findes ikke' }, 404)), internGraense, async (c) => {
    if (!kontrolKonto) return c.json({ error: 'Findes ikke' }, 404);
    const krop = Buffer.from(await c.req.arrayBuffer());
    const v = verificerKontrol({ headers: c.req.raw.headers, peer: peerAf(c.env), metode: c.req.method, sti: c.req.path, krop }, kontrolKonto, Math.floor(now().getTime() / 1000), kontrolNonces);
    if (!v.ok) {
      console.warn('intern: kontrolkald afvist:', v.grund);
      return c.json({ error: 'Clawco ved ikke, hvem du er.' }, 401);
    }
    try {
      let raw: unknown;
      try { raw = JSON.parse(krop.toString('utf8')); } catch { throw new InvitationFejl('Ugyldig forespørgsel.'); }
      const r = await internMedlem(d, parseIntern(raw));
      return c.json({ ok: true, aendret: r.aendret });
    } catch (err) {
      if (err instanceof InvitationFejl || err instanceof ActionError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  // KC-0203: Clawco Sky pulls the beta household's consented numbers (once a day), as a control call: GET, no body, signed
  // like the one above (identitet/kontrol.ts) — the signature covers this tenant, method GET, the path /api/beta/maal (no
  // query string) and the SHA-256 of the empty body. Only under konto identity and only while the beta is on (else 404).
  // Before the identity middleware: it carries no person. No channel from the tenant to Sky exists; this is the only way out.
  app.get('/api/beta/maal', internGraense, async (c) => {
    if (!kontrolKonto || !betaPaa()) return c.json({ error: 'Findes ikke' }, 404);
    const krop = Buffer.from(await c.req.arrayBuffer());
    const v = verificerKontrol({ headers: c.req.raw.headers, peer: peerAf(c.env), metode: c.req.method, sti: c.req.path, krop }, kontrolKonto, Math.floor(now().getTime() / 1000), kontrolNonces);
    if (!v.ok) {
      console.warn('beta: kontrolkald afvist:', v.grund);
      return c.json({ error: 'Clawco ved ikke, hvem du er.' }, 401);
    }
    let t;
    try { t = await betaLager!.laes(); } catch (err) {
      if (!(err instanceof BetaFejl)) throw err;
      console.error('beta:', err.message);
      return c.json({ error: 'Betaens tilstand kan ikke læses.' }, 503);
    }
    if (!t) return c.json({ error: 'Findes ikke' }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json(await byggMaal(maalKilder(t)));
  });

  // KC-0116: who is looking — before anything is served (static files included); /health stays open.
  // The person comes only from the identity headers of a loopback peer (Tailscale Serve) or single-user mode,
  // or (KC-0179, konto) from the Sky gateway's signature.
  const husstandDir = deps.dataDir ?? './data';
  // KC-0160: laptop mode (one person, loopback only) ignores every identity header: the one owner, unless the caller fixed a person.
  const kigger = vaelgKigger(deps.laptop === true && !deps.identitet ? { fast: ENEBRUGER } : deps.identitet, now);
  // KC-0188: this tenant's own record of a support grant (none without the switch: then no support identity passes).
  const stoetteLager = deps.stoette && deps.dataDir ? lavStoetteLager(deps.dataDir) : undefined;
  app.use('/*', async (c, next) => {
    if (c.req.path === '/health') return next();
    let husstand;
    try { husstand = await laesHusstand(husstandDir); } catch (err) {
      if (!(err instanceof HusstandFejl)) throw err;
      console.error('identitet:', err.message);
      return afvis(c, 503, HUSSTAND_ULAESELIG);
    }
    // An unreadable record is no grant (fail closed): a support identity is refused, and no band is shown.
    let stoetteNu: StoetteAdgang | null | 'ulaeselig' = null;
    if (stoetteLager) {
      try { stoetteNu = await stoetteLager.laes(); } catch (err) {
        if (!(err instanceof StoetteFejl)) throw err;
        console.error('stoette:', err.message);
        stoetteNu = 'ulaeselig';
      }
    }
    const hvem = kigger({ headers: c.req.raw.headers, peer: peerAf(c.env) }, husstand, stoetteNu);
    if (erAfvist(hvem)) {
      if (hvem.log) console.warn('identitet:', hvem.log);
      return afvis(c, hvem.afvist, hvem.hvorfor);
    }
    c.set('person', hvem);
    c.set('husstand', husstand?.personer ?? []);
    c.set('stoette', stoetteNu === 'ulaeselig' ? null : stoetteNu);
    if (stoetteNu && stoetteNu !== 'ulaeselig') await noterStoetteUdloeb(stoetteNu);
    // KC-0170: the screen's language for everything this request renders — the profile's (Start step 1), else the standard.
    await medSprog(profil?.laesNu()?.sprog ?? STANDARD_SPROG, () => hvemNu.run(hvem, async () => {
      // KC-0154: her first request through this path activates a member the owner pre-created (once; never a static file).
      // KC-0188: support only looks; its visit activates nobody.
      if (hvem.rolle !== 'stoette' && (husstand?.personer.length ?? 0) > 1 && !/\.[a-z0-9]+$/i.test(c.req.path)) {
        try { await vedBesoeg(d); } catch (err) { console.error('husstand: indgangen kunne ikke markeres:', err); }
      }
      await next();
    }));
  });
  function afvis(c: Context<Env>, status: 401 | 403 | 503, hvorfor: string): Response {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.json({ error: hvorfor }, status);
    return c.html(renderIngenAdgang(hvorfor), status);
  }

  // KC-0188: support reads only. Every method but GET and HEAD is refused here, before any route (the policy layer and
  // the owner-only checks refuse it again behind this). Each support session's start and every page it opens (the route
  // template: never a query string, never content) goes to the audit log with the staff account's id; an /api read is
  // logged once per session. The owner reads it in "Hvad Clawco har gjort".
  const KUN_SE = 'Support kan kun se med og kan ikke ændre noget. Det kan kun ejeren.';
  const stoetteLogget = new Set<string>();
  const stoetteLinje = (verb: string, rum: string, hvorfor: string, person: string, adgang: string, udfald: 'tillad' | 'afvist' = 'tillad') =>
    revision?.skriv({ person, kanal: 'stoette', rum: rum.slice(0, 80), verb, udfald, hvorfor, handlingId: `adgang:${adgang}`, zoner: [], kilde: 'stoette' });
  async function noterStoetteUdloeb(a: StoetteAdgang): Promise<void> {
    const slut = Date.parse(a.udloeber);
    if (!stoetteLager || a.tilbagekaldt || a.udloebLogget || !(now().getTime() >= slut) || stoetteLogget.has(`udloeb:${a.id}`)) return;
    stoetteLogget.add(`udloeb:${a.id}`);
    await stoetteLager.skriv({ ...a, udloebLogget: now().toISOString() });
    await stoetteLinje('stoette-udloeb', 'stoette', `Supportadgangen sluttede af sig selv kl. ${klokkeKbh(new Date(a.udloeber))}.`, 'stoette', a.id);
  }
  app.use('/*', async (c, next) => {
    const p = c.get('person');
    if (p?.rolle !== 'stoette' || !p.stoette) return next();
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return afvis(c, 403, KUN_SE);
    const s = p.stoette;
    const hvem = stoettePersonId(s.personale);
    const sessionNoegle = `${s.adgang}:${s.session}`;
    if (!stoetteLogget.has(sessionNoegle) && stoetteLager) {
      stoetteLogget.add(sessionNoegle);
      const a = await stoetteLager.laes();
      if (a && a.id === s.adgang && !a.sessioner.includes(s.session)) {
        await stoetteLager.skriv({ ...a, sessioner: [...a.sessioner, s.session].slice(-200) });
        await stoetteLinje('stoette-start', 'stoette', 'Support begyndte at kigge med.', hvem, s.adgang);
      }
    }
    await next();
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return; // a static file is not something opened
    let sti = c.req.routePath;
    if (!sti || sti === '/*') return;
    if (sti === '/rum/:id' && ROOMS.some((r) => r.id === c.req.param('id'))) sti = `/rum/${c.req.param('id')}`;
    if (sti.startsWith('/api/')) {
      if (stoetteLogget.has(`${sessionNoegle}:${sti}`)) return;
      stoetteLogget.add(`${sessionNoegle}:${sti}`);
    }
    // A page support was refused (an owner-only page, a missing one) is logged as a no, so the owner sees the attempt too.
    if (c.res.status >= 400) await stoetteLinje('stoette-aabnet', sti, 'Support fik nej til en side.', hvem, s.adgang, 'afvist');
    else await stoetteLinje('stoette-aabnet', sti, 'Support åbnede en side.', hvem, s.adgang);
  });
  // KC-0154: the shell names the household only to whom may see who is in it (rettigheder.ts; not a guest).
  // KC-0188: the band and the owner's card come from the record (shell/layout.ts), on every page that has the skeleton.
  const stoetteSyn = (c: Context<Env>): { stoette?: { adgang: { udloeber: string; grund: string } | null; slaaTil: string; slaaFra: string } } => {
    if (!deps.stoette) return {};
    const a = c.get('stoette');
    return { stoette: { adgang: aktiv(a, now()) ? { udloeber: a.udloeber, grund: a.grund } : null, slaaTil: deps.stoette.slaaTil, slaaFra: deps.stoette.slaaFra } };
  };
  const hvem = (c: Context<Env>): Hvem & { pause?: ReturnType<typeof runs.pauseTilstand>; hjaelp?: { href: string }; beta?: true; stoette?: { adgang: { udloeber: string; grund: string } | null; slaaTil: string; slaaFra: string } } => ({ person: c.get('person'), husstand: maaSe(c.get('person'), { slags: 'medlem' }) ? c.get('husstand') : [], ...(runs.paaPause() ? { pause: runs.pauseTilstand() } : {}), ...(deps.hjaelp ? { hjaelp: deps.hjaelp } : {}), ...(betaPaa() ? { beta: true as const } : {}), ...stoetteSyn(c) });

  // KC-0018: no-cache = always revalidate, so a deploy reaches the browser and the home-screen app.
  app.use('/*', async (c, next) => { c.header('Cache-Control', 'no-cache'); await next(); });
  // KC-0229: the font files never change under their name (the name says family, subset and weight), so a year, immutable.
  app.use('/fonts/*', async (c, next) => { await next(); if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable'); });
  if (deps.publicDir) app.use('/*', serveStatic({ root: deps.publicDir }));

  // KC-0121: the manifest is rendered from code (its name is PRODUKT).
  app.get('/manifest.webmanifest', (c) => c.body(JSON.stringify(manifest()), 200, { 'Content-Type': 'application/manifest+json; charset=utf-8' }));

  // KC-0094: what the service worker shows when the server cannot be reached; self-contained, no shell.
  app.get('/uden-forbindelse', (c) => c.html(renderUdenForbindelse()));

  // KC-0015: the voice. 'samtale' when the real client can mint agent tokens, 'lyt' with the fake.
  const stemme = deps.stemme;
  const stemmeNiveau: 'samtale' | 'lyt' | undefined = stemme ? (stemme.mode === 'elevenlabs' ? 'samtale' : 'lyt') : undefined;
  let voiceId: Promise<string> | undefined;
  function voice(): Promise<string> {
    if (!stemme) return Promise.reject(new StemmeError('Stemmen er ikke sat op', 503));
    if (!voiceId) {
      voiceId = settings.read().then((s) => stemme.ensureVoice(s.stemme.voiceId)).then(async (v) => { await settings.setStemme({ voiceId: v }); return v; })
        .catch((err: unknown) => {
          // No library access (the key lacks voices_read) → the premade default, remembered for this process only.
          console.error('stemme: kunne ikke vælge en stemme fra biblioteket, bruger standardstemmen:', err instanceof Error ? err.message : err);
          return DEFAULT_VOICE_ID;
        });
    }
    return voiceId;
  }
  let agentSync: Promise<string> | undefined;
  /** Syncs the agent defined in code once per process; the ids land in the settings file. */
  function agent(): Promise<string> {
    if (!stemme) return Promise.reject(new StemmeError('Stemmen er ikke sat op', 503));
    if (!agentSync) {
      agentSync = (async () => {
        const v = await voice();
        const s = await settings.read();
        const ids = await stemme.ensureAgent(AGENT_CONFIG, v, s.stemme);
        await settings.setStemme(ids);
        return ids.agentId;
      })();
      agentSync.catch(() => { agentSync = undefined; });
    }
    return agentSync;
  }
  function stemmeFejl(c: { json: (o: unknown, s: 400 | 404 | 502 | 503) => Response }, err: unknown): Response {
    if (err instanceof StemmeError) return c.json({ error: err.message }, err.status === 503 ? 503 : err.status === 400 ? 400 : err.status === 404 ? 404 : 502);
    throw err;
  }

  /** What the nav needs: pending counts per room (every active univers included), the active universes and (KC-0052) which rooms are relevant on `roomId`'s page. The Univers index is read once. */
  async function navData(roomId = HJEM): Promise<{ venter: Record<string, number>; univers: { id: string; navn: string }[]; synlige: Set<string> }> {
    const out: Record<string, number> = {};
    for (const m of ROOM_MODULES) { if (m.id === UNIVERS) continue; const n = await m.venter(d); if (n) out[m.id] = n; }
    const indeks = await laesIndeks(deps.store);
    if (indeks.nyeMoeder.length) out[UNIVERS] = indeks.nyeMoeder.length;
    // KC-0045/KC-0093: what waits in Hjem itself (Claude Code's questions and parked opgaver, Kuratoren's open cards) — the same count Hjem shows.
    const egne = hjemEgne(await hjemEgneData());
    if (egne) out[HJEM] = egne;
    const univers = indeks.univers.filter((u) => !u.arkiveret).map((u) => ({ id: u.id, navn: u.navn }));
    for (const u of univers) { const n = (await getRoomModule(universRum(u.id))?.venter(d)) ?? 0; if (n) out[universRum(u.id)] = n; }
    const start = await rejsen(d);
    // KC-0233: Start is worth a place in the nav while its Digital Post step is open AND the inbox holds a sender that looks like Digital Post (the owner's).
    const postTilbud = danmark && d.person.rolle === 'ejer' ? await danmark.promover().catch(() => false) : false;
    const synlige = synligeRum({ roomId, rum: ROOMS.map((r) => r.id), univers: univers.map((u) => u.id), venter: out, aabnet: await laesAabnet(deps.store), now: now(), situation: (await situationNu()).situation, start: { faerdig: start.faerdig, forslag: start.forslag.length + (postTilbud ? 1 : 0) }, husstand: await husstandSynlig(d) });
    return { venter: out, univers, synlige };
  }
  const venter = async (): Promise<Record<string, number>> => (await navData()).venter;

  /** KC-0114: the situation now, from the engine. The meeting (KC-0030) is the one active now in any non-archived univers. */
  async function situationNu(): Promise<{ situation: Situation; moede: { url: string; titel: string; start: string; slut: string; univers: string } | null }> {
    const aktive = (await laesIndeks(deps.store)).univers.filter((u) => !u.arkiveret);
    const universer = await Promise.all(aktive.map(async (u) => ({ slug: u.id, navn: u.navn, state: await laesUnivers(deps.store, u.id) })));
    const { situation, moede: hit } = vaelgSituation({ now: now(), moeder: universer.flatMap((u) => u.state.moeder.map((m) => ({ id: m.id, start: m.start, slut: m.slut, univers: u.slug }))) });
    const u = hit ? universer.find((x) => x.slug === hit.univers) : undefined;
    const moede = u?.state.moeder.find((m) => m.id === hit?.id);
    if (!u || !moede) return { situation, moede: null };
    return { situation, moede: { url: `/moede/${encodeURIComponent(u.slug)}/${encodeURIComponent(moede.id)}`, titel: moede.titel, start: moede.start, slut: moede.slut, univers: u.navn } };
  }

  app.get('/api/situation', async (c) => c.json(await situationNu()));

  // Opening the app lands in Start on the first run (KC-0126), else on the meeting when one is active, else on Hjem.
  app.get('/', async (c) => c.redirect((await erFoersteGang(d)) ? '/rum/start' : (await situationNu()).moede?.url ?? '/rum/hjem', 302));
  // KC-0115: Nu is Hjem grown up; the internal room id stays hjem.
  app.get('/nu', (c) => c.redirect('/rum/hjem', 302));

  // `hermes` stays for live:tjek; `agent` is the seam (KC-0118) — the same client today.
  app.get('/health', async (c) => {
    // KC-0127: status says why it is not reachable (mangler-noegle on a keyless install); /health itself always answers.
    // KC-0180: reachable is the agent's own health (direkte: a key and a passed live test, no network call).
    const [status, reachable] = await Promise.all([deps.hermes.status(), deps.hermes.health()]);
    const agent = { mode: deps.hermes.mode, reachable, status };
    return c.json({ ok: true, sha: deps.sha ?? 'dev', uptimeSec: Math.round((Date.now() - START) / 1000), hermes: agent, agent, pause: runs.paaPause() });
  });

  app.get('/api/indstillinger', async (c) => c.json({ ...(await settings.read()), niveauer: TIER_KINDS }));
  app.post('/api/indstillinger', async (c) => {
    const b = await body(c);
    const m = typeof b['modeller'] === 'object' && b['modeller'] !== null ? (b['modeller'] as Record<string, string>) : {};
    let s = await settings.setModels(m);
    runs.setModels(s.modeller, hermesProvider(s));
    const st = typeof b['stemme'] === 'object' && b['stemme'] !== null ? (b['stemme'] as Record<string, unknown>) : null;
    if (st && typeof st['voiceId'] === 'string') { s = await settings.setStemme({ voiceId: st['voiceId'].trim() }); voiceId = undefined; agentSync = undefined; }
    return c.json({ ...s, niveauer: TIER_KINDS });
  });

  /** KC-0124: the newest audit lines `person` may read (at most `antal`), optionally only the refusals. */
  async function revisionFor(person: Person, antal: number, kunNej = false): Promise<Revisionslinje[]> {
    if (!revision) return [];
    return (await revision.seneste(500)).filter((e) => synligRevision(person, e) && (!kunNej || erNej(e))).slice(0, antal);
  }
  const navne = (c: Context<Env>): Record<string, string> => Object.fromEntries([c.get('person'), ...c.get('husstand')].map((p) => [p.id, p.id === c.get('person').id ? 'Du' : p.navn]));

  /** KC-0222: the news connector with the functions that change its list (null on a host that did not register it). */
  const rssKilde = (): NyhederRssKilde | null => {
    const k = kilder.hent(NYHEDER_RSS_ID);
    return k && 'tilfoejFeed' in k ? (k as NyhederRssKilde) : null;
  };

  /** KC-0224: the Beskeder connector with the functions that change its choice (null on a host that did not register it). */
  const beskedKilde = (): BeskederKilde | null => {
    const k = kilder.hent(BESKEDER_ID);
    return k && 'vaelgSamtaler' in k ? (k as BeskederKilde) : null;
  };

  /** KC-0120: "Kilder" in the Kø panel, rendered here (escaped); Frakobl only for whoever may change settings. */
  async function kilderPanel(person: Person): Promise<string> {
    try {
      // KC-0139: "last read" survives a restart (helbred.json), else only this run's reads would show.
      const fil = await helbred.laes();
      // KC-0222: the news sources keep a list of their own, shown (to the owner) under their row.
      const rss = rssKilde();
      const feeder = rss ? rss.feeds((await kilder.forbindelse(NYHEDER_RSS_ID))?.valg ?? {}) : null;
      // KC-0224: Beskeder lists the conversations Hermes sees, with a checkbox each, under its row.
      const besked = beskedKilde();
      const samtaler = besked ? await besked.samtalerMedValg((await kilder.forbindelse(BESKEDER_ID))?.valg ?? {}) : null;
      const liste = (await kilder.oversigt()).map((o) => ({ ...o, sidstLaest: fil[o.id]?.sidstLaest ?? o.sidstLaest, ...(o.id === NYHEDER_RSS_ID && o.forbundet && feeder ? { feeder } : {}), ...(o.id === BESKEDER_ID && o.forbundet && samtaler ? { samtaler } : {}) }));
      return String(renderKilder(liste, { nu: now(), maaFrakoble: kan(person.rolle, 'aendre-indstillinger') }));
    } catch (err) {
      if (!(err instanceof KonfigFejl)) throw err;
      console.error('kilder:', err.message);
      return String(html`<p class="muted row" data-kilder="fejl">Forbindelserne kunne ikke læses. Ejeren skal rette kilder.json.</p>`);
    }
  }

  /** KC-0212: the owner's cost card (escaped); '' for anyone else and on a host without a ledger. */
  async function omkostningsKort(person: Person): Promise<string> {
    if (person.rolle !== 'ejer' || !deps.omkostninger) return '';
    try {
      const o = await deps.omkostninger.laes();
      return o ? String(renderOmkostninger(daekning(o, deps.omkostninger.mrr()))) : '';
    } catch (err) {
      if (!(err instanceof OmkostningsFejl)) throw err;
      console.error('omkostninger:', err.message);
      return String(renderOmkostninger('fejl'));
    }
  }

  app.get('/api/koe', async (c) => c.json({
    nu: now().getTime(),
    // KC-0120: only while the panel is open (?kilder=1), so a page load never waits on a health check.
    ...(c.req.query('kilder') === '1' ? { kilder: await kilderPanel(c.get('person')), omkostninger: await omkostningsKort(c.get('person')) } : {}),
    pause: runs.paaPause(),
    // KC-0124: "Hvad Clawco har gjort", rendered here (one renderer, escaped); a guest gets nothing.
    revision: c.get('person').rolle === 'gaest' ? '' : String(renderRevision(await revisionFor(c.get('person'), 50), { nu: now(), navne: navne(c) })),
    runs: runs.list().filter((r) => synligFor(c.get('person'), r)).slice(0, 40).map((r) => ({ id: r.id, room: r.room ?? null, label: r.label ?? LABELS[r.kind] ?? r.kind, kind: r.kind, status: r.status, startedAt: r.startedAt, begyndt: r.begyndtAt ?? null, finishedAt: r.finishedAt ?? null, text: r.result?.text ?? r.error ?? null })),
  }));

  // KC-0124: the audit log (owner and members; never a guest). ?nej=1 = only what Clawco said no to.
  app.get('/api/revision', async (c) => {
    if (c.get('person').rolle === 'gaest') return c.json({ error: 'En gæst kan ikke se, hvad Clawco har gjort.' }, 403);
    const linjer = await revisionFor(c.get('person'), 50, c.req.query('nej') === '1');
    return c.json({ linjer, kaede: revision ? await revision.tjekKaede() : { ok: true } });
  });

  // KC-0124: "Stop alt" (any non-guest) and "Start igen" (the owner only). Both write one audit line.
  app.post('/api/nodstop', async (c) => {
    const stoppede = await stopAlt({ runs, revision, person: c.get('person'), kanal: 'knap' });
    for (const r of ROOMS) live.notify(r.id);
    return c.json({ pause: true, stoppede });
  });
  app.post('/api/nodstop/genoptag', async (c) => {
    await startIgen({ runs, revision, person: c.get('person'), kanal: 'knap' });
    for (const r of ROOMS) live.notify(r.id);
    return c.json({ pause: runs.paaPause() });
  });
  // KC-0124: while paused nothing new starts — every room route that would ask Hermes or act answers 503 at the door.
  app.use('/api/rum/*', async (c, next) => {
    if (c.req.method === 'POST' && runs.paaPause()) return c.json({ error: PAUSE_TEKST }, 503);
    await next();
  });

  // KC-0122: a refusal from the policy layer is a 403 with the plain Danish reason (the room's log has the line).
  app.onError((err, c) => {
    if (err instanceof GraenseAfvist) return c.json({ error: err.message, graense: err.udfald === 'kraever-ja' ? 'kraever-ja' : 'afvist' }, 403);
    // KC-0124: a run asked for while paused (the last line of defence, src/runs.ts), and a role that may not stop/resume.
    if (err instanceof PauseFejl) return c.json({ error: err.message }, 503);
    if (err instanceof NodstopNaegtet) return c.json({ error: err.message }, 403);
    // KC-0132: a connector refusal carries its status (fail closed); a kilder.json that cannot be read is 503, never "none".
    if (err instanceof KildeFejl) return c.json({ error: err.message }, err.status);
    if (err instanceof KonfigFejl) { console.error('kilder:', err.message); return c.json({ error: 'Forbindelserne kunne ikke læses. Ejeren skal rette kilder.json.' }, 503); }
    console.error(err);
    deps.fejlrapport?.rapporter(err, { rute: c.req.routePath, status: 500 });
    return c.text('Internal Server Error', 500);
  });

  // KC-0122: a one-time yes for exactly one button, asked for by the browser when a red button is tapped. Never by voice.
  app.post('/api/graense/ja', async (c) => {
    const b = await body(c);
    const rum = typeof b['rum'] === 'string' ? b['rum'] : '';
    const slags = typeof b['slags'] === 'string' ? b['slags'] : '';
    // KC-0146: a rule's Slå fra / Slå til igen on /viden (id "R-0001:pause") is a tap too; nothing else on that page is.
    const videnRegel = rum === 'viden' && slags === 'regel';
    // KC-0144: Ja on a rule proposal in Nu (id = the proposal's id) is a tap too.
    const hjemForslag = rum === HJEM && slags === 'forslag';
    // KC-0203: Send on a beta answer (id feedback:<day>) and the consent switch (id samtykke:ja|nej) are taps too.
    const hjemBeta = rum === HJEM && slags === 'beta' && betaPaa();
    // KC-0233: "Set den" / "Set dem" on Digital Post in Nu (id set:<notice id> or set:*) is a tap too.
    const hjemPost = rum === HJEM && slags === 'post' && !!danmark;
    // KC-0153: Send on a request in Husstanden (id = request:kind:hash of the text shown) is a tap too; KC-0154: so is
    // Send on an invitation (id = member:invitation:hash of the first message shown).
    const kanalSend = rum === 'husstand' && (slags === 'send' || slags === 'invitation');
    if (!videnRegel && !hjemForslag && !hjemBeta && !hjemPost && !kanalSend &&((!getRoomModule(rum) && rum !== HJEM) || !['handling', 'aktion', 'fortryd', 'kort'].includes(slags))) return c.json({ error: 'Ukendt knap' }, 400);
    const id = slags === 'aktion' ? aktionId(typeof b['id'] === 'string' ? b['id'] : '', typeof b['body'] === 'object' && b['body'] !== null ? b['body'] as Record<string, unknown> : {}) : typeof b['id'] === 'string' ? b['id'] : '';
    if (!id) return c.json({ error: 'Ukendt knap' }, 400);
    return c.json({ ja: TEGN.udsted({ person: c.get('person').id, rum, slags, id }) });
  });

  // KC-0132: the connectors. Reading the list needs a known person (the identity middleware); changing it, the owner.
  const ejerKun = (c: Context<Env>): Response | null => (kan(c.get('person').rolle, 'aendre-indstillinger') ? null : c.json({ error: 'Kun ejeren kan forbinde og frakoble kilder.' }, 403));
  app.get('/api/kilder', async (c) => c.json({ kilder: await kilder.oversigt() }));
  app.post('/api/kilder/:id/forbind', async (c) => {
    const nej = ejerKun(c); if (nej) return nej;
    let b: unknown;
    try { b = await c.req.json(); } catch { return c.json({ error: 'Ugyldig forespørgsel' }, 400); }
    return c.json(await kilder.forbind(c.req.param('id'), b, c.get('person')));
  });
  app.post('/api/kilder/:id/frakobl', async (c) => {
    const nej = ejerKun(c); if (nej) return nej;
    await kilder.frakobl(c.req.param('id'), c.get('person'));
    return c.json({ forbundet: false });
  });
  // KC-0222: the user's own news sources after the connection. The connector checks and changes the list, the registry
  // writes it; the account of it goes in Nyheder's log (the way back for a removal is adding the same address again).
  const FEED_BODY = 'Send {"adresse": "…"} med adressen på én nyhedskilde.';
  async function aendrFeeds(c: Context<Env>, fn: (k: NyhederRssKilde) => (ctx: KildeKontekst) => Promise<{ tekst: string; valg: Record<string, string> }>): Promise<Response> {
    const nej = ejerKun(c); if (nej) return nej;
    if (fremmed(c)) return c.json({ error: 'Kilderne kan kun ændres fra Clawco selv.' }, 403);
    const rss = rssKilde();
    if (!rss) return c.json({ error: 'Ukendt forbindelse' }, 404);
    const person = c.get('person');
    const svar = await kilder.aendreValg(NYHEDER_RSS_ID, person, fn(rss));
    await deps.store.appendLog('nyheder', { kilde: 'henrik', tekst: `${person.navn} ${svar.tekst.charAt(0).toLowerCase()}${svar.tekst.slice(1)}`, zone: (await kilder.hvor(NYHEDER_RSS_ID)).zone, ejer: person.id });
    live.notify('nyheder');
    return c.json({ feeds: rss.feeds(svar.valg), tekst: svar.tekst });
  }
  app.post('/api/kilder/nyheder-rss/feeds', async (c) => {
    let b: unknown;
    try { b = await c.req.json(); } catch { return c.json({ error: FEED_BODY }, 400); }
    const adresse = typeof b === 'object' && b !== null && !Array.isArray(b) && Object.keys(b).every((n) => n === 'adresse') ? (b as Record<string, unknown>)['adresse'] : undefined;
    if (typeof adresse !== 'string' || !adresse.trim() || adresse.length > 2000) return c.json({ error: FEED_BODY }, 400);
    return aendrFeeds(c, (k) => (ctx) => k.tilfoejFeed(adresse, ctx));
  });
  app.delete('/api/kilder/nyheder-rss/feeds/:id', async (c) => {
    const id = c.req.param('id');
    if (!/^f-[0-9a-f]{12}$/.test(id)) return c.json({ error: 'Den kilde findes ikke længere.' }, 404);
    return aendrFeeds(c, (k) => (ctx) => k.fjernFeed(id, ctx));
  });
  // KC-0224: which conversations Clawco may read, after the connection. The whole set is sent (what is not in it is
  // un-chosen and forgotten at once); the connector checks it, the registry writes it and logs it (counts only).
  const VALG_BODY = 'Send {"valgte": ["…"]} med de samtaler, Clawco må læse.';
  app.put('/api/kilder/beskeder/valg', async (c) => {
    const nej = ejerKun(c); if (nej) return nej;
    if (fremmed(c)) return c.json({ error: 'Kilderne kan kun ændres fra Clawco selv.' }, 403);
    const besked = beskedKilde();
    if (!besked) return c.json({ error: 'Ukendt forbindelse' }, 404);
    let b: unknown;
    try { b = await c.req.json(); } catch { return c.json({ error: VALG_BODY }, 400); }
    const o = typeof b === 'object' && b !== null && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
    const valgte = o && Object.keys(o).every((n) => n === 'valgte') ? o['valgte'] : undefined;
    if (!Array.isArray(valgte) || valgte.length > 500 || !valgte.every((v) => typeof v === 'string' && /^s-[0-9a-f]{12}$/.test(v))) return c.json({ error: VALG_BODY }, 400);
    const svar = await kilder.aendreValg(BESKEDER_ID, c.get('person'), (ctx) => besked.vaelgSamtaler(valgte as string[], ctx));
    live.notify(HJEM);
    return c.json({ samtaler: svar.samtaler, tekst: svar.tekst });
  });
  app.get('/api/kilder/:id/tilbage', async (c) => {
    const nej = ejerKun(c); if (nej) return nej;
    await kilder.tilbage(c.req.param('id'), c.req.query('state') ?? '', c.req.query('code') ?? '', c.get('person'));
    return c.redirect('/', 302);
  });

  // KC-0146 "Hvad Clawco ved om dig": the page, Hent alt, Slet alt and a rule's Slå fra. The owner only: the page and
  // the export hold the whole household's data. Slet alt is not a handling — no room, chat phrase, voice id or Hermes
  // answer reaches it; only this route, with the typed word. The work is done by plain functions (src/tillid/), so Sky
  // (KC-0206) can run the export and the delete inside a tenant without this app.
  const KUN_EJER = `Kun ejeren kan se og ændre, hvad ${PRODUKT} har gemt.`;
  const erEjer = (c: Context<Env>): boolean => c.get('person').rolle === 'ejer';
  /** The user's folder (D7): the data dir and the vault's Clawco/; the vault, people register and inbox are the user's own notes. */
  const brugermappe = (): Brugermappe => {
    const s = stier();
    return { dataDir: deps.dataDir ?? './data', ...(vaultDir() ? { vaultDir: vaultDir() } : {}), beskyt: [s.personer, s.indbakke].filter((p) => !!p) };
  };
  const personerListe = async (): Promise<{ dir: string; liste: { navn: string; relation: string; sti: string }[] } | null> => {
    const dir = personerNu();
    if (!dir) return null;
    return { dir, liste: (await laesPersoner(dir, { zone: 'privat' })).map((p) => ({ navn: p.navn, relation: p.relation, sti: p.sti })) };
  };
  async function videnNu(): Promise<Viden> {
    let kildeliste: VidenKilde[] = [];
    try {
      kildeliste = await Promise.all((await d.rejse!.kilder()).map(async (k) => ({ ...k, ...(k.forbundet ? { zone: (await kilder.hvor(k.id)).zone } : {}) })));
    } catch (err) {
      if (!(err instanceof KonfigFejl)) throw err;
      console.error('viden:', err.message);
    }
    return { kilder: kildeliste, regler: regler ? { fil: regler.fil, laest: await regler.laes() } : null, personer: await personerListe(), gemt: await opgoer(brugermappe()), ...(dagstal ? { ugetal: ugeraekke(faerdigeDage(await dagstal.dage(), idagKbh(now())), ugeAf(now())) } : {}) };
  }
  async function videnSide(c: Context<Env>, main: Markup, titel: string, status: 200 | 400 = 200): Promise<Response> {
    const { venter: v, univers, synlige: syn } = await navData();
    return c.html(String(shell({ ...hvem(c), roomId: HJEM, hermesStatus: tekst().klar, venter: v, main, chat: await deps.store.readChat(HJEM), stemme: stemmeNiveau, univers, synlige: syn, titel })), status);
  }
  const erForm = (c: Context<Env>): boolean => /^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(c.req.header('content-type') ?? '');
  async function formFelt(c: Context<Env>, navn: string): Promise<string> {
    if (erForm(c)) { const f = await c.req.parseBody(); return typeof f[navn] === 'string' ? f[navn] : ''; }
    const b = await body(c);
    return typeof b[navn] === 'string' ? b[navn] : '';
  }
  /** A form posted from another site (the browser says so) never reaches these routes. */
  const fremmed = (c: Context<Env>): boolean => { const s = c.req.header('sec-fetch-site'); return !!s && s !== 'same-origin' && s !== 'none'; };

  app.get('/viden', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, KUN_EJER);
    const v = await videnNu();
    const tom = !v.gemt.rum.length && !v.gemt.clawco.length && !v.gemt.andre && !v.gemt.noegler;
    return videnSide(c, renderViden({ ...v, slettet: c.req.query('slettet') === '1' && tom }), `Hvad ${PRODUKT} ved om dig`);
  });
  app.get('/viden/slet-alt', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, KUN_EJER);
    return videnSide(c, renderSletAlt(await videnNu()), 'Slet alt');
  });
  app.get('/api/tillid/eksport', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, KUN_EJER);
    const p = await personerListe();
    const zip = await eksporter(brugermappe(), p ? { personer: { dir: p.dir, filer: p.liste.map((x) => x.sti) } } : {}, now());
    return c.body(new Uint8Array(zip), 200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="clawco-${copenhagenDate(now())}.zip"`, 'Cache-Control': 'no-store' });
  });

  // KC-0203: the closed beta's own routes — all the owner's, all from Clawco itself, all 404 without KC_BETA. An answer and
  // the consent switch are human taps (the one-time yes of jaFraTryk, for exactly that answer); closing the plain card and
  // "Ikke nu" change nothing that leaves the machine. Nothing here reaches Sky: Sky pulls (GET /api/beta/maal above).
  const KUN_EJER_BETA = 'Kun ejeren kan svare for betaen.';
  type BetaAdgang = { t: NonNullable<Awaited<ReturnType<typeof betaNu>>> } | Response;
  const betaAdgang = async (c: Context<Env>): Promise<BetaAdgang> => {
    if (!betaPaa()) return c.json({ error: 'Findes ikke' }, 404);
    if (!erEjer(c)) return afvis(c, 403, KUN_EJER_BETA);
    if (c.req.method !== 'GET' && fremmed(c)) return c.json({ error: SAMME_SIDE }, 403);
    const t = await betaNu();
    return t ? { t } : c.json({ error: 'Betaens tilstand kan ikke læses.' }, 503);
  };
  const betaLog = (tekst: string) => deps.store.appendLog(HJEM, { kilde: 'henrik', tekst, zone: 'privat' });

  app.get('/beta/deling', async (c) => {
    if (!betaPaa()) return c.notFound();
    const a = await betaAdgang(c);
    if (a instanceof Response) return a;
    const k = maalKilder(a.t);
    const pen = (o: unknown): string => JSON.stringify(o, null, 2);
    const nu = await byggMaal(k);
    // With consent off: what switching on would add to what goes anyway.
    const hvis = a.t.samtykke ? undefined : pen(Object.fromEntries(Object.entries(await byggMaal(k, true)).filter(([n]) => !(n in nu))));
    return videnSide(c, renderDeling({ samtykke: a.t.samtykke, nu: pen(nu), ...(hvis !== undefined ? { hvis } : {}) }), tekst().hvadDeler);
  });

  app.post('/api/beta/kort/luk', async (c) => {
    const a = await betaAdgang(c);
    if (a instanceof Response) return a;
    if (!a.t.betaKortLukket) await betaLager!.aendre((s) => (s.betaKortLukket ? s : { ...s, betaKortLukket: now().toISOString() }));
    live.notify(HJEM);
    return c.json({ ok: true });
  });

  app.post('/api/beta/feedback/udsaet', async (c) => {
    const a = await betaAdgang(c);
    if (a instanceof Response) return a;
    const b = await body(c);
    const due = kortDue(a.t, now());
    if (due === null || b['dag'] !== due) return c.json({ error: 'Det spørgsmål venter ikke på dig lige nu.' }, 409);
    await betaLager!.aendre((s) => ({ ...s, udsat: { dag: due, dato: utcDato(now()) } }));
    live.notify(HJEM);
    return c.json({ ok: true });
  });

  app.post('/api/beta/feedback', async (c) => {
    const a = await betaAdgang(c);
    if (a instanceof Response) return a;
    const b = await body(c);
    const u = parseFeedbackSvar(b, { due: kortDue(a.t, now()) });
    if (!u.ok) return c.json({ error: u.fejl }, u.status);
    const { svar } = u;
    const ja = jaFraTryk(TEGN, typeof b['ja'] === 'string' ? b['ja'] : undefined, { person: c.get('person').id, rum: HJEM, slags: 'beta', id: `feedback:${svar.dag}` });
    if (!ja) return c.json({ error: 'Tryk på knappen igen.' }, 403);
    // The card may have been answered between the check and the write (a double tap): the write checks again, once.
    let gemt = false;
    await betaLager!.aendre((s) => {
      if (kortDue(s, now()) !== svar.dag) return s;
      gemt = true;
      const tid = now().toISOString();
      const { udsat: _udsat, ...rest } = s;
      return { ...rest, svaret: { ...s.svaret, [svar.dag]: tid }, feedback: [...s.feedback, { ...svar, tid }] };
    });
    if (!gemt) return c.json({ error: 'Det spørgsmål venter ikke på dig lige nu.' }, 409);
    await betaLog(`Feedback dag ${svar.dag} sendt til Henrik`);
    live.notify(HJEM);
    return c.json({ ok: true });
  });

  app.post('/api/beta/samtykke', async (c) => {
    const a = await betaAdgang(c);
    if (a instanceof Response) return a;
    const b = await body(c);
    const v = b['samtykke'];
    if (v !== 'ja' && v !== 'nej') return c.json({ error: 'Ugyldig forespørgsel.' }, 400);
    const ja = jaFraTryk(TEGN, typeof b['ja'] === 'string' ? b['ja'] : undefined, { person: c.get('person').id, rum: HJEM, slags: 'beta', id: `samtykke:${v}` });
    if (!ja) return c.json({ error: 'Tryk på knappen igen.' }, 403);
    const til = v === 'ja';
    if (a.t.samtykke !== til) {
      await betaLager!.aendre((s) => ({ ...s, samtykke: til }));
      await betaLog(til ? 'Deling af beta-tal slået til' : 'Deling af beta-tal slået fra');
    }
    live.notify(HJEM);
    return c.json({ samtykke: til });
  });

  // KC-0233: "Set den" on the Digital Post card in Nu — the one thing the card does besides linking to the viewer. The owner's, from
  // Clawco itself, a human tap (the one-time yes of jaFraTryk, for exactly this notice or for "all"). It writes one id into
  // danmark/digital-post.json; nothing reaches the mail, Hermes or any other service. 404 without a data dir.
  app.post('/api/danmark/post/set', async (c) => {
    if (!danmark) return c.json({ error: 'Findes ikke' }, 404);
    if (!erEjer(c)) return afvis(c, 403, 'Kun ejeren kan sætte Digital Post.');
    if (fremmed(c)) return c.json({ error: 'Det kan kun gøres fra Clawco selv.' }, 403);
    const b = await body(c);
    const alle = b['alle'] === true;
    const id = typeof b['id'] === 'string' ? b['id'] : '';
    if (alle === (id !== '') || id.length > 300) return c.json({ error: 'Ugyldig forespørgsel.' }, 400);
    const ja = jaFraTryk(TEGN, typeof b['ja'] === 'string' ? b['ja'] : undefined, { person: c.get('person').id, rum: HJEM, slags: 'post', id: alle ? 'set:*' : `set:${id}` });
    if (!ja) return c.json({ error: 'Tryk på knappen igen.' }, 403);
    try {
      if (alle) await danmark.setAlle(); else await danmark.set(id);
    } catch (err) {
      if (err instanceof DanmarkAfvist) return c.json({ error: err.message }, err.status);
      if (err instanceof DanmarkFejl) { console.error('danmark:', err.message); return c.json({ error: 'Digital Post-tilstanden kan ikke læses.' }, 503); }
      throw err;
    }
    await deps.store.appendLog(HJEM, { kilde: 'henrik', tekst: alle ? 'Satte ny Digital Post som set.' : 'Satte en ny Digital Post som set.', zone: 'privat' });
    live.notify(HJEM);
    return c.json({ ok: true });
  });

  // KC-0188: support on (only from Sky, with its signed bevis, for the owner) and off (the owner). Neither is a
  // handling: no room, chat phrase, voice id, rule or clock reaches these routes, and startStoette is called only here.
  app.post('/api/stoette/start', async (c) => {
    if (!stoetteLager) return c.json({ error: 'Findes ikke' }, 404);
    const b = erForm(c) ? {} : await body(c);
    try {
      const a = await startStoette(stoetteLager, { person: c.get('person'), bevis: b['bevis'], konto: deps.identitet && 'konto' in deps.identitet ? deps.identitet.konto : undefined, nu: now() });
      await stoetteLinje('stoette-givet', 'stoette', `Ejeren lod support se med til kl. ${klokkeKbh(new Date(a.udloeber))}.`, c.get('person').id, a.id);
      for (const r of ROOMS) live.notify(r.id);
      return c.json({ aktiv: true });
    } catch (err) {
      if (!(err instanceof StoetteFejl)) throw err;
      return afvis(c, 403, err.message);
    }
  });
  app.post('/api/stoette/slaa-fra', async (c) => {
    if (!stoetteLager) return c.json({ error: 'Findes ikke' }, 404);
    try {
      const a = await slaaStoetteFra(stoetteLager, { person: c.get('person'), nu: now() });
      if (a) {
        await stoetteLinje('stoette-slut', 'stoette', 'Ejeren slog support fra.', c.get('person').id, a.id);
        for (const r of ROOMS) live.notify(r.id);
      }
    } catch (err) {
      if (!(err instanceof StoetteFejl)) throw err;
      return afvis(c, 403, err.message);
    }
    return erForm(c) ? c.redirect('/', 303) : c.json({ aktiv: false });
  });
  app.post('/api/tillid/slet-alt', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, 'Kun ejeren kan slette alt.');
    if (fremmed(c)) return c.json({ error: 'Slet alt kan kun bestilles fra Clawco selv.' }, 403);
    if ((await formFelt(c, 'bekraeft')).trim() !== 'SLET') {
      const fejl = 'Skriv SLET med store bogstaver for at slette alt.';
      return erForm(c) ? videnSide(c, renderSletAlt(await videnNu(), { fejl }), 'Slet alt', 400) : c.json({ error: fejl }, 400);
    }
    const person = c.get('person');
    // Nothing may run or start while the folder is emptied: stop every run (the pause goes with the folder).
    await runs.stopAlle(person.id);
    try {
      await sletAlt(brugermappe(), { person: person.id, kanal: 'knap', ...(revision ? { revision } : {}) });
    } catch (err) {
      await runs.genoptag(person.id);
      throw err;
    }
    // An empty store again: the data dir is there, nothing cached from the old settings, no pause.
    if (deps.dataDir) await mkdir(deps.dataDir, { recursive: true });
    await runs.genlaesPause();
    voiceId = undefined;
    agentSync = undefined;
    const s = await settings.read();
    runs.setModels(s.modeller, hermesProvider(s));
    for (const r of ROOMS) live.notify(r.id);
    return erForm(c) ? c.redirect('/viden?slettet=1', 303) : c.json({ slettet: true });
  });
  // A rule's Slå fra / Slå til igen: the rules file changes only with a fresh human tap (KC-0123), redeemed here.
  app.post('/api/tillid/regler/:id/:status', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, KUN_EJER);
    const status = c.req.param('status');
    if ((status !== 'pause' && status !== 'aktiv') || !regler) return c.json({ error: 'Ukendt regel' }, 404);
    const b = await body(c);
    const ja = jaFraTryk(TEGN, typeof b['ja'] === 'string' ? b['ja'] : undefined, { person: c.get('person').id, rum: 'viden', slags: 'regel', id: `${c.req.param('id')}:${status}` });
    if (!ja) return c.json({ error: 'Tryk på knappen igen.' }, 403);
    const l = await regler.laes();
    if (l.tilstand !== 'ok') return c.json({ error: 'Reglerne kan ikke læses; ret filen først.' }, 409);
    const id = c.req.param('id');
    if (!l.saet.regler.some((r) => r.id === id)) return c.json({ error: 'Ukendt regel' }, 404);
    await regler.skriv({ ...l.saet, regler: l.saet.regler.map((r) => (r.id === id ? { ...r, status } : r)) });
    return c.json({ id, status });
  });

  // KC-0144: the card "Skal jeg gøre det til en regel?". The ONLY writer of the rules file from a proposal is Ja below: a
  // redeemed human-tap token (jaFraTryk) for exactly that proposal, from the owner, from the app itself. Hermes' text and
  // mail never reach it. Fortryd of the log line removes exactly the rule made (the app, no Hermes run).
  const SAMME_SIDE = 'Forslaget kan kun besvares fra Clawco selv.';
  type ForslagUdfald = { status: 200; regelId?: string; igen?: true; forslag?: Regelforslag } | { status: 404 | 409 | 503; error: string };

  app.post('/api/tillid/forslag/:id/godkend', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, 'Kun ejeren kan gøre noget til en regel.');
    if (fremmed(c)) return c.json({ error: SAMME_SIDE }, 403);
    const id = c.req.param('id');
    if (!regler) return c.json({ error: 'Der er ingen regelfil at gemme i.' }, 503);
    if (!synligKurator(await laesKurator(deps.store), d.person).regelforslag?.some((f) => f.id === id)) return c.json({ error: 'Forslaget findes ikke' }, 404);
    const b = await body(c);
    const ja = jaFraTryk(TEGN, typeof b['ja'] === 'string' ? b['ja'] : undefined, { person: c.get('person').id, rum: HJEM, slags: 'forslag', id });
    if (!ja) return c.json({ error: 'Tryk på knappen igen.' }, 403);
    let u = { status: 404, error: 'Forslaget findes ikke' } as ForslagUdfald; // set inside the chain step below
    // One chain step: the rules file and the proposal's state change together, so a second tap sees the first.
    await endreKurator(deps.store, async (s) => {
      const f = s.regelforslag?.find((x) => x.id === id);
      if (!f) return s;
      if (f.status === 'godkendt') { u = { status: 200, ...(f.regelId ? { regelId: f.regelId } : {}), igen: true }; return s; }
      if (f.status === 'afvist') { u = { status: 409, error: 'Du har allerede sagt nej tak til det forslag.' }; return s; }
      const l = await regler.laes();
      if (l.tilstand === 'ulaeselig') { u = { status: 409, error: 'Reglerne kan ikke læses; ret filen først.' }; return s; }
      // KC-0145: a pause only (the Sunday sample): the rule is paused, nothing is added.
      if (f.kunPause) {
        const pauset = l.tilstand === 'ok' && f.pauser ? saetStatus(l.saet, f.pauser, 'pause') : null;
        if (!pauset) { u = { status: 409, error: 'Reglen står ikke længere i filen' }; return s; }
        await regler.skriv(pauset);
        u = { status: 200, ...(f.pauser ? { regelId: f.pauser } : {}), forslag: f };
        return { ...s, regelforslag: afgoerForslag(s.regelforslag ?? [], id, 'godkendt', now(), f.pauser) };
      }
      // The cap is checked again against the file as it is now: it may have changed since the card was made.
      if (f.trin > maksTrinForForslag(l, f.gaelder)) { u = { status: 409, error: 'Reglerne er ændret, siden forslaget blev lavet. Tryk Ret reglen.' }; return s; }
      const saet = l.tilstand === 'ok' ? l.saet : { naesteId: 1, regler: [], ugyldige: [] };
      // A rule from this very proposal already in the file (a crash between the write and the state): adopt it, write nothing more.
      const findes = saet.regler.find((r) => r.oprindelse.kortId === f.kortId && r.oprindelse.art === f.art && r.titel === f.titel);
      let regelId = findes?.id;
      if (!findes) {
        const ny = regelFraForslag(saet, { titel: f.titel, tekst: f.tekst, trin: f.trin, gaelder: f.gaelder, oprindelse: { art: f.art, kortId: f.kortId } }, ja, idagKbh(now()));
        // KC-0145: a narrower rule from the Sunday sample replaces the one that hid the item: that one is paused in the same write.
        await regler.skriv((f.pauser ? saetStatus(ny.saet, f.pauser, 'pause') : null) ?? ny.saet);
        regelId = ny.regel.id;
      }
      u = { status: 200, ...(regelId ? { regelId } : {}), forslag: f };
      return { ...s, regelforslag: afgoerForslag(s.regelforslag ?? [], id, 'godkendt', now(), regelId) };
    });
    if (u.status !== 200) return c.json({ error: u.error }, u.status);
    if (u.forslag && u.regelId && !u.igen) {
      const f = u.forslag;
      const tekst = f.kunPause ? `Satte reglen på pause: ${f.titel.replace(/^Sæt «(.*)» på pause$/, '$1')} (${u.regelId})` : `Gjorde det til en regel: ${f.titel} (${u.regelId})${f.pauser ? `; ${f.pauser} er sat på pause` : ''}`;
      const fortryd = f.kunPause ? { genoptag: u.regelId } : { fjernRegel: u.regelId, ...(f.pauser ? { genoptag: f.pauser } : {}) };
      await deps.store.appendLog(HJEM, { kilde: 'henrik', tekst, handlingId: `regelforslag:${id}`, fortryd: `lokal:${JSON.stringify(fortryd)}`, zone: zoneAf(f), ...(f.ejer ? { ejer: f.ejer } : {}) });
      await revision?.skriv({ person: c.get('person').id, kanal: 'knap', rum: HJEM, verb: 'bogfoer', udfald: 'tillad', hvorfor: 'Ejeren trykkede Ja til et forslag om en regel.', handlingId: `regelforslag:${id}`, zoner: [zoneAf(f)], kilde: 'forslag' });
      live.notify(HJEM);
      live.notify(START_RUM); // KC-0227: Start's step 6 shows the same proposal
    }
    return c.json({ id, regelId: u.regelId });
  });

  app.post('/api/tillid/forslag/:id/afvis', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, 'Kun ejeren kan svare på et forslag til en regel.');
    if (fremmed(c)) return c.json({ error: SAMME_SIDE }, 403);
    const id = c.req.param('id');
    if (!synligKurator(await laesKurator(deps.store), d.person).regelforslag?.some((f) => f.id === id)) return c.json({ error: 'Forslaget findes ikke' }, 404);
    let u = { status: 404, error: 'Forslaget findes ikke' } as ForslagUdfald; // set inside the chain step below
    await endreKurator(deps.store, (s) => {
      const f = s.regelforslag?.find((x) => x.id === id);
      if (!f) return s;
      if (f.status === 'afvist') { u = { status: 200 }; return s; }
      if (f.status === 'godkendt') { u = { status: 409, error: 'Forslaget er allerede gjort til en regel; fortryd det i loggen.' }; return s; }
      u = { status: 200 };
      return { ...s, regelforslag: afgoerForslag(s.regelforslag ?? [], id, 'afvist', now()) };
    });
    if (u.status !== 200) return c.json({ error: u.error }, u.status);
    live.notify(HJEM);
    live.notify(START_RUM);
    return c.json({ id });
  });

  // KC-0145: the Sunday sample. Each drawn line is answered once (the owner, from Clawco itself); a wrong feeds the KC-0144
  // proposal flow (src/kurator/stikproeve.ts: a pending proposal, never a write to the rules file). The last answer of a
  // third clean week asks the stop question.
  const FORTRYD_SOENDAG = 'lokal:{"soendagstjek":"til"}';
  app.post('/api/tillid/stikproeve/:uge/:id', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, 'Kun ejeren svarer på søndagstjekket.');
    if (fremmed(c)) return c.json({ error: 'Søndagstjekket kan kun besvares fra Clawco selv.' }, 403);
    if (!stikbog) return c.json({ error: 'Søndagstjekket er ikke sat op.' }, 503);
    const svar = (await body(c))['svar'];
    if (svar !== 'rigtigt' && svar !== 'forkert') return c.json({ error: 'svar skal være rigtigt eller forkert' }, 400);
    let r: ReturnType<typeof besvar> | undefined;
    await stikbog.endre((b) => {
      r = besvar(b, c.req.param('uge'), c.req.param('id'), svar, now());
      return r.udfald === 'ok' ? medStopTilbud(r.bog, now()) : b;
    });
    if (!r || r.udfald === 'ukendt') return c.json({ error: 'Linjen findes ikke' }, 404);
    if (r.udfald === 'allerede' || !r.post) return c.json({ error: 'Du har allerede svaret på den.' }, 409);
    const run = svar === 'forkert' ? await skulleVises(d, r.post) : undefined;
    live.notify(HJEM);
    return c.json({ ok: true, ...(run ? { runId: run.id } : {}) });
  });

  app.post('/api/tillid/soendagstjek/stop', async (c) => {
    if (!erEjer(c)) return afvis(c, 403, 'Kun ejeren kan stoppe søndagstjekket.');
    if (fremmed(c)) return c.json({ error: 'Søndagstjekket kan kun stoppes fra Clawco selv.' }, 403);
    if (!stikbog) return c.json({ error: 'Søndagstjekket er ikke sat op.' }, 503);
    const svar = (await body(c))['svar'];
    if (svar !== 'ja' && svar !== 'nej') return c.json({ error: 'svar skal være ja eller nej' }, 400);
    let ok = false;
    await stikbog.endre((b) => {
      if (!b.stop || b.stop.svar) return b;
      ok = true;
      return { ...b, stop: { ...b.stop, svar } };
    });
    if (!ok) return c.json({ error: 'Der er ikke spurgt.' }, 409);
    if (svar === 'ja') {
      await settings.setSoendagstjek(false);
      await deps.store.appendLog(HJEM, { kilde: 'henrik', tekst: 'Stoppede søndagstjekket', handlingId: 'soendagstjek:stop', fortryd: FORTRYD_SOENDAG, zone: 'privat' });
    }
    live.notify(HJEM);
    return c.json({ ok: true });
  });

  /** Fortryd on "Stoppede søndagstjekket": the check is on again, once. */
  async function fortrydSoendag(logId: string): Promise<Udfald> {
    const e = (await deps.store.readLog(HJEM, 1000)).find((x) => x.id === logId);
    if (!e) return { ok: false, status: 404, error: 'Linjen findes ikke' };
    if (e.fortrudt) return { ok: false, status: 409, error: 'Allerede fortrudt' };
    await settings.setSoendagstjek(true);
    await deps.store.updateLog(HJEM, logId, { fortrudt: now().toISOString() });
    live.notify(HJEM);
    return { ok: true };
  }

  /** Fortryd on "Gjorde det til en regel": removes exactly that rule and (KC-0145) turns on the rule it paused, once. Not a Hermes run. */
  async function fortrydRegel(logId: string, r: { fjernRegel?: string; genoptag?: string }): Promise<Udfald> {
    if (!regler) return { ok: false, status: 503, error: 'Der er ingen regelfil.' };
    let u = { ok: false, status: 404, error: 'Linjen findes ikke' } as Udfald; // set inside the chain step below
    await endreKurator(deps.store, async (s) => {
      const e = (await deps.store.readLog(HJEM, 1000)).find((x) => x.id === logId);
      if (!e) return s;
      if (e.fortrudt) { u = { ok: false, status: 409, error: 'Allerede fortrudt' }; return s; }
      const l = await regler.laes();
      if (l.tilstand !== 'ok') { u = { ok: false, status: 409, error: 'Reglerne kan ikke læses; ret filen først.' }; return s; }
      const uden = r.fjernRegel ? fjernRegel(l.saet, r.fjernRegel) : l.saet;
      const igen = uden && r.genoptag ? saetStatus(uden, r.genoptag, 'aktiv') : uden;
      if (!igen) { u = { ok: false, status: 409, error: 'Reglen står ikke længere i filen' }; return s; }
      await regler.skriv(igen);
      await deps.store.updateLog(HJEM, logId, { fortrudt: now().toISOString() });
      u = { ok: true };
      return s;
    });
    if (u.ok) live.notify(HJEM);
    return u;
  }

  app.get('/api/live', (c) => streamSSE(c, async (stream) => {
    let open = true;
    let wake!: () => void;
    let waiting = new Promise<void>((res) => { wake = res; });
    const pending: RunRecord[] = [];
    const off = runs.onFinished((r) => { pending.push(r); wake(); });
    stream.onAbort(() => { open = false; off(); wake(); });
    await stream.writeSSE({ event: 'hello', data: JSON.stringify({ running: runs.list().filter((r) => r.status === 'running' || r.status === 'queued').length }) });
    while (open) {
      const timer = setTimeout(() => wake(), 25_000);
      await waiting;
      clearTimeout(timer);
      waiting = new Promise<void>((res) => { wake = res; });
      if (!open) break;
      if (pending.length) {
        for (const r of pending.splice(0)) await stream.writeSSE({ event: 'run.done', data: JSON.stringify({ id: r.id, room: r.room ?? null, label: r.label ?? LABELS[r.kind] ?? r.kind, status: r.status, text: r.result?.text ?? r.error ?? null }) });
      } else await stream.write(': keepalive\n\n');
    }
    off();
  }));

  /**
   * One planned rebuild of a room. KC-0137: Nyheder is rebuilt on a schedule only when there is a paper to build from
   * — Henrik's morning paper is registered, or the user's own feeds are connected — so an install with neither is
   * never sent after a paper nobody set up. Resolves to whether a run started.
   */
  async function bygPlanlagt(roomId: string): Promise<boolean> {
    const mod = getRoomModule(roomId);
    if (!mod) return false;
    if (roomId === 'nyheder' && !kilder.hent('kira-morgenavis') && !(await d.rssNyheder?.())) return false;
    const run = await mod.opdater(d, 'opdater', { kanal: 'baggrund' });
    if (!run) return false;
    run.kind = 'frontload';
    tag(run, roomId);
    return true;
  }

  /** Planned rebuilds (frontloading). Returns a stop function. */
  function frontload(spec: string): () => void {
    return startScheduler(parseFrontload(spec), (roomId) => { void bygPlanlagt(roomId).catch(() => {}); }, undefined, () => !runs.paaPause()); // KC-0124: no planned rebuild while paused
  }

  /** Today's Nyheder lines with their stamp, unless Kuratoren already saw that stamp (state.nyhederSet); else null (= nothing new). */
  async function nyeNyheder(): Promise<{ linjer: string[]; stempel: string } | null> {
    const ny = await deps.store.readState<Partial<NyhederState>>('nyheder');
    if (!ny || ny.dato !== copenhagenDate(now()) || !Array.isArray(ny.femLinjer) || ny.femLinjer.length === 0 || !ny.genereret) return null;
    if (ny.genereret === (await laesKurator(deps.store)).nyhederSet) return null;
    return { linjer: ny.femLinjer, stempel: ny.genereret };
  }

  const startKuratoren = async (dyb: boolean): Promise<RunRecord | null> => {
    const ny = await nyeNyheder();
    const personer = personerNu();
    const run = await startKurator(d, { dyb, nyheder: ny?.linjer ?? null, ...(ny ? { nyhederStempel: ny.stempel } : {}), ...(personer ? { personer } : {}) });
    if (run) live.notify(HJEM); // the timer's runs are not tagged; Hjem's I gang band shows them
    return run;
  };

  /** Today's deep run is owed: none ran today (sidstDyb, Copenhagen) and today's Nyheder has been built. */
  async function skylderDyb(): Promise<boolean> {
    const n = now();
    const { sidstDyb } = await laesKurator(deps.store);
    if (sidstDyb && copenhagenDate(new Date(sidstDyb)) === copenhagenDate(n)) return false;
    const g = (await deps.store.readState<Partial<NyhederState>>('nyheder'))?.genereret;
    return typeof g === 'string' && !Number.isNaN(Date.parse(g)) && copenhagenDate(new Date(g)) === copenhagenDate(n);
  }

  /**
   * The hourly check: a run when due and something is new — deep while today's deep run is owed (so a
   * Nyheder rebuild that came while another run was in flight is not lost). `sidst` is stamped only by a
   * successful run, so the check also remembers (in memory) when it last tried: a tick that finds nothing new,
   * or a run that fails, must not make every minute tick re-read mail or re-ask Hermes. While a deep run is
   * owed, only that memory gates it (not `sidst`): the first tick after the run in flight runs it.
   */
  let sidstTjek: string | undefined;
  async function kuratorTik(plan: KuratorPlan): Promise<RunRecord | null> {
    if (runs.paaPause()) return null; // KC-0124: nothing planned runs while paused (and nothing is stamped)
    // A run in flight: nothing to try, and nothing stamped (the next tick after it may be the deep run).
    if (runs.list().some((r) => r.kind === 'kurator' && (r.status === 'queued' || r.status === 'running'))) return null;
    const dyb = await skylderDyb();
    const sidst = dyb ? undefined : (await laesKurator(deps.store)).sidst;
    const sidste = [sidst, sidstTjek].filter((x): x is string => Boolean(x) && !Number.isNaN(Date.parse(x as string))).sort().pop();
    if (!kuratorDue(plan, now(), sidste)) return null;
    sidstTjek = now().toISOString(); // stamped before the attempt, so a null, a throw or a failed run all count
    return startKuratoren(dyb);
  }

  /** KC-0028: Kuratoren's schedule ("07-22/60"; empty or "fra" = off), plus right after a Mail/Nyheder rebuild. Returns a stop function. */
  function kurator(spec: string): () => void {
    const plan = parseKuratorPlan(spec);
    if (!plan) return () => {};
    const fejl = (e: unknown): void => { console.error('kurator: kørslen kunne ikke startes', e); };
    const t = setInterval(() => { void kuratorTik(plan).catch(fejl); }, 60_000);
    t.unref();
    const off = runs.onFinished((r) => {
      if (runs.paaPause()) return;
      if (r.status !== 'done' || (r.kind !== 'opdater' && r.kind !== 'frontload') || (r.room !== 'mail' && r.room !== 'nyheder')) return;
      // Deep when owed (today's Nyheder built, no deep run today); startKurator itself refuses a second one the same day.
      void skylderDyb().then((dyb) => startKuratoren(dyb)).catch(fejl);
    });
    return () => { clearInterval(t); off(); };
  }

  /** Hjem's own waiting things, read once for the page and for the nav count (KC-0093: one definition). */
  /** KC-0145: the Sunday sample's card and the stop question — the owner's only, and the sample only while the check is on. */
  async function soendagNu(): Promise<{ stikproeve?: Stikuge; stopTilbud?: true }> {
    if (!stikbog || d.person.rolle !== 'ejer') return {};
    const b = await stikbog.laes();
    const til = (await settings.read()).soendagstjek !== false;
    const u = til ? aabenUge(b) : undefined;
    return { ...(u ? { stikproeve: u } : {}), ...(b.stop && !b.stop.svar ? { stopTilbud: true as const } : {}) };
  }

  /**
   * KC-0144 / KC-0227: the proposals waiting for this person's answer — the one list Nu's card and Start's card are drawn from.
   * Only the owner answers (the rules file is the household's) and only what the person may see; a decided one is not on offer.
   */
  function ventendeForslag(kurator: Awaited<ReturnType<typeof laesKurator>>): Regelforslag[] {
    return d.person.rolle === 'ejer' ? (kurator.regelforslag ?? []).filter((f) => f.status === 'afventer') : [];
  }
  async function ventendeForslagNu(): Promise<Regelforslag[]> { return ventendeForslag(synligKurator(await laesKurator(deps.store), d.person)); }

  async function hjemEgneData(): Promise<{ kort: Kort[]; gjort: string[]; claudeCode: CcRaekke[]; kurator: Awaited<ReturnType<typeof laesKurator>>; egne: LogEntry[]; reglerFejl?: { hvorfor: string; fil: string }; kildeHelbred: KildeHelbredKort[]; regelforslag?: Regelforslag[]; stikproeve?: Stikuge; stopTilbud?: true; beta?: BetaVisning; digitalPost?: PostVisning; aula?: AulaVisning }> {
    // KC-0117: Hjem shows (and counts) only what the person looking may see.
    const egne = (await deps.store.readLog(HJEM, 200)).filter((e) => synligFor(d.person, e));
    const gjort = egne.filter((e) => e.handlingId && !e.handlingId.startsWith('regnskab:') && !e.fortrudt).map((e) => e.handlingId as string);
    const kurator = synligKurator(await laesKurator(deps.store), d.person);
    // An expired card goes at once, not at the next run, and a card put away (Senere, KC-0096) until its time.
    const kort = synligeKort(kurator.kort, now());
    // KC-0043: what Claude Code has from Henrik, with its status.
    const claudeCode = synlige(await laesOpgaver(deps.store), now()).map((o) => ({ id: o.id, status: o.status, projekt: findProjekt(o.projekt)?.navn ?? o.projekt, saetning: o.saetning, oprettet: o.oprettet,
      ...(o.ticket ? { ticket: o.ticket } : {}), ...(o.bevis ? { bevis: o.bevis } : {}), ...(o.pr ? { pr: o.pr } : {}), ...(o.grund ? { grund: o.grund } : {}),
      ...(o.spoergsmaal ? { spoergsmaal: { tekst: o.spoergsmaal.tekst, valg: o.spoergsmaal.valg } } : {}), ...(o.svar ? { svar: o.svar.tekst } : {}) }));
    // KC-0142: a rules file that cannot be read is the owner's to fix (one card); otherwise nothing is shown.
    const r = d.person.rolle === 'ejer' && regler ? await regler.laes() : undefined;
    // KC-0144: only the owner answers proposals (the rules file is the household's).
    return { kort, gjort, claudeCode, kurator, egne, kildeHelbred: await kildeHelbredNu(), ...(await soendagNu()), ...await betaVisning().then((b) => (b ? { beta: b } : {})), ...await postVisning().then((p) => (p ? { digitalPost: p } : {})), ...await aulaVisning().then((v) => (v ? { aula: v } : {})), ...(ventendeForslag(kurator).length ? { regelforslag: ventendeForslag(kurator) } : {}), ...(r?.tilstand === 'ulaeselig' && regler ? { reglerFejl: { hvorfor: r.hvorfor, fil: regler.fil } } : {}) };
  }

  /** Hjem is not a room module: its page is built here from every room's hjemVenter, the logs and Kuratoren's cards. */
  async function hjemData(nav: { synlige?: ReadonlySet<string>; venter: Record<string, number> }): Promise<{ data: HjemData; hermesStatus: string }> {
    const synligeNu = nav.synlige;
    const vent: { roomId: string; tekst: string }[] = [];
    for (const m of ROOM_MODULES) vent.push(...(await m.hjemVenter(d)));
    const venterPaaAndre = (await Promise.all(ROOM_MODULES.map((m) => m.hjemIgang?.(d) ?? []))).flat(); // KC-0149
    // Every active univers: today's prepared meeting.
    for (const u of (await laesIndeks(deps.store)).univers) if (!u.arkiveret) vent.push(...(await universRoom(u.id).hjemVenter(d)));
    const logs = await Promise.all(ROOM_MODULES.map(async (m) => (await deps.store.readLog(m.id, 8)).filter((e) => synligFor(d.person, e))));
    const { kort, gjort, claudeCode, kurator, egne, reglerFejl, kildeHelbred, regelforslag, stikproeve, stopTilbud, beta, digitalPost, aula } = await hjemEgneData();
    const gamle = await gamleNu();
    const egneIds = new Set(egne.slice(0, 8).map((e) => e.id));
    // Only Hjem's own entries can be undone from Hjem; the other rooms' lines are shown plain.
    const hermes = [...logs.flat(), ...egne.slice(0, 8)].sort((a, b) => b.tid.localeCompare(a.tid)).slice(0, 10)
      .map((e) => ({ ...(e.graense ? { graense: e.graense } : {}), ...(e.zone ? { zone: e.zone } : {}), ...(e.ejer ? { ejer: e.ejer } : {}), ...(egneIds.has(e.id) ? { tid: e.tid, tekst: e.tekst, id: e.id, ...(e.handlingId ? { handlingId: e.handlingId } : {}), ...(e.fortryd ? { fortryd: e.fortryd } : {}), ...(e.fortrudt ? { fortrudt: e.fortrudt } : {}) } : { tid: e.tid, tekst: e.tekst }) }));
    const hermesStatus = (await getRoomModule(DAGEN)?.view(d))?.hermesStatus ?? tekst().klar;
    // KC-0088: the earliest next appointment any room offers (today only Dagen does).
    const naeste = (await Promise.all(ROOM_MODULES.map((m) => m.naeste?.(d) ?? null))).filter((n) => n !== null).sort((a, b) => a.start.localeCompare(b.start))[0];
    // A written row whose card is gone keeps its Fortryd in "Skrevet i regnskab" (a card only put away, KC-0096, is not gone).
    const aabne = new Set(kurator.kort.filter((k) => !udloebet(k, now())).map((k) => k.id));
    const regnskab = Object.entries(kurator.regnskab ?? {}).filter(([id, r]) => r.status === 'skrevet' && !aabne.has(id))
      .map(([id, r]) => ({ id, hvor: r.hvor, ...(r.leverandoer ? { leverandoer: r.leverandoer } : {}), ...(r.beloeb ? { beloeb: r.beloeb } : {}), ...(r.valuta ? { valuta: r.valuta } : {}) }));
    const skrivIgen = Object.entries(kurator.regnskab ?? {}).filter(([, r]) => r.status === 'fortrudt').map(([id]) => id); // KC-0069
    const ccTal = tillid(await laesOpgaver(deps.store)).map((t) => ({ ...t, projekt: findProjekt(t.projekt)?.navn ?? t.projekt }));
    const sit = await situationNu();
    const foerste = (await forhaandsvisningerNu(d)).map((f) => ({ id: forhaandsvisningId(f.kildeId), html: renderForhaandsvisning(f, now(), gamle[f.slags]) }));
    return { hermesStatus, data: ({ ...(foerste.length ? { forhaandsvisninger: foerste } : {}), hilsen: hilsen(now(), profil?.laesNu()?.navn), venter: vent, hermes, ...(naeste ? { naeste } : {}), situation: sit.situation, ...(sit.moede ? { moede: { titel: sit.moede.titel, url: sit.moede.url, slut: sit.moede.slut } } : {}), kort, intet: kurator.intet, gjort, skrivIgen, regnskab, claudeCode, ccTal, igang: runs.igang(null), now: now(), venterIalt: antalVenter(nav.venter), venterPaaAndre, ...(synligeNu ? { synlige: synligeNu } : {}), person: d.person, ...(reglerFejl ? { reglerFejl } : {}), ...(regelforslag ? { regelforslag } : {}), ...(stikproeve ? { stikproeve } : {}), ...(stopTilbud ? { stopTilbud } : {}), ...(beta ? { beta } : {}), ...(digitalPost ? { digitalPost } : {}), ...(aula ? { aula } : {}), ...(kildeHelbred.length ? { kildeHelbred } : {}), ...(Object.keys(gamle).length ? { gamle } : {}) }) };
  }

  /**
   * KC-0147: notes what stands in Nu's Kræver dig band (the ids come from the band's own groups, kraeverIder) and the
   * day's Fortryd count (log lines undone today, in every room) — only for the owner, whose band it is.
   */
  async function noterDagstal(data: HjemData): Promise<void> {
    if (!dagstal || d.person.rolle !== 'ejer') return;
    const dato = idagKbh(now());
    const logs = await Promise.all([HJEM, ...ROOM_MODULES.map((m) => m.id)].map((id) => deps.store.readLog(id, 500)));
    const laest = regler ? await regler.laes() : undefined;
    await dagstal.noter(dato, kraeverIder(data), { fortryd: fortrudtPaaDag(logs.flat().filter((e) => synligFor(d.person, e)), dato), ...(laest?.tilstand === 'ok' ? { regler: laest.saet.regler.filter((r) => r.status === 'aktiv').length } : {}) });
  }

  /** The week's number for Nu: Mondays only (KC-0052), about the week that just ended — this week has barely begun. */
  async function ugetalNu(): Promise<Markup | undefined> {
    if (!dagstal || d.person.rolle !== 'ejer' || !erMandag(now())) return undefined;
    const v = ugeVisning(ugeraekke(faerdigeDage(await dagstal.dage(), idagKbh(now())), ugeAf(now())).slice(0, -1), 'sidste');
    return v ? ugeLinje(v) : undefined;
  }

  async function hjemView(nav: { synlige?: ReadonlySet<string>; venter: Record<string, number> }): Promise<{ main: Markup; hermesStatus: string }> {
    const { data, hermesStatus } = await hjemData(nav);
    await noterDagstal(data);
    const ugetal = await ugetalNu();
    return { main: renderHjem({ ...data, ...(ugetal ? { ugetal } : {}) }), hermesStatus };
  }

  app.get('/api/rum/hjem/fragment', async (c) => {
    const nav = await navData(HJEM);
    const { main, hermesStatus } = await hjemView(nav);
    return c.json({ html: String(main), venter: nav.venter, hermesStatus, version: live.version(HJEM) });
  });

  app.get('/api/rum/:id/fragment', async (c) => {
    const mod = getRoomModule(c.req.param('id'));
    if (!mod) return c.json({ error: 'Rummet er ikke bygget' }, 404);
    const view = await mod.view(d);
    if (view.status) return c.json({ error: 'Findes ikke' }, view.status);
    return c.json({ html: String(view.main), venter: await venter(), hermesStatus: view.hermesStatus, version: live.version(mod.id) });
  });

  app.get('/api/rum/:id/live', (c) => {
    // Hjem is not a module but is live too (KC-0028): Kuratoren and the card buttons notify 'hjem'.
    const id = c.req.param('id');
    const mod = id === HJEM ? { id: HJEM } : getRoomModule(id);
    if (!mod) return c.text('Rummet er ikke bygget', 404);
    return streamSSE(c, async (stream) => {
      let open = true;
      let wake!: () => void;
      let waiting = new Promise<void>((res) => { wake = res; });
      const pending: number[] = [];
      const off = live.subscribe(mod.id, (v) => { pending.push(v); wake(); });
      stream.onAbort(() => { open = false; off(); wake(); });
      await stream.writeSSE({ event: 'hello', data: JSON.stringify({ version: live.version(mod.id) }) });
      while (open) {
        const timer = setTimeout(() => wake(), 25_000);
        await waiting;
        clearTimeout(timer);
        waiting = new Promise<void>((res) => { wake = res; });
        if (!open) break;
        if (pending.length) { const v = pending[pending.length - 1]!; pending.length = 0; await stream.writeSSE({ event: 'changed', data: JSON.stringify({ version: v }) }); }
        else await stream.write(': keepalive\n\n');
      }
      off();
    });
  });

  /**
   * KC-0089: an unknown HTML address is a calm Danish 404 inside the normal skeleton. A frame (a presentation's
   * <iframe>) gets plain text instead: a whole skeleton inside it would only be noise.
   */
  async function ikkeFundet(c: Context<Env>, slags: IkkeFundetSlags): Promise<Response> {
    if (c.req.header('sec-fetch-dest') === 'iframe') return c.text('Findes ikke', 404);
    const { venter: v, univers, synlige: syn } = await navData(HJEM);
    const main = renderIkkeFundet(slags);
    return c.html(String(shell({ ...hvem(c), roomId: HJEM, hermesStatus: tekst().klar, venter: v, main, chat: [], stemme: stemmeNiveau, univers, synlige: syn, titel: ikkeFundetOverskrift(slags) })), 404);
  }
  app.notFound((c) => {
    const p = new URL(c.req.url).pathname;
    if (p === '/api' || p.startsWith('/api/')) return c.json({ error: 'Findes ikke' }, 404);
    return ikkeFundet(c, 'side');
  });

  app.get('/rum/:id/dok/:name', async (c) => {
    const mod = getRoomModule(c.req.param('id'));
    const f = mod?.fil ? await mod.fil(d, c.req.param('name')) : null;
    if (!f) return ikkeFundet(c, 'dokument');
    return c.body(f.content, 200, { 'content-type': f.contentType, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}` });
  });

  // Hermes' presentations are untrusted HTML: served inline for <iframe sandbox>, with a CSP that allows inline styles, data: fonts and images only (KC-0229: no font host).
  const VIS_CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
  app.get('/rum/:id/vis/:name', async (c) => {
    const name = c.req.param('name');
    const mod = getRoomModule(c.req.param('id'));
    const f = mod?.fil && name.endsWith('.html') ? await mod.fil(d, name) : null;
    if (!f) return ikkeFundet(c, 'dokument');
    return c.body(f.content, 200, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'content-security-policy': VIS_CSP });
  });

  // KC-0030: the meeting view — the shell of the univers with the meeting as main. Not live: the fragment would swap in the univers page.
  app.get('/moede/:slug/:moedeId', async (c) => {
    const slugNavn = c.req.param('slug');
    const { venter: v, univers, synlige: syn } = await navData(universRum(slugNavn));
    const info = findUnivers(await laesIndeks(deps.store), slugNavn);
    const state = info && !info.arkiveret ? await laesUnivers(deps.store, slugNavn) : null;
    const moede = state?.moeder.find((m) => m.id === c.req.param('moedeId'));
    if (!info || !state || !moede) {
      const main = html`<header class="room-head"><div><a class="muted" href="/rum/dagen">Til Dagen</a><h1>Mødet findes ikke</h1><p class="muted">Det er enten flyttet, slettet eller aldrig oprettet. Gå til Dagen for at se, hvad der er i kalenderen.</p></div></header>`;
      return c.html(String(shell({ ...hvem(c), roomId: 'hjem', hermesStatus: tekst().klar, venter: v, main, chat: [], stemme: stemmeNiveau, univers, synlige: syn, titel: 'Mødet findes ikke' })), 404);
    }
    const rum = universRum(slugNavn);
    return c.html(String(shell({
      ...hvem(c), roomId: rum, hermesStatus: state.hermesStatus ?? tekst().klar, venter: v, main: renderMoedeVisning(info, moede, synligUnivers(state, d.person), now()), chat: await deps.store.readChat(rum),
      stemme: stemmeNiveau, univers, synlige: syn, titel: moede.titel, kontekst: `Mødet: ${moede.titel}`.slice(0, 200),
      bodyData: { situation: 'moede', 'moede-slut': moede.slut, 'moede-id': moede.id },
    })));
  });

  // KC-0154: the owner's invite page; also before there is a household (the nav does not show Husstanden yet). Others: 403.
  app.get('/rum/husstand/inviter', async (c) => {
    const { venter: v, univers, synlige: syn } = await navData('husstand');
    const view = await inviterView(d);
    return c.html(String(shell({ ...hvem(c), roomId: 'husstand', hermesStatus: view.hermesStatus, venter: v, main: view.main, chat: await deps.store.readChat('husstand'), stemme: stemmeNiveau, univers, synlige: syn, ...(view.titel ? { titel: view.titel } : {}) })), view.status ?? 200);
  });

  app.get('/rum/:id', async (c) => {
    const room = findRoom(c.req.param('id'));
    if (!room) return ikkeFundet(c, 'rum');
    const mod = getRoomModule(room.id);
    // KC-0188: support's visit marks nothing as seen for the owner.
    if ((mod || room.id === HJEM) && c.get('person').rolle !== 'stoette') await markerAabnet(deps.store, room.id, now());
    const { venter: v, univers, synlige: syn } = await navData(room.id);
    if (mod) {
      const view = await mod.view(d);
      const chat = await deps.store.readChat(mod.id);
      return c.html(String(shell({ ...hvem(c), roomId: room.id, hermesStatus: view.hermesStatus, venter: v, main: view.main, chat, stemme: stemmeNiveau, live: true, univers, synlige: syn, ...(view.titel ? { titel: view.titel } : {}) })), view.status ?? 200);
    }
    if (room.id === HJEM) {
      const { main, hermesStatus } = await hjemView({ synlige: syn, venter: v });
      return c.html(String(shell({ ...hvem(c), roomId: room.id, hermesStatus, venter: v, main, chat: await deps.store.readChat(HJEM), stemme: stemmeNiveau, live: true, univers, synlige: syn, bodyData: { situation: (await situationNu()).situation } })));
    }
    return c.html(String(shell({ ...hvem(c), roomId: room.id, hermesStatus: tekst().klar, venter: v, main: renderPlaceholder(room), chat: [], stemme: stemmeNiveau, univers, synlige: syn })));
  });

  /** KC-0064: a room run starting or ending changes its I gang band, and Hjem's (which shows every room's). */
  function notifyIgang(run: RunRecord): void {
    if (CHAT_KINDS.has(run.kind) || !run.room) return;
    live.notify(run.room);
    if (run.room !== HJEM) live.notify(HJEM);
  }
  runs.onFinished(notifyIgang); // a failed run never calls the room's rendered(), so its row must go here
  // KC-0128: a finished rebuild (or Kuratoren run) replaces the previews it covers; Nu and Start refresh.
  runs.onFinished((r) => {
    if (r.status !== 'done') return;
    void koerselFaerdig(d, r).then((ja) => { if (ja) { live.notify(START_RUM); live.notify(HJEM); } }).catch((err: unknown) => console.error('start: forhåndsvisningen kunne ikke erstattes:', err));
  });
  function tag(run: RunRecord, roomId: string, hint?: string): RunRecord {
    const navn = findRoom(roomId)?.navn ?? roomId;
    if (!run.room) run.room = roomId;
    if (!run.label) run.label = `${navn}: ${hint ?? LABELS[run.kind] ?? run.kind}`;
    notifyIgang(run);
    return run;
  }
  const accepted = (c: { json: (o: unknown, s: 202) => Response }, run: RunRecord) => c.json({ runId: run.id }, 202);
  // KC-0082: one press, one run. The same press while its run is still going (another tab, the phone and the
  // laptop, a double tap before the button greys out) joins that run instead of asking Hermes twice.
  // The promise is stored before the start resolves, so two presses arriving together also share one run.
  const tryk = new Map<string, Promise<RunRecord | null>>();
  function enGang(noegle: string, startFn: () => Promise<RunRecord | null>): Promise<RunRecord | null> {
    const igang = tryk.get(noegle);
    if (igang) return igang;
    const p = startFn().then((run) => {
      if (!run) tryk.delete(noegle);
      else void run.finished.then(() => { if (tryk.get(noegle) === p) tryk.delete(noegle); });
      return run;
    }, (err: unknown) => { tryk.delete(noegle); throw err; });
    tryk.set(noegle, p);
    return p;
  }

  // Only a fenced block that holds a "flyt" key is the app's; other code blocks in an answer stay.
  const FLYT_BLOCK = /```(?:json)?\s*(\{[^`]*?"flyt"[^`]*?\})\s*```/gi;

  // KC-0019: Hjem's chat — no state of its own; Hermes gets the overview of every room.
  async function startHjemChat(dd: RoomDeps, besked: string, kontekst?: string): Promise<RunRecord> {
    await deps.store.appendChat(HJEM, { fra: 'henrik', tekst: besked, ...(kontekst ? { kontekst } : {}) });
    const { tekst } = await bygOversigt(ROOM_MODULES, d, SITUATIONER[(await situationNu()).situation].stemme);
    const stand = synligKurator(await laesKurator(deps.store), d.person);
    const aabne = stand.kort;
    const r0 = stand.regnskab;
    // "Ret" on a card: Hermes sees which card Henrik points at, with what the card says (an afledt segment, KC-0123).
    const kort = kontekst ? aabne.find((k) => `Kortet: ${k.titel}` === kontekst) : undefined;
    if (kontekst?.startsWith('Kortet: ')) await d.retBus?.meld(dd, { art: 'ret', tid: now().toISOString(), titel: kontekst.slice('Kortet: '.length), ...(kort ? { kortId: kort.id } : {}), tekst: besked });
    // KC-0144: a Ret on a card, or Ret reglen on a pending proposal, may bring ONE rule proposal back (the owner's only).
    // Decided here in the request: a run's callback has no person. The answer is only ever stored as a pending proposal.
    const mulig = kanForeslaa(dd);
    const revideret = mulig && kontekst?.startsWith('Forslag: ') ? (stand.regelforslag ?? []).find((f) => f.status === 'afventer' && `Forslag: ${f.titel}` === kontekst) : undefined;
    const regelLaest = await regler?.laes();
    const spec = buildHjemChatRun(besked, tekst, now(), aabne.map((k) => ({ id: k.id, titel: k.titel, betyder: k.betyder, ...(r0?.[k.id]?.status === 'skrevet' ? { hvor: r0[k.id]!.hvor } : {}) })), regelLaest, kontekst ? { kontekst, ...(kort ? { kort } : {}), ...(mulig && (kort || revideret) ? { forslag: true as const } : {}), ...(revideret ? { revideret } : {}) } : undefined);
    return dd.runs.start({
      kind: 'chat',
      spec,
      onDone: async (output) => {
        const { tekst: udenForslag, blok } = mulig ? extractForslagBlok(output) : { tekst: output, blok: undefined };
        const text = udenForslag.replace(FLYT_BLOCK, '').trim() || '(intet svar)';
        await deps.store.appendChat(HJEM, { fra: 'hermes', tekst: text });
        const forslagKort = kort ?? (revideret ? { id: revideret.kortId, titel: revideret.kortTitel, ...(revideret.zone ? { zone: revideret.zone } : {}), ...(revideret.ejer ? { ejer: revideret.ejer } : {}) } : undefined);
        if (forslagKort) await gemRegelforslag(dd, { kort: forslagKort, art: revideret?.art ?? 'ret', blok, ...(revideret?.pauser ? { pauser: revideret.pauser } : {}) }).catch((err: unknown) => console.error('regelforslag:', err instanceof Error ? err.message : err));
        // A correction names the ledger the row should be in; it moves only when that differs from where it is now.
        // Unknown ids, cards without a written row and a missing/same target are ignored. A vault error must not fail the run.
        try {
          for (const m of output.matchAll(FLYT_BLOCK)) {
            let raw: unknown;
            try { raw = JSON.parse(m[1]!); } catch { continue; }
            const { flyt, til } = (raw && typeof raw === 'object' ? raw : {}) as { flyt?: unknown; til?: unknown };
            if (typeof flyt !== 'string' || (til !== 'shelfatlas' && til !== 'privat')) continue;
            // regnskabFlyt checks the card and the row inside Hjem's state chain; a refusal (404/409) is ignored here.
            await regnskabFlyt(d, flyt, til);
          }
        } catch (err) {
          console.error('hjem chat: flyt mislykkedes:', err);
        }
        return { text };
      },
    });
  }

  // KC-0028: Kuratoren's top cards (by prioritet) before the rooms, in the spoken overview. Cards are not voice-executable: punkter stay as they are.
  async function oversigtMedKort(): Promise<Oversigt> {
    return medKildeHelbred(medKuratorKort(await bygOversigt(ROOM_MODULES, d, SITUATIONER[(await situationNu()).situation].stemme), (await laesKurator(deps.store)).kort, d.person, now()), await stemmeHelbred());
  }

  /** KC-0122: the human-tap token a button that needed a yes sends along (absent = none). */
  async function jaFra(c: { req: { json: () => Promise<unknown> } }): Promise<{ ja?: string }> {
    const b = await body(c);
    return typeof b['ja'] === 'string' ? { ja: b['ja'] } : {};
  }

  async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
    try { const b = await c.req.json(); return typeof b === 'object' && b !== null ? (b as Record<string, unknown>) : {}; } catch { return {}; }
  }

  app.post('/api/rum/:id/opdater', async (c) => {
    const mod = getRoomModule(c.req.param('id'));
    if (!mod) return c.json({ error: 'Rummet er ikke bygget' }, 404);
    const b = await body(c);
    const mode = typeof b['mode'] === 'string' ? b['mode'] : 'opdater';
    // KC-0223: a mail connection that cannot be read says so in plain words (400), not a server error.
    let run;
    try { run = await enGang(`${mod.id}|opdater|${mode}`, () => mod.opdater(d, mode, { kanal: 'knap' })); } catch (err) { if (err instanceof ActionError) return c.json({ error: err.message }, err.status); throw err; }
    return run ? accepted(c, tag(run, mod.id)) : c.json({ error: 'ukendt mode for rummet' }, 400);
  });

  app.post('/api/rum/:id/handlinger/:hid', async (c) => {
    const mod = getRoomModule(c.req.param('id'));
    if (!mod) return c.json({ error: 'Rummet er ikke bygget' }, 404);
    const hid = c.req.param('hid');
    const ja = await jaFra(c);
    const run = await enGang(`${mod.id}|handling|${hid}`, () => mod.handling(d, hid, { kanal: 'knap', ...ja }));
    return run ? accepted(c, tag(run, mod.id)) : c.json({ error: 'Handlingen findes ikke i rummet' }, 404);
  });

  app.post('/api/rum/:id/log/:lid/fortryd', async (c) => {
    const mod = getRoomModule(c.req.param('id'));
    if (!mod) return c.json({ error: 'Rummet er ikke bygget' }, 404);
    const lid = c.req.param('lid');
    const ja = await jaFra(c);
    const run = await enGang(`${mod.id}|fortryd|${lid}`, () => mod.fortryd(d, lid, { kanal: 'knap', ...ja }));
    return run ? accepted(c, tag(run, mod.id)) : c.json({ error: 'Kan ikke fortrydes' }, 404);
  });

  app.post('/api/rum/:id/aktion/:name', async (c) => {
    const mod = getRoomModule(c.req.param('id'));
    if (!mod?.aktion) return c.json({ error: 'Rummet har ingen aktioner' }, 404);
    const b = await body(c);
    try {
      const name = c.req.param('name');
      const run = await enGang(`${mod.id}|aktion|${name}|${JSON.stringify(b)}`, () => mod.aktion!(d, name, b, { kanal: 'knap', ...(typeof b['ja'] === 'string' ? { ja: b['ja'] } : {}) }));
      return run ? accepted(c, tag(run, mod.id)) : c.json({ error: 'Ukendt aktion' }, 404);
    } catch (err) {
      if (err instanceof ActionError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });

  // KC-0153: the go-between's Send — a human tap only. The text is the app's (kanal.ts beskedTekst), checked before the
  // policy layer, which needs a one-time yes bound to this request, kind and exact text (verb send-til-andre: never by
  // voice, never on its own); then sent once inside the store's queue. Nothing in the body is sent.
  app.post('/api/hushold/foresp/:id/send', async (c) => {
    const kanal = deps.kanal;
    if (!kanal) return c.json({ error: 'Clawco kan ikke sende beskeder herfra.' }, 503);
    const b = await body(c);
    const slags = b['slags'] === 'paamindelse' ? 'paamindelse' : 'foresp';
    const id = c.req.param('id');
    try {
      const klar = await kanalSendKlar(d, id, slags);
      const run = await gennem(d, { rum: 'husstand', id: klar.jaId, verb: 'send-til-andre', zoner: ['husstand'] }, 'send', { kanal: 'knap', ...(typeof b['ja'] === 'string' ? { ja: b['ja'] } : {}) },
        () => kanalSend(d, kanal, id, slags, klar.tekst));
      return accepted(c, tag(run, 'husstand'));
    } catch (err) {
      if (err instanceof ActionError) return c.json({ error: err.message }, err.status);
      if (err instanceof KanalFejl) return c.json({ error: err.message }, 502);
      throw err;
    }
  });

  // KC-0154: the invitation's Send — the same mechanism as a request's: the first message is the app's (invitation.ts),
  // checked before the policy layer, which needs a one-time yes bound to this member and the hash of the text shown
  // (verb send-til-andre: never by voice, never on its own); then sent once inside the store's queue.
  app.post('/api/hushold/medlem/:id/inviter', async (c) => {
    const kanal = deps.kanal;
    if (!kanal) return c.json({ error: 'Clawco kan ikke sende beskeder herfra.' }, 503);
    const b = await body(c);
    const id = c.req.param('id');
    try {
      const klar = await invitationKlar(d, id);
      const run = await gennem(d, { rum: 'husstand', id: klar.jaId, verb: 'send-til-andre', zoner: ['husstand'] }, 'invitation', { kanal: 'knap', ...(typeof b['ja'] === 'string' ? { ja: b['ja'] } : {}) },
        () => invitationSend(d, kanal, id, klar.tekst));
      return accepted(c, tag(run, 'husstand'));
    } catch (err) {
      if (err instanceof ActionError) return c.json({ error: err.message }, err.status);
      if (err instanceof KanalFejl) return c.json({ error: err.message }, 502);
      throw err;
    }
  });

  app.post('/api/rum/:id/chat', async (c) => {
    const id = c.req.param('id');
    const mod = getRoomModule(id);
    if (!mod && id !== HJEM) return c.json({ error: 'Rummet har ingen chat endnu' }, 404);
    const b = await body(c);
    const besked = typeof b['besked'] === 'string' ? b['besked'].trim().slice(0, 2000) : '';
    if (!besked) return c.json({ error: 'besked mangler' }, 400);
    // KC-0052: "jeg vil skrive" opens Skrive. Only the chat form asks for this (aabn); Samtale and the rest go to Hermes.
    if (b['aabn'] === true) {
      const univers = (await laesIndeks(deps.store)).univers.filter((u) => !u.arkiveret);
      const valg = { husstand: await husstandSynlig(d) }; // KC-0148: Husstanden opens only for whom it is there
      // KC-0098: "Hvad kan jeg sige?" is answered here and kept in the room's chat like any answer.
      if (erHjaelp(besked)) {
        const svar = hjaelpSvar(univers, valg);
        await deps.store.appendChat(mod ? mod.id : HJEM, { fra: 'henrik', tekst: besked });
        await deps.store.appendChat(mod ? mod.id : HJEM, { fra: 'hermes', tekst: svar });
        return c.json({ svar });
      }
      // KC-0146: "hvad ved du om mig" opens the page of what Clawco knows (the owner's; anyone else asks Hermes).
      if (erVidenBesked(besked) && c.get('person').rolle === 'ejer') return c.json({ aabn: '/viden' });
      // KC-0154: "inviter …" opens the invite page for whom may invite (anyone else asks Hermes).
      if (erInviterBesked(besked) && maaSe(c.get('person'), { slags: 'invitation' })) return c.json({ aabn: '/rum/husstand/inviter' });
      const hit = rumFraBesked(besked, univers, valg);
      if (hit && hit.id !== id) {
        await markerAabnet(deps.store, hit.id, now());
        return c.json({ aabn: `/rum/${hit.id}`, ...(hit.videre ? { videre: besked } : {}) });
      }
    }
    // KC-0024: from the phone Hermes answers short.
    const dd = b['enhed'] === 'telefon' ? { ...d, runs: fraTelefonen(runs) } : d;
    const kontekst = typeof b['kontekst'] === 'string' && b['kontekst'].trim() ? b['kontekst'].trim().slice(0, 200) : undefined;
    // KC-0227: "Ret reglen" on the proposal card in Start is the same Ret reglen as in Nu: Hjem's chat revises the proposal (one way).
    if (!mod || (mod.id === START_RUM && kontekst?.startsWith('Forslag: '))) return accepted(c, tag(await startHjemChat(dd, besked, kontekst), HJEM));
    try {
      return accepted(c, tag(await mod.chat(dd, besked, kontekst, { kanal: 'chat' }), mod.id));
    } catch (err) {
      if (err instanceof ActionError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });

  // KC-0028: Kuratoren — start a run, and what the buttons on a card do.
  const kortFejl = (c: { json: (o: unknown, s: 404 | 409 | 503) => Response }, u: Extract<Udfald, { ok: false }>): Response => c.json({ error: u.error }, u.status);
  const kortSvar = (c: { json: (o: unknown, s: 200 | 202) => Response }, u: Extract<Udfald, { ok: true }>): Response =>
    u.run ? c.json({ runId: tag(u.run, HJEM).id }, 202) : c.json({ ok: true }, 200);

  app.post('/api/rum/hjem/kurator', async (c) => {
    const b = await body(c);
    const run = await startKuratoren(b['dyb'] === true);
    return run ? c.json({ runId: run.id }, 202) : c.json({ intet: true }, 200);
  });

  /** KC-0122: Hjem's card routes pass the policy layer too (verb from the app; the card's zone). */
  async function kortGennem<T>(c: Context<Env>, id: string, verb: Verb, koer: () => Promise<T>): Promise<T> {
    const k = synligKurator(await laesKurator(deps.store), d.person).kort.find((x) => x.id === id);
    return gennem(d, { rum: HJEM, id, verb, zoner: [k ? zoneAf(k) : KORT_KORSEL] }, 'kort', { kanal: 'knap', ...(await jaFra(c)) }, koer);
  }

  app.post('/api/rum/hjem/kort/:id/luk', async (c) => {
    const b = await body(c);
    const g = b['grund'];
    if (g !== undefined && (typeof g !== 'string' || g.trim().length > 300)) return c.json({ error: 'grund skal være tekst på højst 300 tegn' }, 400);
    const u = await kortGennem(c, c.req.param('id'), 'sorter', () => luk(d, c.req.param('id'), typeof g === 'string' ? g.trim() : '', personerNu()));
    return u.ok ? kortSvar(c, u) : kortFejl(c, u);
  });

  app.post('/api/rum/hjem/kort/:id/senere', async (c) => {
    const til = (await body(c))['til'];
    if (typeof til !== 'string' || !SENERE.includes(til)) return c.json({ error: 'til skal være aften eller morgen' }, 400);
    const u = await kortGennem(c, c.req.param('id'), 'sorter', () => udsaet(d, c.req.param('id'), til as Senere));
    return u.ok ? kortSvar(c, u) : kortFejl(c, u);
  });

  app.post('/api/rum/hjem/kort/:id/handling', async (c) => {
    // A card's handling is Hermes' free-form instruction: the app's floor (KC-0122 verber.ts), never what the model claims.
    const u = await kortGennem(c, c.req.param('id'), agentGulv({}), () => startKortHandling(d, c.req.param('id')));
    return u.ok ? kortSvar(c, u) : kortFejl(c, u);
  });

  app.post('/api/rum/hjem/fortryd/:logId', async (c) => {
    const logId = c.req.param('logId');
    // KC-0144: the undo of a rule made from a proposal is the app's own (it shrinks the rules file), for the owner only.
    const fortryd = (await deps.store.readLog(HJEM, 1000)).find((x) => x.id === logId)?.fortryd;
    const regel = regelFortryd(fortryd);
    // KC-0145: Fortryd on "Stoppede søndagstjekket" turns the Sunday check on again (the app's own, the owner's).
    const soendag = fortryd === FORTRYD_SOENDAG;
    if ((regel || soendag) && !erEjer(c)) return afvis(c, 403, 'Kun ejeren kan fortryde det.');
    const u = await kortGennem(c, logId, 'udfoer-med-fortryd', () => (regel ? fortrydRegel(logId, regel) : soendag ? fortrydSoendag(logId) : fortrydLog(d, logId)));
    return u.ok ? kortSvar(c, u) : kortFejl(c, u);
  });

  app.post('/api/rum/hjem/kort/:id/regnskab/:hvor', async (c) => {
    const id = c.req.param('id');
    const hvor = c.req.param('hvor');
    if (hvor !== 'fortryd' && hvor !== 'flyt' && hvor !== 'shelfatlas' && hvor !== 'privat') return c.json({ error: 'hvor skal være fortryd, flyt, shelfatlas eller privat' }, 400);
    const u = await kortGennem(c, id, 'bogfoer', () => hvor === 'fortryd' ? regnskabFortryd(d, id) : hvor === 'flyt' ? regnskabFlyt(d, id) : regnskabVaelg(d, id, hvor));
    return u.ok ? kortSvar(c, u) : kortFejl(c, u);
  });

  // KC-0041/KC-0043: the development pipeline. Henrik sends an opgave; the metode plugin on the Mac fetches
  // its repo's opgaver over Tailscale and reports status back (the contract: docs/superpowers/specs/2026-10-29-…).
  app.get('/api/udvikling/projekter', (c) => c.json({ projekter: PROJEKTER }));

  app.post('/api/udvikling/opgaver', async (c) => {
    const u = await udviklingSend(d, await body(c));
    return u.ok ? c.json({ opgave: u.opgave }, 201) : c.json({ error: u.error }, u.status);
  });

  app.get('/api/udvikling/opgaver', async (c) => {
    const repo = c.req.query('repo') ?? '';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return c.json({ error: 'repo skal være owner/name' }, 400);
    const r = await udviklingForRepo(d, repo);
    return r ? c.json(r) : c.json({ error: 'Ukendt repo' }, 404);
  });

  app.post('/api/udvikling/opgaver/:id/status', async (c) => {
    const id = c.req.param('id');
    if (!OPGAVE_ID.test(id)) return c.json({ error: 'Opgaven findes ikke' }, 404);
    const u = await udviklingStatus(d, id, await body(c));
    return u.ok ? c.json({ opgave: u.opgave }) : c.json({ error: u.error }, u.status);
  });

  // KC-0045: Henrik answers the question a parked ticket asks.
  app.post('/api/udvikling/opgaver/:id/svar', async (c) => {
    const id = c.req.param('id');
    if (!OPGAVE_ID.test(id)) return c.json({ error: 'Opgaven findes ikke' }, 404);
    const u = await udviklingBesvar(d, id, await body(c));
    return u.ok ? c.json({ opgave: u.opgave }) : c.json({ error: u.error }, u.status);
  });

  // KC-0015: the stemme routes. Fail-closed: no client → 503 on all of them.
  app.use('/api/stemme/*', async (c, next) => {
    if (!stemme) return c.json({ error: 'Stemmen er ikke sat op (KC_ELEVENLABS_API_KEY mangler)' }, 503);
    await next();
  });

  app.post('/api/stemme/lyt', async (c) => {
    let fd: FormData;
    try { fd = await c.req.formData(); } catch { return c.json({ error: 'lydfilen mangler' }, 400); }
    const file = fd.get('file');
    if (!(file instanceof Blob) || file.size === 0) return c.json({ error: 'lydfilen mangler' }, 400);
    if (file.size > 8_000_000) return c.json({ error: 'optagelsen er for lang' }, 400);
    const rum = String(fd.get('rum') ?? '');
    const mod = getRoomModule(rum);
    const terms = [...KEYTERMS];
    if (mod?.stemme) { try { for (const p of (await mod.stemme(d)).punkter) for (const v of p.valg) terms.push(v.label); } catch { /* keyterms are a nicety */ } }
    try {
      const tekst = await stemme!.lyt(new Uint8Array(await file.arrayBuffer()), file.type || 'audio/webm', terms);
      return c.json({ tekst });
    } catch (err) { return stemmeFejl(c, err); }
  });

  app.post('/api/stemme/sig', async (c) => {
    const b = await body(c);
    const tekst = typeof b['tekst'] === 'string' ? b['tekst'].trim() : '';
    if (!tekst || tekst.length > 2000) return c.json({ error: 'tekst mangler eller er for lang (højst 2000 tegn)' }, 400);
    try {
      const { body: audio, contentType } = await stemme!.sig(tekst, await voice());
      return new Response(audio, { status: 200, headers: { 'content-type': contentType, 'cache-control': 'no-store' } });
    } catch (err) { return stemmeFejl(c, err); }
  });

  app.get('/api/stemme/oversigt', async (c) => c.json(await oversigtMedKort()));

  // KC-0124: while paused the voice offers and runs nothing.
  app.post('/api/stemme/samtale', async (c) => {
    if (runs.paaPause()) return c.json({ error: PAUSE_TEKST }, 409);
    const b = await body(c);
    const rum = typeof b['rum'] === 'string' ? b['rum'] : 'hjem';
    try {
      const agentId = await agent();
      const [token, o] = await Promise.all([stemme!.samtaleToken(agentId), oversigtMedKort()]);
      const dynamiskeVariabler = { oversigt: o.tekst, rum: ROOMS.find((r) => r.id === rum)?.navn ?? 'Nu', antal_tekst: antalTekst(o.punkter.length) };
      return c.json({ token, agentId, dynamiskeVariabler });
    } catch (err) { return stemmeFejl(c, err); }
  });

  /** A choice from the overview, by its spoken id "rum:valgId". Only ids in the current overview run. */
  app.post('/api/stemme/udfoer', async (c) => {
    if (runs.paaPause()) return c.json({ error: PAUSE_TEKST }, 409);
    const b = await body(c);
    const id = typeof b['id'] === 'string' ? b['id'].trim() : '';
    const sep = id.indexOf(':');
    if (sep <= 0) return c.json({ error: 'id mangler' }, 400);
    const rum = id.slice(0, sep);
    const valgId = id.slice(sep + 1);
    const mod = getRoomModule(rum);
    if (!mod) return c.json({ error: 'Rummet findes ikke' }, 404);
    const o = await bygOversigt(ROOM_MODULES, d);
    const valg = o.punkter.filter((p) => p.rum === rum).flatMap((p) => p.valg).find((v) => v.id === valgId);
    if (!valg) return c.json({ error: 'Valget findes ikke i det, der venter' }, 404);
    let run: RunRecord | null = null;
    if (valgId.startsWith('aktion:')) {
      const [, name, arg] = valgId.split(':');
      if (name !== 'faerdig' || !mod.aktion) return c.json({ error: 'Det kan ikke gøres med stemmen' }, 400);
      try { run = await mod.aktion(d, name, { mailId: arg ?? '' }, { kanal: 'stemme' }); } catch (err) { if (err instanceof ActionError) return c.json({ error: err.message }, 400); throw err; }
    } else {
      run = await mod.handling(d, valgId, { kanal: 'stemme' });
    }
    if (!run) return c.json({ error: 'Valget findes ikke i rummet' }, 404);
    tag(run, mod.id, valg.label);
    return c.json({ runId: run.id, label: valg.label }, 202);
  });

  app.get('/api/runs/:runId/events', (c) => {
    const id = c.req.param('runId');
    if (!runs.get(id)) return c.text('Kørslen findes ikke', 404);
    return streamSSE(c, async (stream) => {
      let n = 0;
      let finished!: () => void;
      const closed = new Promise<void>((res) => { finished = res; });
      const unsubscribe = runs.subscribe(id, (e) => {
        void stream.writeSSE({ event: e.type, data: JSON.stringify(e), id: String(++n) })
          .then(() => { if (e.type === 'done' || e.type === 'error') finished(); });
      });
      if (!unsubscribe) { finished(); return; }
      stream.onAbort(() => { unsubscribe(); finished(); });
      await closed;
      unsubscribe();
    });
  });

  /** The calendar poller (Univers: new meetings). Returns a stop function; off without a calendar script. */
  const moedeTik = (): (() => void) => startMoedeTik(d, undefined, () => !runs.paaPause());
  // KC-0149: the rooms' clocks (a request's reminders and expiry), outside any request; nothing while paused.
  const tikNu = async (): Promise<void> => { for (const m of ROOM_MODULES) await m.tik?.(d); };
  const rumTik = (): (() => void) => startTik(tikNu, undefined, () => !runs.paaPause());

  // KC-0152: the Saturday conflict — Tuesdays from the plan's time Husstanden looks at the coming weekend (once per weekend,
  // the room remembers); null when it is not due or Clawco is paused. `spec` "07:30"; empty or "fra" = off.
  const konfliktTik = async (plan: KonfliktPlan): Promise<Awaited<ReturnType<typeof weekendTjek>> | null> => {
    if (runs.paaPause() || !konfliktDue(plan, now())) return null;
    return weekendTjek(d);
  };
  const konflikt = (spec: string): (() => void) => {
    const plan = parseKonfliktPlan(spec);
    if (!plan) return () => {};
    return startTik(async () => { await konfliktTik(plan); }, 60_000, () => !runs.paaPause());
  };

  // KC-0145: the Sunday sample — Sunday from 18:00 the week is drawn once (the ledger remembers); nothing while paused.
  const soendagTik = async (): Promise<Awaited<ReturnType<typeof soendagsTjek>> | null> => {
    if (runs.paaPause() || !skjulte || !stikbog) return null;
    const r = await soendagsTjek({ skjulte, bog: stikbog, til: async () => (await settings.read()).soendagstjek !== false, now: now() });
    if (r === 'oprettet') live.notify(HJEM);
    return r;
  };
  const soendag = (): (() => void) => startTik(async () => { await soendagTik(); }, 60_000, () => !runs.paaPause());

  // KC-0139: every connected source's health once now and then every 30 minutes (and right after a failed read, see the registry); nothing while paused.
  const helbredTik = (): (() => void) => {
    const tik = (): Promise<void> => helbred.pollAlle();
    void tik().catch((err: unknown) => console.error('helbred:', err instanceof Error ? err.message : err));
    return startTik(tik, 30 * 60_000, () => !runs.paaPause());
  };

  return { app, runs, live, frontload, bygPlanlagt, kurator, kuratorTik, konflikt, konfliktTik, soendag, soendagTik, moedeTik, moedeTikNu: () => koerMoedeTik(d), rumTik, tikNu, helbred, helbredTik };
}

function env(name: string, fallback = ''): string { return (process.env[name] ?? fallback).trim(); }

/** The sha /health shows: <rod>/GIT_SHA when a build baked one (KC-0157: an image has no .git), else git, else unknown. */
export function gitSha(rod: string, git: () => string = () => execSync('git rev-parse --short HEAD', { cwd: rod, stdio: ['ignore', 'pipe', 'ignore'] }).toString()): string {
  let fil = '';
  try { fil = readFileSync(path.join(rod, 'GIT_SHA'), 'utf8').trim(); } catch { /* no baked sha */ }
  if (fil) return fil;
  try { return git().trim() || 'unknown'; } catch { return 'unknown'; }
}

/**
 * KC-0118: which AgentClient runs. KC_AGENT (hermes-http | direkte | fake); without it the older KC_HERMES_MODE
 * (http | fake). KC-0180: direkte = the model provider called directly, no Hermes (a Sky container).
 */
export function agentValg(e: Record<string, string | undefined>): AgentClient['mode'] {
  const valgt = (e['KC_AGENT'] ?? '').trim();
  if (valgt) {
    if (valgt === 'hermes-http' || valgt === 'direkte' || valgt === 'fake') return valgt;
    throw new Error('KC_AGENT skal være hermes-http, direkte eller fake');
  }
  const gammel = (e['KC_HERMES_MODE'] ?? '').trim() || 'http';
  if (gammel === 'http') return 'hermes-http';
  if (gammel === 'fake') return 'fake';
  throw new Error('KC_HERMES_MODE skal være http eller fake');
}

/**
 * KC-0120: the calendar script — KC_KALENDER_SCRIPT, else the bundled scripts/kalender_uge.py under `rod`; none with
 * the fake agent. main() derives it once and hands the same value to the meeting tick and to the kira-kalender
 * connector (which Dagen reads). KC-0133: the bundled script only where Kira can read the calendar (`kiraToken`: its
 * Google token script exists); a product install without Kira gets "Log ind med Google" instead.
 */
export function kalenderScriptFra(e: Record<string, string | undefined>, mode: AgentClient['mode'], rod: string, o: { kiraToken: boolean }): string {
  if (mode === 'fake') return '';
  const sat = (e['KC_KALENDER_SCRIPT'] ?? '').trim();
  if (sat) return sat;
  return o.kiraToken ? path.join(rod, 'scripts', 'kalender_uge.py') : '';
}

/** The token script kalender_uge.py reads Kira's Google access through (its default --token-script). */
const KIRA_TOKEN_SCRIPT = path.join(homedir(), '.hermes', 'scripts', 'google_token_refresh.py');

/** KC-0133: the Google calendar is offered unless the host already connects a calendar of its own (kira-kalender). */
export function medGoogleKalender(kilder: Kilde[], google: () => Kilde): Kilde[] {
  return kilder.some((k) => k.slags === 'kalender' && k.standard === 'forbundet') ? kilder : [...kilder, google()];
}

/**
 * KC-0133: the app's own address, which an OAuth provider sends the browser back to — KC_ADRESSE (the tailnet https
 * address), else http://localhost:<port> when the app listens on loopback (a laptop install), else none.
 */
export function egenAdresse(e: Record<string, string | undefined>, hostname: string, port: number): string {
  const sat = (e['KC_ADRESSE'] ?? '').trim();
  if (sat) return sat;
  return ['127.0.0.1', 'localhost', '::1'].includes(hostname) ? `http://localhost:${port}` : '';
}

/** KC-0136: the notes connector is offered unless the host already connects a vault (kira-noter from the env). */
export function medNoter(kilder: Kilde[], noter: () => Kilde = () => noterKilde()): Kilde[] {
  return kilder.some((k) => k.slags === 'noter' && k.standard === 'forbundet') ? kilder : [...kilder, noter()];
}

/** KC-0137: the user's own news sources (RSS/OPML), offered after the host's own; `dataDir` holds its ETags and parsed items. */
export function medNyhederRss(kilder: Kilde[], rss: () => Kilde = () => nyhederRss()): Kilde[] {
  return [...kilder, rss()];
}

/** KC-0235: a parent's Aula calendar through the private Ugekalender link, offered after the other sources (read-only, zone husstand). */
export function medAulaKalender(kilder: Kilde[], aula: () => Kilde = () => aulaKalender()): Kilde[] {
  return [...kilder, aula()];
}

/** KC-0137: Mail's times as before, plus Nyheder's morning rebuild where the host has no morning paper of its own to wait for (Henrik's install builds it from the 07:05 timer). */
export function standardFrontload(e: Record<string, string | undefined>): string {
  return `mail=06:50,12:00,17:00${(e['KC_DAGEN_SOURCE_GLOB'] ?? '').trim() ? '' : ';nyheder=07:08'}`;
}

/** KC-0134: any IMAP account, offered after the host's own sources (kira-mail stays the first mail source). */
export function medMailImap(kilder: Kilde[], mail: () => Kilde = () => mailImapKilde()): Kilde[] {
  return [...kilder, mail()];
}

/** KC-0135: Gmail through "Log ind med Google" (no app password), offered after the other sources; it reads with the same IMAP reader. */
export function medMailGmail(kilder: Kilde[], gmail: () => Kilde = () => mailGmail()): Kilde[] {
  return [...kilder, gmail()];
}

/**
 * KC-0127: the agent from the environment. Without KC_HERMES_API_KEY the client is still built (a fresh install,
 * KC-0156): its status says mangler-noegle, its runs fail closed, and the key is read again on every call, so the one
 * Start saves works at once. Model keys go into Hermes' env file only when KC_HERMES_ENV_FILE names it; the gateway
 * restart (KC_HERMES_GENSTART, default `hermes gateway restart`) runs only after such a write. `env` overrides where
 * the key is read from (tests).
 *
 * KC-0180: direkte keeps model keys in its own NoegleLager (env default: KC_MODEL_NOEGLE_<UDBYDER>; KC_HEMMELIGHEDER_FIL
 * (KC-0181) selects the encrypted file store, whose key Sky delivers onto a tmpfs and which refuses until then). The provider list, the fixed
 * error sentences and the live-test status come from here, so src/agent/ imports nothing of the app. `fetchImpl`
 * replaces the provider calls (tests).
 */
export function lavAgent(e: Record<string, string | undefined>, o: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {}): AgentClient {
  const valg = agentValg(e);
  if (valg === 'fake') return createFakeAgent({ answer: devAnswer, delayMs: 800 });
  const kilde = o.env ?? e;
  if (valg === 'direkte') {
    const dataDir = (e['KC_DATA_DIR'] ?? '').trim() || './data';
    const settings = createSettings(dataDir);
    const noeglefil = (e['KC_HEMMELIGHEDER_FIL'] ?? '').trim();
    const udbyderIds = UDBYDERE.map((u) => u.id);
    return createDirekte({
      udbydere: UDBYDERE,
      lager: registrerNoegleLager(noeglefil ? filNoegleLager({ udbydere: udbyderIds, dataDir, noeglefil }) : envNoegleLager({ udbydere: udbyderIds, env: kilde })),
      fejl: MODEL_FEJL,
      testet: async () => { const s = await settings.read(); return { ...(s.udbyder ? { udbyder: s.udbyder } : {}), ok: modelKlaret(modelSyn(s)) }; },
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    });
  }
  const fil = (e['KC_HERMES_ENV_FILE'] ?? '').trim();
  const [kommando, ...args] = ((e['KC_HERMES_GENSTART'] ?? '').trim() || 'hermes gateway restart').split(/\s+/);
  const genstart = (): Promise<void> => new Promise((resolve, reject) => {
    execFile(kommando!, args, { timeout: 60_000 }, (err) => (err ? reject(new Error(`Hermes kunne ikke genstartes (${kommando})`)) : resolve()));
  });
  return createHermesHttp({
    baseUrl: (e['KC_HERMES_URL'] ?? '').trim() || 'http://127.0.0.1:8642',
    apiKey: () => kilde['KC_HERMES_API_KEY'],
    noegler: { ...(fil ? { skriv: lavAgentNoegleSkriver(fil, MODEL_ENV_NOEGLER) } : {}), genstart },
  });
}

/**
 * KC-0153: the go-between's channel. KC_KANAL (hermes | fake | fra); default fake beside the fake agent (it never
 * reaches anyone), hermes beside Hermes, none for the direct agent (no gateway). hermes runs `KC_HERMES_CLI send`
 * (default `hermes`; systemd's PATH lacks ~/.local/bin, deploy/hermes/README.md) and reads replies from the gateway
 * hook's inbound log in the data dir.
 */
export function lavKanal(e: Record<string, string | undefined>, mode: AgentClient['mode']): KanalClient | undefined {
  const valgt = (e['KC_KANAL'] ?? '').trim() || (mode === 'fake' ? 'fake' : mode === 'hermes-http' ? 'hermes' : 'fra');
  if (valgt === 'fra') return undefined;
  if (valgt === 'fake') {
    if (mode !== 'fake') throw new Error('KC_KANAL=fake kræver KC_AGENT=fake (den falske kanal findes kun i udvikling)');
    return lavFakeKanal();
  }
  if (valgt !== 'hermes') throw new Error('KC_KANAL skal være hermes, fake eller fra');
  const dir = path.join((e['KC_DATA_DIR'] ?? '').trim() || './data', 'beskeder');
  return lavHermesKanal({ cli: (e['KC_HERMES_CLI'] ?? '').trim() || 'hermes', laesLog: () => laesBeskedLog(dir) });
}

export async function main(): Promise<void> {
  redigerKonsol(); // KC-0125: nothing printed holds a secret value
  const mode = agentValg(process.env);
  // KC-0179: KC_IDENTITET=konto (Clawco Sky) — a missing or invalid key refuses to start, naming the key.
  const konto = kontoFraMiljoe(process.env);
  // KC-0160: KC_LAPTOP=ja — one owner, loopback only; a LAN address or konto mode refuses to start, naming the key.
  const laptop = laptopFraMiljoe(process.env);
  const hermes = lavAgent(process.env);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.relative(process.cwd(), path.join(here, '..', 'public')) || 'public';
  const kalenderScript = kalenderScriptFra(process.env, mode, path.join(here, '..'), { kiraToken: existsSync(KIRA_TOKEN_SCRIPT) });
  const port = Number(env('KC_PORT', '8750'));
  const hostname = env('KC_HOST', '127.0.0.1');
  const adresse = egenAdresse(process.env, hostname, port);
  const hjaelp = hjaelpFraMiljoe(process.env);
  const beta = betaFraMiljoe(process.env);
  const stemmeMode = env('KC_STEMME_MODE', mode === 'fake' ? 'fake' : 'elevenlabs');
  const stemme = stemmeMode === 'fake' ? createFakeStemme() : env('KC_ELEVENLABS_API_KEY') ? createElevenLabs({ apiKey: env('KC_ELEVENLABS_API_KEY') }) : undefined;
  const kanal = lavKanal(process.env, mode);
  const { app, frontload, kurator, konflikt, soendag, moedeTik, rumTik, helbredTik } = createApp({
    store: createFileStore(env('KC_DATA_DIR', './data')),
    hermes,
    ...(stemme ? { stemme } : {}),
    sourceGlob: env('KC_DAGEN_SOURCE_GLOB', '/tmp/avis_data_{date}.json'),
    mailStateDir: mode === 'fake' ? await devMailStateDir(env('KC_DATA_DIR', './data'), new Date()) : env('KC_MAIL_STATE_DIR', path.join(process.env['HOME'] ?? '', '.hermes', 'state')),
    mailRunner: mode === 'fake' ? devMailRunner() : defaultRunner(),
    himalaya: env('KC_HIMALAYA', 'himalaya'),
    kalenderScript,
    dataDir: env('KC_DATA_DIR', './data'),
    vaultInbox: env('KC_VAULT_INBOX'),
    // KC-0136: in dev the old scratch inbox until a vault is chosen on the notes card.
    ...(mode === 'fake' ? { vaultInboxStandard: path.join(env('KC_DATA_DIR', './data'), 'dev-vault-indbakke') } : {}),
    ...(env('KC_VAULT_DIR') ? { vaultDir: env('KC_VAULT_DIR') } : {}),
    sha: gitSha(path.join(here, '..')),
    publicDir,
    ...(adresse ? { adresse } : {}),
    ...(env('KC_PEOPLE_DIR') ? { personer: env('KC_PEOPLE_DIR') } : {}),
    // KC-0132: the fakes (fed from the test world's story) under KC_KILDER_MODE=fake, else the host's own sources.
    // KC-0133: plus "Log ind med Google" for the calendar, unless the host connects its own.
    // KC-0135: plus Gmail through the same Google app, after the calendar.
    // KC-0235: plus Aula's calendar link, last.
    kilder: medAulaKalender(medMailGmail(medGoogleKalender(medNyhederRss(medMailImap(medNoter(kilderFraMiljoe(process.env, {
      falsk: () => { const t = parseFalskTilstand(env('KC_KILDER_FALSK')); return falskeKilder({ data: falskKildeData(), tilstand: (s) => t[s] ?? 'ok' }); },
      legacy: () => legacyKilder(process.env, { run: defaultRunner(), laesNyheder: readNyhederSource, parseMail: parseAll, kalenderScript }),
      agent: mode,
    }))), () => nyhederRss({ dataDir: env('KC_DATA_DIR', './data') })), () => googleKalender(adresse ? { adresse } : {})), () => mailGmail(adresse ? { adresse } : {}))),
    // KC-0138: messages that reach Hermes, through its gateway hook's log in the data dir; KC_BESKEDER_DAGE = how long read messages are kept.
    beskeder: (o) => beskederKilde({ dataDir: env('KC_DATA_DIR', './data'), dage: Number(env('KC_BESKEDER_DAGE', '14')) || 14, ...o }),
    // KC-0212: the operator's ledger (absent in a tenant image: no card). No paid customers are read yet, so MRR is 0.
    omkostninger: { laes: () => laesOmkostningsfil(env('KC_OMKOSTNINGER', OMKOSTNINGSFIL)), mrr: () => 0 },
    ...(konto ? { identitet: { konto } } : {}),
    // KC-0161: Start's Tailscale card reads the local CLI (argv, never a shell; 4 s timeout). A Sky tenant has none and no card.
    ...(laptop ? { laptop: true } : {}),
    ...(konto ? {} : { tailscale: { koerer: lavTsKoerer({ timeoutMs: 4000 }), port, cacheMs: 5000 } }),
    ...(kanal ? { kanal } : {}),
    // KC-0201: "Få hjælp" in the settings, only under Clawco Sky (KC_SKY=ja plus KC_SKY_URL).
    ...(hjaelp ? { hjaelp } : {}),
    // KC-0203: the closed beta (KC_BETA=ja, set by Clawco Sky for a beta household); a self-installed Clawco has none.
    ...(beta ? { beta } : {}),
    // KC-0188: "Lad support se med" exists only under the Sky gateway (konto identity): the gateway answers the switch.
    ...(konto ? { stoette: { slaaTil: '/_sky/stoette', slaaFra: '/_sky/stoette/slaa-fra' } } : {}),
    // KC-0187: scrubbed error reports only when KC_FEJLRAPPORT_DSN is set (the owner's switch under Sky; default off).
    fejlrapport: tenantFejlrapport(process.env, { release: gitSha(path.join(here, '..')) }),
  });
  frontload(env('KC_FRONTLOAD', standardFrontload(process.env)));
  kurator(env('KC_KURATOR', '07-22/60'));
  konflikt(env('KC_LORDAGSKONFLIKT', '07:30')); // KC-0152: Tuesdays; "fra" turns it off
  soendag(); // KC-0145: Sundays from 18:00; the setting soendagstjek turns it off
  moedeTik();
  rumTik();
  helbredTik();
  // KC-0068: a device with the kc_test cookie gets the fictional test world (created on first use); timers above stay on the real app.
  const lav = () => lavTestverden({ dataDir: testDataDir({ KC_TEST_DATA_DIR: env('KC_TEST_DATA_DIR', ''), KC_DATA_DIR: env('KC_DATA_DIR', './data') }), publicDir, rigtigDataDir: env('KC_DATA_DIR', './data'), ...(stemme ? { stemme } : {}) });
  // KC-0179: in konto mode only a signed request reaches the dispatcher (its test world answers by cookie alone).
  const dispatcher = medTesttilstand(app, lav);
  const fetch = konto ? kunSigneret(konto, () => new Date(), dispatcher, app) : dispatcher.fetch;
  serve({ fetch, port, hostname }, (info) => {
    console.log(`${PRODUKT} lytter på http://${info.address}:${info.port} (agent: ${mode}, stemme: ${stemme ? stemme.mode : 'fra'}, identitet: ${konto ? 'konto' : laptop ? 'laptop' : 'tailnet'})`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
