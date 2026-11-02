import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stemmeSkrive } from '../../src/rooms/skrive/stemme.ts';
import type { Dokument, SkriveState } from '../../src/rooms/skrive/schema.ts';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/shell/tekster.ts';
import { STEMME_RUM, skriveAktiv, skriveFoerste, skriveTom } from '../fixtures/sprog-golden-stemme-rum.ts';

const dok = (id: string, titel: string): Dokument => ({ id, titel, brief: 'b', afsnit: [{ id: 'a1', tekst: 't' }], kilder: [], oprettet: '2026-10-27T10:00:00Z', aendret: '2026-10-27T10:00:00Z' });

test('résumé names the active draft; punkter are always empty', () => {
  const s: SkriveState = { dokumenter: [dok('dok-1', 'Første'), dok('dok-2', 'Mail til **Anne**.')], aktivt: 'dok-2', forslag: [], hermesStatus: 'ok' };
  assert.deepEqual(stemmeSkrive(s), { rum: 'skrive', resume: 'Et udkast er i gang: Mail til Anne.', punkter: [] });
});

test('without an active id the first draft counts', () => {
  const s: SkriveState = { dokumenter: [dok('dok-1', 'Første')], aktivt: null, forslag: [], hermesStatus: 'ok' };
  assert.equal(stemmeSkrive(s).resume, 'Et udkast er i gang: Første.');
});

test('no drafts or no state: nothing in progress', () => {
  assert.equal(stemmeSkrive({ dokumenter: [], aktivt: null, forslag: [], hermesStatus: 'ok' }).resume, 'Intet udkast i gang.');
  assert.equal(stemmeSkrive(null).resume, 'Intet udkast i gang.');
});

// ---- KC-0241: Danish stays byte for byte --------------------------------------------------------------------------------

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, '../fixtures/sprog-stemme-rum');
const mine = Object.entries(STEMME_RUM).filter(([k]) => k.startsWith('skrive-'));

test('Henrik\'s installation: with no language chosen, and with da chosen, the spoken passages of skrive are byte for byte as before', () => {
  assert.deepEqual(mine.map(([k]) => `${k}.txt`).sort(), readdirSync(mappe).filter((f) => f.startsWith('skrive-')).sort(), 'every golden has a case');
  assert.ok(mine.length > 0);
  for (const [k, lav] of mine) {
    const fil = readFileSync(path.join(mappe, `${k}.txt`), 'utf8');
    assert.equal(lav(), fil, k);
    assert.equal(medSprog('da', lav), fil, `${k} (da chosen)`);
  }
});

// ---- KC-0241: English ---------------------------------------------------------------------------------------------------

test('English: Skrive\'s spoken passage names the draft or says there is none', () => {
  assert.deepEqual(medSprog('en', () => stemmeSkrive(skriveAktiv)), { rum: 'skrive', resume: 'A draft is in progress: Mail to Anne.', punkter: [] });
  assert.equal(medSprog('en', () => stemmeSkrive(skriveFoerste)).resume, 'A draft is in progress: First draft.');
  assert.equal(medSprog('en', () => stemmeSkrive(skriveTom)).resume, 'No draft in progress.');
  assert.equal(medSprog('en', () => stemmeSkrive(null)).resume, 'No draft in progress.');
});
