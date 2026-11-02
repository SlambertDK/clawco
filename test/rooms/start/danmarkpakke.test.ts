// KC-0236: Start's "Danmark-pakke" — ONE visible group that holds the Aula card (KC-0235's connect card, wrapped, not
// duplicated) beside Digital Post's step (KC-0233). Shown only while something in it is relevant: the Aula card while no
// Aula source is connected and the person has not put it away; the Digital Post step by its own rule. Nothing relevant: no
// group, no heading. Aula is not a first source: steps 3 and 4 of the journey never offer it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDanmarkPakke, PAKKE_KILDER, PAKKE_TITEL, utenPakke } from '../../../src/rooms/start/danmarkpakke.ts';
import { kildeIndhold, type KildeVisning } from '../../../src/rooms/start/kilderender.ts';
import { renderStart, type StartVisning } from '../../../src/rooms/start/render.ts';
import { AULA_KALENDER_ID } from '../../../src/kilder/aula-kalender/kilde.ts';
import type { KildeKortSyn } from '../../../src/rooms/module.ts';
import type { PostStartVisning } from '../../../src/rooms/start/digitalpost.ts';

const aula = (o: Partial<KildeKortSyn> = {}): KildeKortSyn => ({
  id: 'aula-kalender', navn: 'Aula', slags: 'kalender', zone: 'husstand', forbundet: false, helbred: null,
  kort: {
    titel: 'Aula', tekst: 'Skolens og børnehavens kalender.', handling: 'Forbind Aula',
    felter: [{ navn: 'link', etiket: 'Linket "Ugekalender" fra Aula', type: 'hemmelig', paakraevet: true, maks: 1500 }],
    trin: [{ tekst: 'Åbn Aula, og gå til Kalender.' }, { tekst: 'Kopiér linket "Ugekalender".' }],
  },
  ...o,
});
const post: PostStartVisning = { kandidater: [], laeser: 'ok', viser: 'mit.dk', visere: [{ id: 'mit.dk', navn: 'mit.dk' }], domaener: ['mit.dk'], kanGemme: true };
const antal = (h: string, re: RegExp): number => (h.match(re) ?? []).length;

test('the pack\'s Aula connector id is the connector\'s own (rooms import nothing from src/kilder, so it is restated and held equal here)', () => {
  assert.deepEqual([...PAKKE_KILDER], [AULA_KALENDER_ID]);
});

test('nothing relevant in it: no markup at all — no heading, no empty group', () => {
  assert.equal(String(renderDanmarkPakke({})), '');
  assert.equal(String(renderDanmarkPakke({ aula: undefined, post: undefined })), '');
});

test('Aula alone: one group headed "Danmark-pakke", Aula\'s own connect card (field, button, steps) and a "Ikke nu"', () => {
  const h = String(renderDanmarkPakke({ aula: { kort: aula() } }));
  assert.equal(antal(h, /data-danmark-pakke/g), 1);
  assert.equal(PAKKE_TITEL, 'Danmark-pakke');
  assert.match(h, /<h3 class="eyebrow">Danmark-pakke<\/h3>/);
  assert.match(h, /data-kilde-kort="aula-kalender"/);
  assert.match(h, /data-kilde-trin="aula-kalender"/);
  assert.match(h, /name="link" type="password"/);
  assert.match(h, /data-kilde-forbind="aula-kalender"[^>]*>Forbind Aula</);
  assert.match(h, /data-aktion="aula-ikke-nu"[^>]*>Ikke nu</);
  assert.match(h, /data-element="Danmark-pakke: Aula"/);
  assert.doesNotMatch(h, /data-post-start/);
});

test('Digital Post alone: the same group and heading, only its step', () => {
  const h = String(renderDanmarkPakke({ post }));
  assert.equal(antal(h, /data-danmark-pakke/g), 1);
  assert.match(h, /<h3 class="eyebrow">Danmark-pakke<\/h3>/);
  assert.match(h, /data-post-start/);
  assert.doesNotMatch(h, /data-kilde-kort|aula/i);
});

test('both: ONE group (one heading) holding both cards, Aula\'s first', () => {
  const h = String(renderDanmarkPakke({ aula: { kort: aula() }, post }));
  assert.equal(antal(h, /data-danmark-pakke/g), 1);
  assert.equal(antal(h, /<h3 class="eyebrow">Danmark-pakke<\/h3>/g), 1);
  assert.ok(h.indexOf('data-kilde-kort="aula-kalender"') > 0 && h.indexOf('data-post-start') > h.indexOf('data-kilde-kort="aula-kalender"'));
});

test('Aula\'s card: the zone choice is Aula\'s (the household\'s) and a laptop install has no household zone to offer', () => {
  const h = String(renderDanmarkPakke({ aula: { kort: aula() } }));
  assert.match(h, /<option value="husstand" selected>/);
  const l = String(renderDanmarkPakke({ aula: { kort: aula(), laptop: true } }));
  assert.doesNotMatch(l, /value="husstand"/);
});

test('the Aula card has no Spring over (it is not step 4\'s pile) and the card is not shown twice', () => {
  const h = String(renderDanmarkPakke({ aula: { kort: aula() } }));
  assert.doesNotMatch(h, /kilde-spring-over/);
  assert.equal(antal(h, /data-kilde-kort="aula-kalender"/g), 1);
});

// ---------- Aula is not a first source ----------

const visning = (kort: KildeKortSyn[], o: Partial<KildeVisning> = {}): KildeVisning => ({ kort, forhaandsvisninger: [], flere: [], kanForbinde: true, ...o });
const google: KildeKortSyn = { id: 'google-kalender', navn: 'Google Kalender', slags: 'kalender', zone: 'privat', forbundet: false, helbred: null, kort: { titel: 'Google Kalender', tekst: 'Din kalender.', handling: 'Log ind med Google', felter: [] } };

test('step 3 does not offer Aula beside the calendars (it is in the pack), and step 4 never pulls it into its pile', () => {
  const h3 = String(kildeIndhold('foerste-kilde', 'ikke-startet', visning([google, aula()]), new Date()));
  assert.match(h3, /data-kilde-kort="google-kalender"/);
  assert.doesNotMatch(h3, /aula/i);
  const h4 = String(kildeIndhold('flere-kilder', 'i-gang', visning([google, aula()], { flere: ['aula-kalender'] }), new Date()));
  assert.doesNotMatch(h4, /data-kilde-kort="aula-kalender"/);
});

test('step 3 once done does not list Aula among the connected first sources', () => {
  const h = String(kildeIndhold('foerste-kilde', 'klaret', visning([{ ...google, forbundet: true }, aula({ forbundet: true })]), new Date()));
  assert.doesNotMatch(h, /aula/i);
});

test('utenPakke: the registry as the journey reads it leaves the pack\'s sources out, and nothing else', () => {
  const k = [{ id: 'google-kalender', slags: 'kalender' }, { id: 'aula-kalender', slags: 'kalender' }, { id: 'mail-imap', slags: 'mail' }];
  assert.deepEqual(utenPakke(k).map((x) => x.id), ['google-kalender', 'mail-imap']);
});

// ---------- in the room ----------

const start = (o: Partial<StartVisning> = {}): string => String(renderStart({
  trin: [], profil: null, forslag: [], log: [], now: new Date('2026-11-02T10:00:00Z'), igang: [], venter: 0, standardNavn: '', kanGemme: true, ...o,
} as StartVisning));

test('Start: the group is under the steps, once, with both cards; none of it without either', () => {
  const baade = start({ aula: { kort: aula() }, digitalPost: post });
  assert.equal(antal(baade, /data-danmark-pakke/g), 1);
  assert.match(baade, /data-post-start/);
  assert.match(baade, /data-kilde-kort="aula-kalender"/);
  const intet = start();
  assert.doesNotMatch(intet, /data-danmark-pakke|Danmark-pakke/);
});
