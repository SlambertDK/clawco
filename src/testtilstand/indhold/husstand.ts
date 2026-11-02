// The test world's household (KC-0116): one fictional person per role, the family the story
// already has (Maja, Ella). Display
// only — the test world always runs as TEST_EJER, whatever the device sends.
// KC-0148: the household's family calendar — a fake calendar connector in the husstand zone with
// a week of shared events, each naming its members by their tailnet login (as Google does with
// attendees), so Husstanden shows whose each event is.

import type { Husstand, Person } from '../../identitet/husstand.ts';
import type { Kilde, KalenderData } from '../../kilder/types.ts';
import { fakta, isoDato, momentPlus, momentNr, MOMENT_TABEL, TIRSDAG_WEEKEND, type Fakta } from './fakta.ts';
import { anvend, nyForespoergsel, type Forespoergsel, type Haendelse } from '../../hushold/foresp.ts';
import type { BookingUdkast, HusstandState } from '../../hushold/schema.ts';
import { loesSammenfald, nySammenfald, type Booking, type Ressource } from '../../hushold/ressource.ts';
import { nytKonflikt, weekendKonflikter, type Blok, type Konflikt } from '../../hushold/konflikt.ts';
import { lavFakeKanal } from '../../hushold/kanal.ts';
import { FAMILIE } from '../familie.ts';

export const TEST_EJER: Person = { id: 'henrik', login: 'henrik@test.invalid', navn: 'Henrik', rolle: 'ejer' };

export const TEST_HUSSTAND: Husstand = {
  personer: [
    TEST_EJER,
    { id: 'maja', login: 'maja@test.invalid', navn: 'Maja', rolle: 'medlem' },
    { id: 'ella', login: 'ella@test.invalid', navn: 'Ella', rolle: 'barn' },
    { id: 'farmor', login: 'farmor@test.invalid', navn: 'Farmor', rolle: 'gaest' },
  ],
};

/** The family calendar's connector id (connected in the husstand zone from the first moment, indhold/kilder.ts). */
export const FAMILIEKALENDER = 'falsk-familiekalender';

const login = (id: string): string => TEST_HUSSTAND.personer.find((p) => p.id === id)?.login ?? '';

/** The coming seven days of the family calendar, as scripts/kalender_uge.py writes them. */
export function husstandUge(f: Fakta): KalenderData {
  const med = (...ider: string[]) => ider.map((id) => ({ name: null, email: login(id), self: id === TEST_EJER.id }));
  const aftale = (dag: number, titel: string, fra: string, til: string, o: { attendees?: ReturnType<typeof med>; creator?: string; location?: string } = {}) =>
    ({ id: `familie-${dag}-${fra.replace(':', '')}`, title: titel, start: f.iso(fra, dag), end: f.iso(til, dag), all_day: false, calendar: 'Familie', location: o.location ?? null, creator: o.creator ?? null, attendees: o.attendees ?? [] });
  const heldag = (dag: number, titel: string, hvem: string) =>
    ({ id: `familie-${dag}-heldag`, title: titel, start: f.plus(dag), end: f.plus(dag + 1), all_day: true, calendar: 'Familie', location: null, creator: login(hvem), attendees: [] });
  const events: Record<number, Record<string, unknown>[]> = {
    0: [aftale(0, 'Fællesspisning', '18:00', '19:30', { creator: login('henrik') })],
    1: [aftale(1, 'Svømning', '16:30', '17:30', { attendees: med('ella'), location: 'Svømmehallen' })],
    2: [aftale(2, 'Forældremøde i 2.B', '19:00', '20:30', { attendees: med('maja', 'henrik') })],
    4: [heldag(4, 'Farmor på besøg', 'farmor')],
    5: [aftale(5, 'Ellas fødselsdag', '14:00', '17:00', { attendees: med('henrik', 'maja', 'ella') })],
  };
  return { generated: f.iso('06:30'), days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: f.plus(i), events: events[i] ?? [] })), errors: [] };
}

/** The family calendar as a connector: reads the story's week for the world's day. */
export function familiekalender(dag: () => string): Kilde {
  return {
    id: FAMILIEKALENDER, navn: 'Falsk familiekalender', slags: 'kalender', zone: 'husstand', auth: 'local', tillid: 'uklar',
    read: async (ctx) => ({ slags: 'kalender', hentet: ctx.nu.toISOString(), uklar: true, data: husstandUge(fakta(dag())) }),
    kort: async () => ({ titel: 'Falsk familiekalender', tekst: 'Husstandens fælles kalender med opdigtede aftaler.', felter: [], handling: 'Forbind' }),
    helbred: async () => ({ status: 'ok' }),
  };
}

// KC-0149: the household's requests, every state on Henrik's screen during the day (the moments up to the evening),
// one with a reminder to him, and one between Maja and Ella he never sees (a third member sees nothing until it is
// accepted). Built through the state machine itself, so each history is a real one. From "Sent aften" on, Henrik
// has dealt with his (nothing waits: Alt er ordnet).

const FORSTE_SENE = 6; // momentNr('sent-aften')

export function husstandState(n: number, f: Fakta): HusstandState {
  const t = (hhmm: string, plus = 0): Date => new Date(f.iso(hhmm, plus));
  const trin = (x: Forespoergsel, h: Haendelse, nu: Date): Forespoergsel => {
    const r = anvend(x, h, nu);
    if (!r.ok) throw new Error(`testverden: ${x.id} ${h.slags}: ${r.hvorfor}`);
    return r.f;
  };
  const sen = n >= FORSTE_SENE;
  // Maja asks Henrik (he decides: the blue Ja), reminded 24 h before it expires; Hermes suggested another time.
  let hent = nyForespoergsel({ id: 'f-hent-ella', fra: 'maja', til: 'henrik', titel: 'Kan du hente Ella fra svømning i morgen?', tid: { start: f.iso('16:30', 1), slut: f.iso('17:30', 1) } }, t('07:00', -1));
  hent = { ...hent, paamindet: ['henrik:24t'], forslag: { anbefaling: 'Du har intet andet i kalenderen i morgen eftermiddag.', alternativer: [{ kl: '17:00', tekst: 'Kan 17.00' }] } };
  if (sen) hent = trin(hent, { slags: 'ja', af: 'henrik' }, t('21:40'));
  // Henrik asked Maja; she proposed another time, so it is his to decide.
  let handle = nyForespoergsel({ id: 'f-indkoeb', fra: 'henrik', til: 'maja', titel: 'Kan du handle ind til Ellas fødselsdag?', tid: { start: f.iso('10:00', 4), slut: f.iso('11:00', 4) } }, t('06:30'));
  handle = trin(handle, { slags: 'alternativ', af: 'maja', alternativ: { start: f.iso('14:00', 4), slut: f.iso('15:00', 4), tekst: 'Kan 14.00' } }, t('06:50'));
  if (sen) handle = trin(handle, { slags: 'tag-imod', af: 'henrik' }, t('21:41'));
  // Accepted: in the shared week, and Henrik has not yet put it in his own calendar.
  let tandlaege = nyForespoergsel({ id: 'f-tandlaege', fra: 'henrik', til: 'maja', titel: 'Kan du tage Ella til tandlæge?', tid: { start: f.iso('08:00', 3), slut: f.iso('09:00', 3) } }, t('20:00', -1));
  tandlaege = { ...trin(tandlaege, { slags: 'ja', af: 'maja' }, t('21:00', -1)), iKalender: ['maja'] };
  // Ella said no.
  let rydde = nyForespoergsel({ id: 'f-rydde-op', fra: 'henrik', til: 'ella', titel: 'Kan du rydde op på dit værelse i aften?' }, t('06:45'));
  rydde = trin(rydde, { slags: 'nej', af: 'ella' }, t('06:55'));
  // Nobody answered within 48 h: Spørg igen or Drop for Henrik (dropped by the evening).
  let vvs = nyForespoergsel({ id: 'f-vvs', fra: 'henrik', til: 'maja', titel: 'Kan du ringe til VVS’eren om vandhanen?' }, t('07:00', -3));
  vvs = trin(vvs, { slags: 'udloeb' }, t('07:00', -1));
  if (sen) vvs = { ...vvs, lukket: f.iso('21:42') };
  // Henrik asked Maja this morning; she has not answered (his I gang on Nu, never Kræver dig).
  const pakke = nyForespoergsel({ id: 'f-pakke', fra: 'henrik', til: 'maja', titel: 'Kan du tage pakken med fra posthuset?' }, t('06:40'));
  // Between Maja and Ella only: Henrik never sees it.
  const kat = nyForespoergsel({ id: 'f-kat', fra: 'maja', til: 'ella', titel: 'Kan du fodre katten i weekenden?' }, t('06:20'));
  const { ressourcer, sammenfald } = husstandRessourcer(sen, f, n);
  const k = kanalHusstand(handle, f);
  return { medlemmer: [...k.medlemmer, ...inviterede(f)], ressourcer, forespoergsler: [hent, k.handle, tandlaege, rydde, vvs, pakke, kat], sammenfald: [sammenfald], udkast: bilUdkast(n, f), konflikter: weekendKort(n, f), kanalSidst: k.kanalSidst };
}

// ---------- KC-0153: the go-between (kept apart from the stories above) ----------
// Maja is also reached on Telegram (a fictional bot chat id). Henrik sent the shopping request there; she answered
// "kl 14" on the channel (her alternative, marked as a channel answer) and wrote a line of free text that changes
// nothing. The parcel request has not gone to her channel yet: its card shows the exact message and the red Send.
// The fake channel (testKanal) also holds a stranger's message, which the clock ignores.

export const MAJA_TELEGRAM = '100000001';
const FREMMED_TELEGRAM = '200000009';

function kanalHusstand(handle: Forespoergsel, f: Fakta): { medlemmer: HusstandState['medlemmer']; handle: Forespoergsel; kanalSidst: string } {
  const historik = handle.historik.map((h, i) => (i === 1 ? { ...h, via: 'kanal' as const } : h));
  const medKanal: Forespoergsel = {
    ...handle, historik,
    kanal: { sendt: [{ tid: f.iso('06:31'), slags: 'foresp' }], beskeder: [{ tid: f.iso('06:52'), tekst: 'Jeg er til tandlæge om formiddagen, men kan godt bagefter' }] },
  };
  return {
    medlemmer: [{ id: 'maja', navn: 'Maja', rolle: 'medlem', kanal: { kanal: 'telegram', handle: MAJA_TELEGRAM, status: 'aktiv' } }],
    handle: medKanal,
    kanalSidst: f.iso('06:52'),
  };
}

// ---------- KC-0154: two invitations waiting (kept apart from the stories above) ----------
// Henrik invited two more this morning, one of each kind: Rikke with her own entry (he has not yet shared the machine
// in Tailscale, so the card shows him the steps) and Nora on Signal only (the card shows the exact first message and
// the red Send; the fake channel only records it). Both are persons in husstand.json, so Husstanden lists them; they
// are not in TEST_HUSSTAND, whose four people (one per role) the family calendar and the weekend card are built on.

/** A fictional Signal number (00 00 00 04). */
export const NORA_SIGNAL = '+4500000004';

export const TEST_INVITEREDE: Person[] = [
  { id: FAMILIE.partner.id, login: `${FAMILIE.partner.id}@test.invalid`, navn: FAMILIE.partner.navn, rolle: 'medlem' },
  { id: FAMILIE.barn.id, login: null, navn: FAMILIE.barn.navn, rolle: 'barn' },
];

function inviterede(f: Fakta): HusstandState['medlemmer'] {
  const [rikke, nora] = TEST_INVITEREDE as [Person, Person];
  return [
    { id: rikke.id, navn: rikke.navn, rolle: rikke.rolle, indgang: { status: 'venter', oprettet: f.iso('06:10') } },
    { id: nora.id, navn: nora.navn, rolle: nora.rolle, kanal: { kanal: 'signal', handle: NORA_SIGNAL, status: 'afventer-ja' } },
  ];
}

/**
 * The test world's channel: the fake (Send only records, it never reaches anyone). It holds a stranger's "ja" from
 * before the household's read mark, so the world's clock never even reads it; test/server-foresp-send.test.ts holds
 * that a stranger is ignored when it does.
 */
export function testKanal(): ReturnType<typeof lavFakeKanal> {
  return lavFakeKanal({ indgaaende: [{ kanal: 'telegram', afsender: FREMMED_TELEGRAM, gruppe: false, tid: '2000-01-01T00:00:00.000Z', tekst: 'ja' }] });
}

// KC-0150: the household's things — two cars, the guest room, the drill, and Ella as a resource ("hun kan kun være ét
// sted"). Henrik wished for the big car while Maja has it: one open clash for the two of them (Hermes' suggestion
// first). From "Sent aften" he has taken the small car, through the model itself, so Alt er ordnet holds.
function husstandRessourcer(sen: boolean, f: Fakta, n: number): { ressourcer: Ressource[]; sammenfald: ReturnType<typeof nySammenfald> } {
  const b = (id: string, ressourceId: string, af: string, titel: string, fra: string, til: string, dag: number, tilDag = dag): Booking =>
    ({ id, ressourceId, af, titel, start: f.iso(fra, dag), slut: f.iso(til, tilDag) });
  const begge = ['henrik', 'maja'];
  const stor = b('b-odense', 'stor-bil', 'maja', 'Til Odense', '08:00', '16:00', 2);
  // KC-0151: in the moment "Lørdag i næste uge" Maja's course holds the big car that Saturday 09–13.
  const kursus = n === momentNr('bil-loerdag') ? [b('b-kursus', 'stor-bil', 'maja', 'Kursus', '09:00', '13:00', loerdagNaesteUge(f))] : [];
  const ressourcer: Ressource[] = [
    { id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: begge, kalender: [stor, ...kursus] },
    { id: 'lille-bil', navn: 'Den lille bil', slags: 'bil', ejere: begge, kalender: [b('b-vaerksted', 'lille-bil', 'henrik', 'Værksted', '07:30', '08:30', 3)] },
    { id: 'gaestevaerelse', navn: 'Gæsteværelset', slags: 'rum', ejere: begge, kalender: [b('b-farmor', 'gaestevaerelse', 'maja', 'Farmor overnatter', '12:00', '10:00', 4, 5)] },
    { id: 'boremaskine', navn: 'Boremaskinen', slags: 'ting', ejere: ['henrik'], kalender: [] },
    { id: 'ella', navn: 'Ella', slags: 'person', ejere: begge, kalender: [b('b-svoemning', 'ella', 'maja', 'Svømning', '16:30', '17:30', 1)] },
  ];
  const oensket = b('w-indkoeb', 'stor-bil', 'henrik', 'Storindkøb til fødselsdagen', '10:00', '13:00', 2);
  const aaben = { ...nySammenfald({ id: 's-stor-bil', ny: oensket, mod: stor, ressourcer, nu: new Date(f.iso('06:30')) }), forslag: { foerste: 'v1', anbefaling: 'Maja kører hele dagen; den lille bil er fri, mens Henrik handler.' } };
  if (!sen) return { ressourcer, sammenfald: aaben };
  const l = loesSammenfald(ressourcer, aaben, 'v1', 'b-indkoeb');
  if (!l.ok) throw new Error(`testverden: sammenfald: ${l.hvorfor}`);
  return { ressourcer: l.ressourcer, sammenfald: { ...aaben, afgjort: { valg: 'v1', af: 'henrik', tid: f.iso('21:43') } } };
}

/** The Saturday of KC-0151, in days after the story's day: the one in the week after the coming one. */
export const loerdagNaesteUge = (f: Fakta): number => f.loerdagPlus + 7;

/**
 * KC-0151: the booking block the scripted Hermes writes for "jeg skal bruge den store bil lørdag 10 til 15" — the car, the
 * Saturday (next week's in the moment "Lørdag i næste uge", else the coming one) and the hours; null for any other sentence.
 */
export function bilBooking(besked: string, f: Fakta, momentId: string): { ressource: string; start: string; slut: string; titel: string } | null {
  const bil = /\b(store|lille)\s+bil\b/i.exec(besked)?.[1]?.toLowerCase();
  const tid = /(\d{1,2})(?:[.:](\d{2}))?\s*(?:til|-|–)\s*(\d{1,2})(?:[.:](\d{2}))?/.exec(besked);
  if (!bil || !tid || !/lørdag/i.test(besked)) return null;
  const kl = (t: string | undefined, m: string | undefined): string => `${String(Math.min(23, Number(t))).padStart(2, '0')}:${m ?? '00'}`;
  const dag = f.plus(momentId === 'bil-loerdag' ? loerdagNaesteUge(f) : f.loerdagPlus);
  return { ressource: bil === 'store' ? 'stor-bil' : 'lille-bil', start: `${dag}T${kl(tid[1], tid[2])}`, slut: `${dag}T${kl(tid[3], tid[4])}`, titel: 'Tur' };
}

/** KC-0151: in the moment "Lørdag i næste uge" Henrik has already asked for the small car that Sunday: a card waits for his tap. */
function bilUdkast(n: number, f: Fakta): BookingUdkast[] {
  if (n !== momentNr('bil-loerdag')) return [];
  const dag = f.plus(loerdagNaesteUge(f) + 1);
  return [{ id: 'u-soendag', af: 'henrik', ressourceId: 'lille-bil', start: isoDato(dag, '11:00'), slut: isoDato(dag, '13:00'), titel: 'Besøg hos Farmor', oprettet: f.iso('18:30', 1) }];
}

/**
 * KC-0152: in the moment "Tirsdag før weekenden" (the Tuesday check has just run) Henrik and Maja are both busy on the
 * coming Saturday while Ella is at home: ONE card for the two of them, made by the real check (weekendKonflikter), with
 * the cykeltur and the kaffe shown because both share their titles. Henrik cannot be shown Maja's side of it alone:
 * the card is the same for both. No other moment has one.
 */
function weekendKort(n: number, f: Fakta): Konflikt[] {
  if (n !== momentNr(TIRSDAG_WEEKEND)) return [];
  const tirsdag = momentPlus(MOMENT_TABEL[n]!, f.dag);
  const loerdag = f.plus(tirsdag + 4), soendag = f.plus(tirsdag + 5);
  const blok = (hvem: string, fra: string, til: string, titel: string): Blok => ({ hvem, start: isoDato(loerdag, fra), slut: isoDato(loerdag, til), med: [hvem], titel });
  const medlemmer = TEST_HUSSTAND.personer.map((p) => ({ id: p.id, navn: p.navn, rolle: p.rolle }));
  const kandidat = weekendKonflikter([blok('henrik', '09:00', '14:00', 'cykeltur'), blok('maja', '11:00', '13:00', 'kaffe med Signe')], { medlemmer, ressourcer: [] }, [loerdag, soendag])[0];
  if (!kandidat) throw new Error('testverden: weekendkortet fandt ingen konflikt');
  return [nytKonflikt({ id: 'k-weekend', kandidat, nu: new Date(f.iso('07:30', tirsdag)) })];
}
