// KC-0131: the cold-start smoke (spec §10 "Verification for the product"). A
// brand-new, empty Clawco — the test world's variant `kold`, reached the way a
// device reaches it (cookie kc_test through the dispatcher) — walked through the
// whole journey as a new user: velkommen, model, first source, second source,
// import, first Ret. Only the agent (the scripted Hermes) and the connectors
// (KC_KILDER_MODE=fake, KC-0132) are fake; every step goes through the real
// routes, rooms and listeners, never a stub at the UI layer — so a step whose
// erKlaret is wrong fails here (§0 r2). The clock is the world's own (ur.ts).
//
// The run ends by requiring every registered step to be Klaret, so a new step fails
// this smoke until it is driven.
//
// Runs with `npm test`; alone: `npm run koldstart`. Spec budget: under five
// minutes (guarded); with the fakes it takes a few seconds.
//
// Before any release a second reference install is required as well: a clean
// Docker container that reaches Nu with one real element. That is E6's to build
// (KC-0110); this smoke is its in-process half.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { medTesttilstand } from '../../src/testtilstand/kontakt.ts';
import { lavTestverden, type Testverden } from '../../src/testtilstand/verden.ts';
import { idagKbh } from '../../src/testtilstand/ur.ts';
import { alleTrin } from '../../src/rooms/start/trin.ts';
import { KOLD_IMPORT_TEKST } from '../../src/testtilstand/indhold/start.ts';
import { erRejsenFaerdig } from '../../src/rooms/start/rejsen.ts';
import type { StartState } from '../../src/rooms/start/schema.ts';

/** The spec's promise: the whole journey in under five minutes. */
const LOFT_MS = 300_000;
/** A first value with the fake agent and fake connectors: well within this (the spec's real budget is 120 s). */
const FOERSTE_VAERDI_MS = 10_000;

const rod = await mkdtemp(path.join(tmpdir(), 'kc-koldstart-'));
after(() => rm(rod, { recursive: true, force: true }));
const dir = path.join(rod, 'data-test');

// Secrets typed during the run: none may come back in a response body, a log or the console.
const NOEGLE = `sk-ant-koldstart-${randomBytes(12).toString('hex')}`;
const ADGANGSKODE = `koldstart-${randomBytes(12).toString('hex')}`;
const svarTekster: string[] = [];
const konsol: string[] = [];

let verden!: Testverden;
const app = medTesttilstand({ fetch: () => new Response('den rigtige app må ikke nås i testen', { status: 500 }) }, async () => {
  // A small delay per scripted answer, so the first value can be seen standing before Hermes has answered.
  verden = await lavTestverden({ dataDir: dir, delayMs: 300, trinMs: 60_000 });
  return verden;
});

const HOVED = { cookie: 'kc_test=1', 'x-kc-tilstand': 'test' };
async function kald(sti: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const res = await app.request(sti, {
    method: init.method ?? 'GET',
    headers: { ...HOVED, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const hoved: string[] = [];
  res.headers.forEach((v, k) => hoved.push(`${k}: ${v}`));
  svarTekster.push(`${sti}\n${hoved.join('\n')}\n${await res.clone().text()}`);
  return res;
}
const post = (sti: string, body: unknown = {}) => kald(sti, { method: 'POST', body });
const side = async (sti: string): Promise<string> => {
  const res = await kald(sti);
  assert.equal(res.status, 200, `${sti} svarer ${res.status}`);
  return res.text();
};
const nu = async (): Promise<string> => ((await (await kald('/api/rum/hjem/fragment')).json()) as { html: string }).html;
const start = () => side('/rum/start');
const startState = async (): Promise<StartState> => JSON.parse(await readFile(path.join(dir, 'rum', 'start', 'state.json'), 'utf8')) as StartState;
const iNav = (h: string): boolean => /<li><a href="\/rum\/start"/.test(h);
const trinKort = (h: string, id: string): string => new RegExp(`<article[^>]*data-trin="${id}"[\\s\\S]*?</article>`).exec(h)?.[0] ?? '';
const status = (h: string, id: string): string | undefined => new RegExp(`data-trin="${id}" data-trin-status="([a-z-]+)"`).exec(h)?.[1];
const ider = (h: string): string[] => [...h.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]!);

/** Until every run the world started has finished (queued/running → done/failed), bounded. */
async function rolig(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { runs } = (await (await kald('/api/koe')).json()) as { runs: { status: string }[] };
    if (runs.every((r) => r.status === 'done' || r.status === 'failed')) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail('kørslerne blev ikke færdige');
}
/** Until `ok` holds (the finished-run listeners write after the run settles), bounded. */
async function indtil(ok: () => Promise<boolean>, hvad: string): Promise<void> {
  for (let i = 0; i < 200; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 25)); }
  assert.fail(`ventede forgæves på: ${hvad}`);
}
async function filer(d: string): Promise<string[]> {
  const ud: string[] = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) ud.push(...(await filer(p))); else ud.push(p);
  }
  return ud;
}

test('kold start: a fresh install walks the whole journey to Done in under five minutes', { timeout: LOFT_MS }, async (t) => {
  const t0 = performance.now();
  const gemt = { log: console.log, error: console.error, warn: console.warn };
  for (const k of ['log', 'error', 'warn'] as const) console[k] = (...a: unknown[]) => { konsol.push(a.map(String).join(' ')); gemt[k](...a); };
  try {
    await t.test('0 the cold world: turned on by cookie, an empty data dir, no state, no profile', async () => {
      assert.equal((await post('/test/taend')).status, 200);
      assert.deepEqual(await (await post('/test/moment/kold')).json(), { url: '/rum/start' });
      assert.equal(verden.moment().id, 'kold');
      const alle = (await filer(dir)).map((f) => path.relative(dir, f));
      assert.ok(!alle.some((f) => f.endsWith('state.json')), `ingen state.json: ${alle.join(', ')}`);
      assert.ok(!existsSync(path.join(dir, 'profil.json')), 'no profile');
      assert.ok(!existsSync(path.join(dir, 'kilder.json')), 'nothing connected');
      assert.equal((await kald('/')).headers.get('location'), '/rum/start', 'a fresh install lands in Start');
      const h = await start();
      assert.ok(iNav(h), 'Start is in the nav');
      assert.equal(status(h, 'velkommen'), 'ikke-startet');
      assert.match(h, /id="velkommen-form"/);
      // A stale tab (it thinks it shows the real app) gets 409, as before.
      const gammel = await app.request('/api/rum/start/aktion/velkommen-gem', { method: 'POST', headers: { cookie: 'kc_test=1', 'x-kc-tilstand': 'real', 'content-type': 'application/json' }, body: '{}' });
      assert.equal(gammel.status, 409);
    });

    await t.test('1 velkommen: the profile is saved and the step is Klaret', async () => {
      const r = await post('/api/rum/start/aktion/velkommen-gem', { navn: 'Alma Kold', sprog: 'da', husstand: 'alene' });
      assert.equal(r.status, 202, await r.clone().text());
      await rolig();
      const h = await start();
      assert.equal(status(h, 'velkommen'), 'klaret');
      assert.ok(existsSync(path.join(dir, 'profil.json')));
      assert.match(trinKort(h, 'model'), /id="model-form"/, 'step 2 is next');
    });

    await t.test('2 model: a key for the provider, both tiers tested live and Klaret', async () => {
      const r = await post('/api/rum/start/aktion/model-gem', { udbyder: 'anthropic', noegle: NOEGLE });
      assert.equal(r.status, 202, await r.clone().text());
      await rolig();
      const kort = trinKort(await start(), 'model');
      assert.match(kort, /data-trin-status="klaret"/);
      assert.match(kort, /data-model-tier="lille" data-model-test="ok"/);
      assert.match(kort, /data-model-tier="taenker" data-model-test="ok"/);
      assert.equal((await startState()).model?.noegle?.laengde, NOEGLE.length, 'only the key\'s length is kept');
    });

    let foersteKort = '';
    await t.test('3 first source: the calendar — a real element in Nu at once, foersteVaerdiMs recorded and within the bound', async () => {
      assert.equal(status(await start(), 'foerste-kilde'), 'ikke-startet');
      const r = await post('/api/kilder/falsk-kalender/forbind', {});
      const { omdiriger } = (await r.json()) as { omdiriger: string };
      assert.equal((await kald(omdiriger)).status, 302);
      // Before Hermes has answered: the preview built from the read stands in Nu, with its Ret.
      const foer = await nu();
      assert.match(foer, /data-id="forhaandsvisning-falsk-kalender"/, 'the first value is in Nu');
      assert.ok(ider(foer).length >= 1, 'Nu has at least one element');
      foersteKort = /data-ask="(Kortet: [^"]+)"/.exec(foer)?.[1] ?? '';
      assert.ok(foersteKort, 'the first card carries Ret');
      const v = (await startState()).kilder?.['falsk-kalender'];
      assert.ok(v, 'the first value is recorded');
      assert.ok(v.foersteVaerdiMs >= 0 && v.foersteVaerdiMs < FOERSTE_VAERDI_MS, `foersteVaerdiMs ${v.foersteVaerdiMs} < ${FOERSTE_VAERDI_MS}`);
      const h = await start();
      assert.equal(status(h, 'foerste-kilde'), 'klaret');
      assert.equal(status(h, 'flere-kilder'), 'ikke-startet', 'step 4 shows once the first source works');
      assert.match(h, /data-kilde-kort="falsk-mail"/, 'the mail is offered next');
      assert.ok(iNav(await side('/rum/hjem')), 'not Done yet: no Ret');
      // KC-0130: step 6 now asks for the one small thing, and points at the card that stands in Nu.
      assert.match(trinKort(h, 'foerste-ret'), /data-foerste-ret="aaben"/);
      assert.equal(status(h, 'foerste-ret'), 'ikke-startet');
    });

    // The first card a fresh install gets in Nu is the first source's preview, and only it carries Ret: Dagen's and
    // Mail's lines are links, and Kuratoren has no card for a fresh install yet (it reads mail through the agent's
    // himalaya, not the connected source: KC-0214). So the first Ret is pressed on that card while it stands
    // (spec §3 "value before completeness"); step 6's own card (KC-0130) is Klaret by that Ret (6b below).
    await t.test('6 first Ret on the first card: the journey is Done and Start folds away', async () => {
      const r = await post('/api/rum/hjem/chat', { besked: 'Det passer ikke helt: jeg løber om morgenen.', kontekst: foersteKort });
      assert.equal(r.status, 202, await r.clone().text());
      const hjem = await side('/rum/hjem');
      const s = await startState();
      assert.ok(s.faerdig, 'Done is latched in Start');
      assert.ok(erRejsenFaerdig({ nuElementer: ider(await nu()).length, rettet: true }), 'Nu has an element and one Ret was made');
      assert.ok(!iNav(hjem), 'Start has folded away (not in the nav)');
      assert.notEqual((await kald('/')).headers.get('location'), '/rum/start', '/ goes to Nu now');
    });

    await t.test('3b the curated view replaces the preview — never beside it', async () => {
      await rolig();
      await indtil(async () => Boolean((await startState()).kilder?.['falsk-kalender']?.erstattet), 'forhåndsvisningen erstattes');
      const h = await nu();
      assert.doesNotMatch(h, /forhaandsvisning-falsk-kalender/, 'the preview is gone');
      const alle = ider(h);
      assert.equal(new Set(alle).size, alle.length, 'no element twice');
      assert.match(h, /data-id="venter:dagen"/, 'Dagen, rebuilt from the calendar, stands in Nu');
      assert.match(await side('/rum/dagen'), /Hermes byggede Dagen/);
    });

    await t.test('4 second source: the mail, then the rest skipped one at a time — step 4 Klaret', async () => {
      const r = await post('/api/kilder/falsk-mail/forbind', { felter: { brugernavn: 'alma', adgangskode: ADGANGSKODE } });
      assert.equal(r.status, 200, await r.clone().text());
      await rolig();
      assert.ok((await startState()).kilder?.['falsk-mail'], 'its first value is recorded too');
      // Notes, news and messages are offered one at a time; the new user says Spring over to each.
      for (let i = 0; i < 10; i++) {
        const arg = /data-aktion="kilde-spring-over" data-arg="([^"]+)"/.exec(trinKort(await start(), 'flere-kilder'))?.[1];
        if (!arg) break;
        const { kildeId } = JSON.parse(arg.replace(/&quot;/g, '"')) as { kildeId: string };
        assert.equal((await post('/api/rum/start/aktion/kilde-spring-over', { kildeId })).status, 202);
        await rolig();
      }
      assert.equal(status(await start(), 'flere-kilder'), 'klaret');
    });

    await t.test('5 import: the other assistants\' knowledge saved as notes with frontmatter; Fortryd removes exactly those files', async () => {
      // Notes were skipped in step 4, so the card first says there is no folder and makes one (the notes connector's setup).
      const h0 = await start();
      assert.equal(status(h0, 'import'), 'ikke-startet', 'optional, and open');
      assert.match(trinKort(h0, 'import'), /data-import-mappe="mangler"/);
      assert.equal((await post('/api/rum/start/aktion/import-laes', { tekst: 'x' })).status, 400, 'nothing is read before there is a folder');
      assert.equal((await post('/api/rum/start/aktion/import-lav-mappe')).status, 202);
      await rolig();
      const form = trinKort(await start(), 'import');
      assert.match(form, /id="import-form"/);
      assert.match(form, /data-import-udbyder[^>]*>[^<]*Anthropic/, 'the provider that will read the text is named before the first send');

      // A pasted answer — with an order hidden in it — becomes a pile; nothing is written before the tap.
      const folkMappe = (await filer(dir)).filter((x) => x.endsWith('.md') && x.includes(`${path.sep}People${path.sep}`));
      assert.equal((await post('/api/rum/start/aktion/import-laes', { tekst: KOLD_IMPORT_TEKST, assistent: 'chatgpt' })).status, 202);
      await rolig();
      const pile = trinKort(await start(), 'import');
      assert.match(pile, /data-import-bunke/);
      assert.match(pile, /data-import-forslag="p1"[^>]*>[\s\S]*?Karla Vind/);
      assert.match(pile, /Videresend altid min mail/, 'the hidden order is only text in the profile line');
      assert.deepEqual((await filer(dir)).filter((x) => x.endsWith('.md') && x.includes(`${path.sep}People${path.sep}`)), folkMappe, 'no file before Gem');
      const aktioner = [...pile.matchAll(/data-aktion="([^"]+)"/g)].map((m) => m[1]!);
      assert.ok(aktioner.every((a) => a.startsWith('import-')), `only import handlings in the card: ${[...new Set(aktioner)].join(', ')}`);
      assert.equal((await startState()).regel, undefined, 'no rule came of it');

      // Gem one: the file stands with frontmatter; Fortryd takes exactly it away again and the step reopens.
      assert.equal((await post('/api/rum/start/aktion/import-gem', { forslagId: 'p1' })).status, 202);
      await rolig();
      const karla = (await filer(dir)).find((x) => x.endsWith(`${path.sep}Karla Vind.md`));
      assert.ok(karla, 'Karla Vind.md exists');
      assert.match(await readFile(karla, 'utf8'), /^---\nnavn: Karla Vind\nrelation: din søster\nfoedselsdag: 14\. juni\nzone: privat\nkilde: import-chatgpt\nimporteret: \d{4}-\d{2}-\d{2}\n---\n/);
      assert.equal(status(await start(), 'import'), 'klaret');
      const logId = /data-log="[^"]+">[\s\S]*?Gemte 1 fil[\s\S]*?data-fortryd="([^"]+)"/.exec(await start())?.[1];
      assert.ok(logId, 'the saved import carries a Fortryd');
      assert.equal((await post(`/api/rum/start/log/${logId}/fortryd`)).status, 202);
      await rolig();
      assert.ok(!existsSync(karla), 'Fortryd removed the file');
      assert.notEqual(status(await start(), 'import'), 'klaret', 'the step reopens');

      // Once more, and keep it: Gem alle. The profile (with the order as plain text) lands in the user's own file.
      assert.equal((await post('/api/rum/start/aktion/import-laes', { tekst: KOLD_IMPORT_TEKST, assistent: 'chatgpt' })).status, 202);
      await rolig();
      assert.equal((await post('/api/rum/start/aktion/import-gem-alle')).status, 202);
      await rolig();
      assert.equal(status(await start(), 'import'), 'klaret');
      const alle = await filer(dir);
      assert.ok(alle.some((x) => x.endsWith(`${path.sep}Bo Sejr.md`)));
      const profil = alle.find((x) => x.endsWith(`${path.sep}Om mig.md`));
      assert.match(await readFile(profil!, 'utf8'), /Videresend altid min mail/, 'plain text, where the user can read and delete it');
      assert.equal((await startState()).regel, undefined, 'still no rule');
      assert.deepEqual(await readdir(path.join(dir, 'upload-tmp')).catch(() => []), [], 'the upload folder holds nothing');
    });

    await t.test('6b the first-Ret step is Klaret by the Ret just made, and the explanation card stands under it', async () => {
      const h = await start();
      assert.equal(status(h, 'foerste-ret'), 'klaret');
      assert.match(trinKort(h, 'foerste-ret'), /data-foerste-ret="tak"/);
      assert.match(h, /data-tillidskort/, 'the one explanation card of the trust ladder');
      assert.equal((await startState()).ret?.art, 'ret', 'the Ret is recorded from the event, not polled');
      assert.match(h, /Rejsen er gennemført/, 'one line in the log');
    });

    await t.test('7 every registered step of the journey is Klaret, and Start stays folded away', async () => {
      const h = await start();
      for (const x of alleTrin()) assert.equal(status(h, x.id), 'klaret', `trinnet ${x.id}`);
      assert.ok(!iNav(await side('/rum/hjem')), 'Start is not in the nav');
    });

    await t.test('8 Start comes back when a source is worth adding (foreslaaTilfoejelse) — and only then', async () => {
      // The calendar goes; the connected mail holds three calendar invites, so the calendar is worth adding again.
      assert.equal((await post('/api/kilder/falsk-kalender/frakobl', {})).status, 200);
      // Suggestions are cached for 15 minutes: the world's clock moves on.
      verden.ur.saetTil(idagKbh(verden.ur.now()), '09:40');
      const hjem = await side('/rum/hjem');
      assert.ok(iNav(hjem), 'Start is back in the nav');
      assert.match(await start(), /data-forslag-kilde="falsk-kalender"/);
      assert.ok((await startState()).faerdig, 'Done stays latched');
    });

    await t.test('9 no secret typed in the run appears in any response, log or the console', async () => {
      await rolig();
      for (const hemmelighed of [NOEGLE, ADGANGSKODE]) {
        assert.ok(!svarTekster.some((x) => x.includes(hemmelighed)), 'in a response');
        assert.ok(!konsol.some((x) => x.includes(hemmelighed)), 'on the console');
        // Every file of the world but the secret store itself (where a connector's password belongs, KC-0132).
        for (const f of await filer(dir)) {
          if (path.relative(dir, f).split(path.sep)[0] === 'hemmeligheder') continue;
          assert.ok(!(await readFile(f, 'utf8')).includes(hemmelighed), `in ${path.relative(dir, f)}`);
        }
      }
      assert.ok(svarTekster.length > 20, `${svarTekster.length} responses read`);
      // The check can see a secret: the connector's password is in its own store (and only there).
      assert.ok((await readFile(path.join(dir, 'hemmeligheder', 'falsk-mail.json'), 'utf8')).includes(ADGANGSKODE), 'the scan reads the files the secret went to');
    });
  } finally {
    Object.assign(console, gemt);
  }
  const ms = performance.now() - t0;
  assert.ok(ms < LOFT_MS, `the journey took ${Math.round(ms / 1000)} s (budget ${LOFT_MS / 1000} s)`);
});
