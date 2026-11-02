// KC-0242: fixed inputs for the two things Hermes reads that were still Danish in an English run: the sentence that
// wraps every untrusted or derived data segment (src/agent/udtroet.ts) and the messages the rooms' answer parsers throw
// when Hermes' JSON does not fit (they go back to Hermes in the correction run). The files in
// test/fixtures/sprog-rester-prompt/ (<name>.txt) were captured from these cases BEFORE the words moved into the
// language tables; the Danish output (no language set, and inside medSprog('da')) must equal them byte for byte. The
// data in every case is English with no Danish word, so an English run shows only the words the code itself owns.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/shell/tekster.ts';
import { omslutUtroet } from '../../src/agent/udtroet.ts';
import { kraevJson, parseDagenState } from '../../src/rooms/dagen/schema.ts';
import { parseNyhederState } from '../../src/rooms/nyheder/schema.ts';
import { brugForslag, parseForslag, parseNytDokument, type Dokument, type Forslag } from '../../src/rooms/skrive/schema.ts';
import { parseForberedelse, parseNytUnivers, parseUniversSvar } from '../../src/rooms/univers/schema.ts';
import { parseKuratorSvar } from '../../src/rooms/hjem/kort.ts';

const G = 'a1b2c3d4e5f6a7b8c9d0e1f2';
const NOW = new Date('2026-11-01T10:00:00Z');
const FAKTA = { nyhedsbreve: [], kilder: { rss: 0 } } as never;

/** The message a failing parser throws, with its class: what goes back to Hermes (and what a screen may show). */
const fejl = (f: () => unknown): string => {
  try { f(); } catch (e) { return `${(e as Error).name}: ${(e as Error).message}`; }
  throw new Error('the case did not throw');
};

const dok: Dokument = { id: 'dok-1', titel: 'Draft', brief: 'b', afsnit: [{ id: 'a1', tekst: 'One' }], kilder: [], oprettet: NOW.toISOString(), aendret: NOW.toISOString() };
const forslagTilAfsnit: Forslag = { id: 'f-1', dokId: 'dok-1', afsnitId: 'a9', ny: 'New', hvorfor: '', tid: NOW.toISOString() };
const dag = (extra: Record<string, unknown>): unknown => ({ treLinjer: ['Line'], anbefaling: { tekst: 'Do it' }, ...extra });
const kort = (zone: unknown): unknown => ({ kort: [{ id: 'k-1', type: 'tjeneste', titel: 'T', betyder: 'B', zone }] });

export const RESTER: Record<string, () => string> = {
  // The wrapper around a data segment.
  'omslut-utroet-mail': () => omslutUtroet({ kilde: 'mail', zone: 'privat', tillid: 'utroet', tekst: 'Hello, please read this.' }, { graense: G }),
  'omslut-afledt-husstand': () => omslutUtroet({ kilde: 'nyheder', zone: 'husstand', tillid: 'afledt', tekst: 'A line Hermes wrote.' }, { graense: G }),
  // Dagen.
  'dagen-ingen-json': () => fejl(() => kraevJson('no json here at all')),
  'dagen-ikke-objekt': () => fejl(() => parseDagenState('x', NOW)),
  'dagen-trelinjer': () => fejl(() => parseDagenState({}, NOW)),
  'dagen-anbefaling': () => fejl(() => parseDagenState({ treLinjer: ['Line'] }, NOW)),
  'dagen-handling-ikke-objekt': () => fejl(() => parseDagenState(dag({ anbefaling: { tekst: 'Do it', handling: 'x' } }), NOW)),
  'dagen-handling-mangler': () => fejl(() => parseDagenState(dag({ anbefaling: { tekst: 'Do it', handling: { label: 'Go' } } }), NOW)),
  'dagen-kalender-handling': () => fejl(() => parseDagenState(dag({ kalender: [{ tid: '10.00', titel: 'Meeting', handling: { instruktion: 'x' } }] }), NOW)),
  'dagen-zone-ukendt': () => fejl(() => parseDagenState(dag({ kalender: [{ tid: '10.00', titel: 'Meeting', zone: 'mars' }] }), NOW)),
  'dagen-zone-anden': () => fejl(() => parseDagenState(dag({ morgenavis: [{ titel: 'Story', zone: 'arbejde' }] }), NOW)),
  // Nyheder.
  'nyheder-ikke-objekt': () => fejl(() => parseNyhederState([], FAKTA, NOW)),
  'nyheder-femlinjer': () => fejl(() => parseNyhederState({}, FAKTA, NOW)),
  'nyheder-ingen-baner': () => fejl(() => parseNyhederState({ femLinjer: ['Line'], baner: [] }, FAKTA, NOW)),
  'nyheder-zone-ukendt': () => fejl(() => parseNyhederState({ femLinjer: ['Line'], baner: [{ navn: 'Lane', nyheder: [{ titel: 'Story', zone: 'mars' }] }] }, FAKTA, NOW)),
  'nyheder-zone-anden': () => fejl(() => parseNyhederState({ femLinjer: ['Line'], baner: [{ navn: 'Lane', nyheder: [{ titel: 'Story', zone: 'husstand' }] }] }, FAKTA, NOW)),
  // Skrive.
  'skrive-nyt-ikke-objekt': () => fejl(() => parseNytDokument('x', { brief: 'b' }, NOW)),
  'skrive-ingen-afsnit': () => fejl(() => parseNytDokument({ afsnit: [] }, { brief: 'b' }, NOW)),
  'skrive-forslag-ikke-objekt': () => fejl(() => parseForslag(null, dok, NOW)),
  'skrive-ingen-forslag': () => fejl(() => parseForslag({ forslag: [] }, dok, NOW)),
  'skrive-afsnit-vaek': () => fejl(() => brugForslag(structuredClone(dok), forslagTilAfsnit, NOW)),
  // Univers.
  'univers-ikke-objekt': () => fejl(() => parseUniversSvar('x')),
  'univers-ingen-elementer': () => fejl(() => parseUniversSvar({ elementer: [] })),
  'univers-zone-ukendt': () => fejl(() => parseUniversSvar({ elementer: [{ type: 'note', titel: 'N', tekst: 'text', zone: 'mars' }] })),
  'univers-zone-anden': () => fejl(() => parseUniversSvar({ elementer: [{ type: 'note', titel: 'N', tekst: 'text', zone: 'arbejde' }] })),
  'univers-forberedelse-mangler': () => fejl(() => parseForberedelse({})),
  'univers-forberedelse-maal': () => fejl(() => parseForberedelse({ forberedelse: {} })),
  'univers-forberedelse-talepunkter': () => fejl(() => parseForberedelse({ forberedelse: { maal: 'Goal' } })),
  'univers-nyt-mangler': () => fejl(() => parseNytUnivers({})),
  'univers-nyt-navn': () => fejl(() => parseNytUnivers({ nytUnivers: {} })),
  // Kuratoren (Nu).
  'kurator-ikke-objekt': () => fejl(() => parseKuratorSvar([])),
  'kurator-kort-mangler': () => fejl(() => parseKuratorSvar({})),
  'kurator-vurderinger': () => fejl(() => parseKuratorSvar({ kort: [], vurderinger: 'x' })),
  'kurator-zone-ukendt': () => fejl(() => parseKuratorSvar(kort('mars'))),
  'kurator-zone-anden': () => fejl(() => parseKuratorSvar(kort('arbejde'))),
};

// ---- The check the tests share -------------------------------------------------------------------------------------

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, 'sprog-rester-prompt');
const guld = (navn: string): string => readFileSync(path.join(mappe, `${navn}.txt`), 'utf8');

/** Danish output (no language set, and da chosen) equals the captured files byte for byte; every file has a case. */
export function holdTilGuld(): void {
  const filer = readdirSync(mappe).map((f) => f.replace(/\.txt$/, ''));
  assert.deepEqual(filer.sort(), Object.keys(RESTER).sort(), 'every golden has a case and every case a golden');
  for (const [k, lav] of Object.entries(RESTER)) {
    assert.equal(lav(), guld(k), `${k} (no language)`);
    assert.equal(medSprog('da', lav), guld(k), `${k} (da chosen)`);
  }
}
