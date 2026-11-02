import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stemmeSkrive } from '../../src/rooms/skrive/stemme.ts';
import type { Dokument, SkriveState } from '../../src/rooms/skrive/schema.ts';

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
