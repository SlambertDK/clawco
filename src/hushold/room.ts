// Husstanden, wired as a room (KC-0148): `husstand` in the registry, its own
// rum-lager (state.json with the members' extras, resources and requests; log;
// chat). The view is pure aggregation — no Hermes: members from identity
// through `deps.husstand`, the shared week from the calendars in the husstand
// zone. It exists only for a household member who is not a guest, and only when
// the household is relevant (personer.ts); anyone else gets a 404 that names
// nobody.
//
// KC-0149, the request (forespørgsel): the actions opret · svar · traek ·
// spoerg-igen · drop are a party's taps (local runs; Hermes only suggests answer
// options beside the state), checked against the stored state and the caller
// (a third person gets 403, a settled request 409). Every step is a log line
// per party in zone privat with that party as ejer — a husstand-zone line would
// show the request to a third member. Nu: Kræver dig (hjemVenter) and I gang
// (hjemIgang). The clock (tik) reminds and expires; the .ics (fil) is the
// one-tap "Læg i din kalender".
//
// KC-0150, the resource: book (an owner, done with Fortryd) · book-spoerg (anyone
// else asks the first owner: a request, red) · sammenfald-valg (a party's own
// option of a clash) · sammenfald-spoerg (the other party's option, as a red
// request through the same opretOgSpoerg). A booking that hits another person's
// booking books nothing and becomes one clash card for exactly those two;
// Hermes (lille tier) only orders its options. Accepting a resource request books
// inside the same queue, or is refused (409). `endre` refuses to write a double
// booking, whatever path got there.
//
// KC-0151, the cars: a sentence in the chat ("jeg skal bruge den store bil lørdag
// 10 til 15") may be answered with one booking block (bil.ts). The app validates
// it and makes ONE card: a free slot is a draft (`udkast`, per person) whose blue
// button books (`udkast-book`; anyone but an owner gets a red ask, `udkast-spoerg`);
// another person's booking in the way is the clash card of KC-0150, through the
// same code as the Book form. A sentence never books. "Tilføj ting" adds a bil, rum or ting.
//
// KC-0152, the Saturday conflict: `weekendTjek` (driven by a Tuesday 07:30 job in server.ts, once per weekend) turns two
// busy adults and something to cover into ONE card for exactly those two (state.konflikter, konflikt.ts); Hermes
// (taenker tier) only phrases it. `konflikt-valg` is a party's pick: it creates a request to the other person through
// the same opretOgSpoerg and decides nothing; a no re-opens the card, a yes settles it. Nothing leaves the app.
//
// KC-0215, the things from the screen: tilfoej-ressource · ret-ressource · fjern-ressource are direct taps, checked
// against the stored state and the caller's role (an owner of the thing, or the household's owner). Removing is the
// verb `slet` (the red yes) and never takes another person's booking: it is refused while one is upcoming.

import { randomUUID } from 'node:crypto';
import type { RunRecord } from '../runs.ts';
import { ActionError, type RoomDeps, type RoomModule, type RoomView } from '../rooms/module.ts';
import type { Verb } from '../graenser/verber.ts';
import { idagKbh, koebenhavnTilIso } from '../shell/tid.ts';
import { html } from '../shell/html.ts';
import { HusholdFejl, KORSEL, parseHusstandState, RUM, TOM_HUSSTAND, type HusstandState, type Medlem } from './schema.ts';
import { maaSeHusstand, medlemmerAf } from './personer.ts';
import { faellesUge, ugeDage, type FaellesDag } from './uge.ts';
import { datoVis, klokkeVis, renderHusstand, renderIkkeHer } from './render.ts';
import { husstandTekst } from './tekster.ts';
import { sprogNu, tekst } from '../shell/tekster.ts';
import { buildForespForslagRun, buildHusstandChatRun, parseForespForslag } from './prompt.ts';
import { parseBookingSvar, udkastAabent, valider, type BookingOensker, type BookingUdkast } from './bil.ts';
import {
  aftaleTid, alternativFraKl, anvend, beslutter, erPaamindet, erPart, fortrydSvar, nyForespoergsel, tik as tikForesp, ubesvaret,
  type Fejl, type Forespoergsel, type Haendelse, type PersonId, type Tidsrum,
} from './foresp.ts';
import { forespLog, forespMarkoer, forespSektion, linjeKanFortrydes } from './foresp-render.ts';
import {
  aabenSammenfald, andenPart, dobbeltBooket, erEjer, erPartI, hvorforIkkeFjernes, indsaet, loesSammenfald, maaRetteRessource, nySammenfald, OPRET_SLAGS, overlapper, parterI, sammenfald as overlappende, valgNeutralt,
  type Booking, type OpretSlags, type Ressource, type Sammenfald, type Slags, type Valg,
} from './ressource.ts';
import { ejerAtSpoerge, ressourceSektion } from './ressource-render.ts';
import { buildSammenfaldForslagRun, parseSammenfaldForslag } from './prompt.ts';
import { blokkeFraKalendere, erPartIKonflikt, konfliktStatus, nytKonflikt, parseKonfliktTekst, valgTitel, weekendKonflikter, andenIKonflikt, type Konflikt } from './konflikt.ts';
import { konfliktSektion, konfliktTekstVis, tidSagVis } from './konflikt-render.ts';
import { buildKonfliktRun } from './prompt.ts';
import type { LogEntry } from '../store/types.ts';
import { KANAL_NAVN, vurderSend, type KanalClient, type KanalStatus, type SendSlags } from './kanal.ts';
import { afsenderAf, fortolk } from './svar.ts';
import { MAX_KANAL_BESKEDER, MAX_KANAL_TEKST } from './schema.ts';
import { AKTION_HANDLING, maaHandle, maaSe } from './rettigheder.ts';
import { aktiverIndgang, fjernPerson, InvitationFejl, MAX_PERSONER, navnFra, nyPerson, nytMedlem, parseInvitation, skiftRolle, slug, vurderInvitation } from './invitation.ts';
import { invitationSektion, renderInviter } from './invitation-render.ts';
import { anvendIntern, type InternOp } from './intern.ts';
import { erRolle } from '../identitet/roller.ts';
import type { Person } from '../identitet/husstand.ts';

/** The stored state; a file that does not validate reads as empty (and is said in the journal), never as a crash. */
async function laesState(deps: RoomDeps): Promise<HusstandState> {
  try { return parseHusstandState(await deps.store.readState<unknown>(RUM)); } catch (err) {
    if (!(err instanceof HusholdFejl)) throw err;
    console.error('husstand: state.json kunne ikke læses:', err.message);
    return { ...TOM_HUSSTAND };
  }
}

/** Members and state, or null when Husstanden is not there for the person looking. */
async function forPersonen(deps: RoomDeps): Promise<{ medlemmer: Medlem[]; state: HusstandState } | null> {
  if (!deps.husstand) return null;
  const state = await laesState(deps);
  const medlemmer = medlemmerAf(await deps.husstand.personer(), state.medlemmer);
  return maaSeHusstand(deps.person, medlemmer, state) ? { medlemmer, state } : null;
}

/** Whether Husstanden is there for the person of this request (nav, Univers overview). */
export async function husstandSynlig(deps: RoomDeps): Promise<boolean> {
  return (await forPersonen(deps)) !== null;
}

async function ugen(deps: RoomDeps, medlemmer: Medlem[], state: HusstandState): Promise<FaellesDag[]> {
  const kalendere = deps.husstand ? await deps.husstand.kalendere() : [];
  return faellesUge(medlemmer, { kalendere, ressourcer: state.ressourcer, forespoergsler: state.forespoergsler }, ugeDage(deps.now()));
}

async function view(deps: RoomDeps): Promise<RoomView> {
  const h = await forPersonen(deps);
  if (!h) return { main: renderIkkeHer(), hermesStatus: tekst().klar, titel: husstandTekst().husstandenFindesIkke, status: 404 };
  const now = deps.now();
  const p = deps.person;
  const person = p.id;
  const log = await deps.store.readLog(RUM, 200);
  const kanBooking = (e: LogEntry): boolean => bookingLinjeKanFortrydes(e, h.state.ressourcer, person);
  // KC-0154: what this person may see and do (rettigheder.ts); a guest gets her requests and nothing shared.
  const faelles = maaSe(p, { slags: 'ressource' });
  const kanSvare = maaHandle(p, { slags: 'svar' });
  const foresp = html`${konfliktSektion({ konflikter: h.state.konflikter, forespoergsler: h.state.forespoergsler, person, medlemmer: h.medlemmer, now })}${forespSektion({ forespoergsler: h.state.forespoergsler, person, medlemmer: h.medlemmer, now, kanSpoerge: maaHandle(p, { slags: 'spoerg' }), kanSvare })}${faelles ? ressourceSektion({ ressourcer: h.state.ressourcer, sammenfald: h.state.sammenfald, forespoergsler: h.state.forespoergsler, udkast: h.state.udkast, person, medlemmer: h.medlemmer, now }) : ''}${forespLog({ log, forespoergsler: h.state.forespoergsler, person, now, ekstraFortryd: kanSvare ? kanBooking : () => false })}`;
  const invitationer = maaSe(p, { slags: 'invitation' }) ? invitationSektion({ medlemmer: h.medlemmer, person: p, kanSende: Boolean(deps.husstand?.kanalSvar) }) : undefined;
  return {
    main: renderHusstand({ medlemmer: h.medlemmer, person: p, uge: faelles ? await ugen(deps, h.medlemmer, h.state) : [], now, forespoergsler: foresp, faelles, kanRette: maaHandle(p, { slags: 'skift-rolle' }), ...(invitationer ? { invitationer } : {}) }),
    hermesStatus: tekst().klar,
  };
}

// ---------- KC-0149: the request ----------

/** One change of the stored state at a time (two taps arriving together must not both read the old state). */
let koe: Promise<unknown> = Promise.resolve();
function iKoe<T>(fn: () => Promise<T>): Promise<T> {
  const p = koe.then(fn, fn);
  koe = p.catch(() => undefined);
  return p;
}

/** Reads, changes and writes the state in the queue; `fn` returns null to leave it as it is. */
async function endre<T>(deps: RoomDeps, fn: (s: HusstandState) => { state: HusstandState; ud: T } | { ud: T }): Promise<T> {
  return iKoe(async () => {
    const r = fn(await laesState(deps));
    if ('state' in r) {
      // KC-0150: the last check before anything is written — no code path stores a double booking.
      if (r.state.ressourcer.some(dobbeltBooket)) throw new ActionError(husstandTekst().fejl.dobbeltbooking, 409);
      await deps.store.writeState(RUM, r.state);
    }
    return r.ud;
  });
}

const FEJL_STATUS: Record<Fejl, 400 | 403 | 409> = { 'ikke-part': 403, 'ikke-din-tur': 403, afgjort: 409, 'ikke-endnu': 400, intet: 409 };
/** A member's name; a stranger is "someone in the household" in the language being served. */
const navnAf = (medlemmer: readonly Medlem[], id: string): string => medlemmer.find((m) => m.id === id)?.navn ?? husstandTekst().ukendtMedlem;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const KL = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAG = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FORESP = 50;
const GEM_AFGJORTE_MS = 30 * 24 * 3600_000;

/** The request's members and state for an action, or a 404 that names nobody. */
async function forAktion(deps: RoomDeps): Promise<{ medlemmer: Medlem[]; state: HusstandState }> {
  const h = await forPersonen(deps);
  if (!h) throw new ActionError(husstandTekst().ikkeHerTitel, 404);
  return h;
}

/** One line per party, each private to that party; `fortrydAf` gets the marker that undoes the step. */
async function logBegge(deps: RoomDeps, f: Forespoergsel, tekst: (party: PersonId) => string, o: { kilde?: 'henrik' | 'system'; fortrydAf?: PersonId } = {}): Promise<void> {
  for (const party of [f.fra, f.til]) {
    await deps.store.appendLog(RUM, {
      kilde: o.kilde ?? 'henrik', tekst: tekst(party).slice(0, 300), zone: 'privat', ejer: party,
      ...(o.fortrydAf === party ? { fortryd: `foresp:${f.id}:${f.historik.length}` } : {}),
    });
  }
}

/** A tap's run ends with the room as it is now, so the page swaps at once (the live refresh would wait for the run). */
async function faerdig(deps: RoomDeps, text: string): Promise<{ text: string; html: string }> {
  return { text, html: String((await view(deps)).main) };
}

function notify(deps: RoomDeps): void {
  deps.live.notify(RUM);
  deps.live.notify('hjem');
}

/** The time asked for: none, or a day with from and to (Copenhagen) in the future. Throws ActionError. */
function tidFra(body: Record<string, unknown>, now: Date): Tidsrum | undefined {
  const dag = str(body['dag']), start = str(body['start']), slut = str(body['slut']);
  if (!dag && !start && !slut) return undefined;
  if (!DAG.test(dag) || !KL.test(start) || !KL.test(slut)) throw new ActionError(husstandTekst().fejl.vaelgDagFraTilTom);
  const s = koebenhavnTilIso(`${dag}T${start}`), e = koebenhavnTilIso(`${dag}T${slut}`);
  if (!s || !e || Date.parse(e) <= Date.parse(s)) throw new ActionError(husstandTekst().fejl.tilEfterFra);
  if (Date.parse(s) <= now.getTime()) throw new ActionError(husstandTekst().fejl.tidGaaet);
  return { start: s, slut: e };
}

/** Requests settled more than 30 days ago go when room is needed; still full = refused (nothing open is ever dropped). */
function medPlads(s: HusstandState, now: Date): HusstandState {
  if (s.forespoergsler.length < MAX_FORESP) return s;
  const gammel = (f: Forespoergsel): boolean => beslutter(f) === null && !ubesvaret(f) && now.getTime() - Date.parse(f.historik.at(-1)?.tid ?? f.oprettet) > GEM_AFGJORTE_MS;
  const forespoergsler = s.forespoergsler.filter((f) => !gammel(f));
  if (forespoergsler.length >= MAX_FORESP) throw new ActionError(husstandTekst().fejl.forMangeForesp, 409);
  return { ...s, forespoergsler };
}

/** Hermes' suggestions for the recipient (answer options, one line of advice), stored beside the state — never a transition. */
function startForslag(deps: RoomDeps, f: Forespoergsel, medlemmer: Medlem[], uge: FaellesDag[]): RunRecord | null {
  try {
    return deps.runs.start({
      kind: 'forslag',
      spec: buildForespForslagRun(f, medlemmer, uge),
      onDone: async (output) => {
        const forslag = parseForespForslag(output);
        if (forslag) {
          await endre(deps, (s) => {
            const i = s.forespoergsler.findIndex((x) => x.id === f.id && x.tilstand === 'spurgt');
            if (i < 0) return { ud: null };
            const forespoergsler = s.forespoergsler.map((x, j) => (j === i ? { ...x, forslag } : x));
            return { state: { ...s, forespoergsler }, ud: null };
          });
          notify(deps);
        }
        return { text: husstandTekst().ud.hermesSvar };
      },
    });
  } catch (err) {
    console.error('husstand: forslag kunne ikke startes:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Creates the request (asker = the person) and logs it; the run waits for Hermes' suggestions, whose failure changes nothing. */
async function opretOgSpoerg(deps: RoomDeps, h: { medlemmer: Medlem[] }, o: { til: string; titel: string; tid?: Tidsrum | undefined; ressourceId?: string }, foer?: (s: HusstandState, ny: Forespoergsel) => HusstandState): Promise<RunRecord> {
  const now = deps.now();
  const f = await endre(deps, (s0) => {
    const ny = nyForespoergsel({ id: `f-${randomUUID().slice(0, 8)}`, fra: deps.person.id, til: o.til, titel: o.titel, tid: o.tid, ressourceId: o.ressourceId }, now);
    const s = medPlads(foer ? foer(s0, ny) : s0, now);
    return { state: { ...s, forespoergsler: [...s.forespoergsler, ny] }, ud: ny };
  });
  const fra = navnAf(h.medlemmer, f.fra), til = navnAf(h.medlemmer, f.til);
  const L = husstandTekst().log;
  await logBegge(deps, f, (p) => (p === f.fra ? L.duSpurgte(til, f.titel) : L.spurgteDig(fra, f.titel)), { fortrydAf: f.fra });
  notify(deps);
  const uge = await ugen(deps, h.medlemmer, await laesState(deps));
  return deps.runs.local('opret', async () => {
    const run = startForslag(deps, f, h.medlemmer, uge);
    if (run) await run.finished;
    return faerdig(deps, husstandTekst().ud.spurgt(til));
  });
}

const SVAR: Record<string, Haendelse['slags']> = { ja: 'ja', nej: 'nej', alternativ: 'alternativ', 'tag-imod': 'tag-imod', afslaa: 'afslaa' };

/** What a step says, from each party's side. */
function trinTekst(f: Forespoergsel, slags: Haendelse['slags'], af: PersonId, medlemmer: readonly Medlem[]): (p: PersonId) => string {
  const L = husstandTekst().log;
  const hvem = (p: PersonId): string => (p === af ? husstandTekst().du(true) : navnAf(medlemmer, af));
  const kl = f.alternativ ? klokkeVis(f.alternativ.start) : null;
  const verbum: Record<Haendelse['slags'], string> = {
    ja: L.verbJa, nej: L.verbNej, alternativ: L.verbForeslog(kl), 'tag-imod': L.verbTogImod(kl), afslaa: L.verbAfslog(kl), traek: L.verbTrak, udloeb: '',
  };
  return (p) => L.trin(hvem(p), verbum[slags], f.titel);
}

/** A party's tap on a request: validated against the stored state, logged per party, the step undoable by its author. */
async function tryk(deps: RoomDeps, id: string, h: { medlemmer: Medlem[] }, lav: (f: Forespoergsel) => Haendelse | ActionError): Promise<RunRecord> {
  const now = deps.now();
  const person = deps.person.id;
  const r = await endre<{ f: Forespoergsel; aendret: boolean; slags: Haendelse['slags']; bookinger: Bookinger | null } | ActionError>(deps, (s) => {
    const f = s.forespoergsler.find((x) => x.id === id);
    if (!f) return { ud: new ActionError(husstandTekst().fejl.foresp404, 404) };
    if (!erPart(f, person)) return { ud: new ActionError(husstandTekst().fejl.forespIkkeDin, 403) };
    const haendelse = lav(f);
    if (haendelse instanceof ActionError) return { ud: haendelse };
    const u = anvend(f, haendelse, now);
    if (!u.ok) return { ud: new ActionError(u.hvorfor, FEJL_STATUS[u.fejl]) };
    if (!u.aendret) return { ud: { f: u.f, aendret: false, slags: haendelse.slags, bookinger: null } };
    const s1 = { ...s, forespoergsler: s.forespoergsler.map((x) => (x.id === id ? u.f : x)) };
    // KC-0150: a yes to a resource request books it here, in the same queue — or the yes is refused.
    const b = u.f.tilstand === 'accepteret' && u.f.ressourceId ? bookVedJa(s1, u.f, person, now) : null;
    if (b instanceof ActionError) return { ud: b };
    return { state: b ? b.state : s1, ud: { f: u.f, aendret: true, slags: haendelse.slags, bookinger: b } };
  });
  if (r instanceof ActionError) throw r;
  if (r.aendret) {
    // An accepted resource request is not undone through the request; each booking has its own Fortryd.
    await logBegge(deps, r.f, trinTekst(r.f, r.slags, person, h.medlemmer), r.slags === 'traek' || r.bookinger ? {} : { fortrydAf: person });
    if (r.bookinger) await logBookinger(deps, r.bookinger, h.medlemmer);
    notify(deps);
  }
  return deps.runs.local('foresp', () => faerdig(deps, r.aendret ? husstandTekst().ud.gjort : husstandTekst().ud.alleredeGjort));
}

/** The asker's card on an expired, unanswered request: drop it, or ask again (a new request). */
async function lukUdloebet(deps: RoomDeps, id: string): Promise<Forespoergsel> {
  const s = await laesState(deps);
  const f = s.forespoergsler.find((x) => x.id === id);
  if (!f) throw new ActionError(husstandTekst().fejl.foresp404, 404);
  if (f.fra !== deps.person.id) throw new ActionError(husstandTekst().fejl.forespIkkeDin, 403);
  if (!ubesvaret(f)) throw new ActionError(husstandTekst().fejl.kunUdenSvar, 409);
  return f;
}
const lukket = (id: string, now: Date) => (s: HusstandState): HusstandState => {
  const f = s.forespoergsler.find((x) => x.id === id);
  if (!f || !ubesvaret(f)) throw new ActionError(husstandTekst().fejl.forespOrdnet, 409);
  return { ...s, forespoergsler: s.forespoergsler.map((x) => (x.id === id ? { ...x, lukket: now.toISOString() } : x)) };
};

// ---------- KC-0153: the go-between ----------

/** What may be sent for a request now, and the exact text (kanal.ts vurderSend over the person's household). Throws ActionError. */
export async function kanalSendKlar(deps: RoomDeps, id: string, slags: SendSlags): Promise<{ tekst: string; jaId: string }> {
  const h = await forAktion(deps);
  const v = vurderSend({ forespoergsler: h.state.forespoergsler, medlemmer: h.medlemmer }, id, slags, deps.person.id);
  if (!v.ok) throw new ActionError(v.hvorfor, v.status);
  return { tekst: v.tekst, jaId: v.jaId };
}

/**
 * The human tap's send (server.ts calls it only inside the policy layer, after a one-time yes for exactly this text).
 * In the store's queue: checked again, sent once through the channel, then recorded — a second tap waiting in the
 * queue finds it sent (409). A channel failure records nothing (KanalFejl reaches the route), so the tap can be retried.
 */
export async function kanalSend(deps: RoomDeps, kanal: KanalClient, id: string, slags: SendSlags, tekst: string): Promise<RunRecord> {
  const h = await forAktion(deps);
  const now = deps.now();
  const v = await iKoe(async () => {
    const s = await laesState(deps);
    // Her channel state as stored now (a "stop" read a moment ago counts).
    const medlemmer = medlemmerAf(await deps.husstand!.personer(), s.medlemmer);
    const v = vurderSend({ forespoergsler: s.forespoergsler, medlemmer }, id, slags, deps.person.id);
    if (!v.ok) throw new ActionError(v.hvorfor, v.status);
    if (v.tekst !== tekst) throw new ActionError(husstandTekst().fejl.beskedAendret, 409);
    await kanal.send(v.til, v.tekst);
    const tid = now.toISOString();
    const forespoergsler = s.forespoergsler.map((x) => (x.id === id ? { ...x, kanal: { sendt: [...(x.kanal?.sendt ?? []), { tid, slags }], beskeder: x.kanal?.beskeder ?? [] } } : x));
    await deps.store.writeState(RUM, { ...s, forespoergsler, kanalSidst: s.kanalSidst ?? tid });
    return v;
  });
  const til = navnAf(h.medlemmer, v.f.til), fra = navnAf(h.medlemmer, v.f.fra);
  const L = husstandTekst().log;
  await logBegge(deps, v.f, (p) => (p === v.f.fra ? L.sendteDu(slags, til, v.kanalNavn, v.f.titel) : L.sendteDig(slags, fra, v.kanalNavn, v.f.titel)));
  notify(deps);
  return deps.runs.local('kanal-send', () => faerdig(deps, husstandTekst().ud.sendt(til, v.kanalNavn)));
}

type KanalHaendelse =
  | { slags: 'svar'; f: Forespoergsel; haendelse: Haendelse['slags']; af: PersonId; kanalNavn: string }
  | { slags: 'tekst'; f: Forespoergsel; af: PersonId; tekst: string; kanalNavn: string }
  | { slags: 'stop' | 'aktiv' | 'nej-tak'; af: PersonId; kanalNavn: string; til: PersonId[] };

/**
 * Her replies on the channel (Path B), read by the room's clock. Deterministic (svar.ts): exactly ja / nej / kl from
 * her registered handle moves the one open request sent to her there (`af` = her, `via: 'kanal'`); anything else is
 * a text line on that request that never acts; stop ends her go-between; her first ja after the invitation opts her
 * in. A sender who is not a member's handle is ignored (counted in the journal, never stored). Nothing is sent here.
 */
async function laesKanalSvar(deps: RoomDeps): Promise<void> {
  const hent = deps.husstand?.kanalSvar;
  if (!hent || !deps.husstand) return;
  const foer = await laesState(deps);
  // Nothing is read before the first send or invitation (an old "ja" of hers must never count).
  const inviteret = foer.medlemmer.flatMap((m) => (m.kanal?.status === 'afventer-ja' && m.kanal.inviteret ? [m.kanal.inviteret] : [])).sort();
  const siden = foer.kanalSidst ?? inviteret[0];
  if (!siden) return;
  const beskeder = await hent(siden);
  if (!beskeder.length) return;
  const personer = await deps.husstand.personer();
  const ejer = personer.find((p) => p.rolle === 'ejer')?.id;
  const now = deps.now();
  let fremmede = 0;
  const haendelser = await iKoe(async () => {
    let s = await laesState(deps);
    if ((s.kanalSidst ?? inviteret[0]) !== siden) return []; // another read got there first
    const ud: KanalHaendelse[] = [];
    for (const b of beskeder) {
      s = { ...s, kanalSidst: !s.kanalSidst || b.tid > s.kanalSidst ? b.tid : s.kanalSidst };
      const m = afsenderAf(medlemmerAf(personer, s.medlemmer), b);
      if (!m?.kanal) { fremmede += 1; continue; }
      const kanalNavn = KANAL_NAVN[m.kanal.kanal];
      const saetStatus = (status: KanalStatus): void => { s = { ...s, medlemmer: s.medlemmer.map((x) => (x.id === m.id && x.kanal ? { ...x, kanal: { ...x.kanal, status } } : x)) }; };
      const svar = fortolk(b.tekst);
      if (m.kanal.status === 'stoppet') continue;
      if (svar.slags === 'stop') {
        saetStatus('stoppet');
        const til = [...new Set(s.forespoergsler.filter((f) => f.til === m.id && f.kanal).map((f) => f.fra))];
        ud.push({ slags: 'stop', af: m.id, kanalNavn, til: til.length ? til : ejer ? [ejer] : [] });
        continue;
      }
      if (m.kanal.status === 'afventer-ja') {
        if (svar.slags === 'ja') { saetStatus('aktiv'); ud.push({ slags: 'aktiv', af: m.id, kanalNavn, til: ejer ? [ejer] : [] }); }
        // KC-0154: her "nej" to the invitation changes nothing (she may still say ja later) and is told to the owner.
        else if (svar.slags === 'nej') ud.push({ slags: 'nej-tak', af: m.id, kanalNavn, til: ejer ? [ejer] : [] });
        continue;
      }
      const sendtTil = s.forespoergsler.filter((f) => f.til === m.id && (f.kanal?.sendt.length ?? 0) > 0);
      const aabne = sendtTil.filter((f) => f.tilstand === 'spurgt');
      const maal = aabne.length === 1 ? aabne[0]! : null;
      if (maal && svar.slags !== 'tekst') {
        const h: Haendelse | null = svar.slags === 'kl'
          ? (() => { const alt = alternativFraKl(maal, svar.kl, husstandTekst().alternativTekst(svar.kl)); return alt ? { slags: 'alternativ', af: m.id, alternativ: alt } : null; })()
          : { slags: svar.slags, af: m.id };
        const u = h ? anvend(maal, h, now) : null;
        if (h && u?.ok && u.aendret) {
          const f = { ...u.f, historik: u.f.historik.map((x, i, a) => (i === a.length - 1 ? { ...x, via: 'kanal' as const } : x)) };
          s = { ...s, forespoergsler: s.forespoergsler.map((x) => (x.id === f.id ? f : x)) };
          ud.push({ slags: 'svar', f, haendelse: h.slags, af: m.id, kanalNavn });
          continue;
        }
      }
      // Text, or an answer with no open request to answer: a line on her latest request, which never acts.
      const tekst = b.tekst.trim().slice(0, MAX_KANAL_TEKST);
      const sidste = maal ?? [...sendtTil].sort((a, z) => (a.kanal!.sendt.at(-1)!.tid < z.kanal!.sendt.at(-1)!.tid ? 1 : -1))[0];
      if (!tekst || !sidste) continue;
      const kanalFelt = { sendt: sidste.kanal?.sendt ?? [], beskeder: [...(sidste.kanal?.beskeder ?? []), { tid: b.tid, tekst }].slice(-MAX_KANAL_BESKEDER) };
      const f = { ...sidste, kanal: kanalFelt };
      s = { ...s, forespoergsler: s.forespoergsler.map((x) => (x.id === f.id ? f : x)) };
      ud.push({ slags: 'tekst', f, af: m.id, tekst, kanalNavn });
    }
    await deps.store.writeState(RUM, s);
    return ud;
  });
  if (fremmede) console.info(`husstand: ${fremmede} besked(er) fra afsendere uden for husstanden blev ignoreret`);
  const medlemmer = medlemmerAf(personer, (await laesState(deps)).medlemmer);
  const L = husstandTekst().log;
  for (const e of haendelser) {
    const navn = navnAf(medlemmer, e.af);
    if (e.slags === 'svar') await logBegge(deps, e.f, (p) => `${trinTekst(e.f, e.haendelse, e.af, medlemmer)(p)}${L.paaKanal(e.kanalNavn)}`);
    else if (e.slags === 'tekst') await deps.store.appendLog(RUM, { kilde: 'system', tekst: L.skrevPaa(navn, e.kanalNavn, e.tekst).slice(0, 300), zone: 'privat', ejer: e.f.fra });
    else {
      const tekst = e.slags === 'stop' ? L.skrevStop(navn, e.kanalNavn)
        : e.slags === 'nej-tak' ? L.nejTakInvitation(navn, e.kanalNavn)
          : L.sagdeJaBeskeder(navn, e.kanalNavn);
      for (const p of e.til) await deps.store.appendLog(RUM, { kilde: 'system', tekst, zone: 'privat', ejer: p });
    }
  }
  if (haendelser.length) notify(deps);
}

// ---------- KC-0154: roles and invitations ----------

/** An invitation step's refusal as the room's action error (the routes turn it into its status). */
function somAktion<T>(fn: () => T): T {
  try { return fn(); } catch (err) {
    if (err instanceof InvitationFejl) throw new ActionError(err.message, err.status);
    throw err;
  }
}

/** The household's persons are written only here, inside the room's queue (husstand.json through the identity port). */
function gemmer(deps: RoomDeps): (personer: Person[]) => Promise<void> {
  const gem = deps.husstand?.gemPersoner;
  if (!gem) throw new ActionError(husstandTekst().fejl.kanIkkeAendres, 409);
  return gem;
}

/**
 * The owner invites (rettigheder.ts `inviter`): the person into husstand.json (a login, a name, a role — no account,
 * password or token of ours) and her extras into the room's state (a waiting own entry, or a channel waiting for her
 * ja). Nothing is sent. With no household yet (single user) the owner becomes its first person, by the login
 * Tailscale vouched for on this request; without one the household is not written (he would lock himself out).
 */
async function inviter(deps: RoomDeps, body: Record<string, unknown>): Promise<RunRecord> {
  const af = deps.person;
  const ny = somAktion(() => parseInvitation(body));
  const gem = gemmer(deps);
  const now = deps.now();
  const p = await iKoe(async () => {
    let personer = await deps.husstand!.personer();
    if (!personer.length) {
      if (!af.login) throw new ActionError(husstandTekst().fejl.aabnTailscale, 409);
      const navn = somAktion(() => navnFra(body['mitNavn'] ?? af.navn));
      personer = [{ id: af.id, login: af.login, navn, rolle: 'ejer' }];
    }
    const p = somAktion(() => nyPerson(personer, ny));
    const s = await laesState(deps);
    await deps.store.writeState(RUM, { ...s, medlemmer: [...s.medlemmer.filter((m) => m.id !== p.id), nytMedlem(p, ny, now)] });
    await gem([...personer, p]);
    return p;
  });
  const T = husstandTekst();
  const hvordan = ny.slags === 'egen' ? T.log.hvordanEgen : T.log.hvordanPaa(KANAL_NAVN[ny.kanal]);
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.inviterede(p.navn, husstandTekst().rolleOrd[p.rolle], hvordan).slice(0, 300), zone: 'privat', ejer: af.id });
  notify(deps);
  return deps.runs.local('inviter', async () => ({ ...(await faerdig(deps, T.ud.inviteret(p.navn))), url: '/rum/husstand' }));
}

/** The owner gives another person a role (stored on the person in husstand.json, KC-0148); a line to each of them. */
async function rolle(deps: RoomDeps, body: Record<string, unknown>): Promise<RunRecord> {
  const af = deps.person;
  const id = str(body['id']);
  const ny = body['rolle'];
  if (!erRolle(ny)) throw new ActionError(husstandTekst().fejl.ukendtRolle);
  const gem = gemmer(deps);
  const p = await iKoe(async () => {
    const personer = await deps.husstand!.personer();
    const efter = somAktion(() => skiftRolle(personer, af, id, ny));
    await gem(efter);
    const s = await laesState(deps);
    if (s.medlemmer.some((m) => m.id === id)) await deps.store.writeState(RUM, { ...s, medlemmer: s.medlemmer.map((m) => (m.id === id ? { ...m, rolle: ny } : m)) });
    return efter.find((x) => x.id === id)!;
  });
  const L = husstandTekst().log;
  const rolleNavn = husstandTekst().rolleOrd[ny];
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: L.rolleNu(p.navn, rolleNavn), zone: 'privat', ejer: af.id });
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: L.gjordeDigTil(af.navn, rolleNavn).slice(0, 300), zone: 'privat', ejer: p.id });
  notify(deps);
  return deps.runs.local('rolle', () => faerdig(deps, husstandTekst().ud.nuEr(p.navn, rolleNavn)));
}

/**
 * The owner removes another person (verb slet: the red yes). Her entry ends with her line in husstand.json, and her
 * channel with her extras (a message from her handle is then a stranger's, ignored). Shared history stays: requests
 * and log lines are not touched; only her own booking drafts go.
 */
async function fjernMedlem(deps: RoomDeps, body: Record<string, unknown>): Promise<RunRecord> {
  const af = deps.person;
  const id = str(body['id']);
  const gem = gemmer(deps);
  const p = await iKoe(async () => {
    const personer = await deps.husstand!.personer();
    const efter = somAktion(() => fjernPerson(personer, af, id));
    const s = await laesState(deps);
    await deps.store.writeState(RUM, { ...s, medlemmer: s.medlemmer.filter((m) => m.id !== id), udkast: s.udkast.filter((u) => u.af !== id) });
    await gem(efter);
    return personer.find((x) => x.id === id)!;
  });
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: husstandTekst().log.fjernedeDu(p.navn).slice(0, 300), zone: 'privat', ejer: af.id });
  notify(deps);
  return deps.runs.local('fjern-medlem', () => faerdig(deps, husstandTekst().ud.erFjernet(p.navn)));
}

/**
 * KC-0184: Clawco Sky's control call (server.ts verifies it; intern.ts is the pure change): an accepted invitation
 * pre-creates the member (her own entry waits for her first visit, as the owner's own invite does), a removal or her
 * leaving takes her line and her extras out (shared history stays, as fjernMedlem), a role change is stored. Inside
 * the room's queue; a line to each owner. Not a person's request: nothing here reads deps.person.
 */
export async function internMedlem(deps: RoomDeps, op: InternOp): Promise<{ aendret: boolean }> {
  const gem = gemmer(deps);
  const r = await iKoe(async () => {
    const personer = await deps.husstand!.personer();
    const r = somAktion(() => anvendIntern(personer, op));
    if (!r.aendret || !r.person) return r;
    const p = r.person;
    const s = await laesState(deps);
    const medlemmer = op.op === 'tilfoej'
      ? [...s.medlemmer.filter((m) => m.id !== p.id), nytMedlem(p, { slags: 'egen', navn: p.navn, rolle: p.rolle, login: op.email }, deps.now())]
      : op.op === 'fjern' ? s.medlemmer.filter((m) => m.id !== p.id) : s.medlemmer.map((m) => (m.id === p.id ? { ...m, rolle: p.rolle } : m));
    await deps.store.writeState(RUM, { ...s, medlemmer, ...(op.op === 'fjern' ? { udkast: s.udkast.filter((u) => u.af !== p.id) } : {}) });
    await gem(r.personer);
    return r;
  });
  if (!r.aendret || !r.person) return { aendret: false };
  const p = r.person;
  const L = husstandTekst().log;
  const linje = op.op === 'tilfoej' ? L.internTogImod(p.navn, husstandTekst().rolleOrd[p.rolle])
    : op.op === 'fjern' ? L.internForlod(p.navn)
      : L.rolleNu(p.navn, husstandTekst().rolleOrd[p.rolle]);
  for (const ejer of r.personer.filter((x) => x.rolle === 'ejer')) {
    await deps.store.appendLog(RUM, { kilde: 'system', tekst: linje.slice(0, 300), zone: 'privat', ejer: ejer.id });
  }
  notify(deps);
  return { aendret: true };
}

/** What the owner's red Send would send to member `id` now, and its yes id (invitation.ts vurderInvitation). Throws ActionError. */
export async function invitationKlar(deps: RoomDeps, id: string): Promise<{ tekst: string; jaId: string }> {
  const h = await forAktion(deps);
  const v = vurderInvitation(h.medlemmer, id, deps.person);
  if (!v.ok) throw new ActionError(v.hvorfor, v.status);
  return { tekst: v.tekst, jaId: v.jaId };
}

/**
 * The owner's tap sends the invitation (server.ts calls it only inside the policy layer, after a one-time yes for
 * exactly this text — kanalSend's mechanism). In the store's queue: checked again, sent once, `inviteret` recorded, so
 * a second tap finds it sent (409) and her replies are read from then on. A channel failure records nothing.
 */
export async function invitationSend(deps: RoomDeps, kanal: KanalClient, id: string, tekst: string): Promise<RunRecord> {
  await forAktion(deps);
  const v = await iKoe(async () => {
    const s = await laesState(deps);
    const v = vurderInvitation(medlemmerAf(await deps.husstand!.personer(), s.medlemmer), id, deps.person);
    if (!v.ok) throw new ActionError(v.hvorfor, v.status);
    if (v.tekst !== tekst) throw new ActionError(husstandTekst().fejl.beskedAendret, 409);
    await kanal.send(v.til, v.tekst);
    const tid = deps.now().toISOString();
    await deps.store.writeState(RUM, { ...s, medlemmer: s.medlemmer.map((m) => (m.id === id && m.kanal ? { ...m, kanal: { ...m.kanal, inviteret: tid } } : m)) });
    return v;
  });
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: husstandTekst().log.sendteInvitation(v.navn, v.kanalNavn).slice(0, 300), zone: 'privat', ejer: deps.person.id });
  notify(deps);
  return deps.runs.local('invitation-send', () => faerdig(deps, husstandTekst().ud.invitationSendt(v.navn, v.kanalNavn)));
}

/**
 * A person's request reached the app (the identity middleware calls this after resolving her): a waiting own entry
 * becomes active, once, with a line to the owner. Nothing else changes, and nothing is sent.
 */
export async function vedBesoeg(deps: RoomDeps): Promise<void> {
  const id = deps.person.id;
  if ((await laesState(deps)).medlemmer.find((m) => m.id === id)?.indgang?.status !== 'venter') return;
  const m = await iKoe(async () => {
    const s = await laesState(deps);
    const foer = s.medlemmer.find((x) => x.id === id);
    const efter = foer ? aktiverIndgang(foer, deps.now()) : null;
    if (!efter) return null; // another request got there first
    await deps.store.writeState(RUM, { ...s, medlemmer: s.medlemmer.map((x) => (x.id === id ? efter : x)) });
    return efter;
  });
  if (!m) return;
  for (const p of (deps.husstand ? await deps.husstand.personer() : []).filter((x) => maaSe(x, { slags: 'invitation' }))) {
    await deps.store.appendLog(RUM, { kilde: 'system', tekst: husstandTekst().log.kommetInd(m.navn).slice(0, 300), zone: 'privat', ejer: p.id });
  }
  notify(deps);
}

/** The invite page (/rum/husstand/inviter): the owner's only, also before there is a household (that is how one starts). */
export async function inviterView(deps: RoomDeps): Promise<RoomView> {
  if (!maaHandle(deps.person, { slags: 'inviter' })) {
    const T = husstandTekst();
    return { main: html`<header class="room-head"><div><a class="muted" href="/rum/hjem">${T.tilNu}</a><h1>${T.kunEjerenInviterer}</h1><p class="muted">${T.bedEjeren}</p></div></header>`, hermesStatus: tekst().klar, titel: T.kunEjerenInviterer, status: 403 };
  }
  const personer = deps.husstand ? await deps.husstand.personer() : [];
  return { main: renderInviter({ enebruger: personer.length === 0, plads: personer.length < MAX_PERSONER }), hermesStatus: tekst().klar, titel: husstandTekst().inviterEnTilHusstanden };
}

// ---------- KC-0150: the resource ----------

/** What a resource step booked and released; `loest`: the clash it settled (a line to each party). */
type Bookinger = { state: HusstandState; booket: Booking[]; fjernet: Booking[]; loest?: { s: Sammenfald; valgId: string }; flyttet?: Record<string, string> };

const MAX_SAMMENFALD = 50;
const nyBookingId = (): string => `b-${randomUUID().slice(0, 8)}`;
const bookingMarkoer = (id: string): string => `lokal:${JSON.stringify({ booking: id })}`;
/** The booking a log line's Fortryd removes; null for any other line. */
export function bookingFraMarkoer(fortryd: string | undefined): string | null {
  return /^lokal:\{"booking":"([a-z0-9][a-z0-9-]{0,39})"\}$/.exec(fortryd ?? '')?.[1] ?? null;
}
// KC-0151: a booking that an accepted swap moved to another car goes back to where it was; a car that was just added goes again.
const flytMarkoer = (id: string, fra: string): string => `lokal:${JSON.stringify({ flyt: id, fra })}`;
const bilMarkoer = (id: string): string => `lokal:${JSON.stringify({ ressource: id })}`;
/** The booking and the car a "moved" line's Fortryd puts it back on; null for any other line. */
export function flytFraMarkoer(fortryd: string | undefined): { id: string; fra: string } | null {
  const m = /^lokal:\{"flyt":"([a-z0-9][a-z0-9-]{0,39})","fra":"([a-z0-9][a-z0-9-]{0,39})"\}$/.exec(fortryd ?? '');
  return m ? { id: m[1]!, fra: m[2]! } : null;
}
/** The car an "added car" line's Fortryd removes; null for any other line. */
export function bilFraMarkoer(fortryd: string | undefined): string | null {
  return /^lokal:\{"ressource":"([a-z0-9][a-z0-9-]{0,39})"\}$/.exec(fortryd ?? '')?.[1] ?? null;
}
/** Whether a moved booking fits back where it came from: the booking is the person's, on another car, and its old slot is free there. */
function kanFlyttesTilbage(ressourcer: readonly Ressource[], f: { id: string; fra: string }, person: PersonId): boolean {
  const nu = ressourcer.find((r) => r.kalender.some((b) => b.id === f.id && b.af === person));
  const b = nu?.kalender.find((x) => x.id === f.id);
  const fra = ressourcer.find((r) => r.id === f.fra);
  return !!nu && !!b && nu.id !== f.fra && !!fra && overlappende(b, fra.kalender).length === 0;
}
/** Fortryd on a line of the person's own: a booking still in the calendar, a moved booking that fits back, or an added car that is still empty. */
function bookingLinjeKanFortrydes(e: LogEntry, ressourcer: readonly Ressource[], person: PersonId): boolean {
  if (e.fortrudt || e.ejer !== person) return false;
  const id = bookingFraMarkoer(e.fortryd);
  if (id !== null) return ressourcer.some((r) => r.kalender.some((b) => b.id === id && b.af === person));
  const flyt = flytFraMarkoer(e.fortryd);
  if (flyt) return kanFlyttesTilbage(ressourcer, flyt, person);
  const bil = bilFraMarkoer(e.fortryd);
  return bil !== null && ressourcer.some((r) => r.id === bil && r.kalender.length === 0);
}
/** Which of the booked bookings sat on another car before (booking id → the car it left). */
function flyttedeAf(foer: readonly Ressource[], booket: readonly Booking[]): Record<string, string> {
  const ud: Record<string, string> = {};
  for (const x of booket) {
    const r = foer.find((y) => y.kalender.some((b) => b.id === x.id));
    if (r && r.id !== x.ressourceId) ud[x.id] = r.id;
  }
  return ud;
}
// The time and the thing in a sentence, in the language being served (KC-0170): the Nu lines, the log lines and the titles
// of the requests the room makes all read them from here ("lørdag 7. nov kl. 09.00–13.00" / "Saturday 7 Nov at 09:00–13:00").
const tidKort = (t: Tidsrum, now: Date): string => { const T = husstandTekst(); return T.tidsrum(T.midt(datoVis(idagKbh(new Date(t.start)), now)), klokkeVis(t.start), klokkeVis(t.slut)); };
/** The same inside a sentence ("on Saturday 7 Nov at 09:00–13:00"; Danish needs no "on"): the log lines and the request titles. */
const tidSaetning = (t: Tidsrum, now: Date): string => husstandTekst().paa(tidKort(t, now));
const rNavnAf = (ressourcer: readonly Ressource[], id: string): string => ressourcer.find((r) => r.id === id)?.navn ?? husstandTekst().ukendtTing;
const ren = (v: unknown): string => str(v).replace(/[\u0000-\u001f\u007f]/g, ' ');

/** One line per booking to its booker (with Fortryd), one per released booking, and one per party for a settled clash. */
async function logBookinger(deps: RoomDeps, b: Bookinger, medlemmer: readonly Medlem[]): Promise<void> {
  const now = deps.now();
  const T = husstandTekst();
  const r = b.state.ressourcer;
  for (const x of b.booket) {
    const fra = b.flyttet?.[x.id];
    if (fra) {
      await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.bookingFlyttet(T.iSaet(rNavnAf(r, x.ressourceId)), tidSaetning(x, now), x.titel).slice(0, 300), zone: 'privat', ejer: x.af, fortryd: flytMarkoer(x.id, fra) });
      continue;
    }
    await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.booket(rNavnAf(r, x.ressourceId), tidSaetning(x, now), x.titel).slice(0, 300), zone: 'privat', ejer: x.af, fortryd: bookingMarkoer(x.id) });
  }
  for (const x of b.fjernet) {
    await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.gavSlip(T.iSaet(rNavnAf(r, x.ressourceId)), tidSaetning(x, now), x.titel).slice(0, 300), zone: 'privat', ejer: x.af });
  }
  if (b.loest) {
    const { s, valgId } = b.loest;
    const valg = s.valg.find((v) => v.id === valgId);
    for (const p of parterI(s)) {
      const navn = (id: string): string => (id === p ? T.duSmaa : navnAf(medlemmer, id));
      const tekst = valg ? valgNeutralt(s, valg, navn, r, T) : T.log.loestUdenValg;
      await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.sammenfaldLoest(T.iSaet(rNavnAf(r, s.ressourceId)), tekst).slice(0, 300), zone: 'privat', ejer: p });
    }
  }
}

/** A yes to a resource request: a request sent from a clash card applies its option for the acceptor; any other books the asker. */
function bookVedJa(s: HusstandState, f: Forespoergsel, person: PersonId, now: Date): Bookinger | ActionError {
  const sf = s.sammenfald.find((x) => x.forespId === f.id);
  if (sf) {
    if (!aabenSammenfald(sf, now)) return new ActionError(husstandTekst().fejl.dobbeltLoest, 409);
    const valg = sf.valg.find((v) => v.id === sf.forespValg);
    if (!valg || valg.hvem !== person) return new ActionError(husstandTekst().fejl.valgIkkeDit, 403);
    const l = loesSammenfald(s.ressourcer, sf, valg.id, nyBookingId(), { foresporgselId: f.id });
    if (!l.ok) return new ActionError(l.hvorfor, 409);
    const afgjort: Sammenfald = { ...sf, afgjort: { valg: valg.id, af: person, tid: now.toISOString() } };
    return { state: { ...s, ressourcer: l.ressourcer, sammenfald: s.sammenfald.map((x) => (x.id === sf.id ? afgjort : x)) }, booket: l.booket, fjernet: l.fjernet, loest: { s: afgjort, valgId: valg.id }, flyttet: flyttedeAf(s.ressourcer, l.booket) };
  }
  const t = aftaleTid(f);
  if (!t || !f.ressourceId) return new ActionError(husstandTekst().fejl.intetTidspunktBooke, 409);
  const b: Booking = { id: nyBookingId(), ressourceId: f.ressourceId, af: f.fra, start: t.start, slut: t.slut, titel: f.titel.replace(LAAN, '').slice(0, 200) || f.titel, foresporgselId: f.id };
  const i = indsaet(s.ressourcer, b);
  if (!i.ok) return new ActionError(i.hvorfor, 409);
  return { state: { ...s, ressourcer: i.ressourcer }, booket: [b], fjernet: [] };
}

/**
 * A non-owner's request: "Må jeg låne den lille bil? Spejder" / "May I borrow the little car? Scouts" — the booking keeps
 * only "Spejder". The stored title is in the language of the request that made it, so both openings are recognised
 * whichever language the install speaks now.
 */
const LAAN = /^(?:Må jeg låne|May I borrow) [^?]{1,80}\? /;
const laaneTitel = (r: Ressource, titel: string): string => husstandTekst().laaneTitel(husstandTekst().iSaet(r.navn), titel).slice(0, 200);

/** The booking asked for: the resource, a day with from and to in the future, a title. Throws ActionError. */
function bookingInput(s: HusstandState, body: Record<string, unknown>, now: Date): { r: Ressource; tid: Tidsrum; titel: string } {
  const r = s.ressourcer.find((x) => x.id === str(body['ressourceId']));
  if (!r) throw new ActionError(husstandTekst().fejl.tingFindesIkke, 404);
  const tid = tidFra(body, now);
  if (!tid) throw new ActionError(husstandTekst().fejl.vaelgDagFraTil);
  const titel = ren(body['titel']);
  if (!titel || titel.length > 200) throw new ActionError(husstandTekst().fejl.skrivBrug);
  return { r, tid, titel };
}

/** Settled or ended clashes go when room is needed; still full = refused (nothing open is ever dropped). */
function medPladsSammenfald(liste: readonly Sammenfald[], now: Date): Sammenfald[] {
  if (liste.length < MAX_SAMMENFALD) return [...liste];
  const aabne = liste.filter((x) => aabenSammenfald(x, now));
  if (aabne.length >= MAX_SAMMENFALD) throw new ActionError(husstandTekst().fejl.forMangeSammenfald, 409);
  return aabne;
}

/** An open clash the person is a party to, from the stored state. Throws ActionError (404 · 403 · 409). */
function findSammenfald(s: HusstandState, id: string, person: PersonId, now: Date): Sammenfald {
  const sf = s.sammenfald.find((x) => x.id === id);
  if (!sf) throw new ActionError(husstandTekst().fejl.sammenfald404, 404);
  if (!erPartI(sf, person)) throw new ActionError(husstandTekst().fejl.sammenfaldIkkeDin, 403);
  if (!aabenSammenfald(sf, now)) throw new ActionError(husstandTekst().fejl.alleredeAfgjort, 409);
  return sf;
}

/** What the request from a clash card asks the other person, from the asker's side. */
function spoergTitel(sf: Sammenfald, valg: Valg, ressourcer: readonly Ressource[], now: Date): string {
  const T = husstandTekst();
  const r = T.iSaet(rNavnAf(ressourcer, sf.ressourceId));
  const tid = tidSaetning(sf.ny, now);
  const holder = valg.hvem === sf.mod.af;
  if (valg.slags === 'anden') return T.spoergTitelAnden(holder, T.iSaet(rNavnAf(ressourcer, valg.ressourceId)), r, tid).slice(0, 200);
  return T.spoergTitelAfgiv(holder, r, tid, holder ? sf.ny.titel : sf.mod.titel).slice(0, 200);
}

/** Hermes orders a clash's options (lille tier) — advice beside the clash; a bad answer writes nothing. */
function startSammenfaldForslag(deps: RoomDeps, sf: Sammenfald, medlemmer: readonly Medlem[], ressourcer: readonly Ressource[]): RunRecord | null {
  const r = ressourcer.find((x) => x.id === sf.ressourceId);
  if (!r) return null;
  try {
    return deps.runs.start({
      kind: 'sammenfald',
      tier: 'lille',
      spec: buildSammenfaldForslagRun(sf, r, medlemmer, ressourcer),
      onDone: async (output) => {
        const forslag = parseSammenfaldForslag(output, sf);
        if (forslag) {
          await endre(deps, (s) => {
            const x = s.sammenfald.find((y) => y.id === sf.id);
            if (!x || !aabenSammenfald(x, deps.now())) return { ud: null };
            return { state: { ...s, sammenfald: s.sammenfald.map((y) => (y.id === sf.id ? { ...y, forslag } : y)) }, ud: null };
          });
          notify(deps);
        }
        return { text: husstandTekst().ud.hermesLoesning };
      },
    });
  } catch (err) {
    console.error('husstand: forslag til dobbeltbooking kunne ikke startes:', err instanceof Error ? err.message : err);
    return null;
  }
}

const MAX_UDKAST_PR_PERSON = 10;
const MAX_UDKAST = 50;
const nytUdkastId = (): string => `u-${randomUUID().slice(0, 8)}`;

/** Open drafts only; the same wish by the same person replaces the older card, and the oldest goes when a person or the room is full. */
function medUdkast(s: HusstandState, ny: BookingUdkast, now: Date): HusstandState {
  let liste = s.udkast.filter((u) => udkastAabent(u, now) && !(u.af === ny.af && u.ressourceId === ny.ressourceId && u.start === ny.start && u.slut === ny.slut));
  const aeldst = (xs: readonly BookingUdkast[]): BookingUdkast | undefined => [...xs].sort((a, b) => Date.parse(a.oprettet) - Date.parse(b.oprettet))[0];
  const egne = liste.filter((u) => u.af === ny.af);
  if (egne.length >= MAX_UDKAST_PR_PERSON) liste = liste.filter((u) => u !== aeldst(egne));
  if (liste.length >= MAX_UDKAST) liste = liste.filter((u) => u !== aeldst(liste));
  return { ...s, udkast: [...liste, ny] };
}

/** The request of a booking: the thing, a time, a title. */
type BookInput = { r: Ressource; tid: Tidsrum; titel: string };

/** What booking (or asking for one) led to. */
type BookUd =
  | { slags: 'booket'; b: Bookinger; navn: string }
  | { slags: 'sammenfald'; sf: Sammenfald; ressourcer: Ressource[]; navn: string; holder: string }
  | { slags: 'udkast'; u: BookingUdkast };

/**
 * The one place a booking is tried (KC-0150, KC-0151), in the write queue: free = booked (with Fortryd; mode 'udkast' keeps
 * it as a card instead, so a sentence never books); one other person's booking in the way = one clash card for the two;
 * anything else is a plain refusal. `udkastId` is a card the person taps: it is read and removed in the same step.
 */
async function bookKerne(deps: RoomDeps, h: { medlemmer: Medlem[] }, inp: BookInput | { udkastId: string }, mode: 'book' | 'udkast'): Promise<BookUd> {
  const now = deps.now();
  const person = deps.person.id;
  const ud = await endre<Exclude<BookUd, { slags: 'booket' }> | { slags: 'booket'; state: HusstandState; ny: Booking; navn: string }>(deps, (s0) => {
    let b: BookInput;
    let s = s0;
    if ('udkastId' in inp) {
      const u = s0.udkast.find((x) => x.id === inp.udkastId && x.af === person);
      if (!u) throw new ActionError(husstandTekst().fejl.kort404, 404);
      if (!udkastAabent(u, now)) throw new ActionError(husstandTekst().fejl.kortUdloebet, 409);
      const r = s0.ressourcer.find((x) => x.id === u.ressourceId);
      if (!r) throw new ActionError(husstandTekst().fejl.tingFindesIkke, 404);
      b = { r, tid: { start: u.start, slut: u.slut }, titel: u.titel };
      s = { ...s0, udkast: s0.udkast.filter((x) => x.id !== u.id) };
    } else b = inp;
    const rr = s.ressourcer.find((x) => x.id === b.r.id);
    if (!rr) throw new ActionError(husstandTekst().fejl.tingFindesIkke, 404);
    const ny: Booking = { id: nyBookingId(), ressourceId: rr.id, af: person, start: b.tid.start, slut: b.tid.slut, titel: b.titel };
    const mod = overlappende(ny, rr.kalender);
    if (!erEjer(rr, person)) {
      if (mode === 'book') throw new ActionError(husstandTekst().fejl.ikkeEjer(husstandTekst().iSaet(rr.navn)), 403);
      if (mod.length) throw new ActionError(husstandTekst().fejl.optaget(rr.navn), 409);
      const u: BookingUdkast = { id: nytUdkastId(), af: person, ressourceId: rr.id, start: ny.start, slut: ny.slut, titel: ny.titel, oprettet: now.toISOString() };
      return { state: medUdkast(s, u, now), ud: { slags: 'udkast', u } };
    }
    if (!mod.length) {
      if (mode === 'udkast') {
        const u: BookingUdkast = { id: nytUdkastId(), af: person, ressourceId: rr.id, start: ny.start, slut: ny.slut, titel: ny.titel, oprettet: now.toISOString() };
        return { state: medUdkast(s, u, now), ud: { slags: 'udkast', u } };
      }
      const i = indsaet(s.ressourcer, ny);
      if (!i.ok) throw new ActionError(i.hvorfor, 409);
      return { state: { ...s, ressourcer: i.ressourcer }, ud: { slags: 'booket', state: { ...s, ressourcer: i.ressourcer }, ny, navn: rr.navn } };
    }
    if (mod.some((m) => m.af === person)) throw new ActionError(husstandTekst().fejl.harAllerede(husstandTekst().iSaet(rr.navn)), 409);
    if (mod.length > 1) throw new ActionError(husstandTekst().fejl.flereGange(rr.navn), 409);
    if (s.sammenfald.some((x) => aabenSammenfald(x, now) && x.ny.af === person && x.mod.id === mod[0]!.id && overlapper(x.ny, ny))) throw new ActionError(husstandTekst().fejl.alleredeKort, 409);
    const sf = nySammenfald({ id: `s-${randomUUID().slice(0, 8)}`, ny, mod: mod[0]!, ressourcer: s.ressourcer, nu: now });
    return { state: { ...s, sammenfald: [...medPladsSammenfald(s.sammenfald, now), sf] }, ud: { slags: 'sammenfald', sf, ressourcer: s.ressourcer, navn: rr.navn, holder: navnAf(h.medlemmer, sf.mod.af) } };
  });
  if (ud.slags === 'booket') {
    const b: Bookinger = { state: ud.state, booket: [ud.ny], fjernet: [] };
    await logBookinger(deps, b, h.medlemmer);
    notify(deps);
    return { slags: 'booket', b, navn: ud.navn };
  }
  if (ud.slags === 'sammenfald') {
    const L = husstandTekst().log;
    for (const p of parterI(ud.sf)) {
      const linje = p === person ? L.optagetAfDig(ud.navn, ud.holder, tidSaetning(ud.sf.mod, now)) : L.villeOgsaa(navnAf(h.medlemmer, person), husstandTekst().iSaet(ud.navn), tidSaetning(ud.sf.ny, now));
      await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: linje.slice(0, 300), zone: 'privat', ejer: p });
    }
  }
  notify(deps);
  return ud;
}

/** An owner books: free = booked (with Fortryd); one other person's booking in the way = one clash card for the two. `udkastId`: a tap on a card (KC-0151). */
async function book(deps: RoomDeps, h: { medlemmer: Medlem[]; state: HusstandState }, body: Record<string, unknown>, udkastId?: string): Promise<RunRecord> {
  const ud = await bookKerne(deps, h, udkastId ? { udkastId } : bookingInput(h.state, body, deps.now()), 'book');
  if (ud.slags === 'booket') return deps.runs.local('book', () => faerdig(deps, husstandTekst().ud.booket(ud.navn)));
  if (ud.slags === 'sammenfald') {
    return deps.runs.local('book', async () => {
      const run = startSammenfaldForslag(deps, ud.sf, h.medlemmer, ud.ressourcer);
      if (run) await run.finished;
      return faerdig(deps, husstandTekst().ud.optagetKort(ud.navn, ud.holder));
    });
  }
  throw new ActionError(husstandTekst().fejl.kortKunneIkke, 409);
}

/** A non-owner asks the first owner for the slot (a request, red); `udkastId` is the card it came from, taken away in the same step. */
async function bookSpoerg(deps: RoomDeps, h: { medlemmer: Medlem[]; state: HusstandState }, inp: BookInput, udkastId?: string): Promise<RunRecord> {
  const person = deps.person.id;
  const { r, tid, titel } = inp;
  if (erEjer(r, person)) throw new ActionError(husstandTekst().fejl.ejerBookDirekte);
  const ejer = ejerAtSpoerge(r, person, h.medlemmer);
  if (!ejer) throw new ActionError(husstandTekst().fejl.ingenEjerAtSpoerge(husstandTekst().iSaet(r.navn)), 409);
  if (overlappende({ id: '', ...tid }, r.kalender).length) throw new ActionError(husstandTekst().fejl.optaget(r.navn), 409);
  return opretOgSpoerg(deps, h, { til: ejer.id, titel: laaneTitel(r, titel), tid, ressourceId: r.id }, udkastId ? (s) => {
    if (!s.udkast.some((x) => x.id === udkastId && x.af === person)) throw new ActionError(husstandTekst().fejl.kort404, 404);
    return { ...s, udkast: s.udkast.filter((x) => x.id !== udkastId) };
  } : undefined);
}

/** The person's own open card, from the stored state. Throws ActionError (404 · 409). */
function findUdkast(s: HusstandState, id: string, person: PersonId, now: Date): { u: BookingUdkast; r: Ressource } {
  const u = s.udkast.find((x) => x.id === id && x.af === person);
  if (!u) throw new ActionError(husstandTekst().fejl.kort404, 404);
  if (!udkastAabent(u, now)) throw new ActionError(husstandTekst().fejl.kortUdloebet, 409);
  const r = s.ressourcer.find((x) => x.id === u.ressourceId);
  if (!r) throw new ActionError(husstandTekst().fejl.tingFindesIkke, 404);
  return { u, r };
}

/** A chat answer's booking block → at most one card for the person (never a booking); the note says why there is none, else null. */
async function bookingKort(deps: RoomDeps, h: { medlemmer: Medlem[] }, oensk: BookingOensker): Promise<string | null> {
  const nej = (hvorfor: string): string => husstandTekst().ud.ikkeKort(hvorfor);
  const v = valider(oensk, (await laesState(deps)).ressourcer, deps.now());
  if (!v.ok) return nej(v.hvorfor);
  try {
    const ud = await bookKerne(deps, h, { r: v.r, tid: v.tid, titel: v.titel }, 'udkast');
    if (ud.slags === 'sammenfald') void startSammenfaldForslag(deps, ud.sf, h.medlemmer, ud.ressourcer);
    return null;
  } catch (err) {
    if (err instanceof ActionError) return nej(err.message);
    throw err;
  }
}

const MAX_RESSOURCER = 50;

/** The owner checkboxes `ejer-<id>` of a form: household members who are not guests (a stranger or a guest is never an owner). */
function ejereFraBody(medlemmer: readonly Medlem[], body: Record<string, unknown>): PersonId[] {
  const valgt = (id: string): boolean => { const v = body[`ejer-${id}`]; return v !== undefined && v !== null && v !== false && v !== '' && v !== 'off' && v !== 'false'; };
  const ejere = medlemmer.filter((m) => m.rolle !== 'gaest' && valgt(m.id)).map((m) => m.id);
  if (!ejere.length) throw new ActionError(husstandTekst().fejl.vaelgEjer);
  return ejere;
}
const navnFraBody = (body: Record<string, unknown>): string => {
  const navn = ren(body['navn']).replace(/ {2,}/g, ' ').trim();
  if (!navn || navn.length > 80) throw new ActionError(husstandTekst().fejl.skrivNavn);
  return navn;
};
/** A kind from a form: empty = bil; only the kinds a person can create (KC-0215). */
function opretSlagsFraBody(v: unknown): OpretSlags {
  if (v === undefined || v === null || v === '') return 'bil';
  if (typeof v === 'string' && (OPRET_SLAGS as readonly string[]).includes(v)) return v as OpretSlags;
  throw new ActionError(husstandTekst().fejl.vaelgSlags);
}
const ordListe = (navne: string[]): string => (navne.length <= 1 ? (navne[0] ?? '') : `${navne.slice(0, -1).join(', ')} ${husstandTekst().og} ${navne.at(-1)}`);
/** A line to every owner of the circle except the actor (zone privat, each as their own). */
async function logTilEjere(deps: RoomDeps, ejere: readonly PersonId[], medlemmer: readonly Medlem[], tekst: string): Promise<void> {
  for (const e of new Set(ejere)) {
    if (e === deps.person.id || !medlemmer.some((m) => m.id === e)) continue;
    await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: tekst.slice(0, 300), zone: 'privat', ejer: e });
  }
}
const erVoksen = (m: Medlem | undefined): m is Medlem => !!m && (m.rolle === 'ejer' || m.rolle === 'medlem');

/** "Tilføj ting" (KC-0151 "Tilføj bil", KC-0215 with a kind): a member who is not a child names it, picks bil, rum or ting, and its owners. */
async function tilfoejRessource(deps: RoomDeps, h: { medlemmer: Medlem[] }, body: Record<string, unknown>): Promise<RunRecord> {
  const person = deps.person.id;
  if (!erVoksen(h.medlemmer.find((m) => m.id === person))) throw new ActionError(husstandTekst().fejl.kunVoksne, 403);
  const navn = navnFraBody(body);
  const slags = opretSlagsFraBody(body['slags']);
  const ejere = ejereFraBody(h.medlemmer, body);
  const r = await endre<Ressource>(deps, (s) => {
    if (s.ressourcer.length >= MAX_RESSOURCER) throw new ActionError(husstandTekst().fejl.forMangeTing, 409);
    if (s.ressourcer.some((x) => x.navn.toLowerCase() === navn.toLowerCase())) throw new ActionError(husstandTekst().fejl.navnFindes, 409);
    const grund = slug(navn, 'bil');
    let id = grund;
    for (let i = 2; s.ressourcer.some((x) => x.id === id); i++) id = `${grund.slice(0, 36)}-${i}`;
    const ny: Ressource = { id, navn, slags, ejere, kalender: [] };
    return { state: { ...s, ressourcer: [...s.ressourcer, ny] }, ud: ny };
  });
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: husstandTekst().log.tilfoejede(husstandTekst().slagsOrd[r.slags], r.navn).slice(0, 300), zone: 'privat', ejer: person, fortryd: bilMarkoer(r.id) });
  notify(deps);
  return deps.runs.local('tilfoej-ressource', () => faerdig(deps, husstandTekst().ud.tilfoejet(r.navn)));
}

/** "Ret": name, kind and owners of a resource, by an owner of it (or the household's owner). Bookings stay as they are. */
async function retRessource(deps: RoomDeps, h: { medlemmer: Medlem[] }, body: Record<string, unknown>): Promise<RunRecord> {
  const person = deps.person.id;
  const mig = h.medlemmer.find((m) => m.id === person);
  const id = str(body['ressourceId']);
  const navn = navnFraBody(body);
  const ejere = ejereFraBody(h.medlemmer, body);
  const ud = await endre<{ foer: Ressource; nu: Ressource } | null>(deps, (s) => {
    const foer = s.ressourcer.find((x) => x.id === id);
    if (!foer) throw new ActionError(husstandTekst().fejl.tingFindesIkke, 404);
    if (!mig || !maaRetteRessource(foer, mig)) throw new ActionError(husstandTekst().fejl.kunEjerRette, 403);
    // A person-resource keeps its kind (it stands for a member); the others choose among the kinds of the list.
    const oenskes = body['slags'];
    const uaendret = oenskes === undefined || oenskes === null || oenskes === '';
    let slags: Slags = foer.slags;
    if (foer.slags === 'person') { if (!uaendret && oenskes !== 'person') throw new ActionError(husstandTekst().fejl.personBlivTing); }
    else if (!uaendret) slags = opretSlagsFraBody(oenskes);
    if (s.ressourcer.some((x) => x.id !== foer.id && x.navn.toLowerCase() === navn.toLowerCase())) throw new ActionError(husstandTekst().fejl.navnFindes, 409);
    const nu: Ressource = { ...foer, navn, slags, ejere };
    // Nobody keeps an open "Tag <denne ting>" option after they stopped owning it: they would book what is not theirs.
    for (const fjernet of foer.ejere.filter((e) => !ejere.includes(e))) {
      if (s.sammenfald.some((x) => aabenSammenfald(x, deps.now()) && x.valg.some((v) => v.slags === 'anden' && v.hvem === fjernet && v.ressourceId === foer.id))) {
        throw new ActionError(husstandTekst().fejl.aabentKortValg(navnAf(h.medlemmer, fjernet), husstandTekst().iSaet(foer.navn)), 409);
      }
    }
    if (nu.navn === foer.navn && nu.slags === foer.slags && nu.ejere.length === foer.ejere.length && nu.ejere.every((e, i) => e === foer.ejere[i])) return { ud: null };
    return { state: { ...s, ressourcer: s.ressourcer.map((x) => (x.id === foer.id ? nu : x)) }, ud: { foer, nu } };
  });
  if (!ud) return deps.runs.local('ret-ressource', () => faerdig(deps, husstandTekst().ud.ingenAendringer));
  const { foer, nu } = ud;
  const T = husstandTekst();
  const aendret = [
    ...(nu.navn !== foer.navn ? [T.log.hedFoer(foer.navn)] : []),
    ...(nu.slags !== foer.slags ? [T.log.erNuSlags(T.slagsOrd[nu.slags])] : []),
    ...(nu.ejere.join() !== foer.ejere.join() ? [T.log.ejereListe(ordListe(nu.ejere.map((e) => navnAf(h.medlemmer, e))))] : []),
  ].join(', ');
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.rettedeDu(nu.navn, aendret).slice(0, 300), zone: 'privat', ejer: person });
  await logTilEjere(deps, [...foer.ejere, ...nu.ejere], h.medlemmer, T.log.rettedeAndre(navnAf(h.medlemmer, person), nu.navn, aendret));
  notify(deps);
  return deps.runs.local('ret-ressource', () => faerdig(deps, husstandTekst().ud.rettet(nu.navn)));
}

/** "Fjern": the thing goes, with the actor's own upcoming bookings; refused while anyone else's booking, an open clash or an open request depends on it. */
async function fjernRessource(deps: RoomDeps, h: { medlemmer: Medlem[] }, body: Record<string, unknown>): Promise<RunRecord> {
  const person = deps.person.id;
  const mig = h.medlemmer.find((m) => m.id === person);
  const id = str(body['ressourceId']);
  const now = deps.now();
  const r = await endre<{ r: Ressource; egne: number; gamle: number }>(deps, (s) => {
    const x = s.ressourcer.find((y) => y.id === id);
    if (!x) throw new ActionError(husstandTekst().fejl.tingFindesIkke, 404);
    if (!mig || !maaRetteRessource(x, mig)) throw new ActionError(husstandTekst().fejl.kunEjerFjerne, 403);
    const hvorfor = hvorforIkkeFjernes(x, { person, nu: now, sammenfald: s.sammenfald, forespoergsler: s.forespoergsler });
    if (hvorfor) throw new ActionError(hvorfor, 409);
    const egne = x.kalender.filter((b) => Date.parse(b.slut) > now.getTime()).length;
    return { state: { ...s, ressourcer: s.ressourcer.filter((y) => y.id !== id), udkast: s.udkast.filter((u) => u.ressourceId !== id) }, ud: { r: x, egne, gamle: x.kalender.length - egne } };
  });
  const T = husstandTekst();
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.fjernedeRessource(r.r.navn, T.slagsBare[r.r.slags], T.log.bookingerMed(r.egne, r.gamle)).slice(0, 300), zone: 'privat', ejer: person });
  await logTilEjere(deps, r.r.ejere, h.medlemmer, T.log.fjernedeAndres(navnAf(h.medlemmer, person), r.r.navn));
  notify(deps);
  return deps.runs.local('fjern-ressource', () => faerdig(deps, T.ud.fjernet(r.r.navn)));
}

/** A party's own option of a clash, applied at once; a request already sent from the card is withdrawn (or, its recipient, a no). */
async function vaelg(deps: RoomDeps, h: { medlemmer: Medlem[] }, id: string, valgId: string): Promise<RunRecord> {
  const now = deps.now();
  const person = deps.person.id;
  const ud = await endre<{ b: Bookinger; lukket: { f: Forespoergsel; slags: Haendelse['slags'] } | null }>(deps, (s) => {
    const sf = findSammenfald(s, id, person, now);
    const valg = sf.valg.find((v) => v.id === valgId);
    if (!valg) throw new ActionError(husstandTekst().fejl.ukendtValg);
    if (valg.hvem !== person) throw new ActionError(husstandTekst().fejl.valgAndens(navnAf(h.medlemmer, valg.hvem)));
    const l = loesSammenfald(s.ressourcer, sf, valg.id, nyBookingId());
    if (!l.ok) throw new ActionError(l.hvorfor, 409);
    const afgjort: Sammenfald = { ...sf, afgjort: { valg: valg.id, af: person, tid: now.toISOString() } };
    let forespoergsler = s.forespoergsler;
    let lukket: { f: Forespoergsel; slags: Haendelse['slags'] } | null = null;
    const f = sf.forespId ? s.forespoergsler.find((x) => x.id === sf.forespId) : undefined;
    if (f && beslutter(f) !== null) {
      const haendelse: Haendelse | null = f.fra === person ? { slags: 'traek', af: person } : beslutter(f) === person ? { slags: 'nej', af: person } : null;
      const u = haendelse ? anvend(f, haendelse, now) : null;
      if (haendelse && u?.ok && u.aendret) { forespoergsler = s.forespoergsler.map((x) => (x.id === f.id ? u.f : x)); lukket = { f: u.f, slags: haendelse.slags }; }
    }
    const state = { ...s, ressourcer: l.ressourcer, sammenfald: s.sammenfald.map((x) => (x.id === sf.id ? afgjort : x)), forespoergsler };
    return { state, ud: { b: { state, booket: l.booket, fjernet: l.fjernet, loest: { s: afgjort, valgId: valg.id }, flyttet: flyttedeAf(s.ressourcer, l.booket) }, lukket } };
  });
  await logBookinger(deps, ud.b, h.medlemmer);
  if (ud.lukket) await logBegge(deps, ud.lukket.f, trinTekst(ud.lukket.f, ud.lukket.slags, person, h.medlemmer));
  notify(deps);
  return deps.runs.local('sammenfald', () => faerdig(deps, husstandTekst().ud.loest));
}

/** The other party's option of a clash: a request to them (red), linked to the card so their yes applies it. */
async function spoergAnden(deps: RoomDeps, h: { medlemmer: Medlem[]; state: HusstandState }, id: string, valgId: string): Promise<RunRecord> {
  const now = deps.now();
  const person = deps.person.id;
  const sf = findSammenfald(h.state, id, person, now);
  const valg = sf.valg.find((v) => v.id === valgId);
  if (!valg) throw new ActionError(husstandTekst().fejl.ukendtValg);
  if (valg.hvem === person) throw new ActionError(husstandTekst().fejl.valgDitEget);
  return opretOgSpoerg(deps, h, { til: valg.hvem, titel: spoergTitel(sf, valg, h.state.ressourcer, now), ressourceId: sf.ressourceId }, (s, ny) => {
    const x = findSammenfald(s, id, person, now);
    const f = x.forespId ? s.forespoergsler.find((y) => y.id === x.forespId) : undefined;
    if (f && beslutter(f) !== null) throw new ActionError(husstandTekst().fejl.alleredeSpurgt(navnAf(h.medlemmer, f.fra === person ? f.til : f.fra)), 409);
    return { ...s, sammenfald: s.sammenfald.map((y) => (y.id === x.id ? { ...y, forespId: ny.id, forespValg: valg.id } : y)) };
  });
}

// ---------- KC-0152: the Saturday conflict ----------

const MAX_KONFLIKTER = 50;
const GEM_KONFLIKTER_MS = 30 * 24 * 3600_000;

/** The coming Saturday and Sunday (Copenhagen dates) from `nu`: the nearest Saturday strictly after today. */
export function kommendeWeekend(nu: Date): [string, string] {
  const lo = ugeDage(nu, 8).slice(1).find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6)!;
  const soen = new Date(`${lo}T12:00:00Z`); soen.setUTCDate(soen.getUTCDate() + 1);
  return [lo, soen.toISOString().slice(0, 10)];
}

/** An open card the person is a party to. Throws ActionError (404 · 403 · 409). */
function findKonflikt(s: HusstandState, id: string, person: PersonId, now: Date): Konflikt {
  const k = s.konflikter.find((x) => x.id === id);
  if (!k) throw new ActionError(husstandTekst().fejl.kort404, 404);
  if (!erPartIKonflikt(k, person)) throw new ActionError(husstandTekst().fejl.kortIkkeDit, 403);
  const status = konfliktStatus(k, s.forespoergsler, now);
  if (status === 'venter') throw new ActionError(husstandTekst().fejl.alleredeSpurgtKort, 409);
  if (status !== 'aaben') throw new ActionError(husstandTekst().fejl.alleredeAfgjort, 409);
  return k;
}

/** A pick on the weekend card: a red request to the other adult (the one request machinery), linked to the card. */
async function konfliktValg(deps: RoomDeps, h: { medlemmer: Medlem[]; state: HusstandState }, id: string, valgId: string): Promise<RunRecord> {
  const now = deps.now();
  const person = deps.person.id;
  const k = findKonflikt(h.state, id, person, now);
  const valg = k.valg.find((v) => v.id === valgId);
  if (!valg) throw new ActionError(husstandTekst().fejl.ukendtValg, 400);
  // A window that has already begun is asked about in words only, so the request does not expire before it is answered.
  const tid = Date.parse(k.tid.start) > now.getTime() ? { start: k.tid.start, slut: k.tid.slut } : undefined;
  return opretOgSpoerg(deps, h, { til: andenIKonflikt(k, person), titel: valgTitel(k, valg, person), tid }, (s, ny) => {
    const x = findKonflikt(s, id, person, now);
    return { ...s, konflikter: s.konflikter.map((y) => (y.id === x.id ? { ...y, forespId: ny.id, forespValg: valg.id } : y)) };
  });
}

/** Hermes phrases a card (taenker tier): the summary and the question only; a bad answer writes nothing. */
function startKonfliktTekst(deps: RoomDeps, k: Konflikt, medlemmer: readonly Medlem[]): RunRecord | null {
  try {
    return deps.runs.start({
      kind: 'konflikt',
      tier: 'taenker',
      spec: buildKonfliktRun(k, medlemmer),
      onDone: async (output) => {
        const tekst = parseKonfliktTekst(output, k, medlemmer);
        if (tekst) {
          await endre(deps, (s) => {
            const x = s.konflikter.find((y) => y.id === k.id);
            if (!x || x.tekst) return { ud: null };
            return { state: { ...s, konflikter: s.konflikter.map((y) => (y.id === k.id ? { ...y, tekst } : y)) }, ud: null };
          });
          notify(deps);
        }
        return { text: husstandTekst().ud.hermesWeekend };
      },
    });
  } catch (err) {
    console.error('husstand: weekendkortet kunne ikke formuleres:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * The Tuesday check (KC-0152), outside any request: reads every connected calendar as busy blocks, finds the weekend's
 * conflicts and makes one card per conflict for exactly the two adults. Once per weekend (`konfliktTjek` remembers the
 * Saturday); with no calendar read at all nothing is marked, so a later tick still looks. Returns what it made.
 */
export async function weekendTjek(deps: RoomDeps): Promise<{ nye: Konflikt[]; runs: RunRecord[] }> {
  const ingen = { nye: [], runs: [] };
  if (!deps.husstand?.alleKalendere) return ingen;
  const now = deps.now();
  const dage = kommendeWeekend(now);
  const foer = await laesState(deps);
  if (foer.konfliktTjek === dage[0]) return ingen;
  const medlemmer = medlemmerAf(await deps.husstand.personer(), foer.medlemmer);
  if (medlemmer.length < 2) return ingen;
  const kalendere = await deps.husstand.alleKalendere();
  if (!kalendere.length) return ingen;
  const kandidater = weekendKonflikter(blokkeFraKalendere(kalendere, medlemmer), { medlemmer, ressourcer: foer.ressourcer }, dage);
  const nye = await endre<Konflikt[]>(deps, (s) => {
    if (s.konfliktTjek === dage[0]) return { ud: [] };
    const gem = s.konflikter.filter((k) => now.getTime() - Date.parse(k.tid.slut) < GEM_KONFLIKTER_MS);
    const lavet: Konflikt[] = [];
    for (const c of kandidater) {
      if (gem.some((k) => k.noegle === c.noegle) || gem.length + lavet.length >= MAX_KONFLIKTER) continue;
      lavet.push(nytKonflikt({ id: `k-${randomUUID().slice(0, 8)}`, kandidat: c, nu: now }));
    }
    return { state: { ...s, konflikter: [...gem, ...lavet], konfliktTjek: dage[0] }, ud: lavet };
  });
  const runs: RunRecord[] = [];
  for (const k of nye) {
    // The card's words in the language being served; Hermes' prompt (prompt.ts) keeps konfliktResume, which is Danish.
    const t = konfliktTekstVis(k, medlemmer);
    for (const party of k.parter) await deps.store.appendLog(RUM, { kilde: 'system', tekst: husstandTekst().log.weekendLinje(t.resume, t.spoergsmaal).slice(0, 300), zone: 'privat', ejer: party });
    const run = startKonfliktTekst(deps, k, medlemmer);
    if (run) runs.push(run);
  }
  if (nye.length) notify(deps);
  return { nye, runs };
}

/** Fortryd of a booking line: exactly that booking goes; a clash it was holding falls away, with a line to both. */
async function fortrydBooking(deps: RoomDeps, h: { medlemmer: Medlem[] }, linje: LogEntry, bookingId: string): Promise<RunRecord | null> {
  const person = deps.person.id;
  const now = deps.now();
  if (linje.ejer !== person || linje.fortrudt) return null;
  const r = await endre<{ b: Booking; res: Ressource; bortfaldne: Sammenfald[] } | null>(deps, (s) => {
    const res = s.ressourcer.find((x) => x.kalender.some((b) => b.id === bookingId && b.af === person));
    const b = res?.kalender.find((x) => x.id === bookingId);
    if (!res || !b) return { ud: null };
    const ressourcer = s.ressourcer.map((x) => (x.id === res.id ? { ...x, kalender: x.kalender.filter((y) => y.id !== bookingId) } : x));
    const bortfaldne = s.sammenfald.filter((x) => aabenSammenfald(x, now) && x.mod.id === bookingId);
    const sammenfald = s.sammenfald.map((x) => (bortfaldne.includes(x) ? { ...x, afgjort: { valg: 'bortfaldet', af: person, tid: now.toISOString() } } : x));
    return { state: { ...s, ressourcer, sammenfald }, ud: { b, res, bortfaldne } };
  });
  if (!r) return null;
  await deps.store.updateLog(RUM, linje.id, { fortrudt: now.toISOString() });
  const T = husstandTekst();
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.fortrudt(linje.tekst).slice(0, 300), zone: 'privat', ejer: person });
  for (const sf of r.bortfaldne) {
    await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: T.log.gavSlipSaaBook(navnAf(h.medlemmer, person), T.iSaet(r.res.navn), tidSaetning(r.b, now)).slice(0, 300), zone: 'privat', ejer: andenPart(sf, person) });
  }
  notify(deps);
  return deps.runs.local('fortryd', () => faerdig(deps, T.ud.fortrudt));
}

/** Fortryd of "your booking was moved": it goes back to its car, but only while that slot is free there (nobody is displaced). Null = cannot. */
async function fortrydFlyt(deps: RoomDeps, linje: LogEntry, f: { id: string; fra: string }): Promise<RunRecord | null> {
  const person = deps.person.id;
  const now = deps.now();
  if (linje.ejer !== person || linje.fortrudt) return null;
  const ok = await endre<boolean>(deps, (s) => {
    if (!kanFlyttesTilbage(s.ressourcer, f, person)) return { ud: false };
    const nu = s.ressourcer.find((r) => r.kalender.some((b) => b.id === f.id))!;
    const b = nu.kalender.find((x) => x.id === f.id)!;
    const ressourcer = s.ressourcer.map((r) => (r.id === nu.id ? { ...r, kalender: r.kalender.filter((x) => x.id !== f.id) } : r.id === f.fra ? { ...r, kalender: [...r.kalender, { ...b, ressourceId: f.fra }] } : r));
    return { state: { ...s, ressourcer }, ud: true };
  });
  if (!ok) return null;
  await deps.store.updateLog(RUM, linje.id, { fortrudt: now.toISOString() });
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: husstandTekst().log.fortrudt(linje.tekst).slice(0, 300), zone: 'privat', ejer: person });
  notify(deps);
  return deps.runs.local('fortryd', () => faerdig(deps, husstandTekst().ud.fortrudt));
}

/** Fortryd of "you added a car": it goes again while nothing is booked in it (a card or clash about it goes with it). Null = cannot. */
async function fortrydBil(deps: RoomDeps, linje: LogEntry, bilId: string): Promise<RunRecord | null> {
  const person = deps.person.id;
  const now = deps.now();
  if (linje.ejer !== person || linje.fortrudt) return null;
  const ok = await endre<boolean>(deps, (s) => {
    const r = s.ressourcer.find((x) => x.id === bilId);
    if (!r || r.kalender.length > 0) return { ud: false };
    return { state: { ...s, ressourcer: s.ressourcer.filter((x) => x.id !== bilId), udkast: s.udkast.filter((u) => u.ressourceId !== bilId) }, ud: true };
  });
  if (!ok) return null;
  await deps.store.updateLog(RUM, linje.id, { fortrudt: now.toISOString() });
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: husstandTekst().log.fortrudt(linje.tekst).slice(0, 300), zone: 'privat', ejer: person });
  notify(deps);
  return deps.runs.local('fortryd', () => faerdig(deps, husstandTekst().ud.fortrudt));
}

async function startAction(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null> {
  if (!(name in AKTION_VERBER)) return null;
  // KC-0154: the role decides first (rettigheder.ts); the invite also works before there is a household to see.
  const handling = AKTION_HANDLING[name];
  if (!handling || !maaHandle(deps.person, { slags: handling })) throw new ActionError(husstandTekst().fejl.rolleMaaIkke, 403);
  if (name === 'inviter') return inviter(deps, body);
  const h = await forAktion(deps);
  const person = deps.person.id;
  const id = str(body['id']);
  switch (name) {
    case 'opret': {
      const til = h.medlemmer.find((m) => m.id === str(body['til']));
      if (!til || til.id === person) throw new ActionError(husstandTekst().fejl.vaelgAnden);
      const titel = str(body['titel']).replace(/[\u0000-\u001f\u007f]/g, ' ');
      if (!titel || titel.length > 200) throw new ActionError(husstandTekst().fejl.skrivSpoergsmaal);
      return opretOgSpoerg(deps, h, { til: til.id, titel, tid: tidFra(body, deps.now()) });
    }
    case 'svar': {
      const slags = SVAR[str(body['svar'])];
      if (!slags) throw new ActionError(husstandTekst().fejl.ukendtSvar);
      return tryk(deps, id, h, (f) => {
        if (slags !== 'alternativ') return { slags, af: person } as Haendelse;
        if (beslutter(f) !== person) return { slags: 'alternativ', af: person, alternativ: { start: '', slut: '', tekst: '' } };
        const kl = str(body['kl']);
        const alt = alternativFraKl(f, kl, husstandTekst().alternativTekst(kl));
        if (!alt) return new ActionError(f.tid ? husstandTekst().fejl.skrivKl : husstandTekst().fejl.intetTidspunktFlytte);
        return { slags: 'alternativ', af: person, alternativ: alt };
      });
    }
    case 'traek':
      return tryk(deps, id, h, () => ({ slags: 'traek', af: person }));
    case 'drop': {
      const f = await lukUdloebet(deps, id);
      await endre(deps, (s) => ({ state: lukket(id, deps.now())(s), ud: null }));
      await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: husstandTekst().log.droppede(f.titel).slice(0, 300), zone: 'privat', ejer: person });
      notify(deps);
      return deps.runs.local('foresp', () => faerdig(deps, husstandTekst().ud.droppet));
    }
    case 'book':
      return book(deps, h, body);
    case 'book-spoerg':
      return bookSpoerg(deps, h, bookingInput(h.state, body, deps.now()));
    case 'udkast-book':
      return book(deps, h, body, id);
    case 'udkast-spoerg': {
      const { u, r } = findUdkast(h.state, id, person, deps.now());
      return bookSpoerg(deps, h, { r, tid: { start: u.start, slut: u.slut }, titel: u.titel }, u.id);
    }
    case 'udkast-drop': {
      await endre(deps, (s) => {
        if (!s.udkast.some((x) => x.id === id && x.af === person)) throw new ActionError(husstandTekst().fejl.kort404, 404);
        return { state: { ...s, udkast: s.udkast.filter((x) => x.id !== id) }, ud: null };
      });
      notify(deps);
      return deps.runs.local('udkast', () => faerdig(deps, husstandTekst().ud.droppet));
    }
    case 'tilfoej-ressource':
      return tilfoejRessource(deps, h, body);
    case 'ret-ressource':
      return retRessource(deps, h, body);
    case 'fjern-ressource':
      return fjernRessource(deps, h, body);
    case 'sammenfald-valg':
      return vaelg(deps, h, id, str(body['valg']));
    case 'sammenfald-spoerg':
      return spoergAnden(deps, h, id, str(body['valg']));
    case 'konflikt-valg':
      return konfliktValg(deps, h, id, str(body['valg']));
    case 'rolle':
      return rolle(deps, body);
    case 'fjern-medlem':
      return fjernMedlem(deps, body);
    case 'spoerg-igen': {
      const f = await lukUdloebet(deps, id);
      if (f.tid && Date.parse(f.tid.start) <= deps.now().getTime()) throw new ActionError(husstandTekst().fejl.tidGaaetSpoergNy, 409);
      return opretOgSpoerg(deps, h, { til: f.til, titel: f.titel, tid: f.tid }, lukket(id, deps.now()));
    }
  }
  return null;
}

/** Creating and asking again go to another person (red, a human tap); answers, withdraw and drop are done with undo. */
const AKTION_VERBER: Readonly<Record<string, Verb>> = {
  opret: 'send-til-andre', 'spoerg-igen': 'send-til-andre', svar: 'udfoer-med-fortryd', traek: 'udfoer-med-fortryd', drop: 'udfoer-med-fortryd',
  // KC-0150: booking and an own clash option are done with Fortryd; asking an owner or the other party goes to another person.
  book: 'udfoer-med-fortryd', 'book-spoerg': 'send-til-andre', 'sammenfald-valg': 'udfoer-med-fortryd', 'sammenfald-spoerg': 'send-til-andre',
  // KC-0151: a card's own tap books (with Fortryd), asking for a loan goes to another person, Drop only tidies the person's own card.
  'udkast-book': 'udfoer-med-fortryd', 'udkast-spoerg': 'send-til-andre', 'udkast-drop': 'sorter', 'tilfoej-ressource': 'udfoer-med-fortryd',
  // KC-0215: editing is the owner's own tidy-up (the log line says what changed); removing needs the red yes.
  'ret-ressource': 'sorter', 'fjern-ressource': 'slet',
  // KC-0152: a pick on the weekend card is a request to the other adult.
  'konflikt-valg': 'send-til-andre',
  // KC-0154: inviting and a role are the owner's records (nothing leaves the app); removing someone ends her access: the red yes.
  inviter: 'bogfoer', rolle: 'bogfoer', 'fjern-medlem': 'slet',
};

/** Fortryd of a request's log line: the creation is withdrawn, an answer goes back to the state before it. Null = cannot. */
async function startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null> {
  const h = await forPersonen(deps);
  if (!h) return null;
  const person = deps.person.id;
  const linje = (await deps.store.readLog(RUM, 200)).find((e) => e.id === logId);
  const bookingId = bookingFraMarkoer(linje?.fortryd);
  if (linje && bookingId) return fortrydBooking(deps, h, linje, bookingId);
  const flyt = flytFraMarkoer(linje?.fortryd);
  if (linje && flyt) return fortrydFlyt(deps, linje, flyt);
  const bil = bilFraMarkoer(linje?.fortryd);
  if (linje && bil) return fortrydBil(deps, linje, bil);
  const m = forespMarkoer(linje?.fortryd);
  if (!linje || !m) return null;
  const now = deps.now();
  const r = await endre(deps, (s) => {
    if (!linjeKanFortrydes(linje, s.forespoergsler, person, now)) return { ud: null };
    const f = s.forespoergsler.find((x) => x.id === m.id)!;
    const u = m.n === 1 ? anvend(f, { slags: 'traek', af: person }, now) : fortrydSvar(f, person, now);
    if (!u.ok) return { ud: null };
    return { state: { ...s, forespoergsler: s.forespoergsler.map((x) => (x.id === f.id ? u.f : x)) }, ud: u.f };
  });
  if (!r) return null;
  await deps.store.updateLog(RUM, logId, { fortrudt: now.toISOString() });
  const navn = navnAf(h.medlemmer, person);
  const L = husstandTekst().log;
  await logBegge(deps, r, (p) => (m.n === 1 ? (p === person ? L.duTrakTilbage(r.titel) : L.hunTrakTilbage(navn, r.titel)) : (p === person ? L.duFortrod(r.titel) : L.hunFortrod(navn, r.titel))));
  notify(deps);
  return deps.runs.local('fortryd', () => faerdig(deps, husstandTekst().ud.fortrudt));
}

/** Kræver dig on Nu: what the person decides now, and an expired request of theirs nobody answered. */
async function hjemVenter(deps: RoomDeps): Promise<{ roomId: string; tekst: string }[]> {
  const T = husstandTekst();
  const h = await forPersonen(deps);
  // KC-0154: Kræver dig is what the person can act on here; a guest answers on her channel.
  if (!h || !maaHandle(deps.person, { slags: 'svar' })) return [];
  const p = deps.person.id;
  const now = deps.now();
  // KC-0150: an open clash is a decision for exactly its two parties.
  const sammenfald = h.state.sammenfald.filter((s) => erPartI(s, p) && aabenSammenfald(s, now)).map((s) => ({
    roomId: RUM, tekst: T.nuDobbeltbooket(rNavnAf(h.state.ressourcer, s.ressourceId), tidKort(s.ny, now), navnAf(h.medlemmer, andenPart(s, p))),
  }));
  // KC-0151: a booking card waits for this person's tap.
  const kort = h.state.udkast.filter((u) => u.af === p && udkastAabent(u, now) && h.state.ressourcer.some((r) => r.id === u.ressourceId)).map((u) => ({
    roomId: RUM, tekst: T.nuBekraeft(rNavnAf(h.state.ressourcer, u.ressourceId), tidKort(u, now)),
  }));
  // KC-0152: an open weekend card is a decision for exactly its two adults (once a request waits, that request is the line).
  const weekend = h.state.konflikter.filter((k) => erPartIKonflikt(k, p) && konfliktStatus(k, h.state.forespoergsler, now) === 'aaben').map((k) => ({
    roomId: RUM, tekst: T.nuWeekend(konfliktTekstVis(k, h.medlemmer).spoergsmaal, tidSagVis(k), navnAf(h.medlemmer, andenIKonflikt(k, p))),
  }));
  return [...kort, ...sammenfald, ...weekend, ...h.state.forespoergsler.flatMap((f) => {
    const mind = erPaamindet(f) ? T.nuPaamindelse : '';
    if (beslutter(f) === p && f.tilstand === 'spurgt') return [{ roomId: RUM, tekst: T.nuSpoerger(mind, navnAf(h.medlemmer, f.fra), f.titel) }];
    if (beslutter(f) === p && f.tilstand === 'alternativ') return [{ roomId: RUM, tekst: T.nuForeslaar(mind, navnAf(h.medlemmer, f.til), f.titel) }];
    if (f.fra === p && ubesvaret(f)) return [{ roomId: RUM, tekst: T.nuIngenSvar(navnAf(h.medlemmer, f.til), f.titel) }];
    return [];
  })];
}

/** I gang on Nu: what the person asked and waits on the other for. */
async function hjemIgang(deps: RoomDeps): Promise<{ roomId: string; tekst: string }[]> {
  const T = husstandTekst();
  const h = await forPersonen(deps);
  if (!h || !maaHandle(deps.person, { slags: 'spoerg' })) return [];
  const p = deps.person.id;
  return h.state.forespoergsler.flatMap((f) => {
    const b = beslutter(f);
    if (b === null || b === p || !erPart(f, p)) return [];
    return [{ roomId: RUM, tekst: f.tilstand === 'spurgt' ? T.nuIkkeSvaretEndnu(navnAf(h.medlemmer, f.til), f.titel) : T.nuIkkeSvaretPaaForslag(navnAf(h.medlemmer, f.fra), f.titel) }];
  });
}

/** The clock: reminders to whoever decides (an element on their Nu) and expiry (a line per party). Outside any request. */
async function tik(deps: RoomDeps): Promise<void> {
  const now = deps.now();
  const udloebne = await endre(deps, (s) => {
    let aendret = false;
    const udloebne: Forespoergsel[] = [];
    const forespoergsler = s.forespoergsler.map((f) => {
      const r = tikForesp(f, now);
      if (r.aendret) aendret = true;
      if (r.udloeb) udloebne.push(r.f);
      return r.f;
    });
    return aendret ? { state: { ...s, forespoergsler }, ud: { aendret, udloebne } } : { ud: { aendret, udloebne } };
  });
  for (const f of udloebne.udloebne) await logBegge(deps, f, () => husstandTekst().log.udloeb(f.titel), { kilde: 'system' });
  if (udloebne.aendret) notify(deps);
  // KC-0153: replies on the go-between's channel (read only; the clock never sends).
  await laesKanalSvar(deps);
}

/** iCalendar text: backslash, semicolon, comma and newlines escaped (RFC 5545 §3.3.11). */
const icsTekst = (t: string): string => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsTid = (iso: string): string => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** "Læg i din kalender": the agreement as an .ics for a party; handing it out takes the card away for that party. */
async function fil(deps: RoomDeps, name: string): Promise<{ content: string; contentType: string; filename: string } | null> {
  const m = /^aftale-([a-z0-9][a-z0-9-]{0,39})\.ics$/.exec(name);
  if (!m) return null;
  const h = await forPersonen(deps);
  const person = deps.person.id;
  const f = h?.state.forespoergsler.find((x) => x.id === m[1]);
  const t = f && erPart(f, person) ? aftaleTid(f) : undefined;
  if (!f || !t) return null;
  if (!(f.iKalender ?? []).includes(person)) {
    await endre(deps, (s) => ({ state: { ...s, forespoergsler: s.forespoergsler.map((x) => (x.id === f.id ? { ...x, iKalender: [...new Set([...(x.iKalender ?? []), person])] } : x)) }, ud: null }));
    notify(deps);
  }
  const content = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//Clawco//Husstanden//${sprogNu().toUpperCase()}`, 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${f.id}@clawco`, `DTSTAMP:${icsTid(deps.now().toISOString())}`, `DTSTART:${icsTid(t.start)}`, `DTEND:${icsTid(t.slut)}`,
    `SUMMARY:${icsTekst(f.titel)}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  return { content, contentType: 'text/calendar; charset=utf-8', filename: name };
}

async function startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const h = await forPersonen(deps);
  if (!h) throw new ActionError(husstandTekst().ikkeHerTitel);
  const uge = await ugen(deps, h.medlemmer, h.state);
  await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst, ejer: deps.person.id } : { fra: 'henrik', tekst: besked, ejer: deps.person.id });
  return deps.runs.start({
    kind: 'chat',
    spec: buildHusstandChatRun(besked, kontekst, h.medlemmer, uge, h.state.ressourcer, deps.now()),
    onDone: async (output) => {
      let text = output.replace(/```(?:json)?\s*[\s\S]*?```/i, '').trim() || husstandTekst().ud.ingenSvar;
      // KC-0151: only the four fields of a booking block count; the app turns them into a card, or says why not.
      const oensk = parseBookingSvar(output);
      if (oensk) {
        const note = await bookingKort(deps, h, oensk);
        if (note) text = `${text}\n\n${note}`.slice(0, 2000);
      }
      await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text, ejer: deps.person.id });
      return { text };
    },
  });
}

export const husstandRoom: RoomModule = {
  id: RUM,
  korsel: KORSEL,
  aktionVerber: AKTION_VERBER,
  view,
  startOpdater: async () => null,
  startHandling: async () => null,
  startFortryd,
  startChat,
  startAction,
  fil,
  venter: async (deps) => (await hjemVenter(deps)).length,
  hjemVenter,
  hjemIgang,
  tik,
};
