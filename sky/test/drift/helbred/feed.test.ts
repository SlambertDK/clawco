// KC-0189: the public status feed. Derived data only: it can identify neither a customer nor a tenant, and a component
// whose data is unknown (no pass, a stale pass, a probe that threw) is `nedsat`, never `ok`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atom, byggFeed, feedCache, samlet, statusOrigin, FRISK_MS, type Feed } from '../../../src/drift/helbred/feed.ts';
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
const ADR = { side: 'https://clawco.work/status', feedUrl: 'https://konto.example.test/status.atom' };

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
    if (k.id === 'clawco') assert.deepEqual(noegler, ['andelSund', 'antal', 'dage', 'id', 'navn', 'oppetid90d', 'status']);
    else assert.deepEqual(noegler, ['dage', 'id', 'navn', 'oppetid90d', 'status']);
    assert.ok(['ok', 'nedsat', 'nede'].includes(k.status));
    assert.ok(k.oppetid90d === null || (k.oppetid90d >= 0 && k.oppetid90d <= 100));
    // KC-0202: the 90-day series is dates and percentages, nothing else.
    assert.equal(k.dage.length, 90);
    for (const x of k.dage) {
      assert.deepEqual(Object.keys(x).sort(), ['dag', 'oppetid']);
      assert.match(x.dag, /^\d{4}-\d\d-\d\d$/);
      assert.ok(x.oppetid === null || (x.oppetid >= 0 && x.oppetid <= 100));
    }
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
    const app = createSkyApp({ db, sha: SHA, startet: 0, status: { feed, origin: 'https://status.example.test', ...ADR } });
    const r = await app.request('/status.json', { headers: { origin: 'https://status.example.test' } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://status.example.test');
    assert.equal(((await r.json()) as Feed).samlet, 'ok');
    const uden = createSkyApp({ db, sha: SHA, startet: 0, status: { feed, origin: null, ...ADR } });
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
    const app = createSkyApp({ db, sha: SHA, startet: 0, status: { feed: async () => { throw new Error('db host 10.0.0.9 nede'); }, origin: null, ...ADR } });
    const r = await app.request('/status.json');
    assert.equal(r.status, 503);
    assert.doesNotMatch(await r.text(), /10\.0\.0\.9/);
  } finally { await db.close(); }
});

test('KC-0202: the feed carries a 90-day series per component, oldest first, ending today; a day without data is null', async () => {
  const db = await nyDb();
  try {
    await flaade(db, 2, NU, SHA);
    await godeKopierOgPost(db, NU);
    await poller(deps(db)).gennemloeb();
    const f = await byggFeed(db, NU);
    tjekForm(f);
    for (const k of f.komponenter) {
      assert.equal(k.dage.at(-1)!.dag, '2026-11-02');
      assert.equal(k.dage[0]!.dag, '2026-08-05');
      assert.equal(k.dage.at(-1)!.oppetid, k.oppetid90d, 'one pass today, so today is the whole 90-day figure');
      assert.ok(k.dage.slice(0, 89).every((x) => x.oppetid === null), 'no history yet: unknown, not 100');
    }
  } finally { await db.close(); }
});

const HAEND: Feed['haendelser'] = [
  { titel: 'Login <langsomt> & "slow"', tekst: 'Det tog 5 > 2 sekunder & mere.', start: '2026-11-01T08:00:00.000Z', slut: '2026-11-01T09:00:00.000Z' },
  { titel: 'Igang', tekst: 'Vi kigger på det.', start: '2026-11-02T09:00:00.000Z', slut: null },
];
const ATOM_ARG = { haendelser: HAEND, opdateret: '2026-11-02T10:00:00.000Z', side: 'https://clawco.work/status', feedUrl: 'https://konto.example.test/status.atom' };

test('atom: a valid Atom 1.0 shell, one entry per incident, every string escaped', () => {
  const x = atom(ATOM_ARG);
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(x, /<title>Clawco Sky status<\/title>/);
  assert.match(x, /<id>https:\/\/konto\.example\.test\/status\.atom<\/id>/);
  assert.match(x, /<updated>2026-11-02T10:00:00\.000Z<\/updated>/);
  assert.match(x, /<link rel="alternate" href="https:\/\/clawco\.work\/status"\/>/);
  assert.match(x, /<link rel="self" href="https:\/\/konto\.example\.test\/status\.atom"\/>/);
  assert.equal((x.match(/<entry>/g) ?? []).length, 2);
  assert.equal((x.match(/<\/entry>/g) ?? []).length, 2);
  assert.ok(x.endsWith('</feed>\n'));
  // Escaping: no raw < > or bare & from the incident text.
  assert.match(x, /Login &lt;langsomt&gt; &amp; &quot;slow&quot;/);
  assert.match(x, /5 &gt; 2 sekunder &amp; mere\./);
  assert.ok(!x.includes('<langsomt>'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(x), 'every ampersand is an entity');
  // Entries: published = start, updated = slut ?? start, plain-text content; an ended incident says when.
  const entries = x.split('<entry>').slice(1);
  assert.match(entries[0]!, /<published>2026-11-01T08:00:00\.000Z<\/published>/);
  assert.match(entries[0]!, /<updated>2026-11-01T09:00:00\.000Z<\/updated>/);
  assert.match(entries[0]!, /<content type="text">[^<]*\(ended 2026-11-01T09:00:00\.000Z\)<\/content>/);
  assert.match(entries[1]!, /<updated>2026-11-02T09:00:00\.000Z<\/updated>/);
  assert.doesNotMatch(entries[1]!, /ended/);
});

test('atom: entry ids are stable (feed url + hash of start and title), differ per incident, and carry no incident number', () => {
  const a = atom(ATOM_ARG);
  const b = atom({ ...ATOM_ARG, opdateret: '2026-11-02T10:05:00.000Z' });
  const ids = (x: string) => [...x.matchAll(/<entry>\s*<title>[^<]*<\/title>\s*<id>([^<]+)<\/id>/g)].map((m) => m[1]!);
  assert.equal(ids(a).length, 2);
  assert.deepEqual(ids(a), ids(b), 'stable across builds');
  assert.notEqual(ids(a)[0], ids(a)[1]);
  for (const id of ids(a)) assert.match(id, /^https:\/\/konto\.example\.test\/status\.atom#[0-9a-f]{16}$/);
  // Ending an incident later does not change its id.
  const sluttet = atom({ ...ATOM_ARG, haendelser: [HAEND[0]!, { ...HAEND[1]!, slut: '2026-11-02T09:30:00.000Z' }] });
  assert.deepEqual(ids(sluttet), ids(a));
});

test('atom: no incidents is still a valid feed with no entries', () => {
  const x = atom({ ...ATOM_ARG, haendelser: [] });
  assert.ok(!x.includes('<entry>'));
  assert.ok(x.includes('</feed>'));
});

test('GET /status.atom: application/atom+xml, cached 30 s, the same CORS as the json, 503 with no detail when the feed throws', async () => {
  const db = await nyDb();
  try {
    const feed = async (): Promise<Feed> => ({ opdateret: NU.toISOString(), samlet: 'ok', komponenter: [], haendelser: HAEND });
    const app = createSkyApp({ db, sha: SHA, startet: 0, status: { feed, origin: 'https://status.example.test', ...ADR } });
    const r = await app.request('/status.atom', { headers: { origin: 'https://status.example.test' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/atom+xml; charset=utf-8');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=30');
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://status.example.test');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const t = await r.text();
    assert.match(t, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
    assert.equal((t.match(/<entry>/g) ?? []).length, 2);
    assert.match(t, /<link rel="alternate" href="https:\/\/clawco\.work\/status"\/>/);
    const kaster = createSkyApp({ db, sha: SHA, startet: 0, status: { feed: async () => { throw new Error('db host 10.0.0.9 nede'); }, origin: null, ...ADR } });
    const r2 = await kaster.request('/status.atom');
    assert.equal(r2.status, 503);
    assert.doesNotMatch(await r2.text(), /10\.0\.0\.9/);
    assert.equal((await createSkyApp({ db, sha: SHA, startet: 0 }).request('/status.atom')).status, 404);
  } finally { await db.close(); }
});
