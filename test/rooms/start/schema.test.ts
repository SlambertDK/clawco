// KC-0126: the profile (name, language, alone or household) and Start's state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavProfilLager, parseStartState, ProfilFejl, validerProfil } from '../../../src/rooms/start/schema.ts';
import { renderStart } from '../../../src/rooms/start/render.ts';
import { alleTrin } from '../../../src/rooms/start/trin.ts';

const god = { navn: 'Alma', sprog: 'da', husstand: 'alene' };

test('a valid profile is accepted, the name trimmed', () => {
  assert.deepEqual(validerProfil({ ...god, navn: '  Alma  ' }), god);
  assert.deepEqual(validerProfil({ navn: 'A'.repeat(60), sprog: 'en', husstand: 'husstand' }), { navn: 'A'.repeat(60), sprog: 'en', husstand: 'husstand' });
});

test('an empty name, 61 characters, a bad language or a bad household is refused', () => {
  for (const bad of [{ ...god, navn: '' }, { ...god, navn: '   ' }, { ...god, navn: 'A'.repeat(61) }, { ...god, sprog: 'de' }, { ...god, husstand: 'familie' }, { ...god, navn: 7 }, null, 'Alma', { ...god, navn: 'Al\u0000ma' }]) {
    assert.throws(() => validerProfil(bad), ProfilFejl, JSON.stringify(bad));
  }
});

test('the lager writes atomically and reads back; no file = null; a broken file fails closed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-profil-'));
  try {
    const l = lavProfilLager(dir);
    assert.equal(await l.laes(), null);
    await l.skriv({ navn: 'Alma', sprog: 'da', husstand: 'alene' });
    assert.deepEqual(await l.laes(), god);
    assert.deepEqual((await readdir(dir)).filter((f) => f.includes('.tmp')), [], 'no tmp file left');
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'profil.json'), 'utf8')), god);
    await assert.rejects(() => l.skriv({ ...god, navn: '' } as never), ProfilFejl);
    await l.fjern();
    assert.equal(await l.laes(), null);
    await writeFile(path.join(dir, 'profil.json'), '{"navn":', 'utf8');
    await assert.rejects(() => l.laes(), ProfilFejl);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('parseStartState keeps valid steps and drops unknown statuses', () => {
  const s = parseStartState({ startet: '2026-10-31T08:00:00.000Z', trin: { velkommen: { status: 'klaret', tid: '2026-10-31T08:01:00.000Z' }, x: { status: 'flot' } }, afvist: { 'kal': '2026-10-01T00:00:00.000Z', bad: 3 } });
  assert.ok(s);
  assert.deepEqual(s.trin, { velkommen: { status: 'klaret', tid: '2026-10-31T08:01:00.000Z' } });
  assert.deepEqual(s.afvist, { kal: '2026-10-01T00:00:00.000Z' });
  assert.equal(parseStartState(null), null);
  assert.equal(parseStartState({ trin: {} }), null, 'no startet');
});

test('HTML in the name is escaped on render', () => {
  const h = String(renderStart({ trin: alleTrin().map((t) => ({ trin: t, status: 'klaret' as const })), profil: { navn: '<script>alert(1)</script>', sprog: 'da', husstand: 'alene' }, standardNavn: '', forslag: [], kanGemme: true }));
  assert.ok(!h.includes('<script>alert(1)</script>'));
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('KC-0263: the GitHub login name is kept with the model choice; nothing else of GitHub, and a strange name is dropped', () => {
  const s = parseStartState({ startet: '2026-11-03T09:00:00.000Z', trin: {}, afvist: {}, model: { udbyder: 'copilot', noegle: { laengde: 40, tid: '2026-11-03T09:01:00.000Z' }, github: { login: 'henrik-l', email: 'x@y.z' } } });
  assert.deepEqual(s?.model, { udbyder: 'copilot', noegle: { laengde: 40, tid: '2026-11-03T09:01:00.000Z' }, github: { login: 'henrik-l' } });
  const ond = parseStartState({ startet: '2026-11-03T09:00:00.000Z', trin: {}, afvist: {}, model: { udbyder: 'copilot', github: { login: '<script>' } } });
  assert.deepEqual(ond?.model, { udbyder: 'copilot' });
});
