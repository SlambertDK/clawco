// KC-0184: the tenant's internal household route, POST /intern/husstand/medlem. Sky calls it when an invitation is
// accepted, a member is removed or leaves, or the owner changes a role. Invariant (AGENTS §0 r2/r7): it answers only a
// control call — Sky's Ed25519 signature under its own prefix and audience (k1., clawco-tenant-kontrol), for this
// tenant, this method, this path and this exact body, within the window, once, arriving from the gateway's address.
// A person's Clawco-Konto header never opens it. The body is validated; husstand.json is written atomically through
// skrivHusstand; the owner is never added, changed or removed this way.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { laesHusstand, skrivHusstand, type Person } from '../../src/identitet/husstand.ts';
import { kontoFraMiljoe, type KontoIndstilling } from '../../src/identitet/konto.ts';
import { KONTROL_HEADER, nonceLager, verificerKontrol } from '../../src/identitet/kontrol.ts';
import { anvendIntern, INTERN_STI, parseIntern } from '../../src/hushold/intern.ts';
import { InvitationFejl, MAX_PERSONER } from '../../src/hushold/invitation.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-intern-'));
after(() => rm(rod, { recursive: true, force: true }));
const publicDir = path.relative(process.cwd(), fileURLToPath(new URL('../../public', import.meta.url)));

const FIL = new URL('../fixtures/kontrol-vektorer.json', import.meta.url);
const V = JSON.parse(await readFile(FIL, 'utf8')) as {
  tenant: string; nu: number; noegle: { froe: string; offentlig: string; id: string }; metode: string; sti: string; nonce: string; krop: string; header: string;
};
const KV = JSON.parse(await readFile(new URL('../fixtures/konto-vektorer.json', import.meta.url), 'utf8')) as {
  noegler: Record<string, { froe: string; offentlig: string; id: string }>; vektorer: { navn: string; header: string }[];
};

const GATEWAY = '10.20.0.2';
const K = kontoFraMiljoe({ KC_IDENTITET: 'konto', KC_KONTO_TENANT: V.tenant, KC_KONTO_PUBKEY: V.noegle.offentlig, KC_KONTO_GATEWAY: GATEWAY }) as KontoIndstilling;
const FRA_GATEWAY = { incoming: { socket: { remoteAddress: GATEWAY } } };

/** The test's own signer (the tenant shares no code with Sky): the k1 scheme over any body, path or claims. */
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
function kontrol(o: { krop: string; sti?: string; metode?: string; iat?: number; n?: string; t?: string; aud?: string; froe?: string; id?: string; praefiks?: string }): string {
  const privat = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(o.froe ?? V.noegle.froe, 'hex')]), format: 'der', type: 'pkcs8' });
  const krop = { aud: o.aud ?? 'clawco-tenant-kontrol', t: o.t ?? V.tenant, m: o.metode ?? 'POST', p: o.sti ?? INTERN_STI, h: createHash('sha256').update(o.krop).digest('base64url'), iat: o.iat ?? V.nu, n: o.n ?? Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16) };
  const til = `${o.praefiks ?? 'k1'}.${o.id ?? V.noegle.id}.${Buffer.from(JSON.stringify(krop)).toString('base64url')}`;
  return `${til}.${sign(null, Buffer.from(til), privat).toString('base64url')}`;
}

const anm = (header: string | null, krop: string, ekstra: Record<string, string> = {}, peer: string | undefined = GATEWAY, sti = V.sti, metode = 'POST'): { headers: Headers; peer: string | undefined; metode: string; sti: string; krop: Buffer } => {
  const headers = new Headers(ekstra);
  if (header !== null) headers.set(KONTROL_HEADER, header);
  return { headers, peer, metode, sti, krop: Buffer.from(krop) };
};

test('the two fixture files are byte-identical (the tenant and Sky hold the same contract)', async () => {
  const sky = await readFile(new URL('../../sky/test/fixtures/kontrol-vektorer.json', import.meta.url));
  assert.ok((await readFile(FIL)).equals(sky));
  assert.equal(V.sti, INTERN_STI);
});

test('verificerKontrol: the fixture\'s call is accepted once; a replay of the same header is refused', () => {
  const set = nonceLager();
  assert.deepEqual(verificerKontrol(anm(V.header, V.krop), K, V.nu, set), { ok: true });
  const igen = verificerKontrol(anm(V.header, V.krop), K, V.nu + 1, set);
  assert.equal(igen.ok, false);
  assert.match((igen as { grund: string }).grund, /allerede brugt/);
});

test('verificerKontrol refuses: another body, path, method, tenant or audience; not from the gateway; out of the window', () => {
  const nej = (a: ReturnType<typeof anm>, nu = V.nu, k = K) => { const r = verificerKontrol(a, k, nu, nonceLager()); assert.equal(r.ok, false); return (r as { grund: string }).grund; };
  assert.match(nej(anm(V.header, V.krop.replace('barn', 'medlem'))), /krop/);
  assert.match(nej(anm(V.header, V.krop, {}, GATEWAY, '/intern/husstand/andet')), /sti|metode/);
  assert.match(nej(anm(V.header, V.krop, {}, GATEWAY, V.sti, 'PUT')), /sti|metode/);
  assert.match(nej(anm(V.header, V.krop, {}, '10.20.0.3')), /gatewayen/);
  assert.match(nej({ ...anm(V.header, V.krop), peer: undefined }), /gatewayen/);
  assert.match(nej(anm(V.header, V.krop), V.nu + 61), /udløbet/);
  assert.match(nej(anm(V.header, V.krop), V.nu - 11), /fremtiden/);
  assert.match(nej(anm(kontrol({ krop: V.krop, t: 'hus-andetsted' }), V.krop)), /tenant/);
  assert.match(nej(anm(kontrol({ krop: V.krop, aud: 'clawco-konto' }), V.krop)), /form/);
  assert.match(nej(anm(kontrol({ krop: V.krop, froe: KV.noegler['c']!.froe, id: KV.noegler['c']!.id }), V.krop)), /nøgle/);
  assert.match(nej(anm(kontrol({ krop: V.krop, froe: KV.noegler['c']!.froe }), V.krop)), /signatur/);
  assert.match(nej(anm(null, V.krop)), /Clawco-Kontrol/);
});

test('a person\'s Clawco-Konto header is never a control call: not in the Kontrol header, not re-prefixed, not beside one', () => {
  const bruger = KV.vektorer.find((v) => v.navn === 'gyldig')!.header;
  const nej = (a: ReturnType<typeof anm>) => assert.equal(verificerKontrol(a, K, V.nu, nonceLager()).ok, false);
  nej(anm(bruger, V.krop));
  nej(anm(`k1${bruger.slice(2)}`, V.krop)); // same bytes, another prefix: the signature covers the prefix
  nej(anm(null, V.krop, { 'Clawco-Konto': bruger }));
  nej(anm(V.header, V.krop, { 'Clawco-Konto': bruger })); // a control call never carries a person
  // A support bevis (s1.) is not one either.
  nej(anm(kontrol({ krop: V.krop, praefiks: 's1' }), V.krop));
});

// ---------- the body and the household change (pure) ----------

const EJER: Person = { id: FAMILIE.ejer.id, login: 'ejer@example.com', navn: FAMILIE.ejer.navn, rolle: 'ejer' };
const MAJA: Person = { id: FAMILIE.medlem.id, login: 'maja@example.com', navn: FAMILIE.medlem.navn, rolle: 'medlem' };

test('parseIntern: tilfoej needs an email, a name and a role below the owner; fjern an email; rolle an email and a role', () => {
  assert.deepEqual(parseIntern({ op: 'tilfoej', email: ' Nora@Example.com ', navn: ' Nora ', rolle: 'barn' }), { op: 'tilfoej', email: 'nora@example.com', navn: 'Nora', rolle: 'barn' });
  assert.deepEqual(parseIntern({ op: 'fjern', email: 'nora@example.com' }), { op: 'fjern', email: 'nora@example.com' });
  assert.deepEqual(parseIntern({ op: 'rolle', email: 'nora@example.com', rolle: 'gaest' }), { op: 'rolle', email: 'nora@example.com', rolle: 'gaest' });
  for (const bad of [null, [], 'x', {}, { op: 'slet-alt' }, { op: 'tilfoej', email: 'nora@example.com', navn: 'Nora', rolle: 'ejer' },
    { op: 'tilfoej', email: 'ikke-en-mail', navn: 'Nora', rolle: 'barn' }, { op: 'tilfoej', email: 'nora@example.com', navn: '', rolle: 'barn' },
    { op: 'rolle', email: 'nora@example.com', rolle: 'stoette' }, { op: 'fjern', email: 'nora@example.com', ekstra: 1 }]) {
    assert.throws(() => parseIntern(bad), InvitationFejl, JSON.stringify(bad));
  }
});

test('anvendIntern: add is idempotent, remove of someone gone is a no-op, the owner is never touched, at most six people', () => {
  const tilfoej = anvendIntern([EJER], { op: 'tilfoej', email: 'nora@example.com', navn: 'Nora', rolle: 'barn' });
  assert.equal(tilfoej.aendret, true);
  assert.deepEqual(tilfoej.personer.at(-1), { id: 'nora', login: 'nora@example.com', navn: 'Nora', rolle: 'barn' });
  const igen = anvendIntern(tilfoej.personer, { op: 'tilfoej', email: 'nora@example.com', navn: 'Nora', rolle: 'barn' });
  assert.equal(igen.aendret, false);
  assert.deepEqual(igen.personer, tilfoej.personer);
  assert.equal(anvendIntern([EJER, MAJA], { op: 'fjern', email: 'nora@example.com' }).aendret, false);
  assert.deepEqual(anvendIntern([EJER, MAJA], { op: 'fjern', email: 'MAJA@example.com' }).personer, [EJER]);
  assert.equal(anvendIntern([EJER, MAJA], { op: 'rolle', email: 'maja@example.com', rolle: 'gaest' }).personer[1]!.rolle, 'gaest');
  for (const op of [{ op: 'fjern', email: 'ejer@example.com' }, { op: 'rolle', email: 'ejer@example.com', rolle: 'medlem' }, { op: 'tilfoej', email: 'ejer@example.com', navn: 'X', rolle: 'medlem' }] as const) {
    assert.throws(() => anvendIntern([EJER, MAJA], op), (e: unknown) => e instanceof InvitationFejl && e.status === 409, op.op);
  }
  assert.throws(() => anvendIntern([MAJA], { op: 'tilfoej', email: 'nora@example.com', navn: 'Nora', rolle: 'barn' }), (e: unknown) => e instanceof InvitationFejl && e.status === 409, 'no owner, no household');
  assert.throws(() => anvendIntern([EJER, MAJA], { op: 'rolle', email: 'nora@example.com', rolle: 'barn' }), (e: unknown) => e instanceof InvitationFejl && e.status === 404);
  const fulde = [EJER, ...Array.from({ length: MAX_PERSONER - 1 }, (_, i) => ({ id: `p${i}`, login: `p${i}@example.com`, navn: `P${i}`, rolle: 'medlem' as const }))];
  assert.throws(() => anvendIntern(fulde, { op: 'tilfoej', email: 'nora@example.com', navn: 'Nora', rolle: 'barn' }), (e: unknown) => e instanceof InvitationFejl && e.status === 409);
});

// ---------- the route ----------

async function lav(navn: string, o: { konto?: boolean } = {}) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, { personer: [EJER, MAJA] });
  const app = createApp({ store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, now: () => new Date(V.nu * 1000), ...(o.konto === false ? {} : { identitet: { konto: K } }), mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' });
  return { app: app.app, dataDir };
}
const post = (krop: string, headers: Record<string, string>): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: krop });

test('route: a valid control call from the gateway pre-creates the member in husstand.json (login = email, the role), atomically', async () => {
  const { app, dataDir } = await lav('tilfoej');
  const res = await app.request(INTERN_STI, post(V.krop, { [KONTROL_HEADER]: V.header }), FRA_GATEWAY);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, aendret: true });
  const h = await laesHusstand(dataDir);
  assert.deepEqual(h!.personer.map((p) => [p.login, p.rolle]), [['ejer@example.com', 'ejer'], ['maja@example.com', 'medlem'], ['eva@example.com', 'barn']]);
  assert.deepEqual((await readdir(dataDir)).filter((f) => f.includes('.tmp')), [], 'no temp file left behind');
  // The room's own extras: a waiting own entry, as KC-0154's owner invite makes it (activated on her first visit).
  const state = JSON.parse(await readFile(path.join(dataDir, 'rum', 'husstand', 'state.json'), 'utf8')) as { medlemmer: { id: string; indgang?: { status: string } }[] };
  assert.equal(state.medlemmer.find((m) => m.id === 'eva')?.indgang?.status, 'venter');
  // The same header again is a replay: 401, nothing changes.
  const igen = await app.request(INTERN_STI, post(V.krop, { [KONTROL_HEADER]: V.header }), FRA_GATEWAY);
  assert.equal(igen.status, 401);
});

test('route: remove and role change go through the same call; the owner cannot be touched (409)', async () => {
  const { app, dataDir } = await lav('fjern');
  const kald = (krop: object) => { const k = JSON.stringify(krop); return app.request(INTERN_STI, post(k, { [KONTROL_HEADER]: kontrol({ krop: k }) }), FRA_GATEWAY); };
  assert.equal((await kald({ op: 'rolle', email: 'maja@example.com', rolle: 'gaest' })).status, 200);
  assert.equal((await laesHusstand(dataDir))!.personer[1]!.rolle, 'gaest');
  assert.equal((await kald({ op: 'fjern', email: 'ejer@example.com' })).status, 409);
  assert.equal((await kald({ op: 'fjern', email: 'maja@example.com' })).status, 200);
  assert.deepEqual((await laesHusstand(dataDir))!.personer.map((p) => p.id), [EJER.id]);
  const igen = await kald({ op: 'fjern', email: 'maja@example.com' });
  assert.equal(igen.status, 200, 'removing someone already gone is fine (Sky may retry)');
  assert.deepEqual(await igen.json(), { ok: true, aendret: false });
});

test('route: a user-signed Clawco-Konto header gets 401; so do no header, a wrong peer and a bad signature — nothing is written', async () => {
  const { app, dataDir } = await lav('afvist');
  const foer = await readFile(path.join(dataDir, 'husstand.json'), 'utf8');
  const bruger = KV.vektorer.find((v) => v.navn === 'gyldig')!.header;
  for (const [hvad, headers, env] of [
    ['bruger', { 'Clawco-Konto': bruger }, FRA_GATEWAY],
    ['ingen', {}, FRA_GATEWAY],
    ['loopback', { [KONTROL_HEADER]: kontrol({ krop: V.krop }) }, { incoming: { socket: { remoteAddress: '127.0.0.1' } } }],
    ['fremmed nøgle', { [KONTROL_HEADER]: kontrol({ krop: V.krop, froe: KV.noegler['c']!.froe }) }, FRA_GATEWAY],
  ] as const) {
    const res = await app.request(INTERN_STI, post(V.krop, headers as Record<string, string>), env);
    assert.equal(res.status, 401, hvad);
    assert.deepEqual(Object.keys((await res.json()) as object), ['error'], hvad);
  }
  assert.equal(await readFile(path.join(dataDir, 'husstand.json'), 'utf8'), foer);
});

test('route: an invalid body is 400 even when signed (validated before anything is written); GET is not a route', async () => {
  const { app, dataDir } = await lav('krop');
  const foer = await readFile(path.join(dataDir, 'husstand.json'), 'utf8');
  for (const k of ['{"op":"tilfoej","email":"nora@example.com","navn":"Nora","rolle":"ejer"}', 'ikke json', '{"op":"slet"}']) {
    const res = await app.request(INTERN_STI, post(k, { [KONTROL_HEADER]: kontrol({ krop: k }) }), FRA_GATEWAY);
    assert.equal(res.status, 400, k);
  }
  const stor = JSON.stringify({ op: 'tilfoej', email: 'nora@example.com', navn: 'x'.repeat(5000), rolle: 'barn' });
  assert.equal((await app.request(INTERN_STI, post(stor, { [KONTROL_HEADER]: kontrol({ krop: stor }) }), FRA_GATEWAY)).status, 413);
  assert.equal(await readFile(path.join(dataDir, 'husstand.json'), 'utf8'), foer);
  assert.notEqual((await app.request(INTERN_STI, { headers: { [KONTROL_HEADER]: V.header } }, FRA_GATEWAY)).status, 200);
});

test('route: without konto identity (tailnet, laptop) the route does not exist', async () => {
  const { app } = await lav('tailnet', { konto: false });
  const res = await app.request(INTERN_STI, post(V.krop, { [KONTROL_HEADER]: V.header }), FRA_GATEWAY);
  assert.equal(res.status, 404);
});
