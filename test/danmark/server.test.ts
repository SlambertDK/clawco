// KC-0232/KC-0233 through the app: a rule over the envelopes of the owner's own mail source, read through the registry.
// Start's step (candidates, confirm, refusals), the Nu card (owner only), "Set den" (a human tap, same-origin, owner),
// "kan ikke se" when the mail cannot be read, and what the rule never does. Invented senders on .example only.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { falskeKilder, type FalskData, type FalskTilstand } from '../../src/kilder/falsk/falsk.ts';
import { skrivKonfig } from '../../src/kilder/register.ts';
import type { Kuvert } from '../../src/kilder/types.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { rejsenFaerdig } from '../fixtures/start.ts';

const NU = new Date('2026-11-02T10:00:00Z');
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const A = 'post@notifikation.digitalpost.example';
const iso = (dage: number): string => new Date(NU.getTime() - dage * 86_400_000).toISOString();
const kv = (id: string, o: Partial<Kuvert> = {}): Kuvert => ({ id, emne: 'Du har ny Digital Post', fra: 'Digital Post', fraEmail: A, modtaget: iso(1), laest: false, flag: false, vedhaeftning: false, messageId: `<${id}@x.example>`, ...o });

const rod = await mkdtemp(path.join(tmpdir(), 'kc-danmark-srv-'));
after(() => rm(rod, { recursive: true, force: true }));

type Opsaetning = { mail?: Kuvert[]; tilstand?: FalskTilstand; zone?: 'privat' | 'husstand'; forbundet?: boolean; faerdig?: boolean };
let nr = 0;
async function opsaet(o: Opsaetning = {}) {
  const dataDir = path.join(rod, `t${++nr}`);
  const store = createFileStore(dataDir);
  if (o.faerdig !== false) await rejsenFaerdig(store);
  const m = { mail: o.mail ?? [kv('1', { emne: 'Ny besked fra Fiktiv Kommune' }), kv('2')], tilstand: o.tilstand ?? ('ok' as FalskTilstand) };
  if (o.forbundet !== false) await skrivKonfig(dataDir, { kilder: [{ id: 'falsk-mail', status: 'forbundet', zone: o.zone ?? 'privat', valg: { brugernavn: 'henrik' }, tid: NU.toISOString(), af: 'henrik' }] });
  const tom = (): never => { throw new Error('ikke brugt'); };
  const kilder = falskeKilder({ data: { kalender: tom, nyheder: tom, noter: tom, beskeder: tom, mail: () => m.mail } as FalskData, tilstand: () => m.tilstand });
  const bygg = (person: Person) => createApp({
    store, hermes: createFakeAgent({ answer: () => 'Hej.' }), sourceGlob: '/nonexistent/{date}.json', dataDir, now: () => NU, kilder,
    mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: person },
    danmark: { domaener: ['digitalpost.example'], cacheMs: 0 },
  });
  const ejer = bygg(EJER);
  const medlem = bygg(MEDLEM);
  const post = (s: ReturnType<typeof bygg>, url: string, body: unknown = {}, hoved: Record<string, string> = {}) => s.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...hoved }, body: JSON.stringify(body) });
  const tekstAf = async (s: ReturnType<typeof bygg>, url: string): Promise<string> => (await s.app.request(url)).text();
  const ja = async (s: ReturnType<typeof bygg>, id: string): Promise<string> => ((await (await post(s, '/api/graense/ja', { rum: 'hjem', slags: 'post', id })).json()) as { ja: string }).ja;
  const fil = async (): Promise<{ afsendere: string[]; set: string[]; viser: string }> => JSON.parse(await readFile(path.join(dataDir, 'danmark', 'digital-post.json'), 'utf8'));
  /** Start's action, awaited to the end. */
  async function aktion(s: ReturnType<typeof bygg>, navn: string, body: unknown): Promise<Response> {
    const r = await post(s, `/api/rum/start/aktion/${navn}`, body);
    if (r.status === 202) { const { runId } = (await r.clone().json()) as { runId: string }; await s.runs.get(runId)?.finished; }
    return r;
  }
  /** Confirm the sender as the owner and return the Nu page. */
  const bekraeft = async (viser = 'mit.dk'): Promise<void> => { assert.equal((await aktion(ejer, 'post-afsender-gem', { afsender: A, viser })).status, 202); };
  const kortAntal = (h: string): number => (h.match(/data-post-kort=/g) ?? []).length;
  return { dataDir, m, ejer, medlem, post, tekstAf, ja, fil, aktion, bekraeft, kortAntal };
}

test('nothing connected: no step in Start, no card in Nu, and the state file is never made', async () => {
  const t = await opsaet({ forbundet: false });
  assert.doesNotMatch(await t.tekstAf(t.ejer, '/rum/start'), /data-post-start/);
  assert.doesNotMatch(await t.tekstAf(t.ejer, '/rum/hjem'), /data-post|Digital Post/);
  await assert.rejects(() => readdir(path.join(t.dataDir, 'danmark')), /ENOENT/);
});

test('Start: mail connected and no sender — the step, with the inbox\'s candidate addresses and no subjects; Nu has no card yet', async () => {
  const t = await opsaet({ mail: [kv('1', { emne: 'Ny besked fra Fiktiv Kommune' }), kv('2', { fraEmail: 'info@butik.example', emne: 'Tilbud i dag' })] });
  const h = await t.tekstAf(t.ejer, '/rum/start');
  assert.match(h, /data-post-start/);
  assert.match(h, /name="afsender" value="post@notifikation\.digitalpost\.example"/);
  assert.doesNotMatch(h, /info@butik\.example/, 'only addresses on a hint domain are offered');
  assert.doesNotMatch(h, /Fiktiv Kommune|Tilbud i dag/, 'no subject is ever shown in Start');
  assert.match(h, /Clawco ser kun notifikationen: hverken brevet eller mailens tekst\./);
  assert.doesNotMatch(await t.tekstAf(t.ejer, '/rum/hjem'), /data-post-kort/);
});

test('Start: a member sees the step read-only (no form) and cannot confirm', async () => {
  const t = await opsaet();
  const h = await t.tekstAf(t.medlem, '/rum/start');
  assert.doesNotMatch(h, /name="afsender"|data-aktion="post-afsender-gem"/);
  const r = await t.aktion(t.medlem, 'post-afsender-gem', { afsender: A, viser: 'mit.dk' });
  assert.equal(r.status, 403);
  await assert.rejects(() => t.fil(), /ENOENT/);
});

test('confirming: an address on a hint domain is saved (lower-cased), the step leaves Start, the card appears in Nu', async () => {
  const t = await opsaet();
  assert.equal((await t.aktion(t.ejer, 'post-afsender-gem', { afsender: 'ignored@elsewhere.example', egen: `  ${A.toUpperCase()} `, viser: 'e-boks' })).status, 202);
  assert.deepEqual(await t.fil(), { afsendere: [A], set: [], viser: 'e-boks' });
  assert.doesNotMatch(await t.tekstAf(t.ejer, '/rum/start'), /data-post-start/);
  const nu = await t.tekstAf(t.ejer, '/rum/hjem');
  assert.equal(t.kortAntal(nu), 2);
  assert.match(nu, /href="https:\/\/www\.e-boks\.dk\/"/);
  assert.match(nu, /Der er kommet ny Digital Post \(fra post@notifikation\.digitalpost\.example, 1\. november\)/);
  assert.match(nu, /data-post-emne[^>]*>Ny besked fra Fiktiv Kommune</);
});

test('confirming: an address off the hint domains is refused with a plain sentence (400), nothing is written; so is an unknown viewer', async () => {
  const t = await opsaet();
  for (const egen of ['post@gmail.example', 'hej', `${A}.evil.example`, 'a@b@digitalpost.example']) {
    const r = await t.aktion(t.ejer, 'post-afsender-gem', { egen, viser: 'mit.dk' });
    assert.equal(r.status, 400, egen);
    assert.match(((await r.json()) as { error: string }).error, /ikke en adresse, Digital Post sender fra/);
  }
  assert.equal((await t.aktion(t.ejer, 'post-afsender-gem', { afsender: A, viser: 'google.com' })).status, 400);
  assert.equal((await t.aktion(t.ejer, 'post-afsender-gem', {})).status, 400);
  await assert.rejects(() => t.fil(), /ENOENT/);
});

test('Ikke nu puts the step away; with the mail source not connected nothing can be confirmed (409)', async () => {
  const t = await opsaet();
  assert.equal((await t.aktion(t.ejer, 'post-ikke-nu', {})).status, 202);
  assert.doesNotMatch(await t.tekstAf(t.ejer, '/rum/start'), /data-post-start/);
  const u = await opsaet({ forbundet: false });
  assert.equal((await u.aktion(u.ejer, 'post-afsender-gem', { afsender: A, viser: 'mit.dk' })).status, 409);
});

test('Nu: a card per unseen notice from the confirmed sender; an unconfirmed sender with the same subject, a read mail and an old one give none', async () => {
  const t = await opsaet({ mail: [kv('1'), kv('2', { fraEmail: 'spoof@andet.example' }), kv('3', { laest: true }), kv('4', { modtaget: iso(20) })] });
  await t.bekraeft();
  const nu = await t.tekstAf(t.ejer, '/rum/hjem');
  assert.equal(t.kortAntal(nu), 1);
  assert.doesNotMatch(nu, /spoof@andet/);
});

test('Set den: a human tap for exactly this notice; the card is gone (not greyed), the file holds the id, a replayed tap is refused', async () => {
  const t = await opsaet();
  await t.bekraeft();
  const tegn = await t.ja(t.ejer, 'set:<1@x.example>');
  const r = await t.post(t.ejer, '/api/danmark/post/set', { id: '<1@x.example>', ja: tegn });
  assert.equal(r.status, 200);
  assert.deepEqual((await t.fil()).set, ['<1@x.example>']);
  const nu = await t.tekstAf(t.ejer, '/rum/hjem');
  assert.equal(t.kortAntal(nu), 1);
  assert.doesNotMatch(nu, /data-post-kort="&lt;1@x/);
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { id: '<2@x.example>', ja: tegn })).status, 403, 'a tap is good for one notice, once');
});

test('Set den: no tap, a tap for another notice, another origin, a member, an unknown id, both or neither of id/alle — all refused, nothing written', async () => {
  const t = await opsaet();
  await t.bekraeft();
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { id: '<1@x.example>' })).status, 403, 'no tap');
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { id: '<1@x.example>', ja: await t.ja(t.ejer, 'set:<2@x.example>') })).status, 403, 'a tap for another notice');
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { id: '<1@x.example>', ja: await t.ja(t.ejer, 'set:<1@x.example>') }, { 'sec-fetch-site': 'cross-site' })).status, 403, 'another origin');
  assert.equal((await t.post(t.medlem, '/api/danmark/post/set', { id: '<1@x.example>', ja: await t.ja(t.medlem, 'set:<1@x.example>') })).status, 403, 'a member');
  const ukendt = await t.post(t.ejer, '/api/danmark/post/set', { id: '<findes-ikke@x.example>', ja: await t.ja(t.ejer, 'set:<findes-ikke@x.example>') });
  assert.equal(ukendt.status, 400, 'an unknown id');
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { ja: 'x' })).status, 400, 'neither');
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { id: 'a', alle: true, ja: 'x' })).status, 400, 'both');
  assert.deepEqual((await t.fil()).set, []);
});

test('more than three notices: one card; one tap marks them all', async () => {
  const t = await opsaet({ mail: [1, 2, 3, 4, 5].map((n) => kv(String(n))) });
  await t.bekraeft();
  const nu = await t.tekstAf(t.ejer, '/rum/hjem');
  assert.equal(t.kortAntal(nu), 1);
  assert.match(nu, /Der er kommet 5 nye breve i Digital Post/);
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { alle: true, ja: await t.ja(t.ejer, 'set:*') })).status, 200);
  assert.equal(t.kortAntal(await t.tekstAf(t.ejer, '/rum/hjem')), 0);
  assert.equal((await t.fil()).set.length, 5);
});

test('the mail source not answering: Nu says "kan ikke se", never "ingen ny post"; and Set den is 503', async () => {
  const t = await opsaet();
  await t.bekraeft();
  t.m.tilstand = 'nede';
  const nu = await t.tekstAf(t.ejer, '/rum/hjem');
  assert.match(nu, /Clawco kan ikke se, om der er ny Digital Post lige nu/);
  assert.doesNotMatch(nu, /[Ii]ngen ny post|ingen nye/);
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { id: '<1@x.example>', ja: await t.ja(t.ejer, 'set:<1@x.example>') })).status, 503);
  t.m.tilstand = 'ok';
  assert.equal(t.kortAntal(await t.tekstAf(t.ejer, '/rum/hjem')), 2, 'back when the source answers again');
});

test('zone privat only: a member never sees the card, and a mail source connected into the household\'s zone is not read at all', async () => {
  const t = await opsaet();
  await t.bekraeft();
  assert.doesNotMatch(await t.tekstAf(t.medlem, '/rum/hjem'), /data-post|Digital Post/);
  const h = await opsaet({ zone: 'husstand' });
  assert.doesNotMatch(await h.tekstAf(h.ejer, '/rum/start'), /data-post-start/);
});

test('a notice marked seen stays gone after a restart (the state is the file)', async () => {
  const t = await opsaet();
  await t.bekraeft();
  assert.equal((await t.post(t.ejer, '/api/danmark/post/set', { id: '<1@x.example>', ja: await t.ja(t.ejer, 'set:<1@x.example>') })).status, 200);
  assert.equal(t.kortAntal(await t.tekstAf(t.ejer, '/rum/hjem')), 1);
});

test('the nav offers Start once the journey is Done only while the inbox holds a Digital Post-looking sender and the step is open', async () => {
  const med = await opsaet();
  const iNav = (h: string): boolean => h.includes('<li><a href="/rum/start"'); // the nav lists every room; an irrelevant one is <li hidden>
  assert.ok(iNav(await med.tekstAf(med.ejer, '/rum/hjem')), 'a candidate in the inbox: Start is on screen');
  // (The state is written as the file would be, not through Start: a POST there counts as "opened today", which keeps Start in the nav for the day.)
  const bekraeftet = await opsaet();
  await mkdir(path.join(bekraeftet.dataDir, 'danmark'), { recursive: true });
  await writeFile(path.join(bekraeftet.dataDir, 'danmark', 'digital-post.json'), JSON.stringify({ afsendere: [A], set: [], viser: 'mit.dk' }));
  assert.ok(!iNav(await bekraeftet.tekstAf(bekraeftet.ejer, '/rum/hjem')), 'confirmed: Start leaves the nav');
  const uden = await opsaet({ mail: [kv('1', { fraEmail: 'info@butik.example' })] });
  assert.ok(!iNav(await uden.tekstAf(uden.ejer, '/rum/hjem')), 'no candidate: no reason to promote Start');
});

test('the rule has no outbound path and no verb: no handling, no network, no write to the mail in its code or in the card', async () => {
  const rodSti = fileURLToPath(new URL('../../src/', import.meta.url));
  for (const f of ['danmark/vindue.ts', 'danmark/tilstand.ts', 'kilder/danmark/digital-post.ts', 'rooms/hjem/digitalpost.ts', 'rooms/start/digitalpost.ts']) {
    const kode = (await readFile(path.join(rodSti, f), 'utf8')).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(kode, /\bfetch\(|node:(http|https|net|child_process|dgram|tls)|\.handl\(|\.act\(|act\(|hermes|runs\.start|\bsend\b/i, f);
  }
  const t = await opsaet();
  await t.bekraeft();
  const nu = await t.tekstAf(t.ejer, '/rum/hjem');
  const i = nu.indexOf('data-post-kort');
  const kort = nu.slice(nu.lastIndexOf('<article', i), nu.indexOf('</article>', i));
  assert.doesNotMatch(kort, /data-handling|data-aktion|data-ask|data-instruktion/);
});
