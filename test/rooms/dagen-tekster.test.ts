// KC-0170 slice 2: the screen of Dagen in English or Danish. Danish (no language chosen, or da chosen) renders byte for
// byte as before (test/fixtures/sprog-dagen/, captured before the strings moved); English has no Danish word left in
// what the room itself says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAGEN_TEKSTER, dagenTekst } from '../../src/rooms/dagen/tekster.ts';
import { renderDagen } from '../../src/rooms/dagen/render.ts';
import { ikon } from '../../src/shell/visuel.ts';
import { dagenRoom } from '../../src/rooms/dagen/room.ts';
import { ventendeDagen, venterDagen } from '../../src/rooms/dagen/schema.ts';
import { medSprog } from '../../src/shell/tekster.ts';
import type { RoomDeps } from '../../src/rooms/module.ts';
import { DAGEN, DAGEN_NU, dagenFuld } from '../fixtures/sprog-golden-dagen.ts';
import { form, tomme, ensStrenge, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog-dagen', navn), 'utf8');
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

/** Strings that are the same in both languages on purpose (a name, or a word English borrows). */
const ENS = new Set<string>();

// The reason of a line for what Clawco never does comes from src/graenser/afgoer.ts, Danish for now.
const dansk = (doc: string): string[] => danskeLinjer(doc).filter((l) => !/betaler aldrig/.test(l));

test('English has exactly Danish\'s keys and shapes; no string is empty; no Danish string copied over', () => {
  assert.deepEqual(form(DAGEN_TEKSTER.en), form(DAGEN_TEKSTER.da));
  for (const t of [DAGEN_TEKSTER.da, DAGEN_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(DAGEN_TEKSTER.da), tabel(DAGEN_TEKSTER.en)).filter((k) => !ENS.has(k)), []);
});

test('Henrik\'s installation: with no language chosen Dagen renders byte for byte as before', () => {
  // One difference is allowed, as in slice 1: an apostrophe that was literal markup now comes through the escaper as
  // &#39;, which the browser shows as the same character.
  const samme = (s: string): string => s.replaceAll('&#39;', "'");
  const filer = readdirSync(path.join(rod, '../fixtures/sprog-dagen')).sort();
  assert.deepEqual(Object.keys(DAGEN).map((k) => `dagen-${k}.html`).sort(), filer, 'every golden has a case');
  for (const [k, lav] of Object.entries(DAGEN)) {
    assert.equal(samme(lav()), samme(fixtur(`dagen-${k}.html`)), k);
    assert.equal(samme(medSprog('da', lav)), samme(fixtur(`dagen-${k}.html`)), `${k} (da chosen)`);
  }
});

test('the Danish detector works: the Danish full screen is full of Danish lines', () => {
  assert.ok(dansk(DAGEN['fuld']!()).length > 10, String(dansk(DAGEN['fuld']!()).length));
});

test('English: Dagen has no Danish word in what the room says, in any of its screens', () => {
  for (const [k, lav] of Object.entries(DAGEN)) assert.deepEqual(dansk(medSprog('en', lav)), [], k);
});

test('English: the full screen reads as English chrome, with English weekday and month names', () => {
  const doc = medSprog('en', DAGEN['fuld']!);
  for (const re of [
    /<h1>Today<\/h1>/, /Monday 26 Oct/, /Tuesday 27 Oct/, /Sunday 1 Nov/, />Calendar</, /4 appointments/, />The morning paper</, /2 picked/, /The week ahead/, /3 days/,
    /The day in three lines/, />Recommendation</, /data-element="Recommendation: Use the free hour on the draft\."/, /data-element="Meeting at 10\.00: Operations: winter plan"/,
    /data-element="News item: Energy firm tightens reserves"/, />ready</, />moved</, />cancelled</, /Undone at 06:30/, />Undo</, /Refresh/, /Hermes(?:'|&#39;) work today/,
  ]) assert.match(doc, re);
  assert.match(medSprog('en', DAGEN['tomKalender']!), /No timed appointments today\./);
  assert.match(medSprog('en', DAGEN['gammel']!), /Today has not been built/);
  assert.match(medSprog('en', DAGEN['gammel']!), />Build today now</);
  const tomt = medSprog('en', DAGEN['rumTomt']!);
  for (const re of [/No data yet/, /The room is empty/, /No data for today yet\./, /Ask Hermes to fetch the day/]) assert.match(tomt, re);
});

test('English weather words pick the weather pictogram too, as the Danish ones do', () => {
  const med = (vejr: string): string => String(renderDagen({ ...dagenFuld, vejr }, [], DAGEN_NU));
  assert.ok(med('7 °C, rain from 11').includes(String(ikon('cloud-rain'))));
  assert.ok(med('sunny, 18 degrees').includes(String(ikon('sun'))));
  assert.ok(med('cloudy, 12 degrees').includes(String(ikon('cloud-sun'))));
  assert.ok(med('7 °C, regn fra 11').includes(String(ikon('cloud-rain'))));
});

// ---- Nu: the lines the room reports -----------------------------------------------------------------------------------

const deps = (): RoomDeps => ({
  store: { readState: async () => dagenFuld, readLog: async () => [] },
  person: { id: 'o', login: null, navn: 'Owner', rolle: 'ejer' },
  now: () => DAGEN_NU, runs: { igang: () => [] }, hermes: { harVaerktoejer: true },
}) as unknown as RoomDeps;

test('Nu: Dagen\'s lines are Danish with no language chosen (ventendeDagen\'s own) and English when en', async () => {
  const da = await dagenRoom.hjemVenter(deps());
  assert.deepEqual(da.map((l) => l.tekst), ventendeDagen(dagenFuld, [], DAGEN_NU));
  assert.equal(da.length, venterDagen(dagenFuld, [], DAGEN_NU));
  assert.ok(da.every((l) => l.roomId === 'dagen'));
  const en = (await medSprog('en', () => dagenRoom.hjemVenter(deps()))).map((l) => l.tekst);
  assert.deepEqual(en, ['Recommendation: Use the free hour on the draft.', 'Prepare: Operations: winter plan at 10.00', 'Pay the bill: Lunch at 12.00']);
  assert.equal(en.length, da.length, 'the nav\'s count and Nu\'s lines stay one list');
  assert.deepEqual(en.filter((t) => danskeLinjer(t).length), []);
});

test('Nu: an old Dagen that must be built says so in the chosen language', async () => {
  const gammel = (): RoomDeps => ({ ...(deps() as object), store: { readState: async () => ({ ...dagenFuld, genereret: '2026-10-25T06:00:00.000Z' }), readLog: async () => [] } }) as unknown as RoomDeps;
  assert.deepEqual((await dagenRoom.hjemVenter(gammel())).map((l) => l.tekst), ['Dagen er ikke bygget i dag']);
  assert.deepEqual((await medSprog('en', () => dagenRoom.hjemVenter(gammel()))).map((l) => l.tekst), ['Today has not been built']);
  assert.equal(dagenTekst().nuIkkeBygget, 'Dagen er ikke bygget i dag');
});

test('the room view\'s empty state says why in the chosen language', async () => {
  const tom = (): RoomDeps => ({ ...(deps() as object), store: { readState: async () => null, readLog: async () => [] } }) as unknown as RoomDeps;
  assert.match(String((await dagenRoom.view(tom())).main), /Ingen data for i dag endnu\./);
  const en = String((await medSprog('en', () => dagenRoom.view(tom()))).main);
  assert.match(en, /No data for today yet\./);
  assert.deepEqual(dansk(en), []);
});

test('KC-0241: the spoken passages have their own section: same shape in both languages, none empty, no Danish copied, no Danish in English', () => {
  const da = DAGEN_TEKSTER.da.stemme as Record<string, unknown>;
  const en = DAGEN_TEKSTER.en.stemme as Record<string, unknown>;
  assert.ok(da && en && Object.keys(da).length > 0);
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(en), []);
  assert.deepEqual(ensStrenge(da, en), []);
  assert.deepEqual(danskeLinjer(Object.values(en).filter((v): v is string => typeof v === 'string').join('\n')), []);
});
