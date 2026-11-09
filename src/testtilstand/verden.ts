// The test world (KC-0068): a second createApp on fictional deps — its own
// data dir, a scripted Hermes, a fictional mail runner, a movable clock — plus
// moment jumps, a scripted Claude Code that moves "Send til Claude Code"
// opgaver along, and a voice that listens and speaks for real but never runs
// an ElevenLabs agent. No background jobs. Composition modelled on the demo's
// lavDemoApp (KC-0058). Spec: docs/superpowers/specs/2026-10-30-testtilstand-design.md

import { Hono } from 'hono';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../server.ts';
import { createFileStore } from '../store/fileStore.ts';
import { createFakeAgent } from '../agent/fake.ts';
import { AgentError, type AgentClient, type AgentRunRequest } from '../agent/types.ts';
import type { LiveBus } from '../live.ts';
import { createFakeStemme } from '../stemme/fake.ts';
import { DEFAULT_VOICE_ID } from '../stemme/agent.ts';
import { StemmeError, type StemmeClient } from '../stemme/types.ts';
import { createSettings } from '../settings.ts';
import { ROOMS } from '../rooms/registry.ts';
import { regnskabsfil, skrivRegnskab } from '../kurator/regnskab.ts';
import type { KuratorState, Regnskabslinje } from '../rooms/hjem/kort.ts';
import { dokumentTilMarkdown, type SkriveState } from '../rooms/skrive/schema.ts';
import type { Opgave } from '../udvikling/opgaver.ts';
import type { Froe, Moment } from './typer.ts';
import { idagKbh, lavUr, type Ur } from './ur.ts';
import { skrivFroe, testMailRunner } from './skriv.ts';
import { ALLE_MOMENTER, froe as lavFroe, MOMENTER, svar } from './indhold.ts';
import { erGithubMoment, erInkluderetMoment, erKold, KOLD_GOOGLE, KOLD_GOOGLE_AFVIST, modelTestUdfald, testGithub, testInkluderet } from './indhold/start.ts';
import { falskTailscale, tailscaleLaptop } from './indhold/tailscale.ts'; // KC-0161
import { fakta, KOE, momentNr, momentPlus, plusDag } from './indhold/fakta.ts';
import { familiekalender, TEST_EJER, testKanal } from './indhold/husstand.ts';
import { lavReglerLager } from '../tillid/lager.ts';
import { falskeKilder } from '../kilder/falsk/falsk.ts';
import type { Slags } from '../kilder/types.ts';
import { falskKildeData, GMAIL_AFVIST, GOOGLE_AFVIST, googleKalendere, googleMailRefresh, googleRefresh, KILDE_TILSTAND, kildeData, RSS_DOV, RSS_FEJL, rssXml, TEST_GMAIL, TEST_GOOGLE_KLIENT, TEST_KANALER, TEST_PERSONER } from './indhold/kilder.ts';
import { googleKalender, GOOGLE_KALENDER_ID } from '../kilder/google-kalender/kilde.ts';
import { nyhederRss } from '../kilder/nyheder-rss/kilde.ts';
import { aulaKalender, AULA_KALENDER_ID } from '../kilder/aula-kalender/kilde.ts';
import { POST_DOMAENE } from './indhold/digitalpost.ts';
import { AULA_FORBUNDET, AULA_LINK, AULA_TILBAGEKALDT, aulaIcs, aulaLink } from './indhold/aula.ts';
import { beskederKilde } from '../kilder/beskeder/kilde.ts';
import { HentFejl, lavHenter, type Henter } from '../kilder/nyheder-rss/hent.ts';
import { falskGoogle } from '../kilder/google/falsk-google.ts';
import { ENDPOINTS, SCOPE_KALENDER, SCOPE_MAIL } from '../kilder/google/oauth.ts';
import { mailGmail, MAIL_GMAIL_ID } from '../kilder/mail-gmail/kilde.ts';
import { gemKildeHemmelighed } from '../kilder/hemmeligheder.ts';
import { noterKilde } from '../kilder/noter/noter.ts';
import { NOTER_ID } from '../kilder/noter/stier.ts';
import { adopterVault, STRUKTUR } from '../kilder/noter/vault.ts';
import { skrivPerson, somKanalLinje } from '../kilder/noter/personer.ts';
import { testOmkostninger } from './indhold/omkostninger.ts';

export type Testverden = {
  /** The test app: the inner createApp app behind the scripted pipeline. */
  app: Hono;
  live: LiveBus;
  ur: Ur;
  moment(): Moment;
  /** Jumps to a moment (wipe + reseed); null for an unknown id. */
  hop(id: string): Promise<{ url: string } | null>;
  /** A clean world at the first moment. */
  taend(): Promise<{ url: string }>;
  /** KC-0123: every run the scripted Hermes received, oldest first (what the app actually sent). */
  agentKald(): readonly AgentRunRequest[];
};

export type TestverdenOpts = {
  /** The test world's own data dir; its name must have "test" as a token (skrivFroe refuses anything else). */
  dataDir: string;
  publicDir?: string;
  /** The real voice client: lyt and sig are delegated to it, nothing else. */
  stemme?: StemmeClient;
  /** The scripted Hermes' delay per run, ms. */
  delayMs?: number;
  /** The scripted pipeline's delay per step, ms. */
  trinMs?: number;
  /** KC-0069: how long each of the two runs of the moment "Kørsler i kø" stays with Hermes before it ends by itself, ms (default 8 s: long enough to look at, short enough that nothing stays stuck behind them). */
  holdMs?: number;
  /**
   * KC-0069: the real installation's data dir. Only its settings file is read, and only for the voice Henrik chose
   * (oplæsning then speaks with it); nothing is ever written there. Absent or unreadable = the premade default voice.
   */
  rigtigDataDir?: string;
};

/** The question the scripted Claude Code parks every opgave on. */
const SPOERGSMAAL = { tekst: 'Skal ændringen gælde på telefonen med det samme, eller først når du har set den på computeren?', valg: ['Ja', 'Nej'] };
const BEVIS = 'Typecheck og alle tests grønne. (Testverdenen: intet er ændret i et rigtigt projekt.)';

/** KC-0069: the input of the two held runs of the moment "Kørsler i kø" (the scripted Hermes keeps those with it until their time is up or a jump aborts them). */
const HOLD_INPUT = 'Testverdenen: en kørsel, der holdes i gang, så Kø-panelet kan vise "I kø".';
const SPRUNGET = 'Testverdenen er sprunget til et andet tidspunkt';

/**
 * The voice in the test world: `mode: 'fake'` so the page runs Samtale on the Hermes loop (never an ElevenLabs
 * agent); lyt and sig go to the real client — they only listen and speak. Never creates or changes anything on the
 * ElevenLabs account: no agent, no token, no library voice. The voice is the world's own choice, else (KC-0069) the one
 * `valgt` reads from the real settings, else the premade default.
 */
export function testStemme(real?: StemmeClient, valgt?: () => Promise<string | undefined>): StemmeClient {
  if (!real) return createFakeStemme();
  return {
    mode: 'fake',
    lyt: (audio, mime, keyterms) => real.lyt(audio, mime, keyterms),
    sig: (tekst, voiceId) => real.sig(tekst, voiceId),
    async samtaleToken() { throw new StemmeError('Samtale kører gennem Hermes i testtilstand', 503); },
    async ensureAgent(config) { return { agentId: 'test-agent', toolIds: Object.fromEntries(config.tools.map((t) => [t.name, `test-${t.name}`])) }; },
    async ensureVoice(voiceId) { return voiceId || (await valgt?.().catch(() => undefined)) || DEFAULT_VOICE_ID; },
  };
}

/**
 * Makes the seed point at this test dir before it is written: ledger paths and the Skrive note saved to Obsidian
 * become absolute paths in `<dir>/vault`, and the note's log line gets the same undo the real save writes. Returns
 * the files that must exist in the vault for those to work (written after skrivFroe, which wipes the vault).
 */
function forankr(f: Froe, vaultInbox: string): { regnskab: { fil: string; id: string; linje: Regnskabslinje }[]; noter: { fil: string; md: string }[] } {
  const vaultRod = path.dirname(vaultInbox);
  // KC-0136: the notes connector's folder is relative to the world's data dir in the seed.
  for (const p of f.kilder?.kilder ?? []) {
    const mappe = p.valg['mappe'];
    if (p.id === NOTER_ID && mappe && !path.isAbsolute(mappe)) p.valg = { ...p.valg, mappe: path.resolve(path.dirname(vaultRod), mappe) };
  }
  const regnskab: { fil: string; id: string; linje: Regnskabslinje }[] = [];
  const hjem = f.rum['hjem']?.state as KuratorState | undefined;
  if (hjem) {
    hjem.kort = hjem.kort.map((k) => (k.skrevet ? { ...k, skrevet: { ...k.skrevet, fil: regnskabsfil(vaultRod, k.skrevet.hvor) } } : k));
    for (const [id, r] of Object.entries(hjem.regnskab ?? {})) {
      if (r.status !== 'skrevet') continue;
      const k = hjem.kort.find((x) => x.id === id);
      const fra = k?.regnskab ?? (k?.regnskabForslag ? { ...k.regnskabForslag, hvor: r.hvor } : undefined);
      const linje: Regnskabslinje = fra ? { ...fra, hvor: r.hvor }
        : { hvor: r.hvor, dato: '', leverandoer: r.leverandoer ?? id, beloeb: r.beloeb ?? '', valuta: r.valuta ?? '', art: 'abonnement', emne: r.leverandoer ?? id };
      regnskab.push({ fil: regnskabsfil(vaultRod, r.hvor), id, linje });
    }
  }
  const noter: { fil: string; md: string }[] = [];
  const skrive = f.rum['skrive'];
  const s = skrive?.state as SkriveState | undefined;
  for (const dok of s?.dokumenter ?? []) {
    if (!dok.gemtSom) continue;
    const navn = path.basename(dok.gemtSom);
    const fil = path.join(vaultInbox, navn);
    const md = dokumentTilMarkdown(dok);
    dok.gemtSom = fil;
    noter.push({ fil, md });
    for (const e of skrive?.log ?? []) {
      if (e.kilde === 'system' && !e.fortryd && e.tekst.startsWith('Gemte "') && e.tekst.includes(`(${navn})`)) e.fortryd = `lokal:${JSON.stringify({ slet: fil, hvis: md.length })}`;
    }
  }
  // KC-0069: Nyheder's seeded "Gem til senere" is a line in the vault's Læs senere.md, as the room's own save writes it
  // (its Fortryd removes that line again); the log line gets the absolute path the real save records.
  const laesSenere = path.join(vaultInbox, 'Læs senere.md');
  for (const e of f.rum['nyheder']?.log ?? []) {
    if (!e.fortryd?.startsWith('lokal:')) continue;
    const spec = JSON.parse(e.fortryd.slice(6)) as { nyhedId: string; linje: string; fil?: string };
    if (typeof spec.linje !== 'string' || !spec.linje) continue;
    e.fortryd = `lokal:${JSON.stringify({ ...spec, fil: laesSenere })}`;
    noter.push({ fil: laesSenere, md: `# Læs senere\n\n${spec.linje}\n` });
  }
  return { regnskab, noter };
}

export async function lavTestverden(o: TestverdenOpts): Promise<Testverden> {
  const dir = path.resolve(o.dataDir);
  const vaultInbox = path.join(dir, 'vault', '00-Indbakke');
  const trinMs = o.trinMs ?? 4000;
  const ur = lavUr();
  const forste = MOMENTER[0];
  if (!forste) throw new Error('testverdenen har ingen momenter');
  let nu: Moment = forste;
  let dag = idagKbh(new Date());
  let froe: Froe | undefined;
  /** Bumped by every jump: runs and pipeline steps from an older generation write nothing. */
  let gen = 0;

  // The scripted Hermes. The generation is captured when a run starts and checked when its answer is ready.
  const startGen = new WeakMap<AgentRunRequest, number>();
  /** KC-0069: the held runs of "Kørsler i kø" wait with this one; an abort (a jump) ends them at once. */
  const holdFake = createFakeAgent({ delayMs: o.holdMs ?? 8000, answer: () => 'Opdateret.' });
  const fake = createFakeAgent({
    delayMs: o.delayMs ?? 1400,
    answer: (req) => {
      if (startGen.get(req) !== gen) throw new Error(SPRUNGET);
      return svar(req, { moment: nu, dag });
    },
    // KC-0127: Start's live test passes, except in the moment where the key is rejected.
    modelTest: () => modelTestUdfald(nu.id),
  });
  const hermes: AgentClient = {
    // KC-0263: the GitHub moments run as the built-in agent, so Start offers Copilot with its sign-in; KC-0265: so do the Sky-plan moments, with Clawco's AI included.
    get mode() { return erGithubMoment(nu.id) || erInkluderetMoment(nu.id) ? 'direkte' as const : 'fake' as const; },
    async run(req) {
      if (req.input === HOLD_INPUT) return holdFake.run(req);
      const g = gen;
      startGen.set(req, g);
      const r = await fake.run(req);
      // A jump during the answer's last step: still nothing written.
      if (g !== gen) throw new AgentError(SPRUNGET, r.runId);
      return r;
    },
    health: () => fake.health(),
    status: () => fake.status(),
    // KC-0127: name and length only; no real agent env file is ever written from the test world.
    saetModelNoegle: (u, v) => fake.saetModelNoegle(u, v),
  };

  const store = createFileStore(dir, { now: ur.now });
  /** KC-0139: the sources the person connected again at this moment: they read ok from then on (emptied by every jump). */
  const repareret = new Set<Slags>();
  /** KC-0161: the moments where the user tapped "Del Clawco på dit tailnet" (the stand-in CLI then reports it shared; emptied by every jump). */
  const tailscaleDelt = new Set<string>();
  // KC-0133: the world's fake Google — the story's calendar; it knows every moment's seeded refresh token and refuses them in GOOGLE_AFVIST.
  // KC-0135: the cold moment with the calendar connected has the Google app set up (it could not be connected otherwise).
  const harGoogleApp = (): boolean => !erKold(nu.id) || nu.id === KOLD_GOOGLE || nu.id === KOLD_GOOGLE_AFVIST;
  const googleMiljoe = {
    get KC_GOOGLE_CLIENT_ID(): string { return harGoogleApp() ? TEST_GOOGLE_KLIENT.id : ''; },
    get KC_GOOGLE_CLIENT_SECRET(): string { return harGoogleApp() ? TEST_GOOGLE_KLIENT.hemmelighed : ''; },
  };
  const google = falskGoogle({
    klient: TEST_GOOGLE_KLIENT, nu: ur.now, konto: TEST_GMAIL,
    // Each grant is refused in its own moment: the calendar's the next morning, Gmail's at "Gmail er logget ud".
    afvis: (scopes) => ((nu.id === GOOGLE_AFVIST || nu.id === KOLD_GOOGLE_AFVIST) && scopes.includes(SCOPE_KALENDER)) || (nu.id === GMAIL_AFVIST && scopes.includes(SCOPE_MAIL)),
    kendteRefresh: ALLE_MOMENTER.map((m) => googleRefresh(m.id)), kendteMailRefresh: ALLE_MOMENTER.map((m) => googleMailRefresh(m.id)),
    kalendere: () => googleKalendere(erKold(nu.id) ? 0 : momentNr(nu.id), fakta(dag)),
  });
  // KC-0137: the world's feeds. Every address on the world's own domain answers from the story; a stub on loopback (for trying
  // a pasted address by hand) is fetched for real by the real fetcher; nothing else is reached — the test world never calls the internet.
  const ekte = lavHenter();
  const rssHenter: Henter = async (adresse, o) => {
    const u = new URL(adresse);
    if (u.hostname.endsWith('.testverden.example')) {
      if (adresse === RSS_DOV && nu.id === RSS_FEJL) throw new HentFejl('status', 'Kilden svarede 503.');
      return { status: 'ny', tekst: rssXml(adresse, fakta(dag)), endeligAdresse: adresse };
    }
    if (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return ekte(adresse, o);
    throw new HentFejl('afvist', 'Testverdenen kalder ikke det rigtige internet.');
  };
  // KC-0235: the world's Aula. The real reader over a fetcher that knows one invented link: it answers the family's file, or 410 Gone
  // in the moment the link is revoked. Any other address is refused: the test world never calls the internet.
  const aulaHenter: Henter = async (adresse) => {
    if (!adresse.startsWith(`${AULA_LINK}/`)) throw new HentFejl('afvist', 'Testverdenen kalder ikke det rigtige internet.');
    if (nu.id === AULA_TILBAGEKALDT) throw new HentFejl('status', 'Kilden svarede 410.', 410);
    return { status: 'ny', tekst: aulaIcs(fakta(dag)), endeligAdresse: adresse };
  };
  const inner = createApp({
    store, hermes, now: ur.now, sha: 'test', dataDir: dir,
    // KC-0135: the world's own address, which its fake Google sends the browser back to (the stand-in page turns it into a path).
    adresse: 'https://testverden.example',
    // KC-0116: the test world always runs as its one fictional owner; no cookie or header can pick another person.
    identitet: { fast: TEST_EJER },
    // KC-0161: the Tailscale card reads a scripted CLI per moment; the real one is never run from the test world.
    tailscale: { koerer: falskTailscale(() => ({ id: nu.id, kold: erKold(nu.id) }), tailscaleDelt), port: 8750, laptop: () => tailscaleLaptop(nu.id) },
    // KC-0188: the support switch (not under Sky: on is refused by the app; the band's Slå fra is the app's own route).
    stoette: { slaaTil: '/api/stoette/start', slaaFra: '/api/stoette/slaa-fra' },
    // KC-0203: the closed beta is on in the moments whose folder carries beta.json (kunMedFil), nowhere else.
    beta: { samtykkeStart: false, kunMedFil: true },
    // KC-0233: the Digital Post rule over the world's mail; its invented sender's domain is added to the hint domains, and the mail is read afresh at every moment.
    danmark: { domaener: [POST_DOMAENE], cacheMs: 0 },
    // KC-0069: a real queue, one run with Hermes at a time, so Nu and the Kø panel can show "I kø". A jump settles
    // everything queued or running at once (runs.annuller) and waits for writes in flight (runs.tomgang) before it wipes.
    maxParallel: 1,
    sourceGlob: path.join(dir, 'avis_{date}.json'),
    mailStateDir: path.join(dir, 'hermes-state'),
    mailRunner: testMailRunner(() => froe),
    kalenderScript: '',
    vaultInbox,
    importTmp: path.join(dir, 'upload-tmp'), // KC-0129: raw uploads of Start's import live in the world's own dir
    stemme: testStemme(o.stemme, o.rigtigDataDir ? async () => (await createSettings(o.rigtigDataDir!).read()).stemme.voiceId : undefined),
    // KC-0132: the fake connectors read the moment's story and are in the moment's state (KILDE_TILSTAND).
    // KC-0136: notes are the real connector over the world's own vault (home = the world's dir, so detection
    // finds that vault and nothing of the machine's).
    kilder: [
      ...falskeKilder({ data: falskKildeData(() => (erKold(nu.id) ? { n: 0, dag, kold: true } : { n: momentNr(nu.id), dag, moment: nu.id })), tilstand: (s) => KILDE_TILSTAND[nu.id]?.[s] ?? 'ok', reparation: repareret })
        .map((k) => (k.slags === 'noter' ? noterKilde({ hjem: dir, platform: 'linux' }) : k))
        // KC-0138: messages are the real connector over the world's inbound log (beskeder() below), not a fake.
        .filter((k) => k.slags !== 'beskeder'),
      // KC-0148: the household's family calendar, in the husstand zone (after the fakes, so Start still offers falsk-kalender).
      familiekalender(() => dag),
      // KC-0133: the real Google connector over an in-process fake Google (the world's own app, the story's calendar).
      // In the cold start the fresh install has no Google app yet, so its card walks through making one.
      googleKalender({ env: googleMiljoe, adresse: 'https://testverden.example', hent: google.hent, nu: ur.now }),
      // KC-0137: the user's own feeds over the world's fake feeds; the real connector, so a pasted address and an OPML file work too.
      nyhederRss({ dataDir: dir, hent: rssHenter }),
      // KC-0235: a parent's Aula calendar over the world's fetcher (the real reader, the invented family's file).
      aulaKalender({ hent: aulaHenter }),
      // KC-0135: Gmail on the same fake Google; the mail reader is a stand-in that accepts only an access token the fake Google
      // issued for the mail scope (so a logged-out or expired token fails exactly as Gmail's server would) and reads the story's mail.
      mailGmail({
        env: googleMiljoe, adresse: 'https://testverden.example', hent: google.hent, nu: ur.now,
        laes: async (f, adgang) => {
          const token = typeof adgang === 'string' ? '' : adgang.accessToken;
          if (!google.erAdgang(token, SCOPE_MAIL) || f.bruger !== TEST_GMAIL) throw Object.assign(new Error('AUTHENTICATIONFAILED'), { authenticationFailed: true });
          const mail = kildeData(erKold(nu.id) ? 0 : momentNr(nu.id), fakta(dag)).mail;
          return { kuverter: mail, tal: { indbakke: mail.length, ulaeste: mail.filter((k) => !k.laest).length, mapper: {} } };
        },
      }),
    ],
    // KC-0138: the real Beskeder connector over the hook files each moment seeds; senders from the world's people register.
    beskeder: (b) => beskederKilde({ dataDir: dir, ...b }),
    // KC-0153: the go-between's channel is the fake (Send records, never reaches anyone); a stranger's number waits in it.
    kanal: testKanal(),
    // KC-0212: the owner's cost card reads the moment's invented ledger and MRR (green, amber in the evening, red late).
    omkostninger: { laes: async () => testOmkostninger(nu.id).regnskab, mrr: () => testOmkostninger(nu.id).mrr },
    ...(o.publicDir ? { publicDir: o.publicDir } : {}),
    // KC-0127: model discovery never leaves the test world (no list), and Clawco's own key goes to a file in its data dir.
    model: { fetchImpl: (async () => new Response('{}', { status: 404 })) as typeof fetch, miljoe: { fil: path.join(dir, 'clawco.env'), env: {} }, github: testGithub(() => nu.id), inkluderet: testInkluderet(() => nu.id) },
  });

  // The scripted Claude Code: each step after trinMs, only within the generation that scheduled it.
  const timere = new Set<ReturnType<typeof setTimeout>>();
  let ticketNr = 0;
  function senere(fn: (g: number) => Promise<void>): void {
    const g = gen;
    const t = setTimeout(() => {
      timere.delete(t);
      if (g === gen) void fn(g).catch((err: unknown) => console.error('testverden: pipeline-trinnet fejlede:', err));
    }, trinMs);
    t.unref?.();
    timere.add(t);
  }
  const skift = async (id: string, b: Record<string, unknown>): Promise<boolean> =>
    (await inner.app.request(`/api/udvikling/opgaver/${encodeURIComponent(id)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).status === 200;
  /** Runs the steps in order, one per trinMs; stops at the first refused one, and at a jump made while a step ran. */
  function trin(id: string, steps: Record<string, unknown>[]): void {
    const [forst, ...rest] = steps;
    if (!forst) return;
    senere(async (g) => { if ((await skift(id, forst)) && g === gen) trin(id, rest); });
  }

  // One jump at a time: seeding wipes and rewrites the data dir.
  let laas: Promise<unknown> = Promise.resolve();
  function saetMoment(m: Moment): Promise<{ url: string }> {
    const g = ++gen;
    inner.runs.annuller(SPRUNGET); // at once: nothing queued or running outlives the moment it was started in
    repareret.clear();
    tailscaleDelt.clear();
    for (const t of timere) clearTimeout(t);
    timere.clear();
    const arbejde = laas.then(async () => {
      // Again inside the lock (a jump made while an earlier one was seeding), then wait for an answer or a local save
      // that is mid-write: the wipe must not run under it, and nothing of it may land in the new moment.
      inner.runs.annuller(SPRUNGET);
      await inner.runs.tomgang();
      dag = idagKbh(new Date());
      const f = lavFroe(m.id, dag);
      const { regnskab, noter } = forankr(f, vaultInbox);
      ur.saetTil(plusDag(dag, momentPlus(m, dag)), m.tid);
      await skrivFroe(dir, f, store, dag);
      // KC-0133: a connected Google calendar has its refresh token in the secret store (wiped by skrivFroe).
      if (f.kilder?.kilder.some((k) => k.id === GOOGLE_KALENDER_ID)) await gemKildeHemmelighed(dir, GOOGLE_KALENDER_ID, { refresh_token: googleRefresh(m.id) });
      if (f.kilder?.kilder.some((k) => k.id === AULA_KALENDER_ID) && AULA_FORBUNDET.includes(m.id)) await gemKildeHemmelighed(dir, AULA_KALENDER_ID, { link: aulaLink(m.id) });
      if (f.kilder?.kilder.some((k) => k.id === MAIL_GMAIL_ID)) await gemKildeHemmelighed(dir, MAIL_GMAIL_ID, { refresh_token: googleMailRefresh(m.id), adresse: TEST_GMAIL });
      await inner.runs.genlaesPause(); // KC-0124: the moment's pause.json (or none) is what the app now holds
      // KC-0136: the world's vault is an Obsidian vault with the structure and four invented people, written by the app's own writer.
      const vaultRod = path.dirname(vaultInbox);
      await mkdir(path.join(vaultRod, '.obsidian'), { recursive: true });
      await adopterVault(vaultRod);
      for (const { mappe, ...p } of TEST_PERSONER) {
        const rod = path.join(vaultRod, ...STRUKTUR.personer.split('/'));
        const skrevet = await skrivPerson(rod, p, { mappe, zone: 'privat' });
        // KC-0225: `kanaler:` is written by hand in a real vault, so the world adds the line to the file the writer made.
        const kanaler = TEST_KANALER[p.navn];
        if (kanaler && skrevet.udfald === 'oprettet') {
          const fil = path.join(rod, skrevet.sti);
          await writeFile(fil, (await readFile(fil, 'utf8')).replace(/^---\n/, `---\n${somKanalLinje(kanaler)}\n`), 'utf8');
        }
      }
      for (const r of regnskab) await skrivRegnskab(r.fil, r.id, r.linje);
      if (noter.length) await mkdir(vaultInbox, { recursive: true });
      for (const n of noter) await writeFile(n.fil, n.md, 'utf8');
      // KC-0142: the moment's rules file in the world's vault (written as the app writes it, so its sha is logged).
      if (f.regler !== undefined) await lavReglerLager({ vaultDir: path.dirname(vaultInbox), dataDir: dir }).skrivTekst(f.regler);
      froe = f;
      nu = m;
      if (m.id === KOE && g === gen) startHoldte();
      for (const rum of new Set([...ROOMS.map((r) => r.id), ...Object.keys(f.rum)])) inner.live.notify(rum);
      return { url: m.url };
    });
    laas = arbejde.catch(() => undefined);
    return arbejde;
  }

  /** KC-0069: two room refreshes as the morning build starts them — the first is with Hermes, the second waits in the queue. Their answers change nothing. */
  function startHoldte(): void {
    for (const [room, label] of [['mail', 'Opdaterer Mail'], ['nyheder', 'Opdaterer Nyheder']] as const) {
      inner.runs.start({ kind: 'opdater', room, label, spec: { input: HOLD_INPUT, instructions: 'Testverdenen: ingen opgave, intet ændres.' }, onDone: async () => ({ text: 'Opdateret.' }) });
    }
  }

  const app = new Hono();
  app.post('/api/udvikling/opgaver', async (c) => {
    const res = await inner.app.fetch(c.req.raw, c.env);
    if (res.status === 201) {
      const { opgave } = (await res.clone().json()) as { opgave: Opgave };
      ticketNr += 1;
      trin(opgave.id, [
        { status: 'modtaget', ticket: `KC-${String(950 + ticketNr).padStart(4, '0')}` },
        { status: 'i-gang' },
        { status: 'parkeret', grund: 'Venter på dit valg.', spoergsmaal: SPOERGSMAAL },
      ]);
    }
    return res;
  });
  app.post('/api/udvikling/opgaver/:id/svar', async (c) => {
    const res = await inner.app.fetch(c.req.raw, c.env);
    if (res.status === 200) trin(c.req.param('id'), [{ status: 'i-gang' }, { status: 'faerdig', bevis: BEVIS }]);
    return res;
  });
  // KC-0135: the world's stand-in for Google's consent page, so "Log ind med Google" can be clicked through in a browser without ever
  // leaving for the real Google: the connect answer points here, and this page is the person pressing "Allow" on the fake Google.
  app.post('/api/kilder/:id/forbind', async (c) => {
    const res = await inner.app.fetch(c.req.raw, c.env);
    if (res.status !== 200) return res;
    const j = (await res.clone().json().catch(() => null)) as { omdiriger?: unknown } | null;
    if (typeof j?.omdiriger !== 'string' || !j.omdiriger.startsWith(`${ENDPOINTS.samtykke}?`)) return res;
    return c.json({ omdiriger: `/test-google/samtykke?url=${encodeURIComponent(j.omdiriger)}` });
  });
  app.get('/test-google/samtykke', (c) => {
    const url = c.req.query('url') ?? '';
    if (!url.startsWith(`${ENDPOINTS.samtykke}?`)) return c.text('Ikke en samtykke-adresse til testverdenens Google.', 400);
    let tilbage: URL;
    try { tilbage = new URL(google.samtykke(url)); } catch { return c.text('Testverdenens Google afviste forespørgslen.', 400); }
    return c.redirect(`${tilbage.pathname}${tilbage.search}`, 302);
  });
  app.all('*', (c) => inner.app.fetch(c.req.raw, c.env));

  const verden: Testverden = {
    app,
    live: inner.live,
    ur,
    moment: () => nu,
    async hop(id) {
      const m = ALLE_MOMENTER.find((x) => x.id === id);
      return m ? saetMoment(m) : null;
    },
    taend() {
      ticketNr = 0;
      return saetMoment(forste);
    },
    agentKald: () => fake.calls,
  };
  await verden.taend();
  return verden;
}
