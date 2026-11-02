import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SvarFejl } from '../../src/svarfejl.ts';
import { parseKuratorSvar, mergeKort, MAX_KORT, type Kort, type KuratorState, type KuratorSvar } from '../../src/rooms/hjem/kort.ts';

const NOW = new Date('2026-10-27T10:00:00Z');

function kort(id: string, extra: Partial<Kort> = {}): Kort {
  return { id, type: 'tjeneste', titel: `Titel ${id}`, betyder: `Betyder ${id}`, grundlag: [], kilder: [], anbefaling: 'Gør noget', prioritet: 5, ...extra };
}
const tomState = (): KuratorState => ({ kort: [], intet: [], afvist: [], sete: [] });
const tomSvar = (extra: Partial<KuratorSvar> = {}): KuratorSvar => ({ nye: [], behold: [], opdater: [], fjern: [], intet: [], ...extra });

test('parseKuratorSvar keeps valid cards, drops a card with unknown type or empty betyder, clamps prioritet to 1..9, caps grundlag/kilder at 5 strings of 300 chars', () => {
  const lang = 'x'.repeat(400);
  const svar = parseKuratorSvar({
    kort: [
      { id: 'mail:1', type: 'familie', titel: 'Svar til Rikke', betyder: 'Hun venter', grundlag: ['a', 'b', 'c', 'd', 'e', 'f', 7, '', lang], kilder: [lang], anbefaling: 'Svar i dag', prioritet: 0 },
      { id: 'mail:2', type: 'ukendt', titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 3 },
      { id: 'mail:3', type: 'tjeneste', titel: 'T', betyder: '   ', anbefaling: 'A', prioritet: 3 },
      { id: 'Bad Id!', type: 'tjeneste', titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 3 },
      { id: 'nyhed:4', type: 'nyhed', titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 42 },
    ],
    intet: [{ titel: 'Nyhedsbrev', hvorfor: 'ingen handling' }, { titel: '', hvorfor: 'x' }],
  });
  assert.deepEqual(svar.nye.map((k) => k.id), ['mail:1', 'nyhed:4']);
  const a = svar.nye[0]!;
  assert.equal(a.prioritet, 1);
  assert.equal(svar.nye[1]!.prioritet, 9);
  assert.deepEqual(a.grundlag, ['a', 'b', 'c', 'd', 'e']);
  assert.equal(a.kilder[0]!.length, 300);
  assert.deepEqual(svar.intet, [{ titel: 'Nyhedsbrev', hvorfor: 'ingen handling', zone: 'privat' }]);
  assert.deepEqual(svar.behold, []);
  assert.deepEqual(svar.fjern, []);
});

test('parseKuratorSvar reads {"vurderinger":[{"id","status":"behold|opdater|fjern","hvorfor"}]} and rejects input without "kort" array', () => {
  const svar = parseKuratorSvar({
    kort: [kort('a', { betyder: 'ny tekst' }), kort('ny')],
    vurderinger: [
      { id: 'a', status: 'opdater', hvorfor: 'ændret' },
      { id: 'b', status: 'behold', hvorfor: 'stadig gældende' },
      { id: 'c', status: 'fjern', hvorfor: 'overstået' },
      { id: 'd', status: 'måske', hvorfor: 'ugyldig status' },
    ],
  });
  assert.deepEqual(svar.opdater.map((k) => k.id), ['a']);
  assert.deepEqual(svar.nye.map((k) => k.id), ['ny']);
  assert.deepEqual(svar.behold, ['b']);
  assert.deepEqual(svar.fjern, [{ id: 'c', hvorfor: 'overstået' }]);

  // vurderinger may be absent when nothing is open
  assert.deepEqual(parseKuratorSvar({ kort: [] }).behold, []);
  assert.throws(() => parseKuratorSvar({ vurderinger: [] }));
  assert.throws(() => parseKuratorSvar({ kort: 'nope' }));
  assert.throws(() => parseKuratorSvar(null), SvarFejl, 'an unusable Kurator answer goes back to Hermes (KC-0050)');
  assert.throws(() => parseKuratorSvar({ kort: [], vurderinger: 'nope' }));
  assert.throws(() => parseKuratorSvar(null));
  assert.throws(() => parseKuratorSvar('tekst'));
});

test('parseKuratorSvar keeps regnskab only on type regning and only with hvor in shelfatlas|privat; hvor "uklart" sets regnskabUklart and drops regnskab', () => {
  const linje = { dato: '2026-10-20', leverandoer: 'Cloudflare', beloeb: '5.00', valuta: 'USD', periode: '2026-10', art: 'abonnement', emne: 'Invoice 123' };
  const base = { titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 2 };
  const svar = parseKuratorSvar({
    kort: [
      { ...base, id: 'r:1', type: 'regning', regnskab: { hvor: 'shelfatlas', ...linje } },
      { ...base, id: 'r:2', type: 'regning', regnskab: { hvor: 'uklart', ...linje } },
      { ...base, id: 'r:3', type: 'regning', regnskab: { hvor: 'andet', ...linje } },
      { ...base, id: 'r:4', type: 'tjeneste', regnskab: { hvor: 'privat', ...linje } },
      { ...base, id: 'r:5', type: 'regning', regnskab: { hvor: 'privat', ...linje, art: 'gave' } },
    ],
  });
  const by = (id: string) => svar.nye.find((k) => k.id === id)!;
  assert.deepEqual(by('r:1').regnskab, { hvor: 'shelfatlas', ...linje });
  assert.equal(by('r:1').regnskabUklart, undefined);
  assert.equal(by('r:2').regnskab, undefined);
  assert.equal(by('r:2').regnskabUklart, true);
  assert.deepEqual(by('r:2').regnskabForslag, linje, 'the proposed line is kept for an unclear bill');
  assert.equal(by('r:1').regnskabForslag, undefined);
  assert.equal(by('r:3').regnskab, undefined);
  assert.equal(by('r:3').regnskabUklart, undefined);
  assert.equal(by('r:4').regnskab, undefined);
  assert.equal(by('r:4').regnskabUklart, undefined);
  assert.equal(by('r:5').regnskab, undefined);
});

test('parseKuratorSvar validates handling (id is always <card id>:h, Hermes\' id is ignored), prompt only on nyhed, gyldigTil as ISO date, mailId', () => {
  const base = { titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 2 };
  const svar = parseKuratorSvar({
    kort: [
      { ...base, id: 'n:1', type: 'nyhed', prompt: 'Opgradér pakken', handling: { label: 'Gør det', instruktion: 'Kør X', fortryd: 'Kør Y' }, gyldigTil: '2026-11-01T12:00:00Z' },
      { ...base, id: 'n:2', type: 'tjeneste', prompt: 'ikke her', handling: { id: 'egen', label: 'L', instruktion: 'I' }, gyldigTil: 'snart', mailId: 'Folders/Handling:42' },
      { ...base, id: 'n:3', type: 'tjeneste', handling: { label: '', instruktion: 'I' } },
    ],
  });
  const [a, b, c] = svar.nye;
  assert.deepEqual(a!.handling, { id: 'n:1:h', label: 'Gør det', instruktion: 'Kør X', fortryd: 'Kør Y' });
  assert.equal(a!.prompt, 'Opgradér pakken');
  assert.equal(a!.gyldigTil, '2026-11-01');
  assert.deepEqual(b!.handling, { id: 'n:2:h', label: 'L', instruktion: 'I' }, 'a Hermes-given id could collide with another card or a regnskab: id');
  assert.equal(b!.prompt, undefined);
  assert.equal(b!.gyldigTil, undefined);
  assert.equal(b!.mailId, 'Folders/Handling:42');
  assert.equal(c!.handling, undefined);
});

test('parseKuratorSvar ignores a card id given twice (first wins) and never trusts skrevet from Hermes', () => {
  const svar = parseKuratorSvar({
    kort: [{ ...kort('d:1'), titel: 'første', skrevet: { hvor: 'privat', fil: 'x.md' } }, { ...kort('d:1'), titel: 'anden' }],
  });
  assert.equal(svar.nye.length, 1);
  assert.equal(svar.nye[0]!.titel, 'første');
  assert.equal(svar.nye[0]!.skrevet, undefined);
});

test('mergeKort: open card not mentioned in vurderinger is retired (Hermes must stand by every card)', () => {
  const state = { ...tomState(), kort: [kort('a'), kort('b')] };
  const next = mergeKort(state, tomSvar({ behold: ['a'] }), NOW, 'privat');
  assert.deepEqual(next.kort.map((k) => k.id), ['a']);
});

test('mergeKort: behold keeps, opdater replaces by id, fjern removes, nye are added', () => {
  const state = { ...tomState(), kort: [kort('keep'), kort('upd', { betyder: 'gammel' }), kort('gone')] };
  const svar = tomSvar({
    behold: ['keep'],
    opdater: [kort('upd', { betyder: 'ny' })],
    fjern: [{ id: 'gone', hvorfor: 'overstået' }],
    nye: [kort('fresh')],
  });
  const next = mergeKort(state, svar, NOW, 'privat');
  assert.deepEqual(next.kort.map((k) => k.id).sort(), ['fresh', 'keep', 'upd']);
  assert.equal(next.kort.find((k) => k.id === 'upd')!.betyder, 'ny');
  assert.equal(state.kort.length, 3, 'input state is not mutated');
});

test('mergeKort: opdater keeps the app-owned skrevet mark of the old card', () => {
  const skrevet = { hvor: 'privat' as const, fil: 'abonnementer.md' };
  const state = { ...tomState(), kort: [kort('r', { skrevet })] };
  const next = mergeKort(state, tomSvar({ opdater: [kort('r', { betyder: 'ny' })] }), NOW, 'privat');
  assert.deepEqual(next.kort[0]!.skrevet, skrevet);
});

test('mergeKort: a written bill that Hermes returns again keeps the app-owned ledger fields (regnskab, regnskabUklart, regnskabForslag, skrevet)', () => {
  const linje = { hvor: 'privat' as const, dato: '2026-10-20', leverandoer: 'Netto', beloeb: '99,00', valuta: 'DKK', art: 'koeb' as const, emne: 'Kvittering' };
  const skrevet = { hvor: 'privat' as const, fil: 'abonnementer.md' };
  const state = { ...tomState(), kort: [kort('r', { type: 'regning', regnskab: linje, skrevet })] };
  const hermes = kort('r', { type: 'regning', betyder: 'ny tekst', regnskab: { ...linje, hvor: 'shelfatlas', beloeb: '1,00' }, regnskabUklart: true, regnskabForslag: { ...linje, beloeb: '2,00' } });
  for (const svar of [tomSvar({ opdater: [hermes] }), tomSvar({ nye: [hermes] })]) {
    const k = mergeKort(state, svar, NOW, 'privat').kort[0]!;
    assert.equal(k.betyder, 'ny tekst', 'Hermes owns the text');
    assert.deepEqual(k.regnskab, linje, 'the line Henrik placed stays');
    assert.deepEqual(k.skrevet, skrevet);
    assert.equal(k.regnskabUklart, undefined);
    assert.equal(k.regnskabForslag, undefined);
  }
});

test('parseKuratorSvar masks e-mail addresses in titel, betyder, anbefaling, grundlag and kilder', () => {
  const svar = parseKuratorSvar({
    kort: [{ id: 'm:1', type: 'familie', titel: 'Mail fra rikke@example.org', betyder: 'Skriv til rikke.h@mail.example.dk i dag.', anbefaling: 'Svar <rikke@example.org>', grundlag: ['fra rikke@example.org'], kilder: ['mail fra rikke@example.org', 'https://example.org/side'], prioritet: 2 }],
  });
  const k = svar.nye[0]!;
  assert.equal(k.titel, 'Mail fra [adresse]');
  assert.equal(k.betyder, 'Skriv til [adresse] i dag.');
  assert.equal(k.anbefaling, 'Svar [adresse]');
  assert.deepEqual(k.grundlag, ['fra [adresse]']);
  assert.deepEqual(k.kilder, ['mail fra [adresse]', 'https://example.org/side']);
  assert.ok(!JSON.stringify(k).includes('@'));
});

test('KC-0119: parseKuratorSvar reads the legacy card kind forespoergsel as familie and never rejects it', () => {
  const svar = parseKuratorSvar({
    kort: [
      { id: 'm:gammel', type: 'forespoergsel', titel: 'Rikke spørger', betyder: 'Hun venter', anbefaling: 'Svar', prioritet: 3 },
      { id: 'm:ny', type: 'familie', titel: 'Maja spørger', betyder: 'Hun venter', anbefaling: 'Svar', prioritet: 3 },
    ],
  });
  assert.deepEqual(svar.nye.map((k) => [k.id, k.type]), [['m:gammel', 'familie'], ['m:ny', 'familie']]);
});

test('mergeKort never re-adds an id in afvist', () => {
  const state = { ...tomState(), afvist: ['dismissed'] };
  const next = mergeKort(state, tomSvar({ nye: [kort('dismissed'), kort('ok')], opdater: [kort('dismissed')] }), NOW, 'privat');
  assert.deepEqual(next.kort.map((k) => k.id), ['ok']);
  assert.deepEqual(next.afvist, ['dismissed']);
});

test('mergeKort drops cards whose gyldigTil < today (Copenhagen) even if new', () => {
  // 2026-10-27T23:30Z is already 2026-10-28 in Copenhagen (CET, UTC+1)
  const late = new Date('2026-10-27T23:30:00Z');
  const state = { ...tomState(), kort: [kort('old', { gyldigTil: '2026-10-27' }), kort('today', { gyldigTil: '2026-10-28' })] };
  const svar = tomSvar({ behold: ['old', 'today'], nye: [kort('new-past', { gyldigTil: '2026-10-01' }), kort('new-ok', { gyldigTil: '2026-12-01' })] });
  const next = mergeKort(state, svar, late, 'privat');
  assert.deepEqual(next.kort.map((k) => k.id).sort(), ['new-ok', 'today']);
  // and at 10:00Z on the 27th, the 27th is still valid
  assert.deepEqual(mergeKort(state, svar, NOW, 'privat').kort.map((k) => k.id).sort(), ['new-ok', 'old', 'today']);
});

test('mergeKort keeps at most MAX_KORT by prioritet (1 = highest); overflow becomes intet with hvorfor "plads"', () => {
  assert.equal(MAX_KORT, 7);
  const nye = Array.from({ length: 9 }, (_, i) => kort(`k${i}`, { prioritet: 9 - i })); // k8 has prioritet 1
  const next = mergeKort(tomState(), tomSvar({ nye }), NOW, 'privat');
  assert.equal(next.kort.length, MAX_KORT);
  assert.deepEqual(next.kort.map((k) => k.id), ['k8', 'k7', 'k6', 'k5', 'k4', 'k3', 'k2']);
  assert.deepEqual(next.intet.map((i) => i.hvorfor), ['plads', 'plads']);
  assert.deepEqual(next.intet.map((i) => i.titel).sort(), ['Titel k0', 'Titel k1']);
});

test('mergeKort: intet keeps the newest 20 (new first)', () => {
  const gamle = Array.from({ length: 19 }, (_, i) => ({ titel: `gammel ${i}`, hvorfor: 'x' }));
  const state = { ...tomState(), intet: gamle };
  const next = mergeKort(state, tomSvar({ intet: [{ titel: 'ny 1', hvorfor: 'y' }, { titel: 'ny 2', hvorfor: 'y' }, { titel: 'ny 3', hvorfor: 'y' }] }), NOW, 'privat');
  assert.equal(next.intet.length, 20);
  assert.deepEqual(next.intet.slice(0, 3).map((i) => i.titel), ['ny 1', 'ny 2', 'ny 3']);
  assert.equal(next.intet[19]!.titel, 'gammel 16');
});

test('mergeKort: fjern wins over a new card with the same id; other state fields survive', () => {
  const state: KuratorState = { kort: [kort('x')], intet: [], afvist: ['z'], sete: ['s1'], cursor: 'c', sidst: 'old', sidstDyb: 'dyb' };
  const next = mergeKort(state, tomSvar({ fjern: [{ id: 'x', hvorfor: 'væk' }], nye: [kort('x')] }), NOW, 'privat');
  assert.deepEqual(next.kort, []);
  assert.deepEqual(next.sete, ['s1']);
  assert.equal(next.cursor, 'c');
  assert.equal(next.sidstDyb, 'dyb');
  assert.equal(next.sidst, 'old');
});

test('mergeKort carries the regnskab map through untouched', () => {
  const regnskab = { 'regning:a': { hvor: 'privat' as const, status: 'fortrudt' as const } };
  const next = mergeKort({ ...tomState(), regnskab }, tomSvar({ nye: [kort('n')] }), NOW, 'privat');
  assert.deepEqual(next.regnskab, regnskab);
});

test('regnskabForslag on an unclear bill needs valid fields; Hermes may leave them out', () => {
  const base = { type: 'regning', titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 2 };
  const linje = { dato: '2026-10-20', leverandoer: 'Cloudflare', beloeb: '5.00', valuta: 'USD', art: 'abonnement', emne: 'Invoice 123' };
  const svar = parseKuratorSvar({
    kort: [
      { ...base, id: 'u:1', regnskab: { hvor: 'uklart' } },
      { ...base, id: 'u:2', regnskab: { hvor: 'uklart', ...linje, art: 'gave' } },
      { ...base, id: 'u:3', regnskab: { hvor: 'uklart', ...linje, periode: '2026-10' } },
    ],
  });
  const by = (id: string) => svar.nye.find((k) => k.id === id)!;
  for (const id of ['u:1', 'u:2', 'u:3']) assert.equal(by(id).regnskabUklart, true, id);
  assert.equal(by('u:1').regnskabForslag, undefined);
  assert.equal(by('u:2').regnskabForslag, undefined);
  assert.deepEqual(by('u:3').regnskabForslag, { ...linje, periode: '2026-10' });
});

test('mergeKort carries nyhederSet (the Nyheder stamp already seen) through untouched', () => {
  const state: KuratorState = { kort: [], intet: [], afvist: [], sete: [], nyhederSet: '2026-10-27T05:10:00Z' };
  assert.equal(mergeKort(state, tomSvar(), NOW, 'privat').nyhederSet, '2026-10-27T05:10:00Z');
});

test('KC-0046: udvikling is kept only with a project from the list', () => {
  const svar = parseKuratorSvar({ kort: [
    { id: 'mail:inbox:1', type: 'tjeneste', titel: 'Sentry: fejl i ShelfAtlas', betyder: 'Forsiden fejler.', udvikling: { projekt: 'shelfatlas' } },
    { id: 'mail:inbox:2', type: 'tjeneste', titel: 'Ukendt', betyder: 'x', udvikling: { projekt: 'andet' } },
    { id: 'mail:inbox:3', type: 'tjeneste', titel: 'Forkert form', betyder: 'x', udvikling: 'shelfatlas' },
  ] });
  assert.deepEqual(svar.nye.map((k) => k.udvikling), [{ projekt: 'shelfatlas' }, undefined, undefined]);
});

test('KC-0059: parseKuratorSvar keeps a valid visuel (pictogram, headline, picture) and drops an invalid one', () => {
  const base = { type: 'tjeneste', titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 2 };
  const svar = parseKuratorSvar({
    kort: [
      { ...base, id: 'v:1', visuel: { ikon: 'zap', overskrift: 'Over budget', tone: 'adv', billede: { art: 'beloeb', vaerdi: 18400, graense: 15000, enhed: 'kr.', tekst: 'Tilbud', graenseTekst: 'Budget' } } },
      { ...base, id: 'v:2', visuel: { ikon: 'raket' } },
    ],
  });
  assert.deepEqual(svar.nye[0]!.visuel, { ikon: 'zap', overskrift: 'Over budget', tone: 'adv', billede: { art: 'beloeb', vaerdi: 18400, graense: 15000, enhed: 'kr.', tekst: 'Tilbud', graenseTekst: 'Budget' } });
  assert.equal(svar.nye[1]!.visuel, undefined);
});

// KC-0242: the messages this room's answer parser sends back to Hermes follow the language of the run.
import { HJEM_PROMPT_TEKSTER } from '../../src/rooms/hjem/prompt-tekster.ts';
import { form, tomme, ensStrenge } from '../fixtures/sprog-tjek.ts';

test('KC-0242: the room has an English `fejl` table with exactly the Danish keys, no empty text and no Danish copy', () => {
  const { da, en } = { da: HJEM_PROMPT_TEKSTER.da.fejl, en: HJEM_PROMPT_TEKSTER.en.fejl };
  assert.ok(da && Object.keys(da).length > 0);
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(en as never), []);
  assert.deepEqual(ensStrenge(da as never, en as never), []);
});
