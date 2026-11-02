// KC-0170: the screen's language. One table per language (shell + Start), Danish when no language is chosen, so
// Henrik's installation renders byte for byte as before; English when the profile says so, with no Danish word left
// on the surfaces this slice converted (the shell, the bands, Start's steps 1–2 and the step cards).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEKSTER, medSprog, sprogNu, tekst, klientTekst } from '../../src/shell/tekster.ts';
import { START_TEKSTER } from '../../src/rooms/start/tekster.ts';
import { ROOMS } from '../../src/rooms/registry.ts';
import { ZONE_NAVN } from '../../src/identitet/zoner.ts';
import { friskhed, kildeFriskhed } from '../../src/shell/friskhed.ts';
import { naesteLinje, omTekst } from '../../src/shell/naeste.ts';
import { renderIkkeFundet, ikkeFundetOverskrift } from '../../src/shell/ikkefundet.ts';
import { renderKilder } from '../../src/shell/kilder.ts';
import { kildeHelbredElementer } from '../../src/shell/kilde-helbred.ts';
import { zoneChip } from '../../src/shell/zone.ts';
import { resultatBoks } from '../../src/shell/log.ts';
import { shell } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';
import { baand, igangGruppe, afvistLinje } from '../../src/shell/sprog.ts';
import { renderStart } from '../../src/rooms/start/render.ts';
import { alleTrin } from '../../src/rooms/start/trin.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';
import * as golden from '../fixtures/sprog-golden.ts';
import { form, tomme, ensStrenge, laesbart, danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog', navn), 'utf8');


test('English has exactly Danish\'s keys and shapes, in the shell and in Start; no string is empty', () => {
  assert.deepEqual(form(TEKSTER.en), form(TEKSTER.da));
  assert.deepEqual(form(START_TEKSTER.en), form(START_TEKSTER.da));
  for (const t of [TEKSTER.da, TEKSTER.en, START_TEKSTER.da, START_TEKSTER.en]) assert.deepEqual(tomme(t as unknown as Record<string, unknown>), []);
});

test('the Danish zone names are the identity module\'s own; English has all three', () => {
  assert.deepEqual(TEKSTER.da.zone, ZONE_NAVN);
  assert.deepEqual(Object.keys(TEKSTER.en.zone).sort(), Object.keys(ZONE_NAVN).sort());
});

test('every room has an English name; the Danish names are the registry\'s own', () => {
  for (const r of ROOMS) {
    assert.equal(TEKSTER.da.rum[r.id], r.navn);
    assert.ok(TEKSTER.en.rum[r.id], r.id);
  }
});

/** Strings that are the same in both languages on purpose (names, and words English borrows). */
const ENS = new Set(['hermes', 'stop', 'send', 'rum.start', 'rum.mail', 'rolle.stoette', 'sprogValg.da', 'klient.omMin', 'kanal.stoette', 'stoetteHvem', 'billede.under', 'billede.min']);

test('English is actually English: no Danish string copied over', () => {
  const ens = [...ensStrenge(TEKSTER.da as unknown as Record<string, unknown>, TEKSTER.en as unknown as Record<string, unknown>), ...ensStrenge(START_TEKSTER.da as unknown as Record<string, unknown>, START_TEKSTER.en as unknown as Record<string, unknown>)];
  assert.deepEqual(ens.filter((k) => !ENS.has(k)), []);
});

test('no language set is Danish (an installation without a profile); medSprog sets it for one render', () => {
  assert.equal(sprogNu(), 'da');
  assert.equal(tekst(), TEKSTER.da);
  assert.equal(medSprog('en', () => sprogNu()), 'en');
  assert.equal(medSprog('en', () => tekst().kraeverDig), 'Needs you');
  assert.equal(sprogNu(), 'da');
});

test('Henrik\'s installation: with no language chosen the shell, the bands and Start render byte for byte as before', () => {
  const sager: [string, () => string][] = [
    ['shell-fuld.html', golden.SHELL_FULD], ['shell-minimal.html', golden.SHELL_MINIMAL], ['shell-stoette-fra.html', golden.SHELL_STOETTE_FRA], ['baand.html', golden.BAAND],
    ...Object.entries(golden.START).map(([k, f]): [string, () => string] => [`start-${k}.html`, f]),
  ];
  const filer = readdirSync(path.join(rod, '../fixtures/sprog')).sort();
  assert.deepEqual(sager.map(([f]) => f).sort(), filer, 'every golden has a case');
  // One difference is allowed: an apostrophe that was literal markup ("Hermes' kø") now comes through the escaper as
  // &#39;, which the browser shows as the same character.
  const samme = (s: string): string => s.replaceAll('&#39;', "'");
  for (const [fil, lav] of sager) {
    assert.equal(samme(lav()), fixtur(fil), fil);
    assert.equal(samme(medSprog('da', lav)), fixtur(fil), `${fil} (da chosen)`);
  }
});

// ---- English: no Danish on the converted surfaces -------------------------------------------------------------------


const ejer = { id: FAMILIE.medlem.id, login: null, navn: FAMILIE.medlem.navn, rolle: 'ejer' as const };
const partner = { id: FAMILIE.partner.id, login: null, navn: FAMILIE.partner.navn, rolle: 'medlem' as const };

test('English: the shell has no Danish word, and its <html lang> and client table say en', () => {
  const doc = medSprog('en', () => String(shell({
    roomId: 'dagen', hermesStatus: tekst().klar, venter: { dagen: 1, mail: 3 }, main: html`<p>Body</p>`, kontekst: 'The 10 o\'clock meeting',
    chat: [{ id: 'c1', tid: '2026-10-26T06:00:00.000Z', fra: 'hermes', tekst: 'Good morning' }], stemme: 'samtale', live: true,
    univers: [{ id: 'garden', navn: 'Garden' }], synlige: new Set(['hjem', 'dagen', 'mail', 'univers', 'husstand']),
    person: ejer, husstand: [ejer, partner], pause: { pause: true, tid: '2026-10-26T08:00:00.000Z', person: FAMILIE.partner.id },
    hjaelp: { href: 'https://konto.example.com/help' },
    stoette: { adgang: { udloeber: '2026-10-26T12:00:00.000Z', grund: 'Mail is stuck' }, slaaTil: '/a', slaaFra: '/b' },
  })));
  assert.match(doc, /<html lang="en">/);
  assert.match(doc, /window\.KC_TEKST=\{[^<]*"fortryd":"Undo"/);
  assert.match(doc, /<span>Now<\/span>/);
  assert.match(doc, /<span>Today<\/span>/);
  assert.deepEqual(danskeLinjer(doc), []);
  // The chat reads English phrases too (KC-0170), so the chips and the list of what to say are shown in English.
  assert.match(doc, /id="chat-forslag" role="group" aria-label="Suggestions"/);
  assert.match(doc, /data-forslag="What can I say\?"/);
  assert.match(doc, /<h3 class="eyebrow">In the chat you can say<\/h3>/);
  assert.match(doc, /<li>Open the day<\/li>/);
  assert.match(doc, /<li>What can I say\?<\/li>/);
});

test('the Danish detector works: the same shell in Danish is full of Danish lines', () => {
  const doc = String(shell({ roomId: 'hjem', hermesStatus: tekst().klar, venter: {}, main: html``, chat: [], stoette: { adgang: null, slaaTil: '/a', slaaFra: '/b' } }));
  assert.ok(danskeLinjer(doc).length > 20, String(danskeLinjer(doc).length));
});

test('English: the shell without support grant and with voice off has no Danish word either', () => {
  const doc = medSprog('en', () => String(shell({ roomId: 'hjem', hermesStatus: tekst().klar, venter: {}, main: html``, chat: [], stoette: { adgang: null, slaaTil: '/a', slaaFra: '/b' } })));
  assert.deepEqual(danskeLinjer(doc), []);
});

test('English: the bands carry no Danish band names', () => {
  const ud = medSprog('en', () => String(baand({
    kraever: [{ titel: 'Answer', form: 'kort', elementer: [{ id: 'k:1', html: html`<article>One</article>` }] }],
    igang: [igangGruppe([{ id: 'r1', label: 'Sorting mail', status: 'running' }, { id: 'r2', label: 'Building Today', status: 'queued' }])],
    ordnet: [{ titel: 'Done', form: 'raekker', elementer: [{ id: 'o:1', html: html`<div>Two</div>` }] }],
  })) + String(baand({ kraever: [], igang: [], ordnet: [] })) + String(afvistLinje('Pay the bill', 'Clawco never pays.')));
  for (const ord of ['Kræver dig', 'I gang', 'ordnet', 'venter på dig', 'Hermes arbejder', 'I kø', 'Ikke tilbudt', 'Vis ']) assert.ok(!laesbart(ud).includes(ord), ord);
  assert.match(ud, /Needs you/);
  assert.match(ud, /1 waiting for you · 1 in progress · 1 done|1 waiting for you/);
  assert.deepEqual(danskeLinjer(ud), []);
});

test('English: Start\'s step cards, step 1 and step 2 have no Danish word', () => {
  const NU = new Date('2026-10-26T09:00:00.000Z');
  const rev = { lille: 'r1', taenker: 'r2' };
  const syn = { udbyder: 'ollama', modeller: { lille: 'qwen3:8b', taenker: 'qwen3:14b' }, test: { lille: { ok: false, tid: NU.toISOString(), ms: 400, rev: 'r1', fejl: 'forbindelse' }, taenker: { ok: true, tid: NU.toISOString(), ms: 1460, rev: 'r2' } }, rev };
  const trin = (s: 'ikke-startet' | 'klaret') => alleTrin().map((t, i) => ({ trin: t, status: i === 0 ? s : 'ikke-startet' as const }));
  const sider = medSprog('en', () => [
    renderStart({ trin: trin('ikke-startet'), profil: null, standardNavn: '', forslag: [], kanGemme: true, now: NU, model: { syn: { modeller: {}, test: {}, rev }, agent: 'klar', kanGemme: true } }),
    renderStart({ trin: trin('klaret'), profil: { navn: FAMILIE.medlem.navn, sprog: 'en', husstand: 'husstand' }, standardNavn: '', forslag: [{ kildeId: 'noter', navn: 'Notes', slags: 'noter', grund: 'You write a lot down.' }], kanGemme: true, now: NU,
      model: { syn, agent: 'klar', kanGemme: true, gemt: { udbyder: 'ollama', url: 'http://127.0.0.1:11434' } },
      log: [{ id: 'l1', tid: '2026-10-26T08:30:00.000Z', kilde: 'henrik', tekst: 'Saved the profile', fortryd: 'x' }], igang: [{ id: 'r1', label: 'Testing the model', status: 'running' }] }),
    renderStart({ trin: trin('ikke-startet'), profil: null, standardNavn: '', forslag: [], kanGemme: true, now: NU, laptop: true, model: { syn, agent: 'mangler-noegle', kanGemme: true } }),
    renderStart({ trin: trin('ikke-startet'), profil: null, standardNavn: '', forslag: [], kanGemme: false, now: NU, model: { syn, agent: 'utilgaengelig', kanGemme: false } }),
    renderStart({ trin: trin('ikke-startet'), profil: null, standardNavn: '', forslag: [], kanGemme: true, now: NU, model: { syn: { ...syn, udbyder: 'anthropic' }, agent: 'klar', kanGemme: true, gemt: { udbyder: 'anthropic', kommando: 'hermes config set ANTHROPIC_API_KEY' } } }),
  ].map(String));
  // Steps 3–6 show only their title and sentence here (their own sub-cards are a follow-up: no kilder/import/foersteRet given).
  const ud = sider.join('\n');
  assert.deepEqual(danskeLinjer(ud), []);
  assert.match(ud, /<h1>Start<\/h1>/);
  assert.match(ud, /Welcome/);
  assert.match(ud, /<option value="en"[^>]*>English<\/option>/);
});

test('the client table carries the room names and every client string, for the language being rendered', () => {
  const da = JSON.parse(klientTekst().replace(/^<script>window\.KC_TEKST=/, '').replace(/<\/script>$/, '')) as Record<string, unknown>;
  const en = JSON.parse(medSprog('en', klientTekst).replace(/^<script>window\.KC_TEKST=/, '').replace(/<\/script>$/, '')) as Record<string, unknown>;
  assert.equal(da['fortryd'], 'Fortryd');
  assert.equal(en['fortryd'], 'Undo');
  assert.equal((en['rum'] as Record<string, string>)['hjem'], 'Now');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(da).sort());
});

test('public/app.js reads every key it uses from the client table', () => {
  const js = readFileSync(path.join(rod, '../../public/app.js'), 'utf8');
  const brugt = new Set([...js.matchAll(/\btk\('([a-zA-Z]+)'\)/g)].map((m) => m[1]!));
  assert.ok(brugt.size >= 10, `app.js uses tk() (${brugt.size})`);
  for (const k of brugt) assert.ok(k in TEKSTER.da.klient, k);
});

// ---- English: the shared helpers the rooms draw with (slice 2) -----------------------------------------------------

const NU = new Date('2026-10-26T09:00:00.000Z');

test('English: freshness, the next line, the clock, zone chips, the 404 page, the source list and the connection card carry no Danish word', () => {
  const ud = medSprog('en', () => [
    String(friskhed('2026-10-26T06:05:00.000Z', NU)), String(friskhed('2026-10-25T06:05:00.000Z', NU)), String(friskhed('2026-10-22T06:05:00.000Z', NU)), String(friskhed('2026-10-01T06:05:00.000Z', NU)),
    String(kildeFriskhed({ slags: 'kalender', sidstLaest: '2026-10-26T08:50:00.000Z', ok: true }, NU)), String(kildeFriskhed({ slags: 'kalender', sidstLaest: '2026-10-25T08:50:00.000Z', ok: false }, NU)), String(kildeFriskhed({ slags: 'kalender', ok: false }, NU)),
    String(naesteLinje({ titel: 'Board meeting', start: '2026-10-26T12:30:00.000Z', slut: '2026-10-26T13:30:00.000Z' }, NU)),
    String(zoneChip({ zone: 'privat' })), String(zoneChip({ zone: 'arbejde' })), String(zoneChip({ zone: 'husstand' })),
    String(renderIkkeFundet('rum')), String(renderIkkeFundet('side')), String(renderIkkeFundet('dokument')), ikkeFundetOverskrift('side'),
    String(renderKilder([{ id: 'k1', navn: 'Calendar', slags: 'kalender', auth: 'oauth', zone: 'privat', forbundet: true, helbred: { status: 'langsomt', tid: '2026-10-26T08:00:00.000Z' } as never, sidstLaest: '2026-10-26T08:50:00.000Z' }], { nu: NU, maaFrakoble: true })),
    String(resultatBoks({ id: 'l1', tid: '2026-10-26T08:05:00.000Z', kilde: 'hermes', tekst: 'Sorted the mail.' })),
  ].join('\n'));
  assert.match(ud, /updated 07:05/);
  assert.match(ud, /from yesterday 07:05/);
  assert.match(ud, /from Thursday 08:05/);
  assert.match(ud, /from 1 Oct 08:05/);
  assert.match(ud, /Last fetched 09:50/);
  assert.match(ud, /not updated since yesterday 09:50/);
  assert.match(ud, /not fetched yet/);
  assert.match(ud, /Next: <span class="naeste-titel">Board meeting<\/span> at 13:30 · <span class="naeste-om">in 3 h 30 min<\/span>/);
  assert.match(ud, /Private.*Work.*Household/s);
  assert.match(ud, /That room does not exist/);
  assert.match(ud, /To Now/);
  assert.match(ud, /Sources.*Connected|Sources.*Slow/s);
  assert.match(ud, /Answering slowly/);
  assert.match(ud, /Disconnect/);
  assert.match(ud, /Hermes · 09:05/);
  assert.deepEqual(danskeLinjer(ud), []);
  // The countdown's words are the client's too (public/naeste.js reads them from the page's table).
  assert.equal(medSprog('en', () => omTekst(1_000_000_000_000, undefined, 1_000_000_000_000 - 90 * 60_000)), 'in 1 h 30 min');
  assert.equal(medSprog('en', () => tekst().hilsen(9, 'Alma')), 'Good morning, Alma');
  assert.equal(tekst().hilsen(18, 'Henrik'), 'Godaften, Henrik');
  assert.equal(tekst().hilsen(18), 'Godaften');
  assert.equal(medSprog('en', () => tekst().hilsen(11)), 'Good afternoon');
  assert.equal(medSprog('en', () => omTekst(1_000_000_000_000, 1_000_000_000_000 + 60_000, 1_000_000_000_000)), 'now');
  assert.equal(omTekst(1_000_000_000_000, undefined, 1_000_000_000_000 - 90 * 60_000), 'om 1 t 30 min');
});

test('English: the failing connection\'s card has English chrome (its fixed what-is-wrong words stay the connector table\'s, a follow-up)', () => {
  const [el] = medSprog('en', () => kildeHelbredElementer([{ id: 'k1', navn: 'Calendar', slags: 'kalender', auth: 'oauth', vist: 'snart-udloebet', zone: 'privat', sidstLaest: '2026-10-26T08:50:00.000Z', udloeber: '2026-10-27T19:00:00.000Z', felter: [], kanForbinde: true }], NU));
  const doc = String(el!.html);
  assert.match(doc, /data-element="The connection: Calendar"/);
  assert.match(doc, /Expires tomorrow 20:00/);
  assert.match(doc, /From Calendar · /);
  assert.match(doc, /Remove the connection/);
  assert.match(doc, />Connection</);
});
