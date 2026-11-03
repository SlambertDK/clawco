// KC-0235: the Aula calendar reader as a connector — what read() carries (six fields and nothing else), what opsaet() refuses,
// how the answers of the link map to the health words, and that the link (the secret) is only ever in the secret module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AULA_KALENDER_ID, aulaKalender, erAulaAdresse, erAulaVaert } from '../../../src/kilder/aula-kalender/kilde.ts';
import { HentFejl } from '../../../src/kilder/nyheder-rss/hent.ts';
import { KildeFejl, type Laesning } from '../../../src/kilder/types.ts';
import { KILDER_LOG, lavRegister } from '../../../src/kilder/register.ts';
import { laesKildeHemmelighed } from '../../../src/kilder/hemmeligheder.ts';
import type { Person } from '../../../src/identitet/husstand.ts';
import { medData } from '../hjaelp.ts';
import { ctx, falskHenter, ics, LANG_MARKER, LINK, NU, status, TOKEN, type Kald } from './hjaelp.ts';

const kalender = async (k = aulaKalender({ hent: falskHenter({ tekst: ics() }) }), c = ctx()) => {
  const l = await k.read(c);
  assert.equal(l.slags, 'kalender');
  return (l as Extract<Laesning, { slags: 'kalender' }>).data;
};

test('read(): the week from Monday, seven days, the events the file holds inside it, with the calendar name as the institution', async () => {
  const d = await kalender();
  assert.deepEqual(d.days.map((x) => x.date), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(d.generated.slice(0, 10), '2026-11-02');
  const titler = d.days.map((x) => x.events.map((e) => e['title']));
  assert.deepEqual(titler, [[], ['Forældremøde i 2.B'], ['Skolefri'], ['Gymnastik'], ['Sommerfest i Børnehuset'], [], []]);
  const m = d.days[1]!.events[0]!;
  assert.deepEqual({ ...m, id: 'x' }, { id: 'x', title: 'Forældremøde i 2.B', start: '2026-11-03T19:00:00+01:00', end: '2026-11-03T20:30:00+01:00', all_day: false, calendar: 'Kløvermarkskolen', location: 'Klasselokale 2.B' });
  const heldag = d.days[2]!.events[0]!;
  assert.deepEqual([heldag['all_day'], heldag['start'], heldag['end']], [true, '2026-11-04', '2026-11-05']);
  assert.deepEqual(d.errors, []);
});

test('read(): an event has exactly id, title, start, end, all_day, calendar and location; the id is a hash, stable between reads, and holds no UID', async () => {
  const a = await kalender();
  const b = await kalender();
  for (const e of a.days.flatMap((x) => x.events)) {
    assert.deepEqual(Object.keys(e).sort(), ['all_day', 'calendar', 'end', 'id', 'location', 'start', 'title']);
    assert.match(String(e['id']), /^aula-[0-9a-f]{16}$/);
  }
  assert.deepEqual(a, b);
  const ider = a.days.flatMap((x) => x.events.map((e) => e['id']));
  assert.equal(new Set(ider).size, ider.length);
});

test('invariant: no organizer, attendee, description, link, UID or e-mail address in read(), the health words, a refusal or any console line', async () => {
  const konsol: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const n of ['log', 'error', 'warn', 'info', 'debug'] as const) console[n] = (...a: unknown[]) => { konsol.push(a.map(String).join(' ')); };
  const ud: string[] = [];
  let laest = '';
  try {
    const k = aulaKalender({ hent: falskHenter({ tekst: ics() }) });
    laest = JSON.stringify(await k.read(ctx()));
    ud.push(JSON.stringify(await k.helbred(ctx())), JSON.stringify(await k.kort(ctx())), JSON.stringify(await k.opsaet!(ctx())));
    for (const fejl of [status(410), status(503), new HentFejl('tid', 'Kilden svarede ikke i tide.'), new HentFejl('afvist', 'Adressen er afvist.'), { tekst: '<html>Log ind</html>' }]) {
      const s = aulaKalender({ hent: falskHenter(fejl) });
      await s.read(ctx()).catch((e: Error) => ud.push(e.message));
      ud.push(JSON.stringify(await s.helbred(ctx({ nu: new Date(NU.getTime() + 3600_000) }))));
      await s.opsaet!(ctx()).catch((e: Error) => ud.push(e.message));
    }
  } finally { Object.assign(console, gemt); }
  const alt = [laest, ...ud, ...konsol].join('\n');
  for (const forbudt of ['Lund', 'Lærer', 'Alma Opdigtet', 'Mads Opdigtet', 'mailto', '@', LANG_MARKER, 'hemmelig-uid', 'kloevermark.example', 'besked/12345', TOKEN, 'ORGANIZER', 'ATTENDEE']) {
    assert.ok(!alt.includes(forbudt), `"${forbudt}" reached an output`);
  }
  assert.ok(![...ud, ...konsol].join('\n').includes('Forældremøde'), 'not even a title is written to a health text, a refusal or the console');
});

test('read(): the window follows the clock — next week holds the repeated gymnastics and the event of that week, not this week\'s', async () => {
  const d = await kalender(undefined, ctx({ nu: new Date('2026-11-09T08:00:00Z') }));
  assert.deepEqual(d.days.map((x) => x.date.slice(8)), ['09', '10', '11', '12', '13', '14', '15']);
  assert.deepEqual(d.days.map((x) => x.events.map((e) => e['title'])), [[], [], [], ['Næste uge', 'Gymnastik'], [], [], []], 'sorted by time inside the day; the cancelled one never');
});

test('read(): a failing link fails the read with a fixed Danish sentence, never the file or the link', async () => {
  for (const [fejl, ord] of [[status(410), /virker ikke/], [status(503), /svarer ikke/], [new HentFejl('tid', 'x'), /i tide/], [new HentFejl('stor', 'x'), /for stor/], [{ tekst: '<html>Log ind</html>' }, /virker ikke/]] as const) {
    await assert.rejects(aulaKalender({ hent: falskHenter(fejl) }).read(ctx()), (e: unknown) => e instanceof KildeFejl && e.status === 502 && ord.test(e.message) && !e.message.includes(TOKEN) && !e.message.includes('aula.dk'));
  }
  await assert.rejects(aulaKalender({ hent: falskHenter({ tekst: ics() }) }).read(ctx({ link: null })), (e: unknown) => e instanceof KildeFejl && e.status === 409);
});

test('read(): conditional GET — the validators go back out, and "unchanged" reads the remembered file', async () => {
  const kald: Kald = [];
  const k = aulaKalender({ hent: falskHenter({ tekst: ics(), etag: '"v1"' }, kald) });
  const foerste = await kalender(k);
  const anden = await kalender(k);
  assert.deepEqual(anden, foerste);
  assert.deepEqual(kald.map((x) => x.etag), [undefined, '"v1"']);
});

test('read() only ever calls the link it holds, as a public address', async () => {
  const kald: Kald = [];
  await kalender(aulaKalender({ hent: falskHenter({ tekst: ics() }, kald) }));
  assert.deepEqual(kald.map((x) => x.adresse), [LINK]);
});

// ---------- opsaet ----------

test('opsaet() refuses what is not an https link on an Aula host — before anything is fetched, and without echoing it', async () => {
  const kald: Kald = [];
  const k = aulaKalender({ hent: falskHenter({ tekst: ics() }, kald) });
  const daarlige = [
    '', '   ', 'http://www.aula.dk/kalender/x', 'ftp://www.aula.dk/x', 'javascript:alert(1)', 'www.aula.dk/kalender/x', 'https://example.com/kalender.ics',
    'https://www.aula.dk.evil.example/x', 'https://evilaula.dk/x', 'https://aula.dk@evil.example/x', 'https://u:p' + '@' + 'www.aula.dk/x', 'https://www.aula.dk:8443/x',
    'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'https://aulainfo.dk/x', 'https://www.aula.dk/x\u0000',
  ];
  for (const d of daarlige) {
    await assert.rejects(k.opsaet!(ctx({ link: d })), (e: unknown) => e instanceof KildeFejl && e.status === 400 && (d.length < 4 || !e.message.includes(d.replace(/^https?:\/\//, ''))), JSON.stringify(d));
  }
  assert.equal(kald.length, 0, 'nothing was fetched for any of them');
  assert.equal(erAulaVaert('aula.dk'), true);
  assert.equal(erAulaVaert('www.aula.dk'), true);
  assert.equal(erAulaVaert('WWW.AULA.DK'), true);
  assert.equal(erAulaVaert('aula.dk.evil.example'), false);
  assert.equal(erAulaVaert('xaula.dk'), false);
});

test('opsaet() refuses a link that does not answer with a calendar, or that Aula refuses — each in its own plain words', async () => {
  await assert.rejects(aulaKalender({ hent: falskHenter({ tekst: '<html>Log ind med MitID</html>' }) }).opsaet!(ctx()), (e: unknown) => e instanceof KildeFejl && e.status === 400 && /ligner ikke et Aula-kalenderlink/.test(e.message));
  for (const n of [401, 403, 404, 410]) await assert.rejects(aulaKalender({ hent: falskHenter(status(n)) }).opsaet!(ctx()), (e: unknown) => e instanceof KildeFejl && e.status === 400 && /nyt kalenderlink/.test(e.message), String(n));
  await assert.rejects(aulaKalender({ hent: falskHenter(status(503)) }).opsaet!(ctx()), (e: unknown) => e instanceof KildeFejl && e.status === 502);
  await assert.rejects(aulaKalender({ hent: falskHenter(new HentFejl('afvist', 'x')) }).opsaet!(ctx()), (e: unknown) => e instanceof KildeFejl && e.status === 400);
});

test('opsaet() accepts a calendar and stores no option (the link is the secret); its sentence has the count and no title', async () => {
  const r = await aulaKalender({ hent: falskHenter({ tekst: ics() }) }).opsaet!(ctx());
  assert.deepEqual(r.valg, {});
  assert.match(r.tekst, /\b4 aftaler\b/);
  assert.ok(!r.tekst.includes('Forældremøde') && !r.tekst.includes(TOKEN));
});

// ---------- health ----------

const timer = (n: number): Date => new Date(NU.getTime() + n * 3600_000);

test('health: an answered link is ok, and is not asked again within five minutes', async () => {
  const kald: Kald = [];
  const k = aulaKalender({ hent: falskHenter({ tekst: ics() }, kald) });
  assert.equal((await k.helbred(ctx())).status, 'ok');
  assert.equal((await k.helbred(ctx({ nu: new Date(NU.getTime() + 60_000) }))).status, 'ok');
  assert.equal(kald.length, 1);
  assert.equal((await k.helbred(ctx({ nu: new Date(NU.getTime() + 6 * 60_000) }))).status, 'ok');
  assert.equal(kald.length, 2);
});

test('health: 401, 403, 404 and 410 mean the link is revoked — "log ind igen" at once, in words that say what to do, and it stays until a new link is given', async () => {
  for (const n of [401, 403, 404, 410]) {
    const kald: Kald = [];
    const k = aulaKalender({ hent: falskHenter(status(n), kald) });
    const h = await k.helbred(ctx());
    assert.equal(h.status, 'log-ind-igen', String(n));
    assert.match(h.tekst ?? '', /kalenderlink i Aula/);
    assert.equal((await k.helbred(ctx({ nu: timer(5) }))).status, 'log-ind-igen', 'sticky');
    assert.equal(kald.length, 1, 'a revoked link is not asked again');
    // A new link is judged afresh.
    const ny = await k.helbred(ctx({ link: `${LINK}-ny`, nu: timer(5) }));
    assert.equal(ny.status, 'log-ind-igen');
    assert.equal(kald.length, 2);
    await assert.rejects(k.read(ctx({ nu: timer(5) })), KildeFejl);
  }
});

test('health: a link that works again after being given anew reads ok (opsaet clears the revoked mark)', async () => {
  let virker = false;
  const k = aulaKalender({ hent: falskHenter(async () => (virker ? { tekst: ics() } : status(410))) });
  assert.equal((await k.helbred(ctx())).status, 'log-ind-igen');
  virker = true;
  await k.opsaet!(ctx());
  assert.equal((await k.helbred(ctx({ nu: new Date(NU.getTime() + 1000) }))).status, 'ok');
});

test('health: a timeout, a network failure and a 5xx are "nede" for ten minutes, then asked again', async () => {
  for (const fejl of [new HentFejl('tid', 'x'), new HentFejl('net', 'x'), status(500), status(503), status(429), new HentFejl('stor', 'x')]) {
    const kald: Kald = [];
    const k = aulaKalender({ hent: falskHenter(fejl, kald) });
    assert.equal((await k.helbred(ctx())).status, 'nede');
    assert.equal((await k.helbred(ctx({ nu: new Date(NU.getTime() + 9 * 60_000) }))).status, 'nede');
    assert.equal(kald.length, 1);
    assert.equal((await k.helbred(ctx({ nu: new Date(NU.getTime() + 11 * 60_000) }))).status, 'nede');
    assert.equal(kald.length, 2, 'asked again after ten minutes');
  }
});

test('health: an answer slower than five seconds is "langsomt"; a quick one afterwards is ok again', async () => {
  let t = 0;
  let sidste = 0;
  const k = aulaKalender({ ur: () => t, hent: falskHenter(async () => { t += sidste; return { tekst: ics() }; }) });
  sidste = 6000;
  assert.equal((await k.helbred(ctx())).status, 'langsomt');
  sidste = 200;
  assert.equal((await k.helbred(ctx({ nu: new Date(NU.getTime() + 6 * 60_000) }))).status, 'ok');
});

test('health: no stored link is "log ind igen"; the text names the host at most, never the link', async () => {
  const k = aulaKalender({ hent: falskHenter({ tekst: ics() }) });
  assert.equal((await k.helbred(ctx({ link: null }))).status, 'log-ind-igen');
  const h = await k.helbred(ctx());
  assert.ok(!(h.tekst ?? '').includes(TOKEN) && !(h.tekst ?? '').includes('kalender/ugekalender'));
});

// ---------- the card and the secret ----------

test('the card: one secret field, the plain onboarding in Aula\'s own steps, and what Clawco reads', async () => {
  const k = aulaKalender({ hent: falskHenter({ tekst: ics() }) });
  assert.deepEqual([k.id, k.slags, k.zone, k.auth, k.tillid], [AULA_KALENDER_ID, 'kalender', 'husstand', 'apikey', 'uklar']);
  assert.equal(k.act, undefined);
  assert.equal(k.verber, undefined);
  const kort = await k.kort(ctx({ link: null }));
  assert.deepEqual(kort.felter.map((f) => [f.navn, f.type, f.paakraevet]), [['link', 'hemmelig', true]]);
  assert.match(kort.tekst, /tid, titel, sted og institution/);
  assert.match((kort.trin ?? []).map((t) => t.tekst).join(' '), /Ugekalender/);
  assert.match((kort.trin ?? []).map((t) => t.tekst).join(' '), /flueben/);
  assert.ok(!/[<>]/.test(JSON.stringify(kort)));
});

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };

test('the link lives only in the secret store: not in kilder.json, the log, the overview, an error or the console', async () => {
  await medData(async (dir, store) => {
    const konsol: string[] = [];
    const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const n of ['log', 'error', 'warn', 'info'] as const) console[n] = (...a: unknown[]) => { konsol.push(a.map(String).join(' ')); };
    const fejl: string[] = [];
    try {
      let svar: Parameters<typeof falskHenter>[0] = { tekst: ics() };
      const kald: Kald = [];
      const r = lavRegister({ dataDir: dir, store, nu: () => NU });
      r.registrer(aulaKalender({ hent: async (a, o) => falskHenter(svar, kald)(a, o) }));
      const f = await r.forbind(AULA_KALENDER_ID, { felter: { link: LINK } }, EJER);
      assert.ok('forbundet' in f && f.forbundet);
      const l = await r.laes(AULA_KALENDER_ID);
      assert.equal(l.slags, 'kalender');
      const oversigt = JSON.stringify(await r.oversigt());
      svar = status(410);
      const efter = aulaKalender({ hent: falskHenter(svar) });
      await efter.read(ctx()).catch((e: Error) => fejl.push(e.message));
      await r.forbind(AULA_KALENDER_ID, { felter: { link: `${LINK}x` } }, EJER).catch((e: Error) => fejl.push(e.message));
      assert.equal((await laesKildeHemmelighed(dir, AULA_KALENDER_ID))?.['link'], LINK, 'a refused new link leaves the working one');
      const kilderJson = await readFile(path.join(dir, 'kilder.json'), 'utf8');
      const log = JSON.stringify(await store.readLog(KILDER_LOG, 100));
      const alle = { oversigt, kilderJson, log, fejl: fejl.join('\n'), f: JSON.stringify(f), konsol: konsol.join('\n') };
      for (const [hvor, tekst] of Object.entries(alle)) assert.ok(!tekst.includes(TOKEN) && !tekst.includes('kalender/ugekalender'), `${hvor} holds the link`);
      assert.deepEqual(JSON.parse(kilderJson).kilder.map((k: { id: string; valg: object }) => [k.id, k.valg]), [[AULA_KALENDER_ID, {}]]);
      assert.equal((await r.hvor(AULA_KALENDER_ID)).zone, 'husstand');
    } finally { Object.assign(console, gemt); }
  });
});

// KC-0274 (C3): the real fetcher is built with the https-and-default-port rule on every hop.
test('erAulaAdresse: https on the default port on an Aula host, nothing else', () => {
  assert.equal(erAulaAdresse(new URL('https://www.aula.dk/ugekalender/x.ics')), true);
  for (const u of ['http://www.aula.dk/x.ics', 'https://www.aula.dk:8443/x.ics', 'https://aula.dk.anden.example/x.ics', 'https://anden.example/x.ics']) {
    assert.equal(erAulaAdresse(new URL(u)), false, u);
  }
  const medLogin = new URL('https://www.aula.dk/x.ics'); medLogin.username = 'u';
  assert.equal(erAulaAdresse(medLogin), false, 'credentials');
  assert.equal(erAulaAdresse(new URL('https://www.aula.dk:443/x.ics')), true, 'the explicit default port is the default port');
});
