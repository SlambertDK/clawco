// KC-0117: data zones in Hjem — Kuratoren's cards, Hjem's own log lines and the spoken overview.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SvarFejl } from '../../src/svarfejl.ts';
import { parseKuratorSvar, mergeKort, kunSynlige, type Kort, type KuratorState } from '../../src/rooms/hjem/kort.ts';
import { renderHjem, hjemEgne } from '../../src/rooms/hjem/render.ts';
import { synligKurator } from '../../src/kurator/kurator.ts';
import { medKuratorKort } from '../../src/stemme/oversigt.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const henrik: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const maja: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const gaest: Person = { id: 'gus', login: null, navn: 'Gus', rolle: 'gaest' };
const NOW = new Date('2026-10-27T10:00:00Z');

const raa = (extra: Record<string, unknown> = {}) => ({ id: 'mail:1', type: 'tjeneste', titel: 'T', betyder: 'B', anbefaling: 'A', prioritet: 3, ...extra });
function kort(id: string, extra: Partial<Kort> = {}): Kort {
  return { id, type: 'tjeneste', titel: `Titel ${id}`, betyder: `Betyder ${id}`, grundlag: [], kilder: [], anbefaling: 'Gør noget', prioritet: 5, zone: 'privat', ...extra };
}

test('parseKuratorSvar: an unknown zone, or a zone the run did not read, is rejected like any schema error; no zone → privat', () => {
  assert.throws(() => parseKuratorSvar({ kort: [raa({ zone: 'firma' })] }), SvarFejl);
  assert.throws(() => parseKuratorSvar({ kort: [raa({ zone: 'arbejde' })] }), SvarFejl);
  assert.throws(() => parseKuratorSvar({ kort: [], intet: [{ titel: 'X', hvorfor: 'y', zone: 'firma' }] }), SvarFejl);
  const svar = parseKuratorSvar({ kort: [raa(), raa({ id: 'mail:2', zone: 'privat' })], intet: [{ titel: 'X', hvorfor: 'y' }] });
  assert.deepEqual(svar.nye.map((k) => k.zone), ['privat', 'privat']);
  assert.equal(svar.intet[0]!.zone, 'privat');
});

test('mergeKort: a card pushed out for room keeps its zone and owner in "intet"', () => {
  const mange = Array.from({ length: 8 }, (_, i) => kort(`k${i}`, { prioritet: i + 1, ...(i === 7 ? { zone: 'husstand' as const, ejer: 'maja' } : {}) }));
  const ud = mergeKort({ kort: [], intet: [], afvist: [], sete: [] }, { nye: mange, behold: [], opdater: [], fjern: [], intet: [] }, NOW, 'privat');
  assert.deepEqual(ud.intet[0], { titel: 'Titel k7', hvorfor: 'plads', zone: 'husstand', ejer: 'maja' });
});

const gammelKort = (id: string): Kort => { const k = kort(id); delete k.zone; return k; }; // a card stored before zones existed

test('kunSynlige: a foreign privat element is dropped; husstand is for a member and not for a guest; no ejer = the owner', () => {
  const liste = [kort('egen'), kort('andens', { ejer: 'anden' }), kort('hus', { zone: 'husstand' }), kort('arb', { zone: 'arbejde', ejer: 'henrik' }), gammelKort('gammel')];
  assert.deepEqual(kunSynlige(liste, henrik).map((k) => k.id), ['egen', 'hus', 'arb', 'gammel']);
  assert.deepEqual(kunSynlige(liste, maja).map((k) => k.id), ['hus']);
  assert.deepEqual(kunSynlige(liste, gaest).map((k) => k.id), []);
  assert.equal(kunSynlige(liste, undefined).length, 5); // no person given: the caller filtered
});

test('synligKurator drops cards, "intet", closed cards and ledger rows the person may not see', () => {
  const s: KuratorState = {
    kort: [kort('a'), kort('b', { ejer: 'anden' })], intet: [{ titel: 'egen', hvorfor: '', zone: 'privat' }, { titel: 'andens', hvorfor: '', zone: 'privat', ejer: 'anden' }],
    afvist: ['x'], sete: ['y'],
    lukket: [{ id: 'l1', titel: 'L1', grund: '', dato: 'd', zone: 'privat' }, { id: 'l2', titel: 'L2', grund: '', dato: 'd', zone: 'privat', ejer: 'anden' }],
    regnskab: { r1: { hvor: 'privat', status: 'skrevet', zone: 'privat' }, r2: { hvor: 'privat', status: 'skrevet', zone: 'privat', ejer: 'anden' } },
  };
  const ud = synligKurator(s, henrik);
  assert.deepEqual(ud.kort.map((k) => k.id), ['a']);
  assert.deepEqual(ud.intet.map((i) => i.titel), ['egen']);
  assert.deepEqual(ud.lukket?.map((l) => l.id), ['l1']);
  assert.deepEqual(Object.keys(ud.regnskab ?? {}), ['r1']);
  assert.deepEqual(ud.afvist, ['x']); // the lists of ids are not elements
});

test('renderHjem: root and log lines carry data-datazone, the card has a zone chip; a foreign card, its intet line and its ledger row are absent', () => {
  const out = String(renderHjem({
    hilsen: 'Hej', venter: [], now: NOW, person: henrik,
    hermes: [{ tid: '2026-10-27T09:00:00Z', tekst: 'Egen linje', zone: 'husstand' }, { tid: '2026-10-27T09:01:00Z', tekst: 'Andens linje', ejer: 'anden' }],
    kort: [kort('egen'), kort('fremmed', { titel: 'Fremmedkort', ejer: 'anden' }), kort('hus', { zone: 'husstand' })],
    intet: [{ titel: 'Andens intet', hvorfor: '', zone: 'privat', ejer: 'anden' }],
    regnskab: [{ id: 'r', hvor: 'privat', leverandoer: 'Andens leverandør', zone: 'privat', ejer: 'anden' }],
  }));
  assert.match(out, /data-kort-id="egen"[^>]*data-datazone="privat"/);
  assert.match(out, /data-kort-id="hus"[^>]*data-datazone="husstand"/);
  assert.match(out, /zone-chip/);
  assert.match(out, /log-row[^>]*data-datazone="husstand"/);
  for (const skjult of ['Fremmedkort', 'Andens intet', 'Andens leverandør', 'Andens linje']) assert.ok(!out.includes(skjult), skjult);
});

test('renderHjem and hjemEgne agree: the count is of the cards the person sees', () => {
  const kortene = [kort('egen'), kort('fremmed', { ejer: 'anden' }), kort('hus', { zone: 'husstand' })];
  assert.equal(hjemEgne({ kort: kortene, person: henrik }), 2);
  assert.equal(hjemEgne({ kort: kortene, person: maja }), 1);
  assert.equal(hjemEgne({ kort: kortene, person: gaest }), 0);
});

test('medKuratorKort: the spoken overview names only the cards the person may see', () => {
  const o = { tekst: 'Der venter 0 ting.', punkter: [] };
  const kortene = [kort('egen', { titel: 'Eget', prioritet: 1 }), kort('fremmed', { titel: 'Fremmed', ejer: 'anden', prioritet: 1 }), kort('hus', { titel: 'Fælles', zone: 'husstand', prioritet: 2 })];
  const mig = medKuratorKort(o, kortene, henrik, NOW).tekst;
  assert.match(mig, /Kuratoren har 2 kort til dig/);
  assert.ok(mig.includes('Eget') && mig.includes('Fælles') && !mig.includes('Fremmed'));
  assert.ok(medKuratorKort(o, kortene, gaest, NOW).tekst === o.tekst);
});

test('mergeKort: a run over one zone never rewrites, relabels or retires a card of another zone', () => {
  const husstand: Kort = { ...kort('fam'), zone: 'husstand' };
  const privat: Kort = { ...kort('mig'), zone: 'privat' };
  const state: KuratorState = { kort: [husstand, privat], intet: [], afvist: [], sete: [] };
  // The privat run "updates" the family card (as privat) and does not stand by it — neither may touch it.
  const ud = mergeKort(state, { nye: [], behold: ['mig'], opdater: [{ ...husstand, titel: 'omskrevet', zone: 'privat' }], fjern: [], intet: [] }, NOW, 'privat');
  const fam = ud.kort.find((k) => k.id === 'fam');
  assert.ok(fam, 'the other zone\'s card is kept, not retired');
  assert.equal(fam.zone, 'husstand');
  assert.equal(fam.titel, husstand.titel);
  assert.ok(ud.kort.some((k) => k.id === 'mig'));
});
