// KC-0170 slice 3, Husstanden (part E), the pure rules: every refusal, validation message, stored title and message
// that goes out on a channel is Danish exactly as before when no language is chosen (or `da`), and English when the
// request being served is English, with no Danish word left. The Danish strings below were written from the code
// BEFORE the strings moved into src/hushold/tekster.ts; this file is the proof that the Danish did not change.
// Machine-facing text stays Danish on purpose: Sky's control call (intern.ts), the journal (schema.ts, console lines)
// and Hermes' instructions (prompt.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medSprog, sprogNu } from '../../src/store/sprog.ts';
import { anvend, fortrydSvar, nyForespoergsel } from '../../src/hushold/foresp.ts';
import { hvorforIkkeFjernes, indsaet, loesSammenfald, valgNeutralt, iSaetning, type Booking, type Ressource, type Sammenfald } from '../../src/hushold/ressource.ts';
import { valider } from '../../src/hushold/bil.ts';
import { tidSag, valgTitel } from '../../src/hushold/konflikt.ts';
import { aktiverIndgang, fjernPerson, invitationTekst, navnFra, nyPerson, parseInvitation, skiftRolle, vurderInvitation, InvitationFejl } from '../../src/hushold/invitation.ts';
import { beskedTekst, lavHermesKanal, KanalFejl, vurderSend, type Kanalmedlem } from '../../src/hushold/kanal.ts';
import { fortolk } from '../../src/hushold/svar.ts';
import { HUSSTAND_TEKSTER } from '../../src/hushold/tekster.ts';
import { DELE } from '../fixtures/sprog-golden-husstand.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';
import type { Medlem } from '../../src/hushold/schema.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const NU = new Date('2026-11-02T08:00:00Z'); // Monday 09.00 in Copenhagen
const da = <T>(fn: () => T): T => fn();
const en = <T>(fn: () => T): T => medSprog('en', fn);
/** English has no Danish letter or Danish function word. */
const udenDansk = (s: string, hvad: string): void => assert.doesNotMatch(s, DANSK, `${hvad}: ${s}`);

/** Danish first for every case (the baseline), then English for every case. */
function tjek(tilfaelde: [string, () => string | null | undefined, string, string][]): void {
  for (const [navn, lav, dansk] of tilfaelde) assert.equal(da(lav), dansk, `${navn} (da)`);
  for (const [navn, lav, , engelsk] of tilfaelde) {
    const e = en(lav);
    assert.equal(e, engelsk, `${navn} (en)`);
    udenDansk(e ?? '', navn);
  }
}

const hvorfor = (u: { ok: boolean; hvorfor?: string }): string | null => (u.ok ? null : u.hvorfor ?? null);

// ---- foresp.ts: why a step is refused -----------------------------------------------------------------------------

test('a refused step of a request says why, in the language of the request', () => {
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Can you?' }, NU);
  const ja = anvend(f, { slags: 'ja', af: 'maja' }, NU);
  assert.ok(ja.ok);
  const efterUdloeb = new Date(Date.parse(f.udloeber) + 1000);
  const tilfaelde: [string, () => string | null, string, string][] = [
    ['ikke-part', () => hvorfor(anvend(f, { slags: 'ja', af: 'rikke' }, NU)), 'Forespørgslen er ikke din.', 'The request is not yours.'],
    ['ikke-din-tur', () => hvorfor(anvend(f, { slags: 'ja', af: 'henrik' }, NU)), 'Det er ikke din beslutning lige nu.', 'It is not your decision right now.'],
    ['ikke-endnu', () => hvorfor(anvend(f, { slags: 'udloeb' }, NU)), 'Forespørgslen er ikke udløbet endnu.', 'The request has not expired yet.'],
    ['afgjort', () => hvorfor(anvend(ja.ok ? ja.f : f, { slags: 'nej', af: 'maja' }, NU)), 'Forespørgslen er allerede afgjort.', 'The request is already settled.'],
    ['fortryd: intet svar', () => hvorfor(fortrydSvar(f, 'henrik', NU)), 'Der er intet svar at fortryde.', 'There is no answer to undo.'],
    ['fortryd: ikke svareren', () => hvorfor(fortrydSvar(ja.ok ? ja.f : f, 'henrik', NU)), 'Kun den, der svarede, kan fortryde svaret.', 'Only the one who answered can undo the answer.'],
    ['fortryd: ikke part', () => hvorfor(fortrydSvar(ja.ok ? ja.f : f, 'rikke', NU)), 'Forespørgslen er ikke din.', 'The request is not yours.'],
    ['fortryd: udløbet', () => hvorfor(fortrydSvar(ja.ok ? ja.f : f, 'maja', efterUdloeb)), 'Forespørgslen er udløbet, så svaret kan ikke fortrydes.', 'The request has expired, so the answer cannot be undone.'],
  ];
  tjek(tilfaelde);
});

// ---- ressource.ts ------------------------------------------------------------------------------------------------

const booking = (id: string, af: string, fra: string, til: string, ressourceId = 'stor-bil'): Booking => ({ id, ressourceId, af, start: `2026-11-07T${fra}:00.000Z`, slut: `2026-11-07T${til}:00.000Z`, titel: 'Shopping' });
// The things are named in the language of the install (a name is data): Danish names in a Danish run, English in an English one.
const navne = (sprog: 'da' | 'en') => (sprog === 'en' ? { stor: 'The big car', lille: 'The little car' } : { stor: 'Den store bil', lille: 'Den lille bil' });
const stor = (sprog = sprogNu()): Ressource => ({ id: 'stor-bil', navn: navne(sprog).stor, slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [booking('b1', 'rikke', '08:00', '12:00')] });
const lille = (sprog = sprogNu()): Ressource => ({ id: 'lille-bil', navn: navne(sprog).lille, slags: 'bil', ejere: ['henrik', 'rikke'], kalender: [] });
const sammenfald = (o: Partial<Sammenfald> = {}): Sammenfald => ({
  id: 's1', ressourceId: 'stor-bil', ny: booking('n1', 'henrik', '10:00', '14:00'), mod: booking('b1', 'rikke', '08:00', '12:00'),
  valg: [{ id: 'v1', slags: 'anden', hvem: 'henrik', ressourceId: 'lille-bil' }, { id: 'v2', slags: 'afgiv', hvem: 'rikke' }, { id: 'v3', slags: 'anden', hvem: 'rikke', ressourceId: 'lille-bil' }, { id: 'v4', slags: 'afgiv', hvem: 'henrik' }],
  oprettet: NU.toISOString(), ...o,
});

test('why a thing cannot be removed, and why a booking or a clash outcome is refused', () => {
  const tom = (): Ressource => ({ ...stor(), kalender: [] });
  const o = { person: 'henrik', nu: NU, sammenfald: [] as Sammenfald[], forespoergsler: [] as { ressourceId?: string; tilstand: string }[] };
  const tilfaelde: [string, () => string | null, string, string][] = [
    ['andres bookinger', () => hvorforIkkeFjernes(stor(), o), 'Der er kommende bookinger af andre på den store bil. Vent til de er overstået.', 'There are upcoming bookings by others on the big car. Wait until they are over.'],
    ['aabent kort', () => hvorforIkkeFjernes(tom(), { ...o, sammenfald: [sammenfald()] }), 'Der er et åbent kort om den store bil. Afgør det først.', 'There is an open card about the big car. Settle it first.'],
    ['aaben forespoergsel', () => hvorforIkkeFjernes(tom(), { ...o, forespoergsler: [{ ressourceId: 'stor-bil', tilstand: 'spurgt' }] }), 'Der er en åben forespørgsel om den store bil. Vent på svaret først.', 'There is an open request about the big car. Wait for the answer first.'],
    ['indsaet: ukendt ting', () => hvorfor(indsaet([stor()], booking('x', 'henrik', '08:00', '09:00', 'findes-ikke'))), 'Den ting findes ikke (længere).', 'That thing no longer exists.'],
    ['indsaet: optaget', () => hvorfor(indsaet([stor()], booking('x', 'henrik', '09:00', '10:00'))), 'Den store bil er optaget i det tidsrum.', 'The big car is taken at that time.'],
    ['loes: afgjort', () => hvorfor(loesSammenfald([stor(), lille()], sammenfald({ afgjort: { valg: 'v1', af: 'henrik', tid: NU.toISOString() } }), 'v1', 'ny')), 'Det er allerede afgjort.', 'That is already settled.'],
    ['loes: ukendt valg', () => hvorfor(loesSammenfald([stor(), lille()], sammenfald(), 'v9', 'ny')), 'Ukendt valg.', 'Unknown option.'],
    ['loes: bookingen er vaek', () => hvorfor(loesSammenfald([{ ...stor(), kalender: [] }, lille()], sammenfald(), 'v2', 'ny')), 'Bookingen findes ikke længere.', 'The booking no longer exists.'],
  ];
  tjek(tilfaelde);
});

test('an option of a clash in neutral words: Danish by default (Hermes\' prompt keeps it), the language of the screen when given the table', () => {
  const navn = (id: string): string => (id === 'henrik' ? 'Henrik' : 'Rikke');
  const s = sammenfald();
  const ressourcer = [stor('da'), lille('da')];
  const engelske = [stor('en'), lille('en')];
  const v = (id: string) => s.valg.find((x) => x.id === id)!;
  // The default is the Danish table, whatever language the request is in: prompt.ts calls it without a table.
  for (const f of [da, en]) {
    assert.equal(f(() => valgNeutralt(s, v('v1'), navn, ressourcer)), 'Henrik tager den lille bil');
    assert.equal(f(() => valgNeutralt(s, v('v2'), navn, ressourcer)), 'Rikke lader Henrik få den (bytte)');
    assert.equal(f(() => valgNeutralt(s, v('v4'), navn, ressourcer)), 'Henrik dropper det, Rikke beholder den');
    assert.equal(f(() => valgNeutralt(s, v('v1'), navn, [])), 'Henrik tager en anden');
  }
  const T = HUSSTAND_TEKSTER.en;
  assert.equal(valgNeutralt(s, v('v1'), navn, engelske, T), 'Henrik takes the little car');
  assert.equal(valgNeutralt(s, v('v2'), navn, engelske, T), 'Rikke lets Henrik have it (swap)');
  assert.equal(valgNeutralt(s, v('v4'), navn, engelske, T), 'Henrik drops it, Rikke keeps it');
  assert.equal(valgNeutralt(s, v('v1'), navn, [], T), 'Henrik takes another one');
  assert.equal(valgNeutralt(s, v('v1'), navn, ressourcer, HUSSTAND_TEKSTER.da), 'Henrik tager den lille bil');
  assert.equal(iSaetning('Den store bil'), 'den store bil');
});

// ---- bil.ts: a sentence in the chat, checked --------------------------------------------------------------------

test('a booking wish that does not hold says why, and a wish with no title is a trip', () => {
  const o = (x: Partial<{ ressource: string; start: string; slut: string; titel: string }> = {}) => ({ ressource: 'stor-bil', start: '2026-11-07T10:00', slut: '2026-11-07T15:00', titel: 'Shopping', ...x });
  const tilfaelde: [string, () => string | null, string, string][] = [
    ['ukendt ting', () => hvorfor(valider(o({ ressource: 'x' }), [stor()], NU)), 'Den ting findes ikke (længere).', 'That thing no longer exists.'],
    ['ulaeseligt', () => hvorfor(valider(o({ start: 'i morgen' }), [stor()], NU)), 'Jeg kunne ikke læse tidspunktet.', 'I could not read the time.'],
    ['slut foer start', () => hvorfor(valider(o({ slut: '2026-11-07T09:00' }), [stor()], NU)), 'Slut skal være efter start.', 'The end must be after the start.'],
    ['gaaet', () => hvorfor(valider(o({ start: '2026-11-01T10:00', slut: '2026-11-01T12:00' }), [stor()], NU)), 'Tidspunktet er allerede gået.', 'That time has already passed.'],
    ['for langt frem', () => hvorfor(valider(o({ start: '2026-12-07T10:00', slut: '2026-12-07T12:00' }), [stor()], NU)), 'Jeg booker højst 14 dage frem.', 'I book at most 14 days ahead.'],
    ['for lang', () => hvorfor(valider(o({ start: '2026-11-03T10:00', slut: '2026-11-12T12:00' }), [stor()], NU)), 'Bookingen er for lang (højst 7 dage).', 'The booking is too long (at most 7 days).'],
  ];
  tjek(tilfaelde);
  const titel = (): string => { const v = valider(o({ titel: '' }), [stor()], NU); return v.ok ? v.titel : ''; };
  assert.equal(da(titel), 'Tur');
  assert.equal(en(titel), 'Trip');
});

// ---- konflikt.ts: the request a pick on the weekend card makes ---------------------------------------------------

test('what the request from a weekend pick says: Danish as before, English in an English request', () => {
  const k = DELE.KONFLIKT;
  const asker = k.parter[0];
  const tredje = k.valg.find((v) => v.slags === 'tredje')!;
  const tager = k.valg.find((v) => v.slags === 'tager' && v.hvem === asker)!;
  const andens = k.valg.find((v) => v.slags === 'tager' && v.hvem !== asker)!;
  assert.equal(tidSag(k), 'lørdag kl. 11.00–13.00');
  assert.equal(en(() => tidSag(k, 'en')), 'Saturday at 11:00–13:00');
  const d = da(() => valgTitel(k, tredje, asker)), e = en(() => valgTitel(k, tredje, asker));
  assert.equal(d, 'Kan vi finde en tredje til Nora lørdag kl. 11.00–13.00?');
  assert.equal(e, 'Can we find a third for Nora on Saturday at 11:00–13:00?');
  assert.equal(da(() => valgTitel(k, tager, asker)), 'Jeg tager Nora lørdag kl. 11.00–13.00. Passer det?');
  assert.equal(en(() => valgTitel(k, tager, asker)), 'I take Nora on Saturday at 11:00–13:00. Does that suit you?');
  assert.equal(da(() => valgTitel(k, andens, asker)), 'Kan du tage Nora lørdag kl. 11.00–13.00?');
  assert.equal(en(() => valgTitel(k, andens, asker)), 'Can you take Nora on Saturday at 11:00–13:00?');
  for (const t of [e, en(() => valgTitel(k, tager, asker)), en(() => valgTitel(k, andens, asker))]) udenDansk(t, t);
});

// ---- invitation.ts -----------------------------------------------------------------------------------------------

const feil = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof InvitationFejl) return e.message; throw e; } return ''; };
const EJER: Person = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' };
const MAJA: Person = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' };

test('every refusal of an invitation, a role change and a removal, in the language of the request', () => {
  const personer = [EJER, MAJA];
  const ok = { navn: 'Nora', rolle: 'barn' };
  const seks: Person[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, login: `${id}@example.com`, navn: id.toUpperCase(), rolle: 'medlem' }));
  const tilfaelde: [string, () => unknown, string, string][] = [
    ['navn', () => navnFra(''), 'Skriv personens navn (højst 80 tegn).', 'Write the person\'s name (at most 80 characters).'],
    ['rolle', () => parseInvitation({ ...ok, slags: 'egen', rolle: 'ejer', login: 'n@example.com' }), 'Vælg medlem, barn eller gæst.', 'Pick member, child or guest.'],
    ['login', () => parseInvitation({ ...ok, slags: 'egen', login: 'ikke en mail' }), 'Skriv den e-mail, hun logger ind i Tailscale med.', 'Write the email she logs in to Tailscale with.'],
    ['kanal', () => parseInvitation({ ...ok, slags: 'telefon', kanal: 'sms', handle: '1' }), 'Vælg Telegram, WhatsApp eller Signal.', 'Pick Telegram, WhatsApp or Signal.'],
    ['telegram-id', () => parseInvitation({ ...ok, slags: 'telefon', kanal: 'telegram', handle: 'abc' }), 'Skriv hendes Telegram-id (kun tal).', 'Write her Telegram id (digits only).'],
    ['nummer', () => parseInvitation({ ...ok, slags: 'telefon', kanal: 'signal', handle: '12' }), 'Skriv hendes nummer med landekode, fx +45 …', 'Write her number with country code, e.g. +45 …'],
    ['slags', () => parseInvitation({ ...ok, slags: 'post' }), 'Vælg, hvordan hun skal være med.', 'Pick how she joins.'],
    ['seks personer', () => nyPerson(seks, { slags: 'egen', navn: 'Nora', rolle: 'barn', login: 'n@example.com' }), 'Husstanden kan højst have 6 personer.', 'The household can have at most 6 people.'],
    ['samme mail', () => nyPerson(personer, { slags: 'egen', navn: 'Nora', rolle: 'barn', login: 'maja@example.com' }), 'Den e-mail er allerede med i husstanden.', 'That email is already in the household.'],
    ['ukendt rolle', () => skiftRolle(personer, EJER, 'maja', 'chef' as never), 'Ukendt rolle.', 'Unknown role.'],
    ['kun ejeren aendrer', () => skiftRolle(personer, MAJA, 'maja', 'barn'), 'Kun ejeren kan ændre, hvem der er med.', 'Only the owner can change who is in.'],
    ['person findes ikke', () => fjernPerson(personer, EJER, 'ingen'), 'Personen findes ikke (længere).', 'The person no longer exists.'],
    ['ikke dig selv', () => fjernPerson(personer, EJER, 'henrik'), 'Det kan du ikke gøre med dig selv.', 'You cannot do that to yourself.'],
  ];
  tjek(tilfaelde.map(([n, lav, d, e]) => [n, () => feil(lav), d, e]));
});

const MEDLEMMER_INV: Medlem[] = [
  { id: 'henrik', navn: 'Henrik', rolle: 'ejer' },
  { id: 'maja', navn: 'Maja', rolle: 'medlem', kanal: { kanal: 'signal', handle: '+4500000001', status: 'afventer-ja' } },
  { id: 'ella', navn: 'Ella', rolle: 'barn' },
  { id: 'nora', navn: 'Nora', rolle: 'barn', kanal: { kanal: 'signal', handle: '+4500000002', status: 'stoppet' } },
  { id: 'rikke', navn: 'Rikke', rolle: 'medlem', kanal: { kanal: 'signal', handle: '+4500000003', status: 'aktiv' } },
  { id: 'farmor', navn: 'Farmor', rolle: 'gaest', kanal: { kanal: 'signal', handle: '+4500000004', status: 'afventer-ja', inviteret: NU.toISOString() } },
];

test('whether the owner may send the invitation, and the message itself, in the language of the request', () => {
  const hvorforIkke = (id: string, af: Person = EJER): string => { const v = vurderInvitation(MEDLEMMER_INV, id, af); return v.ok ? '' : v.hvorfor; };
  const tilf: [string, () => string, string, string][] = [
    ['ikke ejer', () => hvorforIkke('maja', MAJA), 'Kun ejeren kan invitere.', 'Only the owner can invite.'],
    ['findes ikke', () => hvorforIkke('ingen'), 'Personen findes ikke (længere).', 'The person no longer exists.'],
    ['ingen kanal', () => hvorforIkke('ella'), 'Ella har ingen kanal at få beskeder på.', 'Ella has no channel to get messages on.'],
    ['stoppet', () => hvorforIkke('nora'), 'Nora har bedt Clawco om ikke at sende flere beskeder.', 'Nora has asked Clawco not to send any more messages.'],
    ['aktiv', () => hvorforIkke('rikke'), 'Rikke har allerede sagt ja.', 'Rikke has already said yes.'],
    ['sendt', () => hvorforIkke('farmor'), 'Invitationen er allerede sendt til Farmor.', 'The invitation has already been sent to Farmor.'],
  ];
  tjek(tilf);
  assert.equal(da(() => invitationTekst('Henrik', 'Maja')), [
    'Hej Maja. Henrik vil gerne have dig med i husstanden i Clawco.',
    'Clawco er jeres fælles overblik over aftaler og ting, I deler. Du skal ikke installere noget: når nogen i husstanden spørger dig om noget, kommer det her som en besked.',
    'Svar ja, hvis du vil være med, eller nej, hvis ikke. Skriv stop, hvis du ikke vil have flere beskeder fra Clawco.',
  ].join('\n'));
  const engelsk = en(() => invitationTekst('Henrik', 'Maja'));
  assert.equal(engelsk, [
    'Hi Maja. Henrik would like you to join the household in Clawco.',
    'Clawco is your shared overview of the appointments and things you share. You do not need to install anything: when someone in the household asks you something, it arrives here as a message.',
    'Reply yes if you want to join, or no if not. Write stop if you do not want any more messages from Clawco.',
  ].join('\n'));
  udenDansk(engelsk, 'invitation');
  // The message the owner sees is the message that is sent: the language is the owner's, the one serving the tap.
  const v = en(() => vurderInvitation(MEDLEMMER_INV, 'maja', EJER));
  assert.ok(v.ok && v.tekst === engelsk);
  assert.equal(aktiverIndgang({ id: 'x', navn: 'X', rolle: 'medlem' }, NU), null);
});

// ---- kanal.ts and svar.ts: the go-between ------------------------------------------------------------------------

test('the message a request puts on a member\'s channel is in the language of the request that sends it (the owner\'s)', () => {
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Can you pick up Nora?', tid: { start: '2026-11-05T15:00:00.000Z', slut: '2026-11-05T16:00:00.000Z' } }, NU);
  const uden = nyForespoergsel({ id: 'f2', fra: 'henrik', til: 'maja', titel: 'Can you call the plumber?' }, NU);
  assert.equal(da(() => beskedTekst(f, 'Henrik')), [
    'Henrik spørger: Can you pick up Nora?',
    'torsdag 5. november kl. 16.00–17.00',
    'Svar ja, nej eller fx kl 17 (et andet tidspunkt). Skriv stop, hvis du ikke vil have flere beskeder fra Clawco.',
  ].join('\n'));
  assert.equal(da(() => beskedTekst(uden, 'Henrik')), ['Henrik spørger: Can you call the plumber?', 'Svar ja eller nej. Skriv stop, hvis du ikke vil have flere beskeder fra Clawco.'].join('\n'));
  assert.equal(da(() => beskedTekst(f, 'Henrik', 'paamindelse')).split('\n')[0], 'Påmindelse fra Henrik: Can you pick up Nora?');
  const e = en(() => beskedTekst(f, 'Henrik'));
  assert.equal(e, [
    'Henrik asks: Can you pick up Nora?',
    'Thursday 5 November at 16:00–17:00',
    'Reply yes, no or e.g. at 17 (another time). Write stop if you do not want any more messages from Clawco.',
  ].join('\n'));
  assert.equal(en(() => beskedTekst(uden, 'Henrik')), ['Henrik asks: Can you call the plumber?', 'Reply yes or no. Write stop if you do not want any more messages from Clawco.'].join('\n'));
  assert.equal(en(() => beskedTekst(f, 'Henrik', 'paamindelse')).split('\n')[0], 'Reminder from Henrik: Can you pick up Nora?');
  udenDansk(e, 'besked');
});

test('why a request cannot be sent on a channel, in the language of the request', () => {
  const MEDL: Medlem[] = [
    { id: 'henrik', navn: 'Henrik', rolle: 'ejer' },
    { id: 'maja', navn: 'Maja', rolle: 'medlem', kanal: { kanal: 'signal', handle: '+4500000001', status: 'aktiv' } },
    { id: 'ella', navn: 'Ella', rolle: 'barn' },
    { id: 'nora', navn: 'Nora', rolle: 'barn', kanal: { kanal: 'signal', handle: '+4500000002', status: 'stoppet' } },
    { id: 'rikke', navn: 'Rikke', rolle: 'medlem', kanal: { kanal: 'telegram', handle: '100000003', status: 'afventer-ja' } },
  ];
  const f = (id: string, til: string, o: Partial<ReturnType<typeof nyForespoergsel>> = {}) => ({ ...nyForespoergsel({ id, fra: 'henrik', til, titel: 'Can you?' }, NU), ...o });
  const sendt = (slags: 'foresp' | 'paamindelse'[] | 'paamindelse') => ({ kanal: { sendt: [{ tid: NU.toISOString(), slags: slags as 'foresp' }], beskeder: [] } });
  const s = (forespoergsler: ReturnType<typeof f>[]) => ({ forespoergsler, medlemmer: MEDL });
  const hvorforIkke = (st: ReturnType<typeof s>, id: string, slags: 'foresp' | 'paamindelse' = 'foresp', person = 'henrik'): string => { const v = vurderSend(st, id, slags, person); return v.ok ? '' : v.hvorfor; };
  const tilfaelde: [string, () => string, string, string][] = [
    ['findes ikke', () => hvorforIkke(s([]), 'x'), 'Forespørgslen findes ikke (længere).', 'The request no longer exists.'],
    ['ikke asker', () => hvorforIkke(s([f('f1', 'maja')]), 'f1', 'foresp', 'maja'), 'Kun den, der spurgte, kan sende forespørgslen.', 'Only the one who asked can send the request.'],
    ['besvaret', () => hvorforIkke(s([f('f1', 'maja', { tilstand: 'afvist' })]), 'f1'), 'Forespørgslen er allerede besvaret eller afsluttet.', 'The request has already been answered or closed.'],
    ['ingen kanal', () => hvorforIkke(s([f('f1', 'ella')]), 'f1'), 'Ella kan ikke nås på en kanal fra Clawco.', 'Ella cannot be reached on a channel from Clawco.'],
    ['stoppet', () => hvorforIkke(s([f('f1', 'nora')]), 'f1'), 'Nora har bedt Clawco om ikke at sende flere beskeder.', 'Nora has asked Clawco not to send any more messages.'],
    ['ikke ja endnu', () => hvorforIkke(s([f('f1', 'rikke')]), 'f1'), 'Rikke har ikke sagt ja til beskeder fra Clawco endnu.', 'Rikke has not said yes to messages from Clawco yet.'],
    ['allerede sendt', () => hvorforIkke(s([f('f1', 'maja', sendt('foresp'))]), 'f1'), 'Forespørgslen er allerede sendt til Maja.', 'The request has already been sent to Maja.'],
    ['aaben paa kanalen', () => hvorforIkke(s([f('f1', 'maja'), f('f2', 'maja', sendt('foresp'))]), 'f1'), 'Maja har allerede en åben forespørgsel på Signal. Vent på svaret først.', 'Maja already has an open request on Signal. Wait for the answer first.'],
    ['send foerst', () => hvorforIkke(s([f('f1', 'maja')]), 'f1', 'paamindelse'), 'Send forespørgslen først.', 'Send the request first.'],
    ['paamindelse sendt', () => hvorforIkke(s([f('f1', 'maja', { kanal: { sendt: [{ tid: NU.toISOString(), slags: 'foresp' }, { tid: NU.toISOString(), slags: 'paamindelse' }], beskeder: [] } })]), 'f1', 'paamindelse'), 'Påmindelsen er allerede sendt til Maja.', 'The reminder has already been sent to Maja.'],
  ];
  tjek(tilfaelde);
  // A recipient or asker who is not a member of the household: the fallback words.
  const ukendt = (): string => { const v = vurderSend({ forespoergsler: [f('f1', 'spoegelse')], medlemmer: MEDL }, 'f1', 'foresp', 'henrik'); return v.ok ? '' : v.hvorfor; };
  assert.equal(da(ukendt), 'Personen kan ikke nås på en kanal fra Clawco.');
  assert.equal(en(ukendt), 'The person cannot be reached on a channel from Clawco.');
  const fraUkendt = (): string => { const v = vurderSend({ forespoergsler: [f('f1', 'maja', { fra: 'spoegelse' })], medlemmer: MEDL }, 'f1', 'foresp', 'spoegelse'); return v.ok ? v.tekst.split('\n')[0]! : ''; };
  assert.equal(da(fraUkendt), 'En i husstanden spørger: Can you?');
  assert.equal(en(fraUkendt), 'Someone in the household asks: Can you?');
});

test('the Hermes channel refuses in the language of the request', async () => {
  const MAJA_K: Kanalmedlem = { medlemId: 'maja', kanal: 'signal', handle: '+4500000001' };
  const fra = (o: { cli?: string; code?: number } = {}) => lavHermesKanal({ cli: o.cli ?? '/x/hermes', koer: async () => ({ code: o.code ?? 0, stdout: '', stderr: '' }), laesLog: async () => null });
  const besked = async (k: ReturnType<typeof fra>, til: Kanalmedlem, tekst: string): Promise<string> => { try { await k.send(til, tekst); } catch (e) { if (e instanceof KanalFejl) return e.message; throw e; } return ''; };
  const tilfaelde: [string, () => Promise<string>, string, string][] = [
    ['ingen cli', () => besked(fra({ cli: '' }), MAJA_K, 'hej'), 'Hermes kan ikke sende beskeder herfra endnu.', 'Hermes cannot send messages from here yet.'],
    ['ugyldigt nummer', () => besked(fra(), { ...MAJA_K, handle: 'familie' }, 'hej'), 'Modtagerens nummer eller id er ikke gyldigt, så intet er sendt.', 'The recipient\'s number or id is not valid, so nothing was sent.'],
    ['kan ikke sendes', () => besked(fra(), MAJA_K, 'se MEDIA:/x'), 'Beskeden kan ikke sendes, som den står.', 'The message cannot be sent as it is.'],
    ['fejlede', () => besked(fra({ code: 1 }), MAJA_K, 'hej'), 'Hermes kunne ikke sende beskeden (Signal). Prøv igen senere.', 'Hermes could not send the message (Signal). Try again later.'],
  ];
  for (const [navn, lav, dansk] of tilfaelde) assert.equal(await lav(), dansk, `${navn} (da)`);
  for (const [navn, lav, , engelsk] of tilfaelde) {
    assert.equal(await medSprog('en', lav), engelsk, `${navn} (en)`);
    udenDansk(engelsk, navn);
  }
});

test('a member\'s reply is read exactly, in either language whatever the install\'s language is', () => {
  for (const f of [da, en]) {
    for (const ja of ['ja', 'Ja', ' JA ', 'yes', 'Yes', ' YES ']) assert.deepEqual(f(() => fortolk(ja)), { slags: 'ja' }, ja);
    for (const nej of ['nej', 'Nej', 'no', 'No', 'NO ']) assert.deepEqual(f(() => fortolk(nej)), { slags: 'nej' }, nej);
    assert.deepEqual(f(() => fortolk('stop')), { slags: 'stop' });
    assert.deepEqual(f(() => fortolk(' STOP')), { slags: 'stop' });
    for (const kl of ['kl 17', 'kl. 17.30', 'kan 9', 'at 17', 'At 17:30', 'at 9.05']) {
      const r = f(() => fortolk(kl));
      assert.equal(r.slags, 'kl', kl);
    }
    assert.deepEqual(f(() => fortolk('at 17')), { slags: 'kl', kl: '17:00' });
    assert.deepEqual(f(() => fortolk('at 9.05')), { slags: 'kl', kl: '09:05' });
    assert.deepEqual(f(() => fortolk('kl 17')), { slags: 'kl', kl: '17:00' });
    for (const tekst of ['yes please', 'no thanks', 'ja tak', 'at 25', 'maybe', 'stop it']) assert.deepEqual(f(() => fortolk(tekst)), { slags: 'tekst', tekst }, tekst);
  }
});

test('nothing in the English table is Danish', () => {
  const ord = (v: unknown, sti: string): string[] => {
    if (typeof v === 'string') return DANSK.test(v) ? [`${sti}: ${v}`] : [];
    if (typeof v === 'function') return [];
    if (Array.isArray(v)) return v.flatMap((x, i) => ord(x, `${sti}.${i}`));
    if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => ord(x, `${sti}.${k}`));
    return [];
  };
  assert.deepEqual(ord(HUSSTAND_TEKSTER.en, 'en'), []);
});
