import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stemmeDagen } from '../../src/rooms/dagen/stemme.ts';
import { renderDagen } from '../../src/rooms/dagen/render.ts';
import type { DagenState } from '../../src/rooms/dagen/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/shell/tekster.ts';
import { STEMME_RUM, stemmeTekster, dagenState, dagenAnbefaling, dagenMedTid, dagenUdenKlokke } from '../fixtures/sprog-golden-stemme-rum.ts';
import { danskeLinjer } from '../fixtures/sprog-tjek.ts';
import { sigAnbefaling, sigKalender } from '../../src/rooms/dagen/stemme.ts';

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

// ---- KC-0241: Danish stays byte for byte --------------------------------------------------------------------------------

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, '../fixtures/sprog-stemme-rum');
const mine = Object.entries(STEMME_RUM).filter(([k]) => k.startsWith('dagen-'));

test('Henrik\'s installation: with no language chosen, and with da chosen, the spoken passages of dagen are byte for byte as before', () => {
  assert.deepEqual(mine.map(([k]) => `${k}.txt`).sort(), readdirSync(mappe).filter((f) => f.startsWith('dagen-')).sort(), 'every golden has a case');
  assert.ok(mine.length > 0);
  for (const [k, lav] of mine) {
    const fil = readFileSync(path.join(mappe, `${k}.txt`), 'utf8');
    assert.equal(lav(), fil, k);
    assert.equal(medSprog('da', lav), fil, `${k} (da chosen)`);
  }
});

// ---- KC-0241: English ---------------------------------------------------------------------------------------------------

test('English: Dagen\'s spoken passages have no Danish word of the code\'s own', () => {
  const en = medSprog('en', () => stemmeDagen(dagenState(dagenUdenKlokke), []));
  assert.ok(en.punkter.length === 3);
  assert.deepEqual(danskeLinjer(stemmeTekster(en).join('\n')), []);
  assert.equal(en.resume, 'Four meetings today. Rain in the afternoon. The bill is due.');
  assert.deepEqual(medSprog('en', () => stemmeDagen(null, [])), { rum: 'dagen', resume: 'Today has not been built yet.', punkter: [] });
  assert.equal(medSprog('en', () => sigAnbefaling(dagenAnbefaling)), 'My recommendation: Move the meeting to 14 <soon>.');
});

test('English: a calendar sentence says "you have" and "I can", starts with a capital and keeps the clock helper\'s words', () => {
  // The clock words are src/stemme/tale.ts's (they change with the language there); only the room's own words are judged.
  assert.equal(medSprog('en', () => sigKalender(dagenUdenKlokke[0]!)), 'Noon you have Status meeting. I can: Call Anne.');
  assert.equal(medSprog('en', () => sigKalender(dagenUdenKlokke[1]!)), 'Evening you have Lunch.');
  const klokke = medSprog('en', () => sigKalender(dagenMedTid[0]!));
  assert.match(klokke, /^[A-Z]\S* .* you have Status meeting\. I can: Call Anne\.$/);
  assert.doesNotMatch(klokke, /har du|Jeg kan/);
});

test('English: the choices keep the room\'s own labels and the open/done logic is the same', () => {
  const en = medSprog('en', () => stemmeDagen(dagenState(dagenUdenKlokke), [entry('rec-move')]));
  assert.deepEqual(en.punkter.map((p) => p.id), ['cal-1-call', 'cal-3-cancel']);
  assert.deepEqual(en.punkter[0]?.valg, [{ id: 'cal-1-call', label: 'Call Anne' }]);
});

test('the render\'s data-sig follows the language too', () => {
  const out = medSprog('en', () => String(renderDagen(dagenState(dagenUdenKlokke), [], new Date('2026-10-27T09:00:00Z'))));
  assert.match(out, /data-sig="My recommendation: Move the meeting to 14 &lt;soon&gt;\./);
  assert.match(out, /data-sig="Noon you have Status meeting\. I can: Call Anne\./);
  assert.doesNotMatch(out, /Min anbefaling|har du|Jeg kan/);
});
