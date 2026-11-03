// The test world's cold start (KC-0126): the world variant `kold` beside the
// day. "Kold start" is a fresh install — an empty data dir, nothing connected,
// Start in the nav with step 1 open. "Velkommen klaret" is a few minutes on:
// the profile is saved, the fake mail is connected and holds three calendar
// invites, so Start suggests the calendar. The day's own moments are an
// install past onboarding (startFaerdig). The full cold-start run is KC-0131.
// All names are invented.

import type { Froe, Moment } from '../typer.ts';
import type { Fakta } from './fakta.ts';
import type { KilderKonfig } from '../../kilder/register.ts';
import type { Kuvert as KildeKuvert } from '../../kilder/types.ts';
import type { StartState } from '../../rooms/start/schema.ts';
import { TEST_EJER, TEST_HUSSTAND } from './husstand.ts';
import { modelRevision, type Settings } from '../../settings.ts';
import { udbyderAf } from '../../rooms/start/udbydere.ts';
import { byggForhaandsvisning } from '../../rooms/start/forhaandsvisning.ts';
import { kildeData } from './kilder.ts';
import { dagenState } from './dagen.ts';
import { parseMailState, type MailState } from '../../rooms/mail/schema.ts';
import { NOTER_ID } from '../../kilder/noter/stier.ts';
import { NYHEDER_RSS_ID } from '../../kilder/nyheder-rss/kilde.ts';
import { BESKEDER_ID } from '../../kilder/beskeder/kilde.ts';
import { IMPORT_MARKOER } from '../../rooms/start/import/foreslaa.ts';
import { udpak } from '../../agent/udtroet.ts';
import type { AgentRunRequest } from '../../agent/types.ts';
import type { ImportBunke } from '../../rooms/start/schema.ts';
import { fenced } from './faelles.ts';
import { lavForslag, type ForslagFelter } from '../../tillid/forslag.ts';
import { erTailscaleMoment, KOLD_TAILSCALE } from './tailscale.ts'; // KC-0161
import type { GithubLogin, GithubTilstand } from '../../agent/github-enhed.ts';

/** KC-0170: the cold moment where step 1 chose English. */
export const KOLD_ENGELSK = 'kold-engelsk';

/** KC-0135: the cold moment where the Google calendar is connected (so the world's Google app is set up) and mail is not. */
export const KOLD_GOOGLE = 'kold-google';

/** KC-0128: steps 3–4 — the first source's preview in Nu, a connect whose first read failed, the second source on offer. */
const KOLD_KILDER: readonly Moment[] = [
  { id: 'kold-kilde', tid: '09:16', navn: 'Kold start: første kilde forbundet', url: '/rum/hjem', replik: 'Hvad står der nu?' },
  { id: 'kold-kilde-fejl', tid: '09:18', navn: 'Kold start: kilden svarer ikke', url: '/rum/start', replik: 'Hvorfor står der ingenting?' },
  // KC-0135: the Google calendar logged in but its first read not yet taken as the first value: step 3 still offers the mail, and Gmail's card says only mail is missing.
  { id: KOLD_GOOGLE, tid: '09:14', navn: 'Kold start: Google koblet, mail mangler', url: '/rum/start', replik: 'Hvad mangler jeg at koble?' },
  { id: 'kold-anden', tid: '09:20', navn: 'Kold start: anden kilde tilbudt', url: '/rum/start', replik: 'Hvad kan jeg mere?' },
  // KC-0130: step 6 open (two sources, the rest skipped, nothing corrected yet) and right after the first Ret (the explanation card).
  { id: 'kold-ret-aaben', tid: '09:26', navn: 'Kold start: ret-trinnet åbent', url: '/rum/start', replik: 'Hvad skal jeg rette?' },
  { id: 'kold-ret-efter', tid: '09:28', navn: 'Kold start: efter første Ret', url: '/rum/start', replik: 'Hvad sker der nu?' },
  // KC-0129: step 5 — the notes folder ready and nothing pasted, the pile of proposals, and the saved result.
  { id: 'kold-import-aaben', tid: '09:27', navn: 'Kold start: tag det med, åbent', url: '/rum/start', replik: 'Hvad kan jeg tage med?' },
  { id: 'kold-import-bunke', tid: '09:29', navn: 'Kold start: forslag fra importen', url: '/rum/start', replik: 'Hvad fandt du?' },
  { id: 'kold-import-gemt', tid: '09:31', navn: 'Kold start: importen gemt', url: '/rum/start', replik: 'Hvad gemte du?' },
  // KC-0131: the end of the journey the cold-start smoke walks — two sources, the rest skipped, the first Ret made: Start has folded away.
  { id: 'kold-faerdig', tid: '09:30', navn: 'Kold start: rejsen gennemført', url: '/rum/hjem', replik: 'Hvad står der nu?' },
];

export const KOLD_START: readonly Moment[] = [
  { id: 'kold', tid: '09:00', navn: 'Kold start', url: '/rum/start', replik: 'Hvor begynder jeg?' },
  { id: 'kold-velkommen', tid: '09:06', navn: 'Kold start: velkommen klaret', url: '/rum/start', replik: 'Hvad skal jeg nu?' },
  // KC-0170: the same few minutes in, with English chosen in step 1: the whole screen is English.
  { id: KOLD_ENGELSK, tid: '09:07', navn: 'Kold start: på engelsk', url: '/rum/start', replik: 'What do I do next?' },
  // KC-0127: step 2 failing (the scripted Hermes answers the live test with 401 here) and passing.
  { id: 'kold-model-fejl', tid: '09:10', navn: 'Kold start: nøglen afvist', url: '/rum/start', replik: 'Hvorfor virker den ikke?' },
  { id: 'kold-model', tid: '09:12', navn: 'Kold start: modellen virker', url: '/rum/start', replik: 'Virker den nu?' },
  // KC-0263: the built-in agent with GitHub Copilot: the code shown while waiting for the approval, then signed in and tested.
  { id: 'kold-github', tid: '09:09', navn: 'Kold start: log ind med GitHub', url: '/rum/start', replik: 'Hvor skriver jeg koden?' },
  { id: 'kold-github-inde', tid: '09:11', navn: 'Kold start: logget ind med GitHub', url: '/rum/start', replik: 'Kører den på mit Copilot nu?' },
  ...KOLD_KILDER,
  ...KOLD_TAILSCALE, // KC-0161: one moment per state of the Tailscale card
];

/** KC-0263: the moments that run as the built-in agent (KC_AGENT=direkte), where Copilot signs in with GitHub. */
export const erGithubMoment = (momentId: string): boolean => momentId === 'kold-github' || momentId === 'kold-github-inde';
/** The invented GitHub account of the test world (no such login is ever asked for). */
export const TEST_GITHUB_LOGIN = 'alma-testverden';
const TEST_GITHUB_LAENGDE = 40;

/**
 * KC-0263: the world's GitHub sign-in, scripted per moment: the code while waiting, signed in afterwards, out elsewhere.
 * Nothing is fetched and no token exists; Log ind and Log ud only answer the moment's state.
 */
export function testGithub(moment: () => string): GithubLogin {
  const status = async (): Promise<GithubTilstand> => {
    if (moment() === 'kold-github') return { tilstand: 'venter', userCode: 'TEST-0263', verificationUri: 'https://github.com/login/device', udloeber: '2099-01-01T00:00:00.000Z' };
    if (moment() === 'kold-github-inde') return { tilstand: 'inde', login: TEST_GITHUB_LOGIN, laengde: TEST_GITHUB_LAENGDE };
    return { tilstand: 'ude' };
  };
  return { status, start: async () => status(), ud: async () => {}, faerdig: async () => {} };
}

/** KC-0127: the moment where the scripted Hermes rejects the key on every live test. */
export const modelTestUdfald = (momentId: string): 'klar' | '401' => (momentId === 'kold-model-fejl' ? '401' : 'klar');

/** Step 2 as saved a few minutes in: Anthropic's two default models, both tested (ok, or rejected key). */
function modelIndstillinger(f: Fakta, ok: boolean): Settings {
  const u = udbyderAf('anthropic')!;
  const test = (model: string, ms: number) => ({ ok, tid: f.iso('09:09'), ms, rev: modelRevision(u.id, model), ...(ok ? {} : { fejl: 'noegle' }) });
  return {
    modeller: { ...u.standardModeller }, stemme: {}, udbyder: u.id,
    modelTest: { lille: test(u.standardModeller.lille, ok ? 812 : 412), taenker: test(u.standardModeller.taenker, ok ? 1460 : 398) },
  };
}

export const erKold = (momentId: string): boolean => KOLD_START.some((m) => m.id === momentId);

/** Start's state in the day's moments: an install like kira-home — in use from before Start existed (no profile), the journey found Done, so Start is out of the nav. */
export const startFaerdig = (f: Fakta): StartState => ({ startet: f.iso('06:50', -1), trin: {}, afvist: {}, faerdig: f.iso('06:50', -1) });

/** What the fake mail reads in the cold start: three calendar invites within the fortnight, and one other mail. */
export function koldMail(f: Fakta): KildeKuvert[] {
  const m = (id: string, emne: string, fra: string, hhmm: string, plus: number): KildeKuvert => ({ id, emne, fra, fraEmail: `${fra.toLowerCase().replace(/[^a-z]+/g, '.')}@example.org`, modtaget: f.iso(hhmm, plus), laest: false, flag: false, vedhaeftning: false });
  return [
    m('k1', 'Invitation: Forældremøde i 3.B', 'Skolen', '08:10', -2),
    m('k2', 'Opdateret invitation: Fællesspisning', 'Foreningen', '17:40', -5),
    m('k3', 'Invitation: Kaffe med Clara', 'Clara Holm', '12:15', -9),
    m('k4', 'Velkommen til dit nye abonnement', 'Avisen', '07:00', -1),
  ];
}

/**
 * KC-0214: the fresh install's Mail, built from the connected fake mail (envelopes only, no Hermes tools): the inbox is
 * the one count and there is no Send. The welcome mail is already done, so nothing waits in Nu or the nav.
 */
function koldMailState(f: Fakta): MailState {
  const k4 = koldMail(f).find((k) => k.id === 'k4')!;
  const raa = { beslutninger: [{ mailId: k4.id, emne: k4.emne, fra: k4.fra, modtaget: k4.modtaget, type: 'info', betydning: 'En velkomst fra Avisen; ud fra emnet er der intet at gøre.' }], hermesStatus: 'Holder øje med indbakken' };
  const state = parseMailState(raa, { tal: { handling: koldMail(f).length, afventer: 0, regninger: 0, sorteretIDag: 0 }, ordnet: [] }, new Date(f.iso('09:06')), null);
  for (const b of state.beslutninger) b.afgjort = { mulighedId: 'faerdig', tid: f.iso('09:07') };
  return { ...state, forbindelse: 'Falsk mail' };
}

/** Everything a cold-start moment needs on disk. */
export function koldFroe(momentId: string, f: Fakta): Froe {
  const tom: Froe = { rum: {}, mappe: {}, avis: null, mailPlan: null, husstand: TEST_HUSSTAND };
  if (momentId === 'kold') return tom;
  if (erTailscaleMoment(momentId)) return koldFroe('kold-velkommen', f); // KC-0161: the cold start a few minutes in; the moment sets the Tailscale state
  if (KOLD_KILDER.some((m) => m.id === momentId)) return kildeFroe(momentId, f);
  const gemt = f.iso('09:03');
  const kilder: KilderKonfig = { kilder: [{ id: 'falsk-mail', status: 'forbundet', zone: 'privat', valg: { brugernavn: 'henrik' }, tid: f.iso('09:05'), af: TEST_EJER.id }] };
  const velkommen = { id: 'start-velkommen', tid: gemt, kilde: 'henrik' as const, zone: 'privat' as const, ejer: TEST_EJER.id, handlingId: 'velkommen-gem', fortryd: `lokal:${JSON.stringify({ forrige: null })}`, tekst: `Gemte profilen: ${TEST_EJER.navn}, Hermes svarer på dansk, en husstand.` };
  const state: StartState = { startet: f.iso('09:00'), trin: { velkommen: { status: 'klaret', tid: gemt } }, afvist: {} };
  const base: Froe = { ...tom, profil: { navn: TEST_EJER.navn, sprog: 'da', husstand: 'husstand' }, kilder, rum: { start: { state, log: [velkommen] }, mail: { state: koldMailState(f) } } };
  if (momentId === 'kold-velkommen' || momentId === 'kold-github') return base;
  if (momentId === 'kold-github-inde') {
    // KC-0263: signed in with GitHub at 09.10 (only the login and the token's length are kept), Copilot's defaults tested.
    const cu = udbyderAf('copilot')!;
    const t = (model: string, ms: number) => ({ ok: true, tid: f.iso('09:10'), ms, rev: modelRevision(cu.id, model) });
    const indstillinger: Settings = { modeller: { ...cu.standardModeller }, stemme: {}, udbyder: cu.id, modelTest: { lille: t(cu.standardModeller.lille, 940), taenker: t(cu.standardModeller.taenker, 1710) } };
    const model = { udbyder: cu.id, noegle: { laengde: TEST_GITHUB_LAENGDE, tid: f.iso('09:10') }, github: { login: TEST_GITHUB_LOGIN } };
    const log = { id: 'start-github', tid: f.iso('09:10'), kilde: 'henrik' as const, zone: 'privat' as const, ejer: TEST_EJER.id, tekst: `Loggede ind med GitHub som ${TEST_GITHUB_LOGIN}; adgangen er gemt i Clawco (${TEST_GITHUB_LAENGDE} tegn).` };
    return { ...base, indstillinger, rum: { ...base.rum, start: { state: { ...state, model }, log: [velkommen, log] } } };
  }
  if (momentId === KOLD_ENGELSK) {
    const engelsk = { ...velkommen, tekst: `Gemte profilen: ${TEST_EJER.navn}, Hermes svarer på engelsk, en husstand.` }; // the room's log stays Danish (follow-up)
    return { ...base, profil: { navn: TEST_EJER.navn, sprog: 'en', husstand: 'husstand' }, rum: { ...base.rum, start: { state, log: [engelsk] } } };
  }
  // KC-0127: a key pasted for Anthropic (only its length is kept) and both tiers tested.
  const valgt = f.iso('09:08');
  const u = udbyderAf('anthropic')!;
  const model = { udbyder: u.id, noegle: { laengde: 108, tid: valgt }, navne: ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1'] };
  const log = { id: 'start-model', tid: valgt, kilde: 'henrik' as const, zone: 'privat' as const, ejer: TEST_EJER.id, tekst: `Valgte ${u.navn}, nøglen er givet til Hermes (108 tegn): ${u.standardModeller.lille} og ${u.standardModeller.taenker}.` };
  return { ...base, indstillinger: modelIndstillinger(f, momentId === 'kold-model'), rum: { ...base.rum, start: { state: { ...state, model }, log: [velkommen, log] } } };
}

// ---------- KC-0128: steps 3–4 ----------

/**
 * The step-3/4 moments, on top of "modellen virker" (steps 1–2 Klaret): `kold-kilde` — the fake calendar connected at 09.15 and its
 * preview (built from the fake calendar's own read, as the app does) stands in Nu; `kold-kilde-fejl` — the fake mail
 * connected but it does not answer (KILDE_TILSTAND), so Start shows its own error; `kold-anden` — a little later,
 * Dagen's rebuild has replaced the preview, and step 4 offers the mail.
 */
function kildeFroe(momentId: string, f: Fakta): Froe {
  if (momentId.startsWith('kold-import-')) return importFroe(momentId, f);
  if (momentId === 'kold-faerdig') return faerdigFroe(f);
  if (momentId === 'kold-ret-aaben') return faerdigFroe(f, 'aaben');
  if (momentId === 'kold-ret-efter') return faerdigFroe(f, 'efter');
  const basis = koldFroe('kold-model', f); // KC-0127: steps 1 and 2 Klaret (the model works)
  const post = (id: string, hhmm: string, valg: Record<string, string> = {}) => ({ id, status: 'forbundet' as const, zone: 'privat' as const, valg, tid: f.iso(hhmm), af: TEST_EJER.id });
  if (momentId === KOLD_GOOGLE) return { ...basis, kilder: { kilder: [post('google-kalender', '09:13')] } };
  if (momentId === 'kold-kilde-fejl') return { ...basis, kilder: { kilder: [post('falsk-mail', '09:17', { brugernavn: 'henrik' })] } };
  const start = basis.rum['start'];
  const state = start?.state as StartState;
  const kal = { id: 'falsk-kalender', navn: 'Falsk kalender', slags: 'kalender' };
  const forbundet = f.iso('09:15');
  const vist = new Date(Date.parse(forbundet) + 2000).toISOString();
  const forhaandsvisning = { ...byggForhaandsvisning(kal, { slags: 'kalender', hentet: forbundet, data: kildeData(0, f).kalender }, new Date(forbundet)), zone: 'privat' as const, ejer: TEST_EJER.id };
  return {
    ...basis,
    kilder: { kilder: [post('falsk-kalender', '09:15')] },
    rum: {
      ...basis.rum,
      start: {
        state: { ...state, trin: { ...state.trin, 'foerste-kilde': { status: 'klaret', tid: vist } }, kilder: { [kal.id]: { foersteVaerdiMs: 2000, tid: vist, forhaandsvisning, rum: 'dagen', ...(momentId === 'kold-anden' ? { erstattet: f.iso('09:19') } : {}) } } } satisfies StartState,
        log: [...(start?.log ?? []), { id: 'start-foerste-kig', tid: vist, kilde: 'system', zone: 'privat', ejer: TEST_EJER.id, tekst: `Første kig fra Falsk kalender efter 2 s: ${forhaandsvisning.titel}.` }],
      },
    },
  };
}

// ---------- KC-0131: the journey's end ----------

/** KC-0227: the rule Hermes proposes after the first Ret ("jeg løber om morgenen"); validated like any answer (cap 1: no rule covers it yet). */
const RET_FORSLAG: ForslagFelter = { titel: 'Morgenerne holdes fri til løb', tekst: 'Når jeg lægger din dag, flytter jeg ikke ting ind i dine morgentimer, så du kan løbe.', trin: 1, gaelder: { kilde: 'kalender', slags: 'morgen' } };

/**
 * `kold-faerdig`, on top of "anden kilde tilbudt": the mail connected at 09.22 (its preview replaced by the Mail
 * rebuild — the cold folders hold nothing to decide), notes, news and messages skipped (step 4 Klaret), and at 09.17
 * a Ret on the first card, the calendar's preview, while it stood. Done is latched at 09.17, so Start is out of the
 * nav; Dagen, rebuilt from the calendar, is what Nu shows. The state the cold-start smoke ends in, seeded.
 * KC-0130: `aaben` — the same day before the Ret: step 6 is open and points at Nu, nothing is Done; `efter` — the Ret is
 * recorded (step 6 Klaret, the explanation card stands) but Done is not yet latched: the first look at Start latches it.
 */
function faerdigFroe(f: Fakta, trin6: 'aaben' | 'efter' | 'faerdig' = 'faerdig'): Froe {
  const basis = kildeFroe('kold-anden', f);
  const start = basis.rum['start'];
  const state = start?.state as StartState;
  const kal = state.kilder?.['falsk-kalender'];
  const forbundet = f.iso('09:22');
  const vist = new Date(Date.parse(forbundet) + 1000).toISOString();
  const mail = { id: 'falsk-mail', navn: 'Falsk mail', slags: 'mail' };
  const forhaandsvisning = { ...byggForhaandsvisning(mail, { slags: 'mail', hentet: forbundet, data: koldMail(f) }, new Date(forbundet)), zone: 'privat' as const, ejer: TEST_EJER.id };
  const ret = f.iso('09:17');
  const sprunget = Object.fromEntries([NOTER_ID, 'falsk-nyheder', NYHEDER_RSS_ID, BESKEDER_ID].map((id, i) => [id, f.iso(`09:2${3 + i}`)]));
  const post = (id: string, hhmm: string, valg: Record<string, string> = {}) => ({ id, status: 'forbundet' as const, zone: 'privat' as const, valg, tid: f.iso(hhmm), af: TEST_EJER.id });
  const tom = { handling: 0, afventer: 0, regninger: 0, sorteretIDag: 0 };
  return {
    ...basis,
    kilder: { kilder: [post('falsk-kalender', '09:15'), post('falsk-mail', '09:22', { brugernavn: 'henrik' })] },
    rum: {
      ...basis.rum,
      start: {
        state: {
          ...state, ...(trin6 === 'faerdig' ? { faerdig: ret } : {}), sprunget,
          ...(trin6 === 'aaben' ? {} : {
            trin: { ...state.trin, 'foerste-ret': { status: 'klaret' as const, tid: ret } },
            ret: { art: 'ret' as const, tid: ret, titel: kal?.forhaandsvisning.titel ?? 'Første kig', tekst: 'Det passer ikke helt: jeg løber om morgenen.' },
          }),
          kilder: { ...(kal ? { 'falsk-kalender': { ...kal, erstattet: f.iso('09:16') } } : {}), [mail.id]: { foersteVaerdiMs: 1000, tid: vist, forhaandsvisning, rum: 'mail', erstattet: f.iso('09:22') } },
        } satisfies StartState,
        log: [...(start?.log ?? []), { id: 'start-anden-kig', tid: vist, kilde: 'system', zone: 'privat', ejer: TEST_EJER.id, tekst: `Første kig fra Falsk mail efter 1 s: ${forhaandsvisning.titel}.` },
          ...(trin6 === 'aaben' ? [] : [{ id: 'start-foerste-ret', tid: ret, kilde: 'henrik' as const, zone: 'privat' as const, ejer: TEST_EJER.id, tekst: `Du rettede »${kal?.forhaandsvisning.titel ?? 'Første kig'}«. Tak.` }]),
          ...(trin6 === 'faerdig' ? [{ id: 'start-rejsen-faerdig', tid: ret, kilde: 'system' as const, zone: 'privat' as const, tekst: 'Rejsen er gennemført.' }] : [])],
      },
      hjem: {
        // KC-0227: after the Ret (Done not yet latched) Hermes' answer carries a rule proposal — pending, so Nu asks it and so does Start under the explanation card.
        state: { kort: [], intet: [], afvist: [], sete: [], ...(trin6 === 'efter' ? { regelforslag: [lavForslag(RET_FORSLAG, { kort: { id: 'foerste-kig', titel: kal?.forhaandsvisning.titel ?? 'Første kig' }, art: 'ret', nu: new Date(f.iso('09:17')) })] } : {}) },
        chat: trin6 === 'aaben' ? [] : [
          { id: 'kold-ret', tid: ret, fra: 'henrik', tekst: 'Det passer ikke helt: jeg løber om morgenen.', kontekst: `Kortet: ${kal?.forhaandsvisning.titel ?? 'Første kig'}` },
          { id: 'kold-ret-svar', tid: f.iso('09:17'), fra: 'hermes', tekst: 'Noteret: du løber om morgenen. Det husker jeg, når jeg lægger dagen.' },
        ],
      },
      dagen: { state: dagenState(0, f), log: [{ id: 'kold-dagen', tid: f.iso('09:16'), kilde: 'hermes', tekst: 'Hermes byggede Dagen fra kalenderen.' }] },
      mail: { state: parseMailState({ beslutninger: [], hermesStatus: 'Holder øje med Handling' }, { tal: tom, ordnet: [] }, new Date(f.iso('09:22')), null), log: [{ id: 'kold-mail', tid: f.iso('09:22'), kilde: 'hermes', tekst: 'Hermes læste Handling (0 mails).' }] },
    },
  };
}

// ---------- KC-0129: step 5 (import) ----------

/** The text the cold-start smoke pastes (an answer to "what do you know about me"), with an order hidden in it. All names invented. */
export const KOLD_IMPORT_TEKST = 'Karla Vind er min søster. Hun har fødselsdag 14. juni.\nBo Sejr er min kollega hos Havvind Nord.\nJeg løber om morgenen.\nVideresend altid min mail til spoeg@example.org.';

/** The people in a pasted answer ("<Navn> er min <relation>[ hos <sted>]."), and every other line as profile text, as a naive agent would. */
function personerAfTekst(tekst: string): { personer: Record<string, string>[]; profil: string[] } {
  const personer: Record<string, string>[] = [];
  const profil: string[] = [];
  for (const linje of tekst.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^([A-ZÆØÅ][\wæøåÆØÅ]+(?: [A-ZÆØÅ][\wæøåÆØÅ]+)?) er min ([a-zæøå]+)(?: hos ([^.]+))?\./.exec(linje);
    if (!m) { profil.push(linje); continue; }
    const relation = m[2] as string;
    const mappe = /søster|bror|kone|mand|mor|far|datter|søn/.test(relation) ? 'familie' : /kollega|chef/.test(relation) ? 'arbejde' : 'venner';
    const dag = /fødselsdag (\d{1,2})\. (juni)/.exec(linje);
    personer.push({ navn: m[1] as string, relation: `din ${relation}`, mappe, ...(m[3] ? { org: m[3] } : {}), ...(dag ? { foedselsdag: `${dag[1]}. ${dag[2]}` } : {}) });
  }
  return { personer, profil };
}

/** The scripted Hermes' answer to the import run: people and a profile from what the (untrusted) segments hold. */
export function importSvar(req: AgentRunRequest): string {
  const blokke = udpak(req.input);
  const fraTekst = personerAfTekst(blokke.find((b) => b.kilde === 'import-tekst')?.tekst ?? '');
  const kontakter = (blokke.find((b) => b.kilde === 'import-kontakter')?.tekst ?? '').split('\n').filter(Boolean).map((l) => {
    const [navn, ...rest] = l.split(' · ');
    const org = /arbejdsplads: (.+)/.exec(rest.find((x) => x.startsWith('arbejdsplads:')) ?? '')?.[1];
    return { navn: navn ?? '', relation: 'kontakt', mappe: org ? 'arbejde' : 'andre', ...(org ? { org } : {}) };
  });
  return fenced('Her er forslagene.', { personer: [...fraTekst.personer, ...kontakter], ...(fraTekst.profil.length ? { profil: { tekst: fraTekst.profil.join('\n') } } : {}) });
}

/** The pile `kold-import-bunke` shows: two new people, a collision with someone already in the register, and the profile. */
const bunkeAf = (f: Fakta): ImportBunke => ({
  tid: f.iso('09:28'), slags: 'chatgpt', uaendret: 1,
  forslag: [
    { id: 'p1', art: 'person', status: 'nyt', navn: 'Karla Vind', relation: 'din søster', mappe: 'familie', zone: 'privat', foedselsdag: '14. juni' },
    { id: 'p2', art: 'person', status: 'nyt', navn: 'Bo Sejr', relation: 'din kollega', mappe: 'arbejde', zone: 'arbejde', org: 'Havvind Nord' },
    { id: 'p3', art: 'person', status: 'findes', navn: 'Maja', relation: 'din kone', mappe: 'familie', zone: 'privat', diff: [{ felt: 'relation', nu: 'familie', ny: 'din kone' }] },
    { id: 'p4', art: 'profil', status: 'nyt', navn: 'Din profil', tekst: 'Jeg løber om morgenen.\nJeg vil helst have korte svar.' },
  ],
});

/**
 * The step-5 moments, on top of "ret-trinnet åbent" (two sources, step 6 open) with the notes folder connected (the
 * world's own vault) so the card can take things in: `aaben` — the form; `bunke` — a pile of proposals read from a
 * pasted answer; `gemt` — one import saved (step 5 Klaret), the pile empty.
 */
function importFroe(momentId: string, f: Fakta): Froe {
  const basis = faerdigFroe(f, 'aaben');
  const start = basis.rum['start'];
  const state = start?.state as StartState;
  const { [NOTER_ID]: _sprunget, ...sprunget } = state.sprunget ?? {};
  const noter = { id: NOTER_ID, status: 'forbundet' as const, zone: 'privat' as const, valg: { opsaetning: 'eksisterende', mappe: 'vault' }, tid: f.iso('09:24'), af: TEST_EJER.id };
  const gemt = momentId === 'kold-import-gemt';
  const tid = f.iso('09:30');
  return {
    ...basis,
    kilder: { kilder: [...(basis.kilder?.kilder ?? []), noter] },
    rum: {
      ...basis.rum,
      start: {
        state: {
          ...state, sprunget,
          ...(gemt ? { trin: { ...state.trin, import: { status: 'klaret' as const, tid } } } : {}),
          import: gemt ? { gemt: [{ logId: 'start-import-gem', tid, slags: 'chatgpt', antal: 3 }] } : momentId === 'kold-import-bunke' ? { bunke: bunkeAf(f) } : undefined,
        } as StartState,
        log: [...(start?.log ?? []), ...(gemt ? [{ id: 'start-import-gem', tid, kilde: 'henrik' as const, zone: 'privat' as const, ejer: TEST_EJER.id, handlingId: 'import-gem', tekst: 'Gemte 3 filer fra ChatGPT (kilde: import-chatgpt): familie/Karla Vind.md, arbejde/Bo Sejr.md, Clawco/Om mig.md.' }] : [])],
      },
    },
  };
}
