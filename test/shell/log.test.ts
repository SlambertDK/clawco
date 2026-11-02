import { test } from 'node:test';
import assert from 'node:assert/strict';
import { senesteResultater } from '../../src/shell/log.ts';

test('senesteResultater keeps the newest non-undone entry per handling id', () => {
  const m = senesteResultater([
    { id: 'c', tid: '2026-10-27T09:00:00Z', kilde: 'hermes', tekst: 'nyest men fortrudt', handlingId: 'h1', fortrudt: '2026-10-27T09:30:00Z' },
    { id: 'b', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'gælder', handlingId: 'h1' },
    { id: 'a', tid: '2026-10-27T07:00:00Z', kilde: 'hermes', tekst: 'ældre', handlingId: 'h1' },
    { id: 'd', tid: '2026-10-27T07:00:00Z', kilde: 'system', tekst: 'uden handling' },
  ]);
  assert.equal(m.get('h1')?.tekst, 'gælder');
  assert.equal(m.size, 1);
});

test('KC-0064: resultatBoks keeps the text and labels it Hermes · time with the ordnet chip', async () => {
  const { resultatBoks } = await import('../../src/shell/log.ts');
  const out = String(resultatBoks({ id: 'l', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Blokken er <oprettet>.' }));
  assert.match(out, /^<div class="resultat">/);
  assert.match(out, /class="chip tilstand-ordnet"><svg[^>]*>[\s\S]*?<\/svg>Hermes · 09\.00<\/span>/);
  assert.match(out, /Blokken er &lt;oprettet&gt;\./);
});

test('KC-0064: dagensLog keeps the last 24 hours', async () => {
  const { dagensLog } = await import('../../src/shell/log.ts');
  const now = new Date('2026-10-30T12:00:00Z');
  const kept = dagensLog([
    { tid: '2026-10-30T11:00:00Z' },
    { tid: '2026-10-29T12:30:00Z' },
    { tid: '2026-10-29T11:00:00Z' },
    { tid: 'x' },
  ], now);
  assert.deepEqual(kept.map((e) => e.tid), ['2026-10-30T11:00:00Z', '2026-10-29T12:30:00Z']);
});
