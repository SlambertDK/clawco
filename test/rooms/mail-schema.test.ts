import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMailState, ordnetHandling, handlingerIMail, kunFaerdig, type Beslutning, type MailState } from '../../src/rooms/mail/schema.ts';
import { SchemaError } from '../../src/rooms/dagen/schema.ts';

const tal = { handling: 2, afventer: 1, regninger: 12, sorteretIDag: 3 };
const ordnet = [{ mailId: '301', emne: 'Faktura oktober', fra: 'Elselskabet', til: 'Folders/Regninger', hvorfor: 'faktura', tid: '2026-10-27T08:30:01' }];
const valid = {
  beslutninger: [
    { mailId: '242', emne: 'Tilbud på ny eltavle', fra: 'Elektrikeren ApS', modtaget: '2026-10-26T18:57:39Z', type: 'svar', resume: 'Tilbud på 18.400 kr.', betydning: 'De vil have svar inden fredag; prisen er 2.000 over det, du regnede med.', frist: '2026-10-31',
      udkast: 'Hej, tak for tilbuddet. Kan I …', arkivmappe: 'Folders/Afventer',
      muligheder: [{ id: 'ring', label: 'Ring til dem', instruktion: 'Find telefonnummeret i mailen og læg det i noten.' }] },
    { mailId: '243', emne: 'Ugens energinyt', fra: 'Nyhedsbrev', modtaget: '2026-10-25T12:40:00Z', type: 'nyhedsbrev', resume: 'Nyhedsbrev.', betydning: 'Du åbner det aldrig.', arkivmappe: 'Archive',
      muligheder: [{ id: 'afmeld', label: 'Afmeld', instruktion: 'Find List-Unsubscribe …', fortryd: 'Kan ikke gøres om' }] },
    { mailId: '244', emne: 'Kvittering', fra: 'Shop', modtaget: '2026-10-24T09:12:00Z', type: 'kvittering', resume: 'Ordre 123.', betydning: 'Ingen handling.', arkivmappe: 'Folders/køb', muligheder: [] },
  ],
  hermesStatus: 'Holder øje med Handling',
};
const NOW = new Date('2026-10-27T08:40:00Z');

test('parseMailState accepts the analysis per mail: type, betydning, udkast, arkivmappe, optional muligheder', () => {
  const s = parseMailState(valid, { tal, ordnet }, NOW);
  assert.equal(s.beslutninger.length, 3);
  const b = s.beslutninger[0]!;
  assert.equal(b.type, 'svar');
  assert.equal(b.betydning, 'De vil have svar inden fredag; prisen er 2.000 over det, du regnede med.');
  assert.equal(b.udkast, 'Hej, tak for tilbuddet. Kan I …');
  assert.equal(b.arkivmappe, 'Folders/Afventer');
  assert.equal(b.muligheder[0]?.id, '242-ring');
  assert.deepEqual(s.beslutninger[2]?.muligheder, []);
  assert.equal(s.ordnet[0]?.handling.id, 'ordnet-301');
});

test('parseMailState defaults: unknown type becomes info, missing arkivmappe becomes Archive, bad folders are rejected', () => {
  const s = parseMailState({ ...valid, beslutninger: [{ ...valid.beslutninger[2], type: 'weird', arkivmappe: undefined }, { ...valid.beslutninger[2], mailId: '9', arkivmappe: 'Trash' }] }, { tal, ordnet }, NOW);
  assert.equal(s.beslutninger[0]?.type, 'info');
  assert.equal(s.beslutninger[0]?.arkivmappe, 'Archive');
  assert.equal(s.beslutninger[1]?.arkivmappe, 'Archive', 'Trash is never a target');
});

test('parseMailState rejects a beslutning without betydning and caps muligheder at 2', () => {
  assert.throws(() => parseMailState({ ...valid, beslutninger: [{ ...valid.beslutninger[2], betydning: '' }] }, { tal, ordnet }, NOW), SchemaError);
  const many = { ...valid.beslutninger[0], muligheder: [1, 2, 3].map((i) => ({ id: `m${i}`, label: `M${i}`, instruktion: 'x' })) };
  assert.equal(parseMailState({ ...valid, beslutninger: [many] }, { tal, ordnet }, NOW).beslutninger[0]?.muligheder.length, 2);
});

test('parseMailState carries afgjort and an edited udkast over from the previous state', () => {
  const prev = parseMailState(valid, { tal, ordnet }, NOW);
  prev.beslutninger[1]!.afgjort = { mulighedId: 'faerdig', tid: '2026-10-27T08:00:00Z' };
  prev.beslutninger[0]!.udkast = 'Min egen rettede tekst';
  const s = parseMailState(valid, { tal, ordnet }, NOW, prev);
  assert.deepEqual(s.beslutninger[1]?.afgjort, { mulighedId: 'faerdig', tid: '2026-10-27T08:00:00Z' });
  assert.equal(s.beslutninger[0]?.udkast, 'Min egen rettede tekst');
});

test('ordnetHandling builds the move-back handling for a sorted mail', () => {
  const h = ordnetHandling(ordnet[0]!);
  assert.equal(h.id, 'ordnet-301');
  assert.match(h.instruktion, /--from "Folders\/Regninger" --to "Folders\/Handling" 301/);
});

test('handlingerIMail lists every mulighed and every ordnet handling by id', () => {
  const s: MailState = parseMailState(valid, { tal, ordnet }, NOW);
  const m = handlingerIMail(s);
  assert.ok(m.has('242-ring') && m.has('243-afmeld') && m.has('ordnet-301'));
});

test('KC-0059: a beslutning keeps a valid visuel (pictogram, headline, picture) and drops an invalid one', () => {
  const visuel = { ikon: 'receipt', tone: 'adv', overskrift: 'Elregning 1.240 kr.', billede: { art: 'beloeb', vaerdi: 1240, graense: 1000, enhed: 'kr', tekst: 'denne måned', graenseTekst: 'Budget' } };
  const s = parseMailState({ ...valid, beslutninger: [{ ...valid.beslutninger[0], visuel }, { ...valid.beslutninger[1], visuel: { ikon: 'findes-ikke' } }, { ...valid.beslutninger[2], visuel: { ikon: 'check', billede: { art: 'ukendt' } } }] }, { tal, ordnet }, NOW);
  assert.equal(s.beslutninger[0]?.visuel?.ikon, 'receipt');
  assert.equal(s.beslutninger[0]?.visuel?.overskrift, 'Elregning 1.240 kr.');
  assert.equal(s.beslutninger[0]?.visuel?.billede?.art, 'beloeb');
  assert.equal(s.beslutninger[1]?.visuel, undefined, 'an unknown pictogram drops the whole visuel');
  assert.deepEqual(s.beslutninger[2]?.visuel, { ikon: 'check' }, 'a bad picture is dropped, the pictogram stays');
});

test('KC-0059: a refresh whose answer has no visuel keeps the stored one; a new visuel wins', () => {
  const prev = parseMailState({ ...valid, beslutninger: [{ ...valid.beslutninger[0], visuel: { ikon: 'clock' } }] }, { tal, ordnet }, NOW);
  const kept = parseMailState({ ...valid, beslutninger: [valid.beslutninger[0]] }, { tal, ordnet }, NOW, prev);
  assert.deepEqual(kept.beslutninger[0]?.visuel, { ikon: 'clock' });
  const nyt = parseMailState({ ...valid, beslutninger: [{ ...valid.beslutninger[0], visuel: { ikon: 'target' } }] }, { tal, ordnet }, NOW, prev);
  assert.deepEqual(nyt.beslutninger[0]?.visuel, { ikon: 'target' });
});

test('KC-0066: a mulighed that goes to other people keeps tilAndre: true; the app\'s own Fortryd never has it', () => {
  const b = { ...valid.beslutninger[0], muligheder: [{ id: 'bekraeft', label: 'Bekræft tiden', instruktion: 'Lav et udkast til en bekræftelse.', tilAndre: true }, { id: 'ring', label: 'Find nummer', instruktion: 'i', tilAndre: 1 }] };
  const s = parseMailState({ ...valid, beslutninger: [b] }, { tal, ordnet }, NOW);
  assert.equal(s.beslutninger[0]?.muligheder[0]?.tilAndre, true);
  assert.equal('tilAndre' in s.beslutninger[0]!.muligheder[1]!, false);
  assert.equal('tilAndre' in s.ordnet[0]!.handling, false);
});

test('KC-0097: kunFaerdig = an undecided info or kvittering with no mulighed; anything with a real step is not', () => {
  const b = (o: Partial<Beslutning>): Beslutning => ({ mailId: '1', emne: 'e', fra: 'f', modtaget: '', type: 'info', resume: '', betydning: 'b', arkivmappe: 'Archive', muligheder: [], ...o });
  assert.equal(kunFaerdig(b({})), true);
  assert.equal(kunFaerdig(b({ type: 'kvittering' })), true);
  assert.equal(kunFaerdig(b({ type: 'info', muligheder: [{ id: '1-x', label: 'Gør', instruktion: 'i' }] })), false);
  for (const type of ['svar', 'aktion', 'nyhedsbrev', 'regning'] as const) assert.equal(kunFaerdig(b({ type })), false, type);
  assert.equal(kunFaerdig(b({ afgjort: { mulighedId: 'faerdig', tid: '2026-10-27T08:00:00Z' } })), false);
});
