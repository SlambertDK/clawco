import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bygOversigt, oversigtAf } from '../../src/stemme/oversigt.ts';
import type { RoomDeps, RoomModule } from '../../src/rooms/module.ts';
import type { StemmeRum } from '../../src/stemme/types.ts';

const mail: StemmeRum = { rum: 'mail', resume: '2 mails venter på din beslutning.', punkter: [
  { id: 'xyz', sig: 'Mail fra Anne: Tilbud.', valg: [{ id: 'xyz-ring', label: 'Ring' }, { id: 'aktion:faerdig:xyz', label: 'Færdig' }] },
  { id: 'abc', sig: 'Mail fra Bo: Faktura.', valg: [{ id: 'aktion:faerdig:abc', label: 'Færdig' }] },
] };
const dagen: StemmeRum = { rum: 'dagen', resume: 'Fire møder i dag.', punkter: [{ id: 'anb', sig: 'Min anbefaling: Flyt mødet.', valg: [{ id: 'anb', label: 'Flyt mødet' }] }] };
const skrive: StemmeRum = { rum: 'skrive', resume: 'Intet udkast i gang.', punkter: [] };

test('oversigtAf: count line, room résumés with room names, numbered punkter with id markers', () => {
  const o = oversigtAf([mail, dagen, skrive]);
  assert.deepEqual(o.tekst.split('\n'), [
    'Der venter 3 ting.',
    'Mail: 2 mails venter på din beslutning.',
    'Dagen: Fire møder i dag.',
    'Skrive: Intet udkast i gang.',
    '1. Mail fra Anne: Tilbud. Valg: Ring (id mail:xyz-ring), Færdig (id mail:aktion:faerdig:xyz).',
    '2. Mail fra Bo: Faktura. Valg: Færdig (id mail:aktion:faerdig:abc).',
    '3. Min anbefaling: Flyt mødet. Valg: Flyt mødet (id dagen:anb).',
  ]);
  assert.deepEqual(o.punkter.map((p) => [p.nr, p.rum, p.id]), [[1, 'mail', 'xyz'], [2, 'mail', 'abc'], [3, 'dagen', 'anb']]);
});

test('oversigtAf: singular, and nothing waiting', () => {
  assert.equal(oversigtAf([dagen]).tekst.split('\n')[0], 'Der venter én ting.');
  const tom = oversigtAf([{ ...mail, punkter: [] }, skrive]);
  assert.equal(tom.tekst.split('\n')[0], 'Intet venter på dig lige nu.');
  assert.deepEqual(tom.punkter, []);
});

test('oversigtAf orders mail, dagen, nyheder, skrive and puts unknown rooms last', () => {
  const nyheder: StemmeRum = { rum: 'nyheder', resume: 'Avisen.', punkter: [] };
  const bank: StemmeRum = { rum: 'bank', resume: 'Saldo.', punkter: [] };
  const linjer = oversigtAf([bank, skrive, nyheder, dagen, mail]).tekst.split('\n').slice(1, 6);
  assert.deepEqual(linjer.map((l) => l.split(':')[0]), ['Mail', 'Dagen', 'Nyheder', 'Skrive', 'Bank']);
});

test('bygOversigt calls every stemme hook, skips rooms without one and logs-and-skips a throwing hook', async () => {
  const mod = (id: string, stemme?: RoomModule['stemme']): RoomModule => ({ id, ...(stemme ? { stemme } : {}) } as unknown as RoomModule);
  const fejl = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    const o = await bygOversigt([
      mod('skrive', async () => skrive),
      mod('mail', async () => mail),
      mod('hjem'),
      mod('nyheder', async () => { throw new Error('boom'); }),
    ], {} as RoomDeps);
    assert.equal(logged.length, 1);
    assert.match(String(logged[0]?.[0]), /nyheder/);
    assert.equal(o.punkter.length, 2);
    assert.deepEqual(o.tekst.split('\n').slice(1, 3), ['Mail: 2 mails venter på din beslutning.', 'Skrive: Intet udkast i gang.']);
  } finally {
    console.error = fejl;
  }
});

test('KC-0114: oversigtAf takes the situation\'s order; without one it keeps mail, dagen, nyheder, skrive', () => {
  const linjer = (o?: readonly string[]) => oversigtAf([skrive, dagen, mail], o).tekst.split('\n').slice(1, 4).map((l) => l.split(':')[0]);
  assert.deepEqual(linjer(['dagen', 'mail', 'nyheder', 'skrive']), ['Dagen', 'Mail', 'Skrive']);
  assert.deepEqual(linjer(), ['Mail', 'Dagen', 'Skrive']);
});

test('KC-0114: bygOversigt passes the order on', async () => {
  const mod = (r: StemmeRum): RoomModule => ({ id: r.rum, stemme: async () => r } as unknown as RoomModule);
  const o = await bygOversigt([mod(mail), mod(dagen)], {} as RoomDeps, ['dagen', 'mail']);
  assert.equal(o.tekst.split('\n')[1]?.split(':')[0], 'Dagen');
});
