// KC-0189 × KC-0187: the poller feeds the existing `tenant-usund` rule. Five consecutive minutes of syg raise one alert
// (mail + error event); recovery clears it; an upgrading tenant never counts. No alert logic lives in the poller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poller, type PollerDeps } from '../../../src/drift/helbred/poller.ts';
import { alarmer } from '../../../src/drift/alarm.ts';
import { falskPost } from '../../../src/delt/post.ts';
import { lavFejlrapport, type Haendelse } from '../../../src/delt/fejlrapport-kerne.ts';
import { nyDb, ur } from '../../konto/hjaelp.ts';
import { komponentDeps } from './hjaelp.ts';

const SHA = 'abc1234';

test('five syg minutes raise tenant-usund once through the KC-0187 rules; recovery clears it', async () => {
  const db = await nyDb();
  try {
    const u = ur('2026-11-02T10:00:00.000Z');
    const post = falskPost();
    const events: Haendelse[] = [];
    const a = alarmer({ post, til: 'drift@example.test', rapport: lavFejlrapport({ transport: async (_k, h) => { events.push(h); }, release: SHA }), log: () => {} });
    let syg = true;
    const d: PollerDeps = {
      db,
      tenanter: async () => [{ slug: 'hus-aaaaaaaa', adresse: 'http://10.0.0.2:8750', release: SHA }, { slug: 'hus-bbbbbbbb', adresse: 'http://10.0.0.3:8750', release: SHA }],
      sundhed: async (adresse) => (syg && adresse.endsWith('.2:8750') ? { ok: false, sha: null } : { ok: true, sha: SHA }),
      komponenter: komponentDeps(db),
      usunde: async (liste, nu) => { await a.vurder({ usunde: liste }, nu); },
      nu: u.nu,
      log: () => {},
    };
    const p = poller(d);
    // Minutes 0..4: syg, not yet five minutes.
    for (let i = 0; i < 5; i++) { await p.gennemloeb(); u.frem(60_000); }
    assert.equal(post.udbakke.length, 0);
    // Minute 5: five minutes since the first syg pass.
    await p.gennemloeb();
    assert.equal(post.udbakke.length, 1);
    assert.equal(post.udbakke[0]!.data['titel'], 'Kunde svarer ikke');
    assert.match(post.udbakke[0]!.data['tekst']!, /1 kunde .*hus-aaaaaaaa/);
    assert.equal(events.length, 1);
    // Still syg: no second alert.
    u.frem(60_000);
    await p.gennemloeb();
    assert.equal(post.udbakke.length, 1);
    // Recovered: cleared. Syg again: a new five-minute wait, then a new alert.
    syg = false;
    u.frem(60_000);
    await p.gennemloeb();
    syg = true;
    for (let i = 0; i < 5; i++) { u.frem(60_000); await p.gennemloeb(); }
    assert.equal(post.udbakke.length, 1);
    u.frem(60_000);
    await p.gennemloeb();
    assert.equal(post.udbakke.length, 2);
  } finally { await db.close(); }
});

test('a failing alert hook never fails the pass (the measurements are stored)', async () => {
  const db = await nyDb();
  try {
    const linjer: string[] = [];
    const d: PollerDeps = {
      db,
      tenanter: async () => [{ slug: 'hus-aaaaaaaa', adresse: 'http://10.0.0.2:8750', release: SHA }],
      sundhed: async () => ({ ok: false, sha: null }),
      komponenter: komponentDeps(db),
      usunde: async () => { throw new Error('post nede'); },
      nu: () => new Date('2026-11-02T10:00:00.000Z'),
      log: (l) => linjer.push(l),
    };
    await poller(d).gennemloeb();
    assert.equal((await db.query('SELECT * FROM drift.helbred_maaling')).length, 1);
    assert.ok(linjer.some((l) => /alarm/.test(l)));
  } finally { await db.close(); }
});
