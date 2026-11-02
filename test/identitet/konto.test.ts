// KC-0179: identity provider `konto` — the tenant trusts only the Sky gateway's signature.
// The case table runs against the vectors shared with the gateway signer (sky/src/gateway/signer.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { erAfvist, ENEBRUGER, hvemKigger, hvemKontoKigger, kunSigneret, peerAf, vaelgKigger, type Anmodning } from '../../src/identitet/identitet.ts';
import { kontoFraMiljoe, verificerKonto, type KontoIndstilling } from '../../src/identitet/konto.ts';
import type { Husstand } from '../../src/identitet/husstand.ts';

const FIL = new URL('../fixtures/konto-vektorer.json', import.meta.url);
const V = JSON.parse(readFileSync(FIL, 'utf8')) as {
  tenant: string; nu: number;
  noegler: Record<'a' | 'b' | 'c', { froe: string; offentlig: string; id: string }>;
  vektorer: { navn: string; header: string; forventet: string | number }[];
};
const vektor = (navn: string): string => { const v = V.vektorer.find((x) => x.navn === navn); assert.ok(v, navn); return v.header; };

const GATEWAY = '10.20.0.2';
const MILJOE = { KC_IDENTITET: 'konto', KC_KONTO_TENANT: V.tenant, KC_KONTO_PUBKEY: V.noegler.a.offentlig, KC_KONTO_GATEWAY: GATEWAY };
const K = kontoFraMiljoe(MILJOE) as KontoIndstilling;
const K2 = kontoFraMiljoe({ ...MILJOE, KC_KONTO_PUBKEY_NY: V.noegler.b.offentlig }) as KontoIndstilling;

const HENRIK = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' as const };
const MAJA = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' as const };
const TO: Husstand = { personer: [HENRIK, MAJA] };
const PERSON: Record<string, unknown> = { maja: MAJA, henrik: HENRIK };

const med = (header: string | null, ekstra: Record<string, string> = {}, peer: string | undefined = GATEWAY): Anmodning => {
  const h = new Headers(ekstra);
  if (header !== null) h.set('Clawco-Konto', header);
  return { headers: h, peer };
};

test('the two fixture files are byte-identical (the tenant and the gateway hold the same contract)', () => {
  const sky = readFileSync(new URL('../../sky/test/fixtures/konto-vektorer.json', import.meta.url));
  assert.ok(readFileSync(FIL).equals(sky));
});

test('config: tailnet is the default; konto needs every key, else start is refused naming the key', () => {
  assert.equal(kontoFraMiljoe({}), null);
  assert.equal(kontoFraMiljoe({ KC_IDENTITET: 'tailnet', KC_KONTO_TENANT: 'x' }), null);
  assert.throws(() => kontoFraMiljoe({ KC_IDENTITET: 'Konto' }), /KC_IDENTITET/);
  assert.throws(() => kontoFraMiljoe({ KC_IDENTITET: 'ingen' }), /KC_IDENTITET/);
  for (const noegle of ['KC_KONTO_TENANT', 'KC_KONTO_PUBKEY', 'KC_KONTO_GATEWAY']) {
    assert.throws(() => kontoFraMiljoe({ ...MILJOE, [noegle]: '' }), new RegExp(noegle), `${noegle} mangler`);
  }
  assert.throws(() => kontoFraMiljoe({ ...MILJOE, KC_KONTO_TENANT: 'Hjem Test' }), /KC_KONTO_TENANT/);
  assert.throws(() => kontoFraMiljoe({ ...MILJOE, KC_KONTO_PUBKEY: 'ikke-en-noegle' }), /KC_KONTO_PUBKEY/);
  assert.throws(() => kontoFraMiljoe({ ...MILJOE, KC_KONTO_PUBKEY: V.noegler.a.offentlig.slice(0, 40) }), /KC_KONTO_PUBKEY/);
  assert.throws(() => kontoFraMiljoe({ ...MILJOE, KC_KONTO_PUBKEY_NY: 'xyz' }), /KC_KONTO_PUBKEY_NY/);
  assert.throws(() => kontoFraMiljoe({ ...MILJOE, KC_KONTO_GATEWAY: 'gateway.local' }), /KC_KONTO_GATEWAY/);
  assert.deepEqual([...K.noegler.keys()], [V.noegler.a.id]);
  assert.deepEqual([...K2.noegler.keys()].sort(), [V.noegler.a.id, V.noegler.b.id].sort());
});

test('every vector gets the verdict the fixture names (two keys configured: rotation)', () => {
  for (const v of V.vektorer) {
    const r = hvemKontoKigger(med(v.header), TO, K2, V.nu);
    if (typeof v.forventet === 'string') assert.deepEqual(r, PERSON[v.forventet], v.navn);
    else {
      assert.ok(erAfvist(r), v.navn);
      assert.equal(r.afvist, v.forventet, v.navn);
      if (r.afvist === 401) assert.match(r.hvorfor, /Clawco ved ikke, hvem du er/, v.navn);
      if (r.afvist === 403) assert.match(r.hvorfor, /Du er ikke med i husstanden her/, v.navn);
      assert.ok(r.log, `${v.navn}: the log line says which check failed`);
      assert.ok(!r.log.includes(v.header) && !r.hvorfor.includes(v.header.split('.')[3]!), `${v.navn}: no header value in body or log`);
    }
  }
});

test('the body never says which check failed: every 401 has the same text', () => {
  const tekster = new Set(V.vektorer.filter((v) => v.forventet === 401).map((v) => { const r = hvemKontoKigger(med(v.header), TO, K2, V.nu); return erAfvist(r) ? r.hvorfor : ''; }));
  tekster.add((hvemKontoKigger(med(null), TO, K2, V.nu) as { hvorfor: string }).hvorfor);
  assert.equal(tekster.size, 1);
});

test('a forged header (right format, random signature) is 401', () => {
  const r = verificerKonto(med(vektor('forfalsket')), K, V.nu);
  assert.equal(r.ok, false);
});

test('the new key is refused until it is configured; wrong key id is refused with one key or two', () => {
  const ny = vektor('rotation-ny-noegle');
  assert.ok(erAfvist(hvemKontoKigger(med(ny), TO, K, V.nu)));
  assert.deepEqual(hvemKontoKigger(med(ny), TO, K2, V.nu), MAJA);
  for (const k of [K, K2]) assert.ok(erAfvist(hvemKontoKigger(med(vektor('forkert-noegle-id')), TO, k, V.nu)));
});

test('the window is measured against now: the valid header expires 56 s later', () => {
  const gyldig = vektor('gyldig'); // iat = nu - 5
  assert.deepEqual(hvemKontoKigger(med(gyldig), TO, K, V.nu + 55), MAJA);
  assert.ok(erAfvist(hvemKontoKigger(med(gyldig), TO, K, V.nu + 56)));
  assert.ok(erAfvist(hvemKontoKigger(med(gyldig), TO, K, V.nu - 16)));
});

test('missing, empty, duplicated or malformed headers are 401', () => {
  const gyldig = vektor('gyldig');
  const dobbelt = new Headers();
  dobbelt.append('Clawco-Konto', gyldig);
  dobbelt.append('Clawco-Konto', gyldig);
  for (const a of [med(null), med(''), { headers: dobbelt, peer: GATEWAY }, med(`${gyldig}.x`), med(gyldig.replace(/^v1/, 'v2')), med(` ${gyldig}`.replace(' ', 'x')), med('v1....')]) {
    const r = hvemKontoKigger(a, TO, K, V.nu);
    assert.ok(erAfvist(r) && r.afvist === 401, a.headers.get('clawco-konto') ?? 'mangler');
  }
});

// Signs any payload with a fixture key (node:crypto in the test; the gateway's signer refuses bad claims).
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
function signerRaa(payload: unknown, n: 'a' | 'b' | 'c' = 'a'): string {
  const privat = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(V.noegler[n].froe, 'hex')]), format: 'der', type: 'pkcs8' });
  const til = `v1.${V.noegler[n].id}.${Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)).toString('base64url')}`;
  return `${til}.${sign(null, Buffer.from(til), privat).toString('base64url')}`;
}

test('a validly signed payload with the wrong shape is still refused (v1 is exactly {t,k,e,iat})', () => {
  const p = { t: V.tenant, k: 'konto-maja', e: 'maja@example.com', iat: V.nu };
  assert.deepEqual(verificerKonto(med(signerRaa(p)), K, V.nu), { ok: true, email: 'maja@example.com' });
  const forkerte: unknown[] = ['ikke json', [p], null, { ...p, ekstra: 1 }, { ...p, iat: String(V.nu) }, { ...p, iat: V.nu + 0.5 }, { ...p, e: '' }, { ...p, k: 7 }, { ...p, t: undefined }, { ...p, e: 'x'.repeat(201) }];
  for (const f of forkerte) assert.equal(verificerKonto(med(signerRaa(f)), K, V.nu).ok, false, JSON.stringify(f));
});

test('a valid signature from any peer but the gateway is 401', () => {
  for (const peer of ['127.0.0.1', '::1', '10.20.0.3', undefined, '']) {
    const r = hvemKontoKigger({ ...med(vektor('gyldig')), peer }, TO, K, V.nu); // not med(…, peer): undefined would mean the default
    assert.ok(erAfvist(r) && r.afvist === 401, String(peer));
  }
  assert.deepEqual(hvemKontoKigger(med(vektor('gyldig'), {}, `::ffff:${GATEWAY}`), TO, K, V.nu), MAJA, 'IPv4-mapped form of the gateway');
});

test('konto mode ignores every Tailscale header, Funnel included', () => {
  const ts = { 'Tailscale-User-Login': 'henrik@example.com', 'Tailscale-User-Name': 'Henrik', 'Tailscale-Funnel-Request': '?1' };
  const uden = hvemKontoKigger(med(null, ts, '127.0.0.1'), TO, K, V.nu);
  assert.ok(erAfvist(uden) && uden.afvist === 401);
  assert.deepEqual(hvemKontoKigger(med(vektor('gyldig'), { 'Tailscale-User-Login': 'henrik@example.com' }), TO, K, V.nu), MAJA);
});

test('tailnet mode ignores the Clawco-Konto header', () => {
  const r = hvemKigger(med(vektor('ejer'), {}, '127.0.0.1'), TO);
  assert.ok(erAfvist(r) && r.afvist === 401);
  assert.deepEqual(vaelgKigger(undefined, () => new Date(V.nu * 1000))(med(vektor('ejer'), {}, '127.0.0.1'), null), ENEBRUGER);
});

test('no single-user mode in konto: a missing or empty household is 503, never the implicit owner', () => {
  for (const hus of [null, { personer: [] }]) {
    const r = hvemKontoKigger(med(vektor('gyldig')), hus, K, V.nu);
    assert.ok(erAfvist(r) && r.afvist === 503);
  }
  // Also for an unsigned request: nobody learns anything about the household's state without a signature.
  const r = hvemKontoKigger(med(null), null, K, V.nu);
  assert.ok(erAfvist(r) && r.afvist === 401);
});

test('vaelgKigger picks the provider: fixed person, konto (clock from now()), else tailnet', () => {
  const nu = () => new Date(V.nu * 1000);
  assert.deepEqual(vaelgKigger({ konto: K }, nu)(med(vektor('gyldig')), TO), MAJA);
  assert.ok(erAfvist(vaelgKigger({ konto: K }, () => new Date((V.nu + 120) * 1000))(med(vektor('gyldig')), TO)));
  assert.deepEqual(vaelgKigger({ fast: HENRIK }, nu)(med(null), null), HENRIK);
  const funnel = vaelgKigger({ fast: HENRIK }, nu)(med(null, { 'Tailscale-Funnel-Request': '?1' }), null);
  assert.ok(erAfvist(funnel) && funnel.afvist === 403);
});

test('peerAf reads the TCP peer from the node-server bindings, nothing else', () => {
  assert.equal(peerAf({ incoming: { socket: { remoteAddress: '10.0.0.1' } } }), '10.0.0.1');
  assert.equal(peerAf(undefined), undefined);
  assert.equal(peerAf({}), undefined);
});

test('kunSigneret: only a signed request reaches the dispatcher (the test world); the rest goes to the app', async () => {
  const hvem: string[] = [];
  const signeret = { fetch: () => { hvem.push('signeret'); return new Response('verden'); } };
  const ellers = { fetch: () => { hvem.push('app'); return new Response('nej', { status: 401 }); } };
  const f = kunSigneret(K, () => new Date(V.nu * 1000), signeret, ellers);
  const env = { incoming: { socket: { remoteAddress: GATEWAY } } };
  await f(new Request('http://x/rum/hjem', { headers: { cookie: 'kc_test=1' } }), env);
  await f(new Request('http://x/test/taend', { method: 'POST', headers: { cookie: 'kc_test=1', 'Clawco-Konto': vektor('forfalsket') } }), env);
  await f(new Request('http://x/rum/hjem', { headers: { cookie: 'kc_test=1', 'Clawco-Konto': vektor('gyldig') } }), { incoming: { socket: { remoteAddress: '127.0.0.1' } } });
  await f(new Request('http://x/rum/hjem', { headers: { cookie: 'kc_test=1', 'Clawco-Konto': vektor('gyldig') } }), env);
  assert.deepEqual(hvem, ['app', 'app', 'app', 'signeret']);
});
