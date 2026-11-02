// KC-0139: a connection that stops working gets one calm card in Nu, "Kræver dig",
// with one tap that restarts its connect flow; it is gone when the source works
// again (and a line in the log says so). A single hiccup is silent; a slow source
// asks nothing. The voice names a broken source once. Rooms say when they last read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { createFakeStemme } from '../src/stemme/fake.ts';
import { falskeKilder, type FalskData, type FalskTilstand } from '../src/kilder/falsk/falsk.ts';
import { KILDER_LOG, skrivKonfig } from '../src/kilder/register.ts';
import { parseDagenState } from '../src/rooms/dagen/schema.ts';
import type { Slags } from '../src/kilder/types.ts';
import type { Person } from '../src/identitet/husstand.ts';

const T0 = new Date('2026-10-31T10:00:00Z').getTime();
const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };

const DATA: FalskData = {
  kalender: () => ({ generated: new Date(T0).toISOString(), days: [{ date: '2026-10-31', events: [{ title: 'Stand-up' }] }], errors: [] }),
  mail: () => [{ id: '1', emne: 'Hej', fra: 'Clara', modtaget: new Date(T0).toISOString(), laest: false, flag: false, vedhaeftning: false }],
  nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};

type App = ReturnType<typeof createApp>;
type Verden = { sut: App; tid(min: number): void; saet(slags: Slags, t: FalskTilstand): void; dir: string; store: ReturnType<typeof createFileStore> };

async function medVerden(fn: (v: Verden) => Promise<void>, person: Person = EJER, forbundne: string[] = ['falsk-kalender'], zone: 'privat' | 'husstand' = 'privat'): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-server-helbred-'));
  try {
    const store = createFileStore(path.join(dir, 'data'));
    let nu = T0;
    const modes: Partial<Record<Slags, FalskTilstand>> = {};
    await skrivKonfig(dir, { kilder: forbundne.map((id) => ({ id, status: 'forbundet' as const, zone, valg: id === 'falsk-mail' ? { brugernavn: 'henrik' } : {}, tid: new Date(T0).toISOString(), af: 'henrik' })) });
    const sut = createApp({
      store, hermes: createFakeAgent({ answer: () => 'Gjort.' }), sourceGlob: '/nonexistent/{date}.json', dataDir: dir, now: () => new Date(nu),
      mailRunner: async () => ({ code: 1, stdout: '', stderr: 'x' }), mailStateDir: '/nonexistent', identitet: { fast: person },
      stemme: createFakeStemme(), kilder: falskeKilder({ data: DATA, tilstand: (s) => modes[s] ?? 'ok', reparation: new Set<Slags>() }),
    });
    await fn({ sut, dir, store, tid: (min) => { nu = T0 + min * 60_000; }, saet: (s, t) => { modes[s] = t; } });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const side = async (v: Verden, sti = '/rum/hjem'): Promise<string> => (await v.sut.app.request(sti)).text();
const kort = (h: string): string[] => [...h.matchAll(/data-kilde-helbred="([a-z-]+)"/g)].map((m) => m[1] ?? '');
const hjemVenter = async (v: Verden): Promise<number> => ((await (await v.sut.app.request('/api/rum/hjem/fragment')).json()) as { venter: Record<string, number> }).venter['hjem'] ?? 0;
const venterIalt = (h: string): number => Number(/(\d+) venter på dig/.exec(h)?.[1] ?? 0);
const poll = async (v: Verden, min: number): Promise<void> => { v.tid(min); await v.sut.helbred.pollAlle(); };

test('a source whose login is gone gets a card in Nu at once, in "Kræver dig", counted in the nav', async () => {
  await medVerden(async (v) => {
    await poll(v, 0);
    const foer = venterIalt(await side(v));
    assert.deepEqual(kort(await side(v)), [], 'working: no card at all');
    assert.equal(await hjemVenter(v), 0);
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 5);
    const h = await side(v);
    assert.deepEqual(kort(h), ['log-ind-igen']);
    const baand = h.slice(h.indexOf('data-baand="kraever"'), h.indexOf('<!--/baand-->'));
    assert.match(baand, /data-kilde-helbred-id="falsk-kalender"/);
    assert.match(baand, /Din kalender er logget ud/);
    assert.match(baand, /data-gruppe="Forbindelser"/);
    assert.match(baand, /data-id="kilde-helbred-falsk-kalender"/);
    assert.equal(venterIalt(h), foer + 1, 'the tab count and the band count agree: one more waits');
    assert.equal(await hjemVenter(v), 1);
  });
});

test('a transient failure is silent until 3 in a row over an hour; then one card; the fix removes it and logs it', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'nede');
    await poll(v, 0); await poll(v, 30);
    assert.deepEqual(kort(await side(v)), [], 'two failures: still a hiccup');
    await poll(v, 60);
    assert.deepEqual(kort(await side(v)), ['nede']);
    assert.match(await side(v), /Din kalender svarer ikke/);
    v.saet('kalender', 'ok');
    await poll(v, 65);
    assert.deepEqual(kort(await side(v)), [], 'gone, not greyed');
    assert.equal(await hjemVenter(v), 0);
    const log = (await v.store.readLog(KILDER_LOG, 10)).map((e) => e.tekst);
    assert.ok(log.some((t) => /Falsk kalender virker igen/.test(t)), log.join(' | '));
  });
});

test('a slow source asks nothing: no card, even after an hour', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'langsom');
    for (const min of [0, 30, 60, 90]) await poll(v, min);
    assert.deepEqual(kort(await side(v)), []);
    assert.equal(await hjemVenter(v), 0);
  });
});

test('the primary handling restarts the connect flow: the provider round trip runs again, the read after it works and the card is gone', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 0);
    const h = await side(v);
    assert.match(h, /btn btn-primary"[^>]*data-kilde-forbind="falsk-kalender"[^>]*>Log ind igen</);
    // The page's button posts to the same route Start's cards use; the fake provider consents at once.
    const res = await v.sut.app.request('/api/kilder/falsk-kalender/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ felter: {} }) });
    const { omdiriger } = (await res.json()) as { omdiriger: string };
    assert.match(omdiriger, /\/api\/kilder\/falsk-kalender\/tilbage\?state=/);
    assert.deepEqual(kort(await side(v)), ['log-ind-igen'], 'nothing is mended until the provider has answered');
    await v.sut.app.request(omdiriger);
    await v.sut.helbred.tom();
    assert.deepEqual(kort(await side(v)), [], 'the read after the reconnect worked: the card is gone');
    assert.ok((await v.store.readLog(KILDER_LOG, 10)).some((e) => /virker igen/.test(e.tekst)));
  });
});

test('a non-oauth source asks for the password again in a form that goes to the same route', async () => {
  await medVerden(async (v) => {
    v.saet('mail', 'log-ind-igen');
    await poll(v, 0);
    const h = await side(v);
    assert.deepEqual(kort(h), ['log-ind-igen']);
    assert.match(h, /Adgangskoden til din mail virker ikke længere/);
    assert.match(h, /<input type="hidden" name="brugernavn" value="henrik">/);
    assert.match(h, /<input name="adgangskode" type="password"/);
    assert.match(h, />Indtast adgangskoden igen</);
  }, EJER, ['falsk-mail']);
});

test('only the owner gets the buttons; the card text is the fixed table, never a provider word', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 0);
    const h = await side(v);
    assert.deepEqual(kort(h), ['log-ind-igen']);
    assert.doesNotMatch(h, /data-kilde-forbind/);
    assert.match(h, /Ejeren kan løse det/);
    assert.doesNotMatch(h, /Adgangen er udløbet\. Log ind igen\./, 'the connector\'s own words are not shown');
  }, MEDLEM, ['falsk-kalender'], 'husstand');
});

test('a member never sees the card of a private source of the owner', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 0);
    assert.deepEqual(kort(await side(v)), []);
    assert.equal(await hjemVenter(v), 0);
    const sig = ((await (await v.sut.app.request('/api/stemme/oversigt')).json()) as { tekst: string }).tekst;
    assert.doesNotMatch(sig, /logget ud/);
  }, MEDLEM);
});

test('a source that is no longer connected has no card', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 0);
    assert.deepEqual(kort(await side(v)), ['log-ind-igen']);
    await skrivKonfig(v.dir, { kilder: [] });
    await poll(v, 5);
    assert.deepEqual(kort(await side(v)), []);
    assert.equal(await hjemVenter(v), 0);
  });
});

test('Fjern forbindelsen goes to the disconnect route and the card goes with it', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 0);
    assert.match(await side(v), /data-kilde-fjern="falsk-kalender"/);
    assert.equal((await v.sut.app.request('/api/kilder/falsk-kalender/frakobl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 200);
    assert.deepEqual(kort(await side(v)), [], 'a disconnected source is not offered a card');
  });
});

test('the voice names a broken source once, in one sentence, only for log-ind-igen and nede', async () => {
  await medVerden(async (v) => {
    const sig = async (): Promise<string> => ((await (await v.sut.app.request('/api/stemme/oversigt')).json()) as { tekst: string }).tekst;
    v.saet('kalender', 'langsom');
    for (const min of [0, 30, 60]) await poll(v, min);
    assert.doesNotMatch(await sig(), /kalender/i, 'slow is not spoken');
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 70);
    const tekst = await sig();
    assert.equal(tekst.match(/Din kalender er logget ud\./g)?.length, 1, 'once');
    v.saet('kalender', 'ok');
    await poll(v, 80);
    assert.doesNotMatch(await sig(), /logget ud/);
  });
});

test('Kø: a broken source is a line with its state and when it last read', async () => {
  await medVerden(async (v) => {
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 0);
    const koe = (await (await v.sut.app.request('/api/koe?kilder=1')).json()) as { kilder: string };
    assert.match(koe.kilder, /data-kilde="falsk-kalender" data-kilde-tilstand="log-ind-igen"/);
  });
});

test('Dagen says when the calendar was last read; once the source fails it says "ikke opdateret siden"', async () => {
  await medVerden(async (v) => {
    await v.store.writeState('dagen', parseDagenState({ dato: '2026-10-31', treLinjer: ['a', 'b', 'c'], anbefaling: { tekst: 'x' }, kalender: [], morgenavis: [], hermesStatus: 'Klar' }, new Date(T0)));
    assert.doesNotMatch(await side(v, '/rum/dagen'), /data-sidst-hentet|data-ikke-opdateret/, 'never read: nothing to say');
    // A read through the registry (the connect's first read) is the proof.
    await v.sut.helbred.laesning('falsk-kalender', true);
    assert.match(await side(v, '/rum/dagen'), /data-sidst-hentet[^>]*>Sidst hentet 11\.00</);
    v.saet('kalender', 'log-ind-igen');
    await poll(v, 10);
    assert.match(await side(v, '/rum/dagen'), /data-ikke-opdateret[^>]*>ikke opdateret siden 11\.00</);
  });
});
