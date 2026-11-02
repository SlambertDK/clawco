// KC-0059: the visual layer — pictograms, the small pictures a decision is read
// from, and the validation of what Hermes (or the demo) sends for them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ikon, billede, parseVisuel, avatar, visHoved, mere, type Billede } from '../../src/shell/visuel.ts';
import { html } from '../../src/shell/html.ts';

test('ikon renders the named pictogram as an inline, hidden-from-readers svg', () => {
  const s = String(ikon('cloud-rain'));
  assert.match(s, /^<svg [^>]*aria-hidden="true"/);
  assert.match(s, /class="ikon"/);
  assert.match(s, /M4 14\.899A7 7 0 1 1 15\.71 8h1\.79/);
});

test('ikon falls back to the info pictogram for an unknown name', () => {
  assert.match(String(ikon('findes-ikke' as never)), /M12 16v-4/);
});

test('parseVisuel keeps a valid pictogram, headline, tone and picture', () => {
  const v = parseVisuel({ ikon: 'receipt', overskrift: 'Betal 4.210 kr.', tone: 'god', billede: { art: 'beloeb', vaerdi: 4210, graense: 4210, enhed: 'kr.', tekst: 'Faktura', graenseTekst: 'Tilbud' } });
  assert.deepEqual(v, { ikon: 'receipt', overskrift: 'Betal 4.210 kr.', tone: 'god', billede: { art: 'beloeb', vaerdi: 4210, graense: 4210, enhed: 'kr.', tekst: 'Faktura', graenseTekst: 'Tilbud' } });
});

test('parseVisuel drops an unknown pictogram, an unknown tone and a broken picture', () => {
  assert.equal(parseVisuel({ ikon: 'raket' }), undefined);
  assert.equal(parseVisuel('regn'), undefined);
  assert.deepEqual(parseVisuel({ ikon: 'sun', tone: 'lilla', billede: { art: 'beloeb', vaerdi: 'mange' } }), { ikon: 'sun' });
  assert.deepEqual(parseVisuel({ ikon: 'sun', billede: { art: 'film' } }), { ikon: 'sun' });
});

test('parseVisuel keeps a day line with zones and moved points, and caps the lists', () => {
  const zoner = Array.from({ length: 9 }, () => ({ fra: '16:00', til: '19:00', slags: 'regn' }));
  const v = parseVisuel({ ikon: 'cloud-rain', billede: { art: 'dagslinje', fra: 6, til: 22, zoner, punkter: [{ tid: '12:00', ikon: 'footprints', tekst: 'Løb', flyttetFra: '17:00' }, { tid: 'nu', ikon: 'sun', tekst: 'x' }] } });
  assert.equal(v?.billede?.art, 'dagslinje');
  if (v?.billede?.art !== 'dagslinje') return;
  assert.equal(v.billede.zoner.length, 6);
  assert.deepEqual(v.billede.punkter, [{ tid: '12:00', ikon: 'footprints', tekst: 'Løb', flyttetFra: '17:00' }]);
});

test('a day line places zones and points by the hour and shows a moved point as a ghost', () => {
  const s = String(billede({ art: 'dagslinje', fra: 6, til: 22, zoner: [{ fra: '16:00', til: '19:00', slags: 'regn' }], punkter: [{ tid: '12:00', ikon: 'footprints', tekst: 'Løb', flyttetFra: '17:00' }] }));
  assert.match(s, /class="dagslinje"/);
  assert.match(s, /zone-regn" style="left:62\.5%;width:18\.75%"/);
  assert.match(s, /punkt" style="left:37\.5%"/);
  assert.match(s, /punkt-spoegelse" style="left:68\.75%"/);
  assert.match(s, />Løb</);
});

test('an amount over its limit is a warning; an amount that matches is good', () => {
  const over = String(billede({ art: 'beloeb', vaerdi: 18400, graense: 15000, enhed: 'kr.', tekst: 'Tilbud', graenseTekst: 'Budget' }));
  assert.match(over, /beloeb tilstand-kraever/);
  assert.match(over, /18\.400 kr\./);
  assert.match(over, /Budget 15\.000/);
  assert.match(over, /\+3\.400 kr\./);
  assert.match(over, /class="bl-over" style="left:81\.52%;width:18\.48%"/, 'the part over the limit is its own colour');
  const lige = String(billede({ art: 'beloeb', vaerdi: 4210, graense: 4210, enhed: 'kr.', tekst: 'Faktura', graenseTekst: 'Tilbud' }));
  assert.match(lige, /beloeb tilstand-ordnet/);
  assert.match(lige, /Passer/);
});

test('a countdown ring shows the minutes left and the label', () => {
  const s = String(billede({ art: 'nedtaelling', minutter: 10, ialt: 60, tekst: 'Gå 15.35' }));
  assert.match(s, /class="nedtaelling"/);
  assert.match(s, />10<\/text>/);
  assert.match(s, /Gå 15\.35/);
});

test('a week strip marks the free day', () => {
  const s = String(billede({ art: 'uge', dage: [{ navn: 'fre', fri: false }, { navn: 'lør', fri: true, ikon: 'gift', valgt: true }] }));
  assert.match(s, /uge-dag fri valgt/);
  assert.match(s, /uge-dag optaget/);
});

test('dots show how many of the newsletters were opened', () => {
  const s = String(billede({ art: 'prikker', antal: 0, ialt: 12, tekst: 'åbnet' }));
  assert.equal((s.match(/class="prik"/g) ?? []).length, 12);
  assert.match(s, /0 af 12 åbnet/);
});

test('people show as avatars with initials, and the name escapes', () => {
  const s = String(billede({ art: 'personer', personer: [{ navn: 'Clara Holm', rolle: 'Nordvik' }, { navn: '<Jonas>' }] }));
  assert.match(s, />CH</);
  assert.match(s, /&lt;Jonas&gt;/);
  assert.match(String(avatar('Ella')), />E</);
});

test('the head of a visual element is the pictogram plus one headline; mere folds the rest behind a tap', () => {
  const h = String(visHoved({ ikon: 'umbrella', tone: 'adv' }, 'Regn fra 16', 'Vejr'));
  assert.match(h, /vis-ikon tilstand-kraever/);
  assert.match(h, /<h3 class="vis-overskrift">Regn fra 16<\/h3>/);
  assert.match(h, />Vejr</);
  const m = String(mere(html`<p>fordi</p>`));
  assert.match(m, /^<details class="vis-mere"><summary>/);
  assert.match(m, /<p>fordi<\/p><\/div><\/details>$/);
});

test('parseIkon keeps a known pictogram name only', async () => {
  const { parseIkon } = await import('../../src/shell/visuel.ts');
  assert.equal(parseIkon('train-front'), 'train-front');
  assert.equal(parseIkon('raket'), undefined);
  assert.equal(parseIkon(3), undefined);
});

test('a day line marks now, and a point too close to the previous one in its lane goes above the track', () => {
  const punkter = ['07:00', '09:00', '10:00', '12:00'].map((tid) => ({ tid, ikon: 'calendar' as const, tekst: tid }));
  const s = String(billede({ art: 'dagslinje', fra: 6, til: 22, zoner: [], punkter }, { nu: new Date('2026-10-30T07:00:00Z'), dag: '2026-10-30' }));
  assert.match(s, /class="dagslinje taet"/);
  assert.match(s, /class="dl-nu" style="left:12\.5%"/);
  assert.equal((s.match(/class="punkt punkt-op"/g) ?? []).length, 2);
});

test('KC-0084: now on the day line is the real clock in Copenhagen, never the value Hermes stored', () => {
  const v = parseVisuel({ ikon: 'sun', billede: { art: 'dagslinje', fra: 6, til: 22, zoner: [], punkter: [], nu: '07:05' } });
  assert.ok(v?.billede?.art === 'dagslinje' && !('nu' in v.billede), 'a stored now is dropped');
  const b = { art: 'dagslinje', fra: 6, til: 22, zoner: [], punkter: [], nu: '07:05' } as unknown as Billede;
  // 12:00 UTC is 14:00 in Copenhagen in summer time (CEST): (14 - 6) / 16 = 50 %.
  const s = String(billede(b, { nu: new Date('2026-06-15T12:00:00Z'), dag: '2026-06-15' }));
  assert.match(s, /class="dl-nu" style="left:50%"/);
  assert.match(s, /data-fra="6" data-til="22" data-dag="2026-06-15" data-nu-ms="1781524800000"/);
  // 12:00 UTC is 13:00 in winter time (CET): (13 - 6) / 16 = 43.75 %.
  assert.match(String(billede(b, { nu: new Date('2026-12-15T12:00:00Z'), dag: '2026-12-15' })), /class="dl-nu" style="left:43\.75%"/);
});

test('KC-0084: no now line without a clock, for another day, or outside the line (it stays hidden for the client to show later)', () => {
  const b: Billede = { art: 'dagslinje', fra: 6, til: 22, zoner: [], punkter: [] };
  assert.doesNotMatch(String(billede(b)), /dl-nu|data-nu-ms/);
  assert.doesNotMatch(String(billede(b, { nu: new Date('2026-10-30T12:00:00Z'), dag: '2026-10-29' })), /dl-nu|data-nu-ms/);
  // 02:00 UTC is 03:00 in Copenhagen (CET), before the line starts at 06.
  assert.match(String(billede(b, { nu: new Date('2026-10-30T02:00:00Z'), dag: '2026-10-30' })), /<span class="dl-nu" hidden style="left:0%">/);
  // 21:30 UTC is 22:30 local on the 30th, after the line ends at 22.
  assert.match(String(billede(b, { nu: new Date('2026-10-30T21:30:00Z'), dag: '2026-10-30' })), /<span class="dl-nu" hidden style="left:100%">/);
});

test('KC-0060: the instruction to Hermes lists every pictogram we have and every picture kind, and its example parses', async () => {
  const { VISUEL_SKEMA, visuelRegler } = await import('../../src/shell/visuel.ts');
  const { IKONER } = await import('../../src/shell/ikoner.ts');
  const regler = visuelRegler();
  for (const navn of Object.keys(IKONER)) assert.ok(regler.includes(navn), navn);
  for (const art of ['dagslinje', 'beloeb', 'nedtaelling', 'uge', 'prikker', 'personer']) assert.ok(regler.includes(`"${art}"`), art);
  assert.ok(parseVisuel(JSON.parse(VISUEL_SKEMA)), 'the example in the schema is itself valid');
});

test('KC-0064: the head tile is classed by state — adv is kraever, no tone is rolig, never tone-', () => {
  assert.match(String(visHoved({ ikon: 'umbrella', tone: 'adv' }, 'x')), /vis-ikon tilstand-kraever/);
  assert.match(String(visHoved({ ikon: 'umbrella', tone: 'god' }, 'x')), /vis-ikon tilstand-ordnet/);
  const rolig = String(visHoved({ ikon: 'umbrella' }, 'x'));
  assert.match(rolig, /vis-ikon tilstand-rolig/);
  assert.doesNotMatch(rolig, /tone-/);
});

// KC-0074: on a phone the track is ~300 px wide, so points a couple of hours apart used to sit on top of each other.
const lanes = (s: string): string[] => [...s.matchAll(/class="punkt( punkt-op)?" style="left:[^"]+"/g)].map((m) => (m[1] ? 'op' : 'ned'));

test('KC-0074: four events within a few hours get alternating lanes so no two icons share a spot', () => {
  const punkter = [['11:00', 'Møde'], ['12:15', 'Løb'], ['14:00', 'Fri'], ['15:45', 'Ella']].map(([tid, tekst]) => ({ tid: tid!, ikon: 'calendar' as const, tekst: tekst! }));
  const s = String(billede({ art: 'dagslinje', fra: 6, til: 21, zoner: [], punkter }));
  assert.deepEqual(lanes(s), ['ned', 'op', 'ned', 'op']);
  assert.match(s, /class="dagslinje taet"/);
});

test('KC-0074: points far apart all stay in the lower lane and the line is not marked dense', () => {
  const punkter = [['07:00', 'A'], ['12:00', 'B'], ['18:00', 'C']].map(([tid, tekst]) => ({ tid: tid!, ikon: 'calendar' as const, tekst: tekst! }));
  const s = String(billede({ art: 'dagslinje', fra: 6, til: 21, zoner: [], punkter }));
  assert.deepEqual(lanes(s), ['ned', 'ned', 'ned']);
  assert.match(s, /class="dagslinje"/);
});

test('KC-0074: even with more than three points, ones far apart stay in the lower lane', () => {
  const punkter = [['07:00', 'A'], ['10:30', 'B'], ['14:00', 'C'], ['18:00', 'D']].map(([tid, tekst]) => ({ tid: tid!, ikon: 'calendar' as const, tekst: tekst! }));
  const s = String(billede({ art: 'dagslinje', fra: 6, til: 21, zoner: [], punkter }));
  assert.deepEqual(lanes(s), ['ned', 'ned', 'ned', 'ned']);
  assert.match(s, /class="dagslinje"/);
});

test('KC-0074: lanes follow time order, not the order the points were sent in', () => {
  const punkter = [['15:45', 'Ella'], ['11:00', 'Møde'], ['12:15', 'Løb'], ['14:00', 'Fri']].map(([tid, tekst]) => ({ tid: tid!, ikon: 'calendar' as const, tekst: tekst! }));
  const s = String(billede({ art: 'dagslinje', fra: 6, til: 21, zoner: [], punkter }));
  assert.deepEqual(lanes(s), ['op', 'ned', 'op', 'ned']);
});

test('KC-0074: the aria-label still lists every point, in the order sent', () => {
  const punkter = [['15:45', 'Ella'], ['11:00', 'Møde']].map(([tid, tekst]) => ({ tid: tid!, ikon: 'calendar' as const, tekst: tekst! }));
  assert.match(String(billede({ art: 'dagslinje', fra: 6, til: 21, zoner: [], punkter })), /aria-label="Ella 15:45, Møde 11:00"/);
});
