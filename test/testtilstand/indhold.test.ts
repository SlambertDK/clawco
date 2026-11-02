// The test world's content (KC-0068): every moment's seed is what the rooms'
// own validators make of it, the scripted Hermes answers every kind of run the
// app can start with something the real parsers accept, and nothing from
// Henrik's real life is in any of it. Lifted from the demo's historie.test.ts
// (KC-0058) and rewritten for main's six moments.

import { test } from 'node:test';
import { momentPlus, plusDag } from '../../src/testtilstand/indhold/fakta.ts';
import assert from 'node:assert/strict';
import { FORBUDT, MOMENTER, froe, svar } from '../../src/testtilstand/indhold.ts';
import { testMailRunner } from '../../src/testtilstand/skriv.ts';
import type { Froe, Moment } from '../../src/testtilstand/typer.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';
import type { LogEntry } from '../../src/store/types.ts';
import { extractJson, handlingensVerb, handlingerI, kraevJson, parseDagenState, type DagenState } from '../../src/rooms/dagen/schema.ts';
import { buildChatRun, buildFortrydRun, buildHandlingRun, buildHentRun, buildRefreshRun } from '../../src/rooms/dagen/prompt.ts';
import { trimAvisData } from '../../src/rooms/dagen/source.ts';
import { handlingerIMail, parseMailState, type MailState } from '../../src/rooms/mail/schema.ts';
import { buildBaggrundFlytRun, buildKladdeRun, buildMailChatRun, buildMailFortrydRun, buildMailHandlingRun, buildMailRefreshRun, buildSendRun } from '../../src/rooms/mail/prompt.ts';
import { parseAll, readMailSource } from '../../src/rooms/mail/source.ts';
import { handlingerINyheder, parseNyhederState, type NyhederState } from '../../src/rooms/nyheder/schema.ts';
import { buildNyhederChatRun, buildNyhederFortrydRun, buildNyhederHandlingRun, buildNyhederHentRun, buildNyhederRefreshRun } from '../../src/rooms/nyheder/prompt.ts';
import { trimNyheder } from '../../src/rooms/nyheder/source.ts';
import { parseForslag, parseNytDokument, type SkriveState } from '../../src/rooms/skrive/schema.ts';
import { buildForslagRun, buildNytRun, buildSkriveChatRun } from '../../src/rooms/skrive/prompt.ts';
import { MAX_KORT, parseKuratorSvar, udloebet, type Kort, type KuratorState } from '../../src/rooms/hjem/kort.ts';
import { buildKortFortrydRun, buildKortHandlingRun, buildLaerRun } from '../../src/kurator/kortprompt.ts';
import { buildKuratorRun } from '../../src/kurator/prompt.ts';
import { buildHjemChatRun } from '../../src/rooms/hjem/prompt.ts';
import { parseFortryd, universRum } from '../../src/rooms/univers/lager.ts';
import { vaelgSituation } from '../../src/situation/situation.ts';
import {
  htmlTilTekst, normaliserIndeks, normaliserUnivers, parseForberedelse, parseNytUnivers, parseUniversSvar,
  type UniversIndeks, type UniversState,
} from '../../src/rooms/univers/schema.ts';
import { buildForberedRun, buildOversigtChatRun, buildUniversChatRun } from '../../src/rooms/univers/prompt.ts';
import { findRoom } from '../../src/rooms/registry.ts';
import { koebenhavnTilIso } from '../../src/rooms/univers/tid.ts';
import { OPGAVE_ID, STATUSSER, type Opgave } from '../../src/udvikling/opgaver.ts';
import { PROJEKTER, findProjekt } from '../../src/udvikling/projekter.ts';

const DAG = '2026-10-29';
const ANDEN_DAG = '2026-12-03';

// The moment's clock: its day is the story's day, or the day after for the next morning (KC-0103).
const nu = (m: Moment, dag = DAG): Date => new Date(koebenhavnTilIso(`${plusDag(dag, momentPlus(m, dag))}T${m.tid}`) as string);
const state = <T>(f: Froe, rum: string): T | null => (f.rum[rum]?.state as T | undefined) ?? null;
const log = (f: Froe, rum: string): LogEntry[] => f.rum[rum]?.log ?? [];
const udenGenereret = <T extends object>(s: T): T => ({ ...s, genereret: '' });
const moment = (id: string): Moment => MOMENTER.find((m) => m.id === id) as Moment;

/** The ledger fields the app owns on a card (kort.ts APP_FELTER, plus KC-0096's udsatTil): Hermes never sends them, so they are not compared. */
const udenAppFelter = (k: Kort): Kort => { const c = { ...k }; delete c.regnskab; delete c.regnskabUklart; delete c.regnskabForslag; delete c.skrevet; delete c.udsatTil; delete c.zone; delete c.besked; delete c.kraeverRegel; return c; };
/** KC-0117: the seeded zone is the stored state's, never part of a (privat) Hermes answer. */
const udenZone = (k: Kort): Kort => { const c = { ...k }; delete c.zone; return c; };

/** App-owned labels are the app's chrome, not seeded content: an opgave carries its project's repo (PROJEKTER), so that is exempt. Nothing else is. */
const APP_ETIKETTER = PROJEKTER.map((p) => p.repo);
function tjekForbudt(tekst: string, hvad: string): void {
  let lav = tekst.toLowerCase();
  for (const e of APP_ETIKETTER) lav = lav.split(e.toLowerCase()).join('');
  for (const ord of FORBUDT) assert.ok(!lav.includes(ord.toLowerCase()), `${hvad} indeholder det forbudte "${ord}"`);
}

// ---------- The moments ----------

test('MOMENTER is the day in order — six moments, the late evening, the next morning, its pause, the Saturday of the cars, the three failing connections (KC-0139) and Gmail connected and logged out (KC-0135) — each landing in a room', () => {
  assert.deepEqual(MOMENTER.map((m) => m.id), ['morgen', 'formiddag', 'foer-moede', 'moede', 'eftermiddag', 'aften', 'sent-aften', 'naeste-morgen', 'pause', 'bil-loerdag', 'kilde-log-ind-igen', 'kilde-nede', 'kilde-snart-udloebet', 'gmail-koblet', 'gmail-log-ind-igen', 'mandag', 'tirsdag-weekend', 'soendag', 'soendag-stop', 'beta-start', 'beta-dag3', 'beta-dag7', 'beta-dag14', 'beta-deling']);
  assert.deepEqual(MOMENTER.map((m) => m.tid), ['07:10', '09:30', '10:50', '11:10', '14:30', '20:30', '22:30', '07:40', '08:10', '19:30', '08:20', '08:30', '08:40', '08:50', '09:00', '07:30', '07:40', '18:30', '18:40', '08:00', '08:10', '08:20', '08:30', '08:40']);
  assert.deepEqual(MOMENTER.map((m) => m.dagPlus ?? 0), [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 2, 2, 2, 2, 2], 'only the moments after the evening are on the next day (Mandag morgen, KC-0147, Tirsdag før weekenden, KC-0152, and the Sunday moments, KC-0145, are on the next Monday / Tuesday / Sunday: ugedag, momentPlus; the beta moments, KC-0203, two days on)');
  assert.deepEqual(MOMENTER.map((m) => m.url), ['/rum/hjem', '/rum/mail', '/rum/hjem', '/rum/hjem', '/rum/skrive', '/rum/hjem', '/rum/hjem', '/rum/dagen', '/rum/hjem', '/rum/husstand', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/rum/husstand', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/rum/hjem', '/beta/deling']);
  assert.deepEqual(MOMENTER.map((m) => m.navn), ['Morgen', 'Formiddag', 'Lige før et møde', 'Under mødet', 'Eftermiddag', 'Aften', 'Sent aften', 'Næste morgen', 'Sat på pause', 'Lørdag i næste uge', 'Kalenderen er logget ud', 'Mailen svarer ikke', 'Adgangen udløber snart', 'Gmail er koblet', 'Gmail er logget ud', 'Mandag morgen', 'Tirsdag før weekenden', 'Søndag aften', 'Søndag: stop tjekket?', 'Beta: første besøg', 'Beta: dag 3', 'Beta: dag 7', 'Beta: dag 14', 'Beta: Hvad deler jeg?']);
  for (const m of MOMENTER) {
    assert.ok(m.replik.length > 0, m.id);
    assert.ok(m.url === '/beta/deling' || findRoom(m.url.slice('/rum/'.length)), `${m.id}: ${m.url} er et rum (KC-0203: or the beta's page of what is shared)`);
  }
  assert.throws(() => froe('findes-ikke', DAG));
});

test('froe is deterministic and every date in it follows the test date', () => {
  for (const m of MOMENTER) assert.equal(JSON.stringify(froe(m.id, DAG)), JSON.stringify(froe(m.id, DAG)), m.id);
  const { dagstal, ...resten } = froe('eftermiddag', ANDEN_DAG);
  const b = JSON.stringify(resten);
  assert.ok(b.includes('2026-12-03'));
  assert.ok(!/2026-10-/.test(b), 'no date of another test day leaks in');
  // KC-0147: the history of the counts is the one thing that reaches back — eight weeks, all before the test day.
  assert.ok(dagstal && dagstal.every((d) => d.dato < ANDEN_DAG && d.dato >= plusDag(ANDEN_DAG, -64)));
});

// ---------- (a) Every seeded room state passes the room's own validator ----------

test('(a) every moment\'s seed validates against each room\'s schema validator', () => {
  for (const m of MOMENTER) {
    const f = froe(m.id, DAG);
    const t = nu(m).getTime();

    const dagen = state<DagenState>(f, 'dagen');
    if (dagen) {
      assert.deepEqual(parseDagenState(dagen, new Date(dagen.genereret)), dagen, `${m.id}: dagen`);
      assert.equal(dagen.dato, DAG);
      assert.ok(Date.parse(dagen.genereret) <= t, `${m.id}: Dagen bygget før nu`);
    }

    const mail = state<MailState>(f, 'mail') as MailState;
    const facts = { tal: mail.tal, ordnet: mail.ordnet.map((o) => ({ mailId: o.mailId, til: o.til, hvorfor: o.hvorfor, tid: o.tid, emne: o.emne, fra: o.fra })) };
    // A mulighed's stored id is "<mailId>-<raw id>": the parser adds the prefix, so it gets the raw id back.
    const raa = { ...mail, beslutninger: mail.beslutninger.map((b) => ({ ...b, muligheder: b.muligheder.map((x) => ({ ...x, id: x.id.slice(b.mailId.length + 1) })) })) };
    // KC-0223: Mail built from a read-only connection (Gmail) carries the connection and the flag, which the parser leaves to the room;
    // its count is what waits in that inbox, not the Handling folder's.
    const fraForbindelse = mail.laeseKun ? { forbindelse: mail.forbindelse, laeseKun: true as const } : {};
    assert.deepEqual({ ...parseMailState(raa, facts, new Date(mail.genereret), mail), ...fraForbindelse }, mail, `${m.id}: mail`);
    if (!mail.laeseKun) assert.equal(mail.tal.handling, parseAll({ envelopes: f.mappe['Folders/Handling'] ?? [] }).length, `${m.id}: tal.handling = mails i Handling`);
    else assert.equal(mail.tal.handling, mail.beslutninger.length, `${m.id}: tal.handling = de ventende mails i Gmail`);
    for (const b of mail.beslutninger) if (b.afgjort) assert.ok(Date.parse(b.afgjort.tid) <= t, m.id);

    const ny = state<NyhederState>(f, 'nyheder');
    if (ny) assert.deepEqual(parseNyhederState(ny, { nyhedsbreve: ny.nyhedsbreve, kilder: ny.kilder }, new Date(ny.genereret), ny), ny, `${m.id}: nyheder`);

    const skrive = state<SkriveState>(f, 'skrive') as SkriveState;
    assert.ok(skrive.dokumenter.length === 0 ? skrive.aktivt === null : skrive.dokumenter.some((d) => d.id === skrive.aktivt), m.id);
    for (const d of skrive.dokumenter) assert.deepEqual(d.afsnit.map((a) => a.id), d.afsnit.map((_, i) => `a${i + 1}`), m.id);
    for (const fs of skrive.forslag) {
      const dok = skrive.dokumenter.find((d) => d.id === fs.dokId);
      assert.ok(dok, `${m.id}: forslagets dokument findes`);
      const raa = fs.afsnitId === null ? { afsnitId: null, efterId: fs.efterId, ny: fs.ny, hvorfor: fs.hvorfor } : { afsnitId: fs.afsnitId, ny: fs.ny, hvorfor: fs.hvorfor };
      assert.equal(parseForslag({ forslag: [raa] }, dok, new Date(fs.tid)).length, 1, m.id);
    }

    const hjem = state<KuratorState>(f, 'hjem') as KuratorState;
    assert.ok(hjem.kort.length <= MAX_KORT, m.id);
    assert.deepEqual(parseKuratorSvar({ kort: hjem.kort.map(udenZone), intet: hjem.intet }).nye.map(udenAppFelter), hjem.kort.map(udenAppFelter), `${m.id}: hjem`);
    for (const k of hjem.kort) {
      assert.ok(!udloebet(k, nu(m)), `${m.id}: ${k.id} er ikke udløbet`);
      if (k.skrevet) assert.equal(hjem.regnskab?.[k.id]?.status, 'skrevet', `${m.id}: ${k.id} skrevet`);
    }
    for (const [id, r] of Object.entries(hjem.regnskab ?? {})) {
      const linjer = log(f, 'hjem').filter((e) => e.handlingId === `regnskab:${id}`);
      assert.ok(linjer.length > 0, `${m.id}: ${id} har en loglinje`);
      assert.equal(linjer.every((e) => Boolean(e.fortrudt)), r.status === 'fortrudt', `${m.id}: ${id} loglinjen følger status`);
    }

    const opgaver = state<{ opgaver: Opgave[] }>(f, 'udvikling')?.opgaver ?? [];
    for (const o of opgaver) {
      assert.match(o.id, OPGAVE_ID);
      assert.ok(STATUSSER.includes(o.status), o.id);
      assert.equal(findProjekt(o.projekt)?.repo, o.repo, o.id);
      assert.ok(!o.spoergsmaal || o.status === 'parkeret', `${m.id}: ${o.id} spørger kun parkeret`);
      assert.ok(Date.parse(o.oprettet) <= Date.parse(o.opdateret) && Date.parse(o.opdateret) <= t, `${m.id}: ${o.id} tider`);
    }

    const indeks = state<UniversIndeks>(f, 'univers') as UniversIndeks;
    assert.deepEqual(normaliserIndeks(indeks), indeks, `${m.id}: univers-indeks`);
    for (const u of indeks.univers) {
      const s = state<UniversState>(f, universRum(u.id)) as UniversState;
      assert.deepEqual(normaliserUnivers(s), s, `${m.id}/${u.id}`);
      const ider = [...s.dokumenter, ...s.noter, ...s.opgaver, ...s.moeder].map((x) => x.id);
      assert.equal(new Set(ider).size, ider.length, `${m.id}/${u.id}: unikke id'er`);
      for (const d of s.dokumenter) assert.equal(d.tekst, htmlTilTekst(d.html), `${m.id}: ${d.id}`);
      for (const mo of s.moeder) if (mo.forberedelse) assert.doesNotThrow(() => parseForberedelse({ forberedelse: { ...mo.forberedelse, opgaver: [] } }));
      for (const e of log(f, universRum(u.id))) if (e.fortryd?.startsWith('lokal:')) assert.doesNotThrow(() => parseFortryd(JSON.parse(e.fortryd?.slice(6) ?? 'null')), `${m.id}: ${e.id}`);
    }

    const nav = state<{ aabnet: Record<string, string> }>(f, 'nav') as { aabnet: Record<string, string> };
    for (const [rum, tid] of Object.entries(nav.aabnet)) {
      assert.ok(findRoom(rum), `${m.id}: ${rum} er et rum`);
      assert.ok(Date.parse(tid) <= t, `${m.id}: ${rum} åbnet før nu`);
    }

    for (const [rum, r] of Object.entries(f.rum)) {
      const l = r.log ?? [];
      assert.equal(new Set(l.map((e) => e.id)).size, l.length, `${m.id}/${rum}: unikke log-id'er`);
      for (const e of l) {
        assert.ok(Date.parse(e.tid) <= t, `${m.id}/${rum}: "${e.tekst.slice(0, 40)}" er efter nu`);
        if (e.fortrudt) assert.ok(e.fortryd && Date.parse(e.fortrudt) <= t, `${m.id}/${rum}: fortrudt`);
      }
    }
  }
});

test('(a) the new content main has: every opgave status, a question back, trust numbers, the bill situations, graense, the meeting', () => {
  const alle = MOMENTER.map((m) => froe(m.id, DAG));
  const opgaver = alle.flatMap((f) => state<{ opgaver: Opgave[] }>(f, 'udvikling')?.opgaver ?? []);
  for (const s of STATUSSER) assert.ok(opgaver.some((o) => o.status === s), `en opgave er ${s}`);
  assert.ok(opgaver.some((o) => o.status === 'parkeret' && o.spoergsmaal && o.spoergsmaal.valg.length >= 2), 'Claude Code spørger');
  assert.ok(opgaver.some((o) => o.status === 'faerdig' && o.tilbagerullet), 'en ændring er rullet tilbage');

  const hjem = alle.map((f) => state<KuratorState>(f, 'hjem') as KuratorState);
  const kort = hjem.flatMap((h) => h.kort);
  assert.ok(kort.some((k) => k.regnskabUklart), 'en regning venter på valg af regnskab');
  assert.ok(kort.some((k) => k.skrevet), 'en regning er skrevet');
  assert.ok(hjem.some((h) => Object.entries(h.regnskab ?? {}).some(([id, r]) => r.status === 'fortrudt' && h.kort.some((k) => k.id === id && k.regnskab && !k.skrevet))), 'en fortrudt regning kan skrives igen');
  for (const t of ['tjeneste', 'familie', 'regning', 'nyhed']) assert.ok(kort.some((k) => k.type === t), t);
  assert.ok(kort.some((k) => k.udvikling) && kort.some((k) => k.prompt) && kort.some((k) => k.mailId), 'Claude Code, prompt og Svar i Mail');

  const dagen = alle.map((f) => state<DagenState>(f, 'dagen')).filter((d): d is DagenState => d !== null);
  const mail = alle.map((f) => state<MailState>(f, 'mail') as MailState);
  assert.ok(dagen.some((d) => [...handlingerI(d).values()].some((h) => h.tilAndre)), 'Dagen har en handling til andre');
  assert.ok(mail.some((s) => [...handlingerIMail(s).values()].some((h) => h.tilAndre)), 'Mail har en mulighed til andre');

  const aktiv = (id: string): string | null => {
    const f = froe(id, DAG);
    const indeks = state<UniversIndeks>(f, 'univers') as UniversIndeks;
    const moeder = indeks.univers.flatMap((u) => (state<UniversState>(f, universRum(u.id)) as UniversState).moeder.map((m) => ({ id: m.id, start: m.start, slut: m.slut, univers: u.id, titel: m.titel })));
    const hit = vaelgSituation({ now: nu(moment(id)), moeder }).moede;
    return hit ? (moeder.find((m) => m.id === hit.id && m.univers === hit.univers)?.titel ?? null) : null;
  };
  assert.ok(aktiv('foer-moede'), 'mødet er situationen lige før');
  assert.equal(aktiv('foer-moede'), aktiv('moede'));
  for (const id of ['morgen', 'formiddag', 'eftermiddag', 'aften']) assert.equal(aktiv(id), null, id);
});

// ---------- (b) The scripted Hermes answers the app's own prompts ----------

type Kald = { navn: string; req: AgentRunRequest; tjek(svar: string): void };

/** One request of every kind the app can start, built by the app's own prompt builders, with what the answer must satisfy. */
async function kald(m: Moment, dag = DAG): Promise<Kald[]> {
  const f = froe(m.id, dag);
  const d = nu(m, dag);
  const ud: Kald[] = [];
  const tekst = (navn: string, req: AgentRunRequest): void => { ud.push({ navn, req, tjek: (s) => assert.ok(s.trim().length > 5, `${m.id}/${navn}: tomt svar`) }); };

  // Dagen
  const dagen = state<DagenState>(f, 'dagen');
  const avis = trimAvisData(f.avis);
  ud.push({ navn: 'dagen opdater', req: buildRefreshRun(avis, d), tjek: (s) => {
    const p = parseDagenState(kraevJson(s), d);
    // KC-0103: on the next morning a refresh builds that day; on the story's day it gives back the seed.
    assert.equal(p.dato, plusDag(dag, momentPlus(m, dag)));
    if (dagen && !momentPlus(m, dag)) assert.deepEqual(udenGenereret(p), udenGenereret(dagen), `${m.id}: refresh = seed`);
  } });
  ud.push({ navn: 'dagen hent', req: buildHentRun(d), tjek: (s) => { parseDagenState(kraevJson(s), d); } });
  if (dagen) {
    for (const h of handlingerI(dagen).values()) {
      tekst(`dagen handling ${h.id}`, buildHandlingRun(h, dagen));
      if (h.fortryd) tekst(`dagen fortryd ${h.id}`, buildFortrydRun(h.fortryd, dagen));
    }
  }
  tekst('dagen chat', buildChatRun(m.replik, undefined, dagen));
  tekst('dagen chat med kontekst', buildChatRun('Hvad betyder den?', 'Anbefalingen: noget', dagen));
  if (dagen) ud.push({ navn: 'dagen flyt løbet', req: buildChatRun('Flyt løbeturen til kl. 17', undefined, dagen), tjek: (s) => assert.ok(s.trim().length > 5) });

  // Mail
  const mail = state<MailState>(f, 'mail') as MailState;
  const mailData = await readMailSource({ run: testMailRunner(() => f), stateDir: '/findes/ikke', now: d });
  ud.push({ navn: 'mail opdater', req: buildMailRefreshRun(mailData, d), tjek: (s) => {
    const facts = { tal: mailData.tal, ordnet: mailData.ordnet };
    const p = parseMailState(kraevJson(s), facts, d, null);
    assert.equal(p.beslutninger.length, mailData.handling.length, `${m.id}: én beslutning per mail i Handling`);
  } });
  for (const h of handlingerIMail(mail).values()) {
    tekst(`mail handling ${h.id}`, buildMailHandlingRun(h.label, h.instruktion, mail, handlingensVerb(h)));
    if (h.fortryd) tekst(`mail fortryd ${h.id}`, buildMailFortrydRun(h.fortryd, mail));
  }
  for (const b of mail.beslutninger) {
    tekst(`mail kladde ${b.mailId}`, buildKladdeRun(b.mailId, b.emne, b.udkast ?? 'Hej'));
    tekst(`mail send ${b.mailId}`, buildSendRun(b.mailId, b.emne, b.udkast ?? 'Hej'));
    tekst(`mail baggrund ${b.mailId}`, buildBaggrundFlytRun(b.mailId, b.arkivmappe));
  }
  tekst('mail chat', buildMailChatRun(m.replik, undefined, mail));

  // Nyheder
  const nyheder = state<NyhederState>(f, 'nyheder');
  ud.push({ navn: 'nyheder opdater', req: buildNyhederRefreshRun(trimNyheder(f.avis), d), tjek: (s) => {
    const p = parseNyhederState(kraevJson(s), { nyhedsbreve: [], kilder: trimNyheder(f.avis).kilder }, d, null);
    assert.ok(p.baner.length >= 2 && p.femLinjer.length === 5);
  } });
  ud.push({ navn: 'nyheder hent', req: buildNyhederHentRun(d), tjek: (s) => { parseNyhederState(kraevJson(s), { nyhedsbreve: [], kilder: trimNyheder(f.avis).kilder }, d, null); } });
  if (nyheder) for (const h of handlingerINyheder(nyheder).values()) {
    tekst(`nyheder handling ${h.id}`, buildNyhederHandlingRun(h.label, h.instruktion, nyheder, handlingensVerb(h)));
    if (h.fortryd) tekst(`nyheder fortryd ${h.id}`, buildNyhederFortrydRun(h.fortryd));
  }
  tekst('nyheder chat', buildNyhederChatRun(m.replik, undefined, nyheder));

  // Kuratoren and Hjem
  const hjem = state<KuratorState>(f, 'hjem') as KuratorState;
  ud.push({ navn: 'kuratoren', req: buildKuratorRun({ mails: [], nyheder: ['x'], aabne: hjem.kort, dyb: false, now: d, stier: { vault: '' } }), tjek: (s) => {
    const p = parseKuratorSvar(extractJson(s));
    // KC-0226: the cards on a message of another zone are the zone runs' (below), not the privat run's.
    assert.deepEqual(p.nye.map(udenAppFelter), hjem.kort.filter((k) => !k.id.startsWith('besked:')).map(udenAppFelter), `${m.id}: Kuratoren står ved kortene`);
  } });
  // KC-0226: a run over one other zone gets a scripted answer the zone's parser accepts, and the stored zone cards are exactly what it stands by.
  for (const zone of ['arbejde', 'husstand'] as const) {
    ud.push({ navn: `kuratoren ${zone}`, req: buildKuratorRun({ mails: [], nyheder: null, aabne: hjem.kort, dyb: false, now: d, stier: { vault: '' }, zone, beskeder: [] }), tjek: (s) => {
      const p = parseKuratorSvar(extractJson(s), zone);
      assert.deepEqual(p.nye.map((k) => k.id), hjem.kort.filter((k) => k.id.startsWith('besked:') && k.zone === zone).map((k) => k.id), `${m.id}: zonekørslen ${zone} står ved sit kort`);
      for (const k of p.nye) { assert.equal(k.zone, zone); assert.equal(k.handling, undefined); }
    } });
  }
  for (const k of hjem.kort) {
    if (k.handling) {
      tekst(`kort handling ${k.id}`, buildKortHandlingRun(k, k.handling, d));
      if (k.handling.fortryd) tekst(`kort fortryd ${k.id}`, buildKortFortrydRun(k.handling.fortryd, d));
    }
    tekst(`kort laer ${k.id}`, buildLaerRun(k, 'Det har jeg selv klaret', d));
  }
  for (const e of log(f, 'hjem')) if (e.fortryd && !e.handlingId?.startsWith('regnskab:')) tekst(`hjem log fortryd ${e.id}`, buildKortFortrydRun(e.fortryd, d));
  tekst('hjem chat', buildHjemChatRun(m.replik, 'Overblik', d, hjem.kort.map((k) => ({ id: k.id, titel: k.titel, betyder: k.betyder }))));

  // Skrive
  ud.push({ navn: 'skrive nyt', req: buildNytRun('Opfølgning', 'Skriv en kort opfølgning til Clara efter mødet i dag'), tjek: (s) => { assert.ok(parseNytDokument(kraevJson(s), { brief: 'x' }, d).afsnit.length >= 2); } });
  ud.push({ navn: 'skrive nyt andet', req: buildNytRun('', 'En hilsen til min mor på fødselsdagen'), tjek: (s) => { assert.ok(parseNytDokument(kraevJson(s), { brief: 'x' }, d).afsnit.length >= 1); } });
  const skrive = state<SkriveState>(f, 'skrive') as SkriveState;
  const dok = skrive.dokumenter[0] ?? parseNytDokument({ titel: 'Test', afsnit: ['Første afsnit er ret langt, og det fortsætter lidt endnu. Her er en ekstra sætning.', 'Andet afsnit.'] }, { brief: 'test' }, d);
  for (const type of ['kortere', 'stram', 'konkret', 'varmere']) {
    ud.push({ navn: `skrive forslag ${type}`, req: buildForslagRun(dok, 'a1', type), tjek: (s) => { assert.equal(parseForslag(kraevJson(s), dok, d)[0]?.afsnitId, 'a1'); } });
  }
  ud.push({ navn: 'skrive forslag hele', req: buildForslagRun(dok, null, 'kortere'), tjek: (s) => { assert.ok(parseForslag(kraevJson(s), dok, d).length >= 1); } });
  ud.push({ navn: 'skrive chat kortere', req: buildSkriveChatRun('Gør den kortere', undefined, dok), tjek: (s) => { assert.ok(parseForslag(kraevJson(s), dok, d).length >= 1); } });
  tekst('skrive chat', buildSkriveChatRun(m.replik, undefined, skrive.dokumenter[0] ?? null));

  // Univers
  const indeks = state<UniversIndeks>(f, 'univers') as UniversIndeks;
  for (const info of indeks.univers) {
    const uni = state<UniversState>(f, universRum(info.id)) as UniversState;
    for (const moede of uni.moeder) {
      ud.push({ navn: `univers forbered ${moede.id}`, req: buildForberedRun(info, uni, moede, '', d), tjek: (s) => { assert.ok(parseForberedelse(kraevJson(s)).talepunkter.length >= 1); } });
    }
    ud.push({ navn: `univers chat opgave ${info.id}`, req: buildUniversChatRun(info, uni, 'Lav en opgave: ring til Jonas om kapaciteten', undefined, d), tjek: (s) => { assert.equal(parseUniversSvar(kraevJson(s))[0]?.type, 'opgave'); } });
    ud.push({ navn: `univers chat note ${info.id}`, req: buildUniversChatRun(info, uni, 'Skriv en note om det, vi aftalte', undefined, d), tjek: (s) => { assert.equal(parseUniversSvar(kraevJson(s))[0]?.type, 'note'); } });
    tekst(`univers chat ${info.id}`, buildUniversChatRun(info, uni, m.replik, undefined, d));
    tekst(`univers chat kontekst ${info.id}`, buildUniversChatRun(info, uni, 'Hvad betyder det?', 'Dokument: Tracé-notat', d));
  }
  ud.push({ navn: 'oversigt nyt univers', req: buildOversigtChatRun(indeks, 'Lav et univers om min sommerferie', undefined, d), tjek: (s) => { assert.match(parseNytUnivers(kraevJson(s)).navn, /sommerferie/i); } });
  tekst('oversigt chat', buildOversigtChatRun(indeks, m.replik, undefined, d));
  return ud;
}

test('(b) svar answers every kind of run, at every moment, with content the real parsers accept', async () => {
  let antal = 0;
  for (const m of MOMENTER) {
    for (const k of await kald(m)) {
      const s = svar(k.req, { moment: m, dag: DAG });
      assert.equal(typeof s, 'string');
      k.tjek(s);
      antal++;
    }
  }
  assert.ok(antal > 200, `${antal} svar tjekket`);
});

test('(b) "flyt løbeturen" in Dagen changes the calendar through the same {opdater} block the real chat uses', () => {
  const m = moment('morgen');
  const dagen = state<DagenState>(froe(m.id, DAG), 'dagen') as DagenState;
  const s = svar(buildChatRun('Flyt løbeturen til kl. 17', undefined, dagen), { moment: m, dag: DAG });
  const raw = extractJson(s) as { opdater: Partial<DagenState> };
  const loeb = parseDagenState({ ...dagen, ...raw.opdater }, nu(m)).kalender.find((k) => /Løb/.test(k.titel));
  assert.equal(loeb?.tid, '17.00');
  assert.equal(loeb?.status, 'flyttet');
});

test('(b) "Hvad skal jeg nu?" in Hjem gets an answer for the moment, not the test fallback', () => {
  const svarene = new Set<string>();
  for (const m of MOMENTER) {
    const f = froe(m.id, DAG);
    const hjem = state<KuratorState>(f, 'hjem') as KuratorState;
    for (const spm of ['Hvad skal jeg nu?', 'hvad nu', 'Hvad gør jeg nu?']) {
      const s = svar(buildHjemChatRun(spm, 'Overblik', nu(m), hjem.kort.map((k) => ({ id: k.id, titel: k.titel, betyder: k.betyder }))), { moment: m, dag: DAG });
      assert.ok(!/testtilstanden/.test(s), `${m.id} "${spm}": ${s}`);
      if (spm === 'Hvad skal jeg nu?') svarene.add(s);
    }
  }
  assert.equal(svarene.size, MOMENTER.length, 'one answer per moment');
});

// ---------- (c) Nothing from Henrik's real life ----------

test('(c) DENY-LIST: no seeded string and no scripted answer contains a real name, employer, account or service', async () => {
  for (const dag of [DAG, ANDEN_DAG]) {
    for (const m of MOMENTER) {
      tjekForbudt(JSON.stringify(froe(m.id, dag)), `froe(${m.id}, ${dag})`);
      tjekForbudt(m.navn + m.url + m.replik, `moment ${m.id}`);
      for (const k of await kald(m, dag)) tjekForbudt(svar(k.req, { moment: m, dag }), `${m.id}/${k.navn}`);
    }
  }
});

test('(c) the deny-list check itself would catch a leak, and only exempts the app\'s own project labels', () => {
  assert.throws(() => tjekForbudt('Mail fra PROTON om kontoen', 'x'), /Proton/);
  assert.throws(() => tjekForbudt('kører på kira-home', 'x'), /Kira/);
  assert.throws(() => tjekForbudt('ShelfAtlas-regnskabet', 'x'), /ShelfAtlas/);
  assert.doesNotThrow(() => tjekForbudt(`repo ${PROJEKTER[0]?.repo ?? ''}`, 'x'));
});

test('KC-0117/KC-0226: Hjem seeds a work card and a family card, plus one message card per zone from the evening; every other card is privat; the owner sees them all', async () => {
  const { synligFor } = await import('../../src/identitet/zoner.ts');
  const zoner = new Map<string, string>();
  for (const m of MOMENTER) {
    for (const k of (state<KuratorState>(froe(m.id, DAG), 'hjem') as KuratorState).kort) {
      assert.ok(k.zone, `${m.id}: ${k.id} has a zone`);
      assert.ok(synligFor({ id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' }, k), `${m.id}: ${k.id} is the owner's`);
      zoner.set(k.id, k.zone as string);
    }
  }
  assert.deepEqual([...zoner.values()].filter((z) => z !== 'privat').sort(), ['arbejde', 'arbejde', 'husstand', 'husstand']);
  assert.equal(zoner.get('familie:maja-hente-ella'), 'husstand');
  assert.equal(zoner.get('besked:arbejde-clara-ruten'), 'arbejde'); // KC-0226
  assert.equal(zoner.get('besked:husstand-maja-svoemning'), 'husstand');
});
