// KC-0188: "Lad support se med", the tenant's half. Invariant (D15, AGENTS §0 r2/r7): a Clawco staff identity reaches
// this tenant only through an unexpired grant its owner made (this tenant's own record, src/identitet/stoette.ts, beside
// the gateway's signed claim); it reads what the owner could see and never acts — the role `stoette` passes only the
// verb `laes`; every write, the export, Slet alt, settings, chat, handlinger, fortryd and refresh are refused; every
// session start and every page opened is in the audit log (route templates only); on any doubt (clock, unreadable
// record, missing grant) the identity is refused. Never on from the agent, a rule or a script: only Sky's bevis.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kan, RETTIGHEDER, ROLLER, ROLLE_NAVN, erRolle } from '../../src/identitet/roller.ts';
import { afgoer } from '../../src/graenser/afgoer.ts';
import { VERBER } from '../../src/graenser/verber.ts';
import { maaHandle, maaSe, HANDLING_SLAGS, AKTION_HANDLING } from '../../src/hushold/rettigheder.ts';
import { synligFor } from '../../src/identitet/zoner.ts';
import { INVITER_ROLLER } from '../../src/hushold/invitation.ts';
import { laesHusstand, type Person } from '../../src/identitet/husstand.ts';
import { erAfvist, hvemKigger, hvemKontoKigger, type Anmodning } from '../../src/identitet/identitet.ts';
import { kontoFraMiljoe, type KontoIndstilling } from '../../src/identitet/konto.ts';
import {
  STOETTE_TIMER, STOETTE_MAKS_TIMER, GRUND_MAKS, aktiv, lavStoetteLager, verificerBevis, type StoetteAdgang,
} from '../../src/identitet/stoette.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { skrivHusstand } from '../../src/identitet/husstand.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-stoette-'));
after(() => rm(rod, { recursive: true, force: true }));
const publicDir = path.relative(process.cwd(), fileURLToPath(new URL('../../public', import.meta.url)));

const V = JSON.parse(readFileSync(new URL('../fixtures/konto-vektorer.json', import.meta.url), 'utf8')) as {
  tenant: string; nu: number; noegler: Record<'a' | 'b', { froe: string; offentlig: string; id: string }>;
};
const GATEWAY = '10.20.0.2';
const K = kontoFraMiljoe({ KC_IDENTITET: 'konto', KC_KONTO_TENANT: V.tenant, KC_KONTO_PUBKEY: V.noegler.a.offentlig, KC_KONTO_GATEWAY: GATEWAY }) as KontoIndstilling;
const PRIVAT = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(V.noegler.a.froe, 'hex')]), format: 'der', type: 'pkcs8' });
const ANDEN = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(V.noegler.b.froe, 'hex')]), format: 'der', type: 'pkcs8' });

/** Signs like the gateway (sky/src/gateway/signer.ts): `<version>.<keyid>.<payload>.<sig>`. */
function signer(version: 'v1' | 's1', krop: unknown, noegle = PRIVAT, id = V.noegler.a.id): string {
  const til = `${version}.${id}.${Buffer.from(JSON.stringify(krop)).toString('base64url')}`;
  return `${til}.${sign(null, Buffer.from(til), noegle).toString('base64url')}`;
}

const NU = V.nu;
const ADGANG = '41';
const SESSION = '0123456789abcdef';
const stoetteKrop = (o: Partial<{ sa: string; su: number; sn: string; iat: number; t: string }> = {}): Record<string, unknown> =>
  ({ t: o.t ?? V.tenant, k: '7', e: 'personale@example.com', iat: o.iat ?? NU - 2, sa: o.sa ?? ADGANG, su: o.su ?? NU + 3600, sn: o.sn ?? SESSION });
/** KC-0272: the gateway signs each request's method and path into the header (after iat, before the support claims). */
const forAnmodning = (krop: Record<string, unknown>, m = 'GET', p = '/rum/hjem'): Record<string, unknown> => {
  const { t, k, e, iat, ...resten } = krop;
  return { t, k, e, iat, m, p, ...resten };
};
const stoetteKlaim = (o: Parameters<typeof stoetteKrop>[0] = {}) => signer('v1', forAnmodning(stoetteKrop(o)));

const HENRIK: Person = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' };
const MAJA: Person = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' };
const HUS = { personer: [HENRIK, MAJA] };

const lokal = (o: Partial<StoetteAdgang> = {}): StoetteAdgang => ({
  id: ADGANG, givet: new Date((NU - 60) * 1000).toISOString(), udloeber: new Date((NU - 60 + 3600) * 1000).toISOString(), timer: 1, grund: '', sessioner: [], ...o,
});
const med = (header: string | null, peer = GATEWAY): Anmodning => {
  const h = new Headers();
  if (header !== null) h.set('Clawco-Konto', header);
  return { headers: h, peer, metode: 'GET', sti: '/rum/hjem' };
};

// ---- the role --------------------------------------------------------------------------------------------------

test('the role stoette reads only: laese and se-husstand, nothing else', () => {
  for (const r of RETTIGHEDER) assert.equal(kan('stoette', r), r === 'laese' || r === 'se-husstand', r);
  assert.equal(ROLLE_NAVN.stoette, 'support');
});

test('stoette is never a household role: not in ROLLER, never in husstand.json, never invited, never from Tailscale', async () => {
  assert.ok(!(ROLLER as readonly string[]).includes('stoette'));
  assert.equal(erRolle('stoette'), false);
  assert.ok(!(INVITER_ROLLER as readonly string[]).includes('stoette'));
  const dir = path.join(rod, 'husstand-med-stoette');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'husstand.json'), JSON.stringify({ personer: [{ id: 'x', login: 'x@example.com', navn: 'X', rolle: 'stoette' }] }));
  await assert.rejects(laesHusstand(dir), /ukendt rolle/);
  // The tailnet provider: every outcome is a household person or a refusal, never the support role.
  const h = new Headers({ 'tailscale-user-login': 'personale@example.com' });
  const r = hvemKigger({ headers: h, peer: '127.0.0.1' }, HUS);
  assert.ok(erAfvist(r));
});

test('the policy layer refuses stoette every verb but laes, on every channel, even with a human-tap token', () => {
  const p: Person = { ...HENRIK, rolle: 'stoette' };
  for (const verb of VERBER) {
    for (const kanal of ['knap', 'stemme', 'chat'] as const) {
      const a = afgoer({ rum: 'mail', id: 'x', verb, zoner: ['privat'] }, { person: p, kanal, ja: true });
      assert.equal(a.udfald, verb === 'laes' ? 'tillad' : 'afvis', `${verb} via ${kanal}`);
    }
  }
});

test('the household rules: stoette may never handle (every handling and every action), and sees what the owner could', () => {
  const p: Person = { ...HENRIK, rolle: 'stoette' };
  for (const slags of HANDLING_SLAGS) assert.equal(maaHandle(p, { slags, parter: [p.id] }), false, slags);
  for (const [navn, slags] of Object.entries(AKTION_HANDLING)) assert.equal(maaHandle(p, { slags, parter: [p.id] }), false, navn);
  assert.equal(maaSe(p, { slags: 'uge' }), true);
  assert.equal(maaSe(p, { slags: 'invitation' }), false, 'less than the owner, never more');
  assert.equal(synligFor(p, { zone: 'privat', ejer: 'henrik' }), true, 'the owner\'s own mail and calendar');
  assert.equal(synligFor(p, { zone: 'privat', ejer: 'maja' }), false, 'never another person\'s privat');
  assert.equal(synligFor(p, { zone: 'arbejde' }), true, 'an element with no ejer is the owner\'s, so the owner could see it');  assert.equal(kan('stoette', 'nodstop'), false);
});

// ---- the identity ----------------------------------------------------------------------------------------------

test('a valid support claim with this tenant\'s own live grant is the owner\'s view in role stoette', () => {
  const r = hvemKontoKigger(med(stoetteKlaim()), HUS, K, NU, lokal());
  assert.ok(!erAfvist(r));
  // KC-0277 (review A14): support's own id, never the owner's; whose eyes it looks through is carried separately.
  assert.deepEqual(r, { id: 'stoette:7', login: null, navn: 'Support', rolle: 'stoette', stoette: { adgang: ADGANG, personale: '7', session: SESSION, ejer: 'henrik' } });
  assert.equal(synligFor(r!, { zone: 'privat', ejer: 'henrik' }), true, 'the owner\'s own element, as the owner would see it');
  assert.equal(synligFor(r!, { zone: 'privat' }), true, 'an element with no ejer is the owner\'s');
  assert.equal(synligFor(r!, { zone: 'privat', ejer: 'maja' }), false, 'a member\'s private element: not even support');
  assert.equal(synligFor(r!, { zone: 'husstand' }), true);
});

test('fail closed: after udloeber the signature is still valid, but the tenant refuses; so for revoked, unknown, unreadable', () => {
  const afvist = (r: ReturnType<typeof hvemKontoKigger>, hvorfor: string) => {
    assert.ok(erAfvist(r), hvorfor);
    assert.equal(r.afvist, 401, hvorfor);
    assert.match(r.hvorfor, /Clawco ved ikke, hvem du er/, hvorfor);
  };
  // The tenant's own record has expired, though the gateway's claim says an hour more and the header is fresh.
  afvist(hvemKontoKigger(med(stoetteKlaim({ su: NU + 7200 })), HUS, K, NU, lokal({ udloeber: new Date(NU * 1000).toISOString() })), 'local expiry');
  // The claim itself says it has ended.
  afvist(hvemKontoKigger(med(stoetteKlaim({ su: NU })), HUS, K, NU, lokal()), 'claimed expiry');
  afvist(hvemKontoKigger(med(stoetteKlaim()), HUS, K, NU, lokal({ tilbagekaldt: new Date((NU - 1) * 1000).toISOString() })), 'revoked');
  afvist(hvemKontoKigger(med(stoetteKlaim({ sa: '42' })), HUS, K, NU, lokal()), 'another grant');
  afvist(hvemKontoKigger(med(stoetteKlaim()), HUS, K, NU, null), 'no grant at all');
  afvist(hvemKontoKigger(med(stoetteKlaim()), HUS, K, NU, 'ulaeselig'), 'an unreadable record');
  afvist(hvemKontoKigger(med(stoetteKlaim()), HUS, K, NU), 'no record handed in');
  afvist(hvemKontoKigger(med(stoetteKlaim()), HUS, K, NU, lokal({ udloeber: 'ikke en tid' })), 'a record with a bad clock');
  afvist(hvemKontoKigger(med(stoetteKlaim()), { personer: [MAJA] }, K, NU, lokal()), 'no owner to look through');
  afvist(hvemKontoKigger(med(stoetteKlaim({ iat: NU - 61 })), HUS, K, NU, lokal()), 'a stale header');
  // Half a claim is no claim.
  afvist(hvemKontoKigger(med(signer('v1', { t: V.tenant, k: '7', e: 'p@example.com', iat: NU, m: 'GET', p: '/rum/hjem', sa: ADGANG })), HUS, K, NU, lokal()), 'half a claim');
  afvist(hvemKontoKigger(med(signer('v1', { t: V.tenant, k: '7', e: 'p@example.com', iat: NU, m: 'GET', p: '/rum/hjem', sa: ADGANG, su: NU + 60, sn: 'x' })), HUS, K, NU, lokal()), 'a bad session id');
});

test('aktiv: on only while not revoked and before udloeber; a bad time is off', () => {
  const nu = new Date(NU * 1000);
  assert.equal(aktiv(lokal(), nu), true);
  assert.equal(aktiv(lokal({ tilbagekaldt: nu.toISOString() }), nu), false);
  assert.equal(aktiv(lokal({ udloeber: nu.toISOString() }), nu), false);
  assert.equal(aktiv(lokal({ udloeber: 'x' }), nu), false);
  assert.equal(aktiv(null, nu), false);
  assert.equal(aktiv(lokal(), new Date(Number.NaN)), false);
});

// ---- the bevis (how support is turned on) ----------------------------------------------------------------------

const bevisKrop = (o: Record<string, unknown> = {}) => ({ t: V.tenant, a: ADGANG, g: NU - 1, u: NU - 1 + 3600, h: 1, r: 'Mail viser ingenting', iat: NU, ...o });

test('the bevis: only Sky\'s key, only its own prefix, only this tenant, fresh, 1, 4 or 24 hours', () => {
  assert.deepEqual([...STOETTE_TIMER], [1, 4, 24]);
  assert.equal(STOETTE_MAKS_TIMER, 24);
  assert.equal(GRUND_MAKS, 120);
  const ok = verificerBevis(signer('s1', bevisKrop()), K, NU);
  assert.ok(ok.ok);
  assert.deepEqual(ok.adgang, { id: ADGANG, givet: new Date((NU - 1) * 1000).toISOString(), udloeber: new Date((NU + 3599) * 1000).toISOString(), timer: 1, grund: 'Mail viser ingenting', sessioner: [] });
  const nej = (b: unknown, hvorfor: string) => assert.equal(verificerBevis(b, K, NU).ok, false, hvorfor);
  nej(signer('v1', bevisKrop()), 'a v1 (user header) signature is no bevis');
  nej(stoetteKlaim(), 'a user header is no bevis');
  nej(signer('s1', bevisKrop(), ANDEN, V.noegler.b.id), 'another key');
  nej(signer('s1', bevisKrop({ t: 'anden-tenant' })), 'another tenant');
  nej(signer('s1', bevisKrop({ iat: NU - 61 })), 'stale');
  nej(signer('s1', bevisKrop({ h: 2 })), 'two hours');
  nej(signer('s1', bevisKrop({ h: 25, u: NU - 1 + 25 * 3600 })), 'more than 24 hours');
  nej(signer('s1', bevisKrop({ u: NU - 1 + 7200 })), 'u does not match h');
  nej(signer('s1', bevisKrop({ u: NU - 1, g: NU - 3601 })), 'already over');
  nej(signer('s1', bevisKrop({ r: 'x'.repeat(121) })), 'a long reason');
  nej(signer('s1', bevisKrop({ r: 'to\nlinjer' })), 'two lines');
  nej(signer('s1', { ...bevisKrop(), ekstra: 1 }), 'an extra field');
  nej(undefined, 'nothing');
  nej('s1.x.y.z', 'garbage');
});

test('the record: written atomically, unreadable is an error (the caller refuses), missing is none', async () => {
  const dir = path.join(rod, 'lager');
  const l = lavStoetteLager(dir);
  assert.equal(await l.laes(), null);
  await l.skriv(lokal({ grund: 'x' }));
  assert.deepEqual(await l.laes(), lokal({ grund: 'x' }));
  assert.deepEqual((await readdir(dir)).filter((f) => f.includes('.tmp')), []);
  await writeFile(path.join(dir, 'stoette.json'), '{ikke json');
  await assert.rejects(l.laes());
  await writeFile(path.join(dir, 'stoette.json'), JSON.stringify({ ...lokal(), timer: 3 }));
  await assert.rejects(l.laes(), 'a record that is not a valid grant');
});

// ---- through the app's real routes -----------------------------------------------------------------------------

const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };
const FRA_GATEWAY = { incoming: { socket: { remoteAddress: GATEWAY } } };
async function app(navn: string, adgang: StoetteAdgang | null = lokal()) {
  const dataDir = path.join(rod, navn);
  await skrivHusstand(dataDir, HUS);
  if (adgang) await lavStoetteLager(dataDir).skriv(adgang);
  let nu = NU * 1000;
  const a = createApp({ store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, now: () => new Date(nu), identitet: { konto: K }, stoette: { slaaTil: '/_sky/stoette', slaaFra: '/_sky/stoette/slaa-fra' }, ...noMail });
  return { ...a, dataDir, frem: (ms: number) => { nu += ms; } };
}
/** One request from the gateway: the claim signed for this request's own method and path, as the gateway does (KC-0272). */
const anmod = (a: { request: (sti: string, init: RequestInit, env: unknown) => Response | Promise<Response> }, sti: string, krop: Record<string, unknown>, init: RequestInit = {}) =>
  a.request(sti, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'Clawco-Konto': signer('v1', forAnmodning(krop, init.method ?? 'GET', new URL(sti, 'http://x.invalid').pathname)) } }, FRA_GATEWAY);
const ejerKrop = () => ({ t: V.tenant, k: '1', e: 'henrik@example.com', iat: NU });
const majaKrop = () => ({ t: V.tenant, k: '2', e: 'maja@example.com', iat: NU });
const json = (b: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

async function revision(dataDir: string): Promise<Record<string, unknown>[]> {
  const filer = (await readdir(dataDir)).filter((f) => /^revision-\d{4}-\d{2}\.jsonl$/.test(f)).sort();
  const linjer: Record<string, unknown>[] = [];
  for (const f of filer) for (const l of (await readFile(path.join(dataDir, f), 'utf8')).split('\n').filter(Boolean)) linjer.push(JSON.parse(l) as Record<string, unknown>);
  return linjer;
}

test('support reads the owner\'s screens, with the band; every write, the export, Slet alt, settings, chat, handlinger, fortryd and refresh are refused in Danish', async () => {
  const { app: a, dataDir } = await app('ruter');
  const side = await anmod(a, '/rum/hjem', stoetteKrop());
  assert.equal(side.status, 200);
  const html = await side.text();
  assert.match(html, /<body[^>]* data-person="stoette:7" data-rolle="stoette"/);
  assert.match(html, /data-stoette="baand"/);
  assert.match(html, /Support kigger med til/);
  assert.doesNotMatch(html, /data-stoette="slaa-fra"/, 'only the owner gets Slå fra');
  assert.equal((await anmod(a, '/rum/mail', stoetteKrop())).status, 200);
  const statFoer = (await readdir(dataDir)).sort();
  const POST = ['/api/indstillinger', '/api/nodstop', '/api/nodstop/genoptag', '/api/graense/ja', '/api/kilder/falsk-mail/forbind', '/api/kilder/falsk-mail/frakobl',
    '/api/tillid/slet-alt', '/api/tillid/regler/R-0001/pause', '/api/tillid/forslag/x/godkend', '/api/rum/mail/opdater', '/api/rum/mail/handlinger/h1',
    '/api/rum/mail/log/l1/fortryd', '/api/rum/mail/aktion/kladde', '/api/rum/mail/chat', '/api/rum/hjem/kurator', '/api/rum/hjem/kort/k1/handling',
    '/api/rum/hjem/fortryd/l1', '/api/hushold/foresp/f1/send', '/api/hushold/medlem/m1/inviter', '/api/udvikling/opgaver', '/api/stemme/udfoer', '/api/stemme/samtale',
    '/api/stoette/start', '/api/stoette/slaa-fra'];
  for (const sti of POST) {
    const r = await anmod(a, sti, stoetteKrop(), json({ besked: 'slet alt', bekraeft: 'SLET' }));
    assert.equal(r.status, 403, sti);
    assert.match(((await r.json()) as { error: string }).error, /Support kan kun se med/, sti);
  }
  for (const metode of ['PUT', 'PATCH', 'DELETE']) assert.equal((await anmod(a, '/api/rum/mail/chat', stoetteKrop(), { method: metode })).status, 403, metode);
  for (const sti of ['/api/tillid/eksport', '/viden', '/viden/slet-alt']) assert.equal((await anmod(a, sti, stoetteKrop())).status, 403, sti);
  assert.deepEqual((await readdir(dataDir)).filter((f) => !/^revision-|^stoette\.json$/.test(f)).sort(), statFoer.filter((f) => !/^revision-|^stoette\.json$/.test(f)).sort(), 'nothing new was written but the audit log');
});

test('every session start and every page opened is in the audit log as a route template (never a query string), with the staff id; the owner sees it', async () => {
  const { app: a, dataDir } = await app('log');
  await anmod(a, '/rum/hjem?hemmelig=1', stoetteKrop());
  await anmod(a, '/rum/mail', stoetteKrop());
  await anmod(a, '/api/rum/mail/fragment?x=2', stoetteKrop());
  await anmod(a, '/api/rum/mail/fragment?x=3', stoetteKrop());
  const linjer = (await revision(dataDir)).filter((l) => l['kilde'] === 'stoette');
  assert.deepEqual(linjer.map((l) => [l['verb'], l['rum']]), [['stoette-start', 'stoette'], ['stoette-aabnet', '/rum/hjem'], ['stoette-aabnet', '/rum/mail'], ['stoette-aabnet', '/api/rum/:id/fragment']]);
  for (const l of linjer) {
    assert.equal(l['person'], 'stoette:7');
    assert.equal(l['kanal'], 'stoette');
    assert.doesNotMatch(JSON.stringify(l), /hemmelig|\?|x=/);
  }
  // A page support is refused (owner-only) is logged as a no, so the owner sees the attempt.
  assert.equal((await anmod(a, '/viden', stoetteKrop())).status, 403);
  const nej = (await revision(dataDir)).filter((l) => l['kilde'] === 'stoette').at(-1)!;
  assert.deepEqual([nej['verb'], nej['rum'], nej['udfald']], ['stoette-aabnet', '/viden', 'afvist']);
  const ejer = await anmod(a, '/api/revision', ejerKrop());
  const { linjer: set } = (await ejer.json()) as { linjer: { kilde: string }[] };
  assert.ok(set.filter((l) => l.kilde === 'stoette').length >= 4, 'the owner sees them in Hvad er sket');
  const maja = await anmod(a, '/api/revision', majaKrop());
  assert.equal(((await maja.json()) as { linjer: { kilde: string }[] }).linjer.filter((l) => l.kilde === 'stoette').length, 0, 'a member does not');
});

test('the tenant refuses a support identity after udloeber, even with a fresh valid signature; the expiry is logged once', async () => {
  const { app: a, dataDir, frem } = await app('udloeb');
  assert.equal((await anmod(a, '/rum/hjem', stoetteKrop())).status, 200);
  frem(3600 * 1000);
  // A gateway bug: a fresh header that claims the grant runs another hour.
  const fejl = { t: V.tenant, k: '7', e: 'personale@example.com', iat: NU + 3600, sa: ADGANG, su: NU + 7200, sn: SESSION };
  assert.equal((await anmod(a, '/rum/hjem', fejl)).status, 401);
  const ejer = { t: V.tenant, k: '1', e: 'henrik@example.com', iat: NU + 3600 };
  const side = await anmod(a, '/rum/hjem', ejer);
  assert.doesNotMatch(await side.text(), /data-stoette="baand"/, 'the band is gone by clock');
  await anmod(a, '/rum/mail', ejer);
  assert.equal((await revision(dataDir)).filter((l) => l['verb'] === 'stoette-udloeb').length, 1);
});

test('only Sky\'s bevis turns it on, and only for the owner; the owner turns it off; the agent, a rule or a script cannot', async () => {
  const { app: a, dataDir } = await app('kontakt', null);
  const bevis = signer('s1', bevisKrop());
  assert.equal((await anmod(a, '/api/stoette/start', majaKrop(), json({ bevis }))).status, 403, 'a member');
  assert.equal((await anmod(a, '/api/stoette/start', ejerKrop(), json({}))).status, 403, 'no bevis');
  assert.equal((await anmod(a, '/api/stoette/start', ejerKrop(), json({ bevis: stoetteKlaim() }))).status, 403, 'a header as bevis');
  assert.equal(await lavStoetteLager(dataDir).laes(), null);
  const r = await anmod(a, '/api/stoette/start', ejerKrop(), json({ bevis }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { aktiv: true });
  assert.equal((await lavStoetteLager(dataDir).laes())?.id, ADGANG);
  const side = await (await anmod(a, '/rum/hjem', ejerKrop())).text();
  assert.match(side, /data-stoette="baand"/);
  assert.match(side, /data-stoette="slaa-fra"/, 'the owner gets Slå fra');
  assert.match(side, /action="\/_sky\/stoette\/slaa-fra"/);
  assert.equal((await anmod(a, '/api/stoette/slaa-fra', majaKrop(), json({}))).status, 403, 'a member cannot');
  const af = await anmod(a, '/api/stoette/slaa-fra', ejerKrop(), json({}));
  assert.deepEqual(await af.json(), { aktiv: false });
  assert.equal((await anmod(a, '/rum/hjem', stoetteKrop())).status, 401, 'revoked at once on the tenant too');
  const linjer = (await revision(dataDir)).filter((l) => l['kilde'] === 'stoette').map((l) => [l['verb'], l['person']]);
  assert.deepEqual(linjer, [['stoette-givet', 'henrik'], ['stoette-slut', 'henrik']]);
});

test('never turned on by the agent, a rule or a script: only the /api/stoette/start route calls startStoette, and nothing the agent reaches imports it', () => {
  const src = fileURLToPath(new URL('../../src', import.meta.url));
  const scripts = fileURLToPath(new URL('../../scripts', import.meta.url));
  const filer = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const f = path.join(dir, n); return statSync(f).isDirectory() ? filer(f) : /\.(ts|js|py|sh)$/.test(n) ? [f] : []; });
  const brugere = [...filer(src), ...filer(scripts)].filter((f) => /\bstartStoette\b/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(path.dirname(src), f)).sort();
  assert.deepEqual(brugere, ['src/identitet/stoette.ts', 'src/server.ts']);
  const server = readFileSync(path.join(src, 'server.ts'), 'utf8');
  assert.equal(server.match(/\bstartStoette\(/g)?.length, 1, 'one call');
  const rute = server.slice(server.indexOf("app.post('/api/stoette/start'"));
  assert.ok(rute.indexOf('startStoette(') > 0 && rute.indexOf('startStoette(') < rute.indexOf('app.post(', 10), 'the call is inside the route');
  // No room, agent tool, rule, voice, scheduler or kurator imports the support module.
  for (const d of ['rooms', 'agent', 'tillid', 'stemme', 'kurator', 'situation', 'kilder', 'udvikling', 'hushold', 'graenser']) {
    for (const f of filer(path.join(src, d))) assert.doesNotMatch(readFileSync(f, 'utf8'), /identitet\/stoette\.ts/, path.relative(src, f));
  }
  assert.doesNotMatch(readFileSync(path.join(src, 'scheduler.ts'), 'utf8'), /stoette/i);
});
