import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stemmeDagen } from '../../src/rooms/dagen/stemme.ts';
import { renderDagen } from '../../src/rooms/dagen/render.ts';
import type { DagenState } from '../../src/rooms/dagen/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';

const state: DagenState = {
  dato: '2026-10-27', genereret: '2026-10-27T05:00:00Z',
  treLinjer: ['Fire møder i dag', 'Regn om eftermiddagen.', 'Elregningen forfalder'],
  anbefaling: { tekst: 'Flyt mødet kl. 14 <hurtigt>', handling: { id: 'anb-flyt', label: 'Flyt mødet', instruktion: 'i' } },
  kalender: [
    { tid: '10:00', titel: 'Statusmøde', handling: { id: 'kal-1-ring', label: 'Ring til Anne', instruktion: 'i' } },
    { tid: '13:30', titel: 'Frokost' },
    { tid: '15:00', titel: 'Review', handling: { id: 'kal-3-aflys', label: 'Aflys', instruktion: 'i' } },
  ],
  morgenavis: [], hermesStatus: 'ok',
};
const entry = (handlingId: string, extra: Partial<LogEntry> = {}): LogEntry => ({ id: `l-${handlingId}`, tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Gjort.', handlingId, ...extra });

test('résumé is the three lines as sentences; punkter are the open anbefaling and open calendar handlinger', () => {
  const r = stemmeDagen(state, []);
  assert.equal(r.rum, 'dagen');
  assert.equal(r.resume, 'Fire møder i dag. Regn om eftermiddagen. Elregningen forfalder.');
  assert.deepEqual(r.punkter.map((p) => p.id), ['anb-flyt', 'kal-1-ring', 'kal-3-aflys']);
  assert.deepEqual(r.punkter[0]?.valg, [{ id: 'anb-flyt', label: 'Flyt mødet' }]);
  assert.match(r.punkter[0]?.sig ?? '', /^Min anbefaling: Flyt mødet kl\. 14/);
  assert.equal(r.punkter[1]?.sig, 'Klokken 10 har du Statusmøde. Jeg kan: Ring til Anne.');
});

test('handlinger with a result in the log are no longer punkter; an undone result counts as open again', () => {
  const r = stemmeDagen(state, [entry('anb-flyt'), entry('kal-1-ring', { fortrudt: '2026-10-27T08:30:00Z' })]);
  assert.deepEqual(r.punkter.map((p) => p.id), ['kal-1-ring', 'kal-3-aflys']);
});

test('no state: résumé says the day is not built, no punkter', () => {
  assert.deepEqual(stemmeDagen(null, []), { rum: 'dagen', resume: 'Dagen er ikke bygget endnu.', punkter: [] });
});

test('renderDagen adds escaped data-sig on the anbefaling and open calendar rows only', () => {
  const out = String(renderDagen(state, [entry('kal-3-aflys')], new Date('2026-10-27T09:00:00Z')));
  assert.equal(out.match(/data-sig="/g)?.length, 2);
  assert.match(out, /class="dagen-anbefaling" data-element="Anbefalingen: [^"]*" data-sig="Min anbefaling: Flyt mødet kl\. 14 &lt;hurtigt&gt;\./);
  assert.match(out, /data-sig="Klokken 10 har du Statusmøde\./);
  assert.doesNotMatch(out, /data-sig="[^"]*<hurtigt>/);
  const done = String(renderDagen(state, [entry('anb-flyt'), entry('kal-1-ring'), entry('kal-3-aflys')], new Date()));
  assert.doesNotMatch(done, /data-sig=/);
});
