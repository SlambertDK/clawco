// KC-0189: the public status feed. Derived data only: it can identify neither a customer nor a tenant, and a component
// whose data is unknown (no pass, a stale pass, a probe that threw) is `nedsat`, never `ok`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byggFeed, feedCache, samlet, statusOrigin, FRISK_MS, type Feed } from '../../../src/drift/helbred/feed.ts';
import { KOMPONENTER } from '../../../src/drift/helbred/komponenter.ts';
import { poller, type PollerDeps } from '../../../src/drift/helbred/poller.ts';
import { nyHaendelse } from '../../../src/drift/helbred/haendelse.ts';
import { klareTilUdrulning } from '../../../src/fleet/tilstand.ts';
import { createSkyApp } from '../../../src/server.ts';
import { nyDb } from '../../konto/hjaelp.ts';
import { flaade, godeKopierOgPost, komponentDeps } from './hjaelp.ts';
import type { Database } from '../../../src/db/pool.ts';
import type { KomponentDeps } from '../../../src/drift/helbred/komponenter.ts';

const SHA = 'abc1234';
const NU = new Date('2026-11-02T10:00:00.000Z');

function deps(db: Database, o: Partial<PollerDeps> = {}, k: Partial<KomponentDeps> = {}): PollerDeps {
  return {
    db,
    tenanter: () => klareTilUdrulning(db),
    sundhed: async () => ({ ok: true, sha: SHA }),
    komponenter: komponentDeps(db, k),
    nu: () => NU,
    log: () => {},
    ...o,
  };
}

/** Every string and number the feed may hold, by path: anything else is a leak. */
function tjekForm(f: Feed): void {
  assert.deepEqual(Object.keys(f).sort(), ['haendelser', 'komponenter', 'opdateret', 'samlet']);
  assert.match(f.opdateret, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(['ok', 'nedsat', 'nede'].includes(f.samlet));
  assert.deepEqual(f.komponenter.map((k) => k.id), [...KOMPONENTER]);
  for (const k of f.komponenter) {
    const noegler = Object.keys(k).sort();
    if (k.id === 'clawco') assert.deepEqual(noegler, ['andelSund', 'antal', 'id', 'navn', 'oppetid90d', 'status']);
    else assert.deepEqual(noegler, ['id', 'navn', 'oppetid90d', 'status']);
    assert.ok(['ok', 'nedsat', 'nede'].includes(k.status));
    assert.ok(k.oppetid90d === null || (k.oppetid90d >= 0 && k.oppetid90d <= 100));
  }
  for (const h of f.haendelser) assert.deepEqual(Object.keys(h).sort(), ['slut', 'start', 'tekst', 'titel']);
}

test('50 tenants: the feed is counts and percentages only — no slug, tenant id, konto id, email, node name or address', async () => {
  const db = await nyDb();
  try {
    const fx = await flaade(db, 50, NU, SHA);
    const syge = new Set(fx.adresser.slice(0, 3));
    const traege = new Set(fx.adresser.slice(3, 5));
    const d = deps(db, {
      sundhed: async (adresse) => {
        if (syge.has(adresse)) return { ok: false, sha: null };
        if (traege.has(adresse)) await new Promise((r) => setTimeout(r, 1_050));
        return { ok: true, sha: SHA };
      },
    });
    await nyHaendelse(db, { titel: 'Langsom login', tekst: 'Login var langsomt i en halv time.', start: new Date(NU.getTime() - 3_600_000), slut: new Date(NU.getTime() - 1_800_000) }, NU);
    await poller(d).gennemloeb();
    const f = await byggFeed(db, NU);
    tjekForm(f);
    const clawco = f.komponenter.find((k) => k.id === 'clawco')!;
    assert.deepEqual(clawco.antal, { sund: 45, traeg: 2, syg: 3, opdaterer: 0 });
    assert.equal(clawco.andelSund, 94);
    assert.equal(clawco.status, 'nedsat');
    const json = JSON.stringify(f);
    const forbudt = [...fx.slugs, ...fx.emails, ...fx.adresser, ...fx.kontoIder, ...fx.tenantIder, '10.77.', 'clawco-t-', 'lokal', 'hetzner', 'example.test', SHA];
    const fundet = forbudt.filter((x) => json.includes(x));
    assert.deepEqual(fundet, []);
  } finally { await db.close(); }
});

test('no pass yet: every component is nedsat, never ok', async () => {
  const db = await nyDb();
  try {
    const f = await byggFeed(db, NU);
    tjekForm(f);
    assert.deepEqual(f.komponenter.map((k) => k.status), KOMPONENTER.map(() => 'nedsat'));
    assert.equal(f.samlet, 'nedsat');
    assert.ok(f.komponenter.every((k) => k.oppetid90d === null));
  } finally { await db.close(); }
});

test('a stale pass (the poller stopped) is nedsat, never the last ok', async () => {
  const db = await nyDb();
  try {
    await flaade(db, 2, NU, SHA);
    await godeKopierOgPost(db, NU);
    await poller(deps(db)).gennemloeb();
    assert.equal((await byggFeed(db, NU)).samlet, 'ok');
    const senere = new Date(NU.getTime() + FRISK_MS + 1);
    const f = await byggFeed(db, senere);
    assert.deepEqual(f.komponenter.map((k) => k.status), KOMPONENTER.map(() => 'nedsat'));
  } finally { await db.close(); }
});

test('a probe that throws or has nothing to look at makes its component nedsat, never ok', async () => {
  const db = await nyDb();
  try {
    await flaade(db, 1, NU, SHA);
    const fejl = async (): Promise<never> => { throw new Error('probe fejlede'); };
    await poller(deps(db, {}, { adgang: async () => null, provisioneringer: fejl, kopiTenanter: fejl })).gennemloeb();
    const f = await byggFeed(db, NU);
    const s = Object.fromEntries(f.komponenter.map((k) => [k.id, k.status]));
    assert.equal(s['adgang'], 'nedsat');
    assert.equal(s['oprettelse'], 'nedsat');
    assert.equal(s['sikkerhedskopi'], 'nedsat');
    // No mail sent yet: unknown.
    assert.equal(s['mail'], 'nedsat');
  } finally { await db.close(); }
});

test('backups switched off are never ok, even with no tenant to copy', async () => {
  const db = await nyDb();
  try {
    await poller(deps(db, {}, { kopierSlaaetTil: false })).gennemloeb();
    const f = await byggFeed(db, NU);
    assert.notEqual(f.komponenter.find((k) => k.id === 'sikkerhedskopi')!.status, 'ok');
  } finally { await db.close(); }
});

test('samlet: nede only when a core component (login, adgang, the tenants) is nede; else nedsat when anything is not ok', () => {
  const k = (o: Record<string, 'ok' | 'nedsat' | 'nede'>) => KOMPONENTER.map((id) => ({ id, status: o[id] ?? 'ok' }));
  assert.equal(samlet(k({})), 'ok');
  assert.equal(samlet(k({ sikkerhedskopi: 'nede' })), 'nedsat');
  assert.equal(samlet(k({ mail: 'nedsat' })), 'nedsat');
  assert.equal(samlet(k({ login: 'nede' })), 'nede');
  assert.equal(samlet(k({ adgang: 'nede' })), 'nede');
  assert.equal(samlet(k({ clawco: 'nede' })), 'nede');
});

test('incidents: the operator\'s list, newest first; ended ones older than 90 days are left out', async () => {
  const db = await nyDb();
  try {
    const dag = 86_400_000;
    await nyHaendelse(db, { titel: 'Gammel', tekst: 'For længe siden.', start: new Date(NU.getTime() - 100 * dag), slut: new Date(NU.getTime() - 99 * dag) }, NU);
    await nyHaendelse(db, { titel: 'Igang', tekst: 'Vi kigger på det.', start: new Date(NU.getTime() - 600_000), slut: null }, NU);
    await nyHaendelse(db, { titel: 'I går', tekst: 'Løst.', start: new Date(NU.getTime() - dag), slut: new Date(NU.getTime() - dag + 600_000) }, NU);
    const f = await byggFeed(db, NU);
    assert.deepEqual(f.haendelser.map((h) => [h.titel, h.slut === null]), [['Igang', true], ['I går', false]]);
  } finally { await db.close(); }
});

test('the cache: one build per 30 seconds, shared by concurrent requests', async () => {
  let t = NU.getTime();
  let bygget = 0;
  const c = feedCache({ bygg: async () => { bygget++; return { opdateret: new Date(t).toISOString(), samlet: 'ok', komponenter: [], haendelser: [] }; }, nu: () => t });
  await Promise.all([c(), c(), c()]);
  assert.equal(bygget, 1);
  t += 29_000;
  await c();
  assert.equal(bygget, 1);
  t += 2_000;
  await c();
  assert.equal(bygget, 2);
});

test('GET /status.json: JSON, cached 30 s, CORS for the configured status page origin only', async () => {
  const db = await nyDb();
  try {
    const feed = async (): Promise<Feed> => ({ opdateret: NU.toISOString(), samlet: 'ok', komponenter: [], haendelser: [] });
    const app = createSkyApp({ db, sha: SHA, startet: 0, status: { feed, origin: 'https://status.example.test' } });
    const r = await app.request('/status.json', { headers: { origin: 'https://status.example.test' } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://status.example.test');
    assert.equal(((await r.json()) as Feed).samlet, 'ok');
    const uden = createSkyApp({ db, sha: SHA, startet: 0, status: { feed, origin: null } });
    const r2 = await uden.request('/status.json');
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('access-control-allow-origin'), null);
    // Without the status seam there is no feed at all.
    assert.equal((await createSkyApp({ db, sha: SHA, startet: 0 }).request('/status.json')).status, 404);
  } finally { await db.close(); }
});

test('SKY_STATUS_ORIGIN: an origin only; unset is null (no CORS); anything else stops Sky naming the key', () => {
  assert.equal(statusOrigin({}), null);
  assert.equal(statusOrigin({ SKY_STATUS_ORIGIN: ' https://status.example.test ' }), 'https://status.example.test');
  assert.equal(statusOrigin({ SKY_STATUS_ORIGIN: 'https://status.example.test/' }), 'https://status.example.test');
  for (const v of ['status.example.test', 'https://status.example.test/side', 'ftp://status.example.test', '*']) {
    assert.throws(() => statusOrigin({ SKY_STATUS_ORIGIN: v }), /SKY_STATUS_ORIGIN/);
  }
});

test('a feed that cannot be built answers 503 with no detail (never a stale or invented ok)', async () => {
  const db = await nyDb();
  try {
    const app = createSkyApp({ db, sha: SHA, startet: 0, status: { feed: async () => { throw new Error('db host 10.0.0.9 nede'); }, origin: null } });
    const r = await app.request('/status.json');
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /10\.0\.0\.9/);
  } finally { await db.close(); }
});
