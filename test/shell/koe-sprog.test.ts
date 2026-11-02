// KC-0170 slice 3, part A: the Kø panel's server-rendered lists (what Clawco has done, the cost card), the shared
// picture renderer and Tailscale's sentences speak English or Danish. Danish (no language chosen, or da chosen) renders
// byte for byte as before (test/fixtures/sprog-koe/, captured before the strings moved); English has no Danish word left.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEKSTER, medSprog } from '../../src/shell/tekster.ts';
import { hvornaar, klokkeKbh } from '../../src/shell/revision.ts';
import { kr } from '../../src/shell/omkostninger.ts';
import { delPaaTailnet, TsFejl, type TsKoerer } from '../../src/shell/tailscale.ts';
import { REVISION, OMKOSTNINGER, BILLEDER } from '../fixtures/sprog-golden-koe.ts';
import { danskeLinjer } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const mappe = path.join(rod, '../fixtures/sprog-koe');
const fixtur = (navn: string): string => readFileSync(path.join(mappe, navn), 'utf8');
const SAMLING: [string, Record<string, () => string>][] = [['revision', REVISION], ['omkostninger', OMKOSTNINGER], ['billede', BILLEDER]];

test('Henrik\'s installation: with no language chosen (or da) every case renders byte for byte as before', () => {
  const filer = readdirSync(mappe).sort();
  assert.deepEqual(SAMLING.flatMap(([pre, m]) => Object.keys(m).map((k) => `${pre}-${k}.html`)).sort(), filer, 'every golden has a case');
  for (const [pre, m] of SAMLING) {
    for (const [k, lav] of Object.entries(m)) {
      assert.equal(lav(), fixtur(`${pre}-${k}.html`), `${pre}-${k}`);
      assert.equal(medSprog('da', lav), fixtur(`${pre}-${k}.html`), `${pre}-${k} (da chosen)`);
    }
  }
});

test('the Danish detector works on these screens: the Danish full lists are full of Danish lines', () => {
  assert.ok(danskeLinjer(REVISION['fuld']!()).length > 20);
  assert.ok(danskeLinjer(OMKOSTNINGER['roed']!()).length >= 2);
});

// The reasons (`hvorfor`) come from the policy layer (src/graenser), Danish there; the fixtures give them English text.
test('English: no Danish word in any of the lists or pictures', () => {
  for (const [pre, m] of SAMLING) for (const [k, lav] of Object.entries(m)) assert.deepEqual(danskeLinjer(medSprog('en', lav)), [], `${pre}-${k}`);
});

test('English: the history reads as English with English clock and dates', () => {
  const h = medSprog('en', REVISION['fuld']!);
  for (const re of [/>14:05</, />30 Oct 0\d:15</, /Today: read and built the room/, /Mail: sorted/, /Mail: said no to pay/, /Universe: waited for your yes to write to others/, /Maja pressed Stop everything/, /Henrik started Clawco again/, /from the voice/, /from a button/, /from Hermes/, /scheduled/]) assert.match(h, re);
  assert.match(medSprog('en', REVISION['tom']!), /Clawco has not done anything yet\./);
  assert.match(medSprog('en', REVISION['ingenNej']!), /Clawco has not said no to anything lately\./);
  const s = medSprog('en', REVISION['stoette']!);
  for (const re of [/Henrik let support look along/, /Support \(employee 42\) started looking along/, /Support \(employee 42\) opened Mail/, /Support was refused Start/, /Henrik turned support off/, /Support access ended by itself/]) assert.match(s, re);
});

test('the clock: Danish "00.05" and "1. nov. 00.05", English "00:05" and "1 Nov 00:05"', () => {
  const sent = new Date('2026-10-31T23:05:00Z');
  const nu = new Date('2026-11-10T12:00:00Z');
  assert.equal(klokkeKbh(sent), '00.05');
  assert.equal(hvornaar(sent.toISOString(), nu), '1. nov. 00.05');
  assert.equal(medSprog('en', () => klokkeKbh(sent)), '00:05');
  assert.equal(medSprog('en', () => hvornaar(sent.toISOString(), nu)), '1 Nov 00:05');
  assert.equal(hvornaar('ikke en tid', nu), '');
});

test('money: kr stays the unit; the number format follows the language', () => {
  assert.equal(kr(129000), '1.290 kr');
  assert.equal(kr(140), '1,40 kr');
  assert.equal(medSprog('en', () => kr(129000)), '1,290 kr');
  assert.equal(medSprog('en', () => kr(140)), '1.40 kr');
});

test('English cost card: the month is "mo", the chips and notes are English', () => {
  const h = medSprog('en', OMKOSTNINGER['roed']!);
  for (const re of [/>Costs</, /56 kr\/mo/, />Not covered</, /on without cover, requires 112 kr\/mo in paid subscriptions/]) assert.match(h, re);
  assert.match(medSprog('en', OMKOSTNINGER['gratisEn']!), /1 service runs free/);
  assert.match(medSprog('en', OMKOSTNINGER['groen']!), /2 services run free/);
  assert.match(medSprog('en', OMKOSTNINGER['fejl']!), /The cost list could not be read/);
  assert.match(medSprog('en', OMKOSTNINGER['gul']!), />Soon covered</);
  assert.match(medSprog('en', OMKOSTNINGER['klar']!), />Can be switched on</);
  assert.match(medSprog('en', OMKOSTNINGER['daekket']!), />Covered</);
});

test('English pictures: the amount verdict, the day line\'s "now", the countdown unit and the dots', () => {
  assert.match(medSprog('en', BILLEDER['beloebLige']!), /Fits/);
  assert.match(medSprog('en', BILLEDER['beloebUnder']!), /^[\s\S]*210,000 kr\. under/);
  assert.match(medSprog('en', BILLEDER['beloebOver']!), /\+2,600 kr\./);
  assert.match(medSprog('en', BILLEDER['dagslinjeNu']!), /<span>now<\/span>/);
  assert.match(medSprog('en', BILLEDER['prikker']!), /3 of 12 opened/);
  assert.match(medSprog('en', BILLEDER['mere']!), /<span>Why\?<\/span>/);
});

// ---- Tailscale's sentences (they reach the page through Start's card) ----

const svar = (s: { kode: number; stderr?: string } | 'mangler' | 'tid'): TsKoerer => async (a) => {
  if (a[0] === 'serve' && a[1] === '--bg') {
    if (s === 'mangler') return { fundet: false };
    if (s === 'tid') throw Object.assign(new Error('x'), { name: 'TsTid' });
    return { fundet: true, kode: s.kode, stdout: '', stderr: s.stderr ?? '' };
  }
  return { fundet: true, kode: 0, stdout: JSON.stringify({ BackendState: 'Running' }), stderr: '' };
};
const o = { port: 8750, laptop: false };
const LINK = 'https://login.tailscale.com/f/serve?node=n123abc';
const meddelelser = async (): Promise<string[]> => {
  const ud: string[] = [];
  for (const k of [svar({ kode: 1, stderr: `visit:\n${LINK}\n` }), svar({ kode: 1, stderr: 'secret line' }), svar('mangler')]) {
    await delPaaTailnet(k, o).then(() => assert.fail('should refuse'), (e: unknown) => { assert.ok(e instanceof TsFejl); ud.push(e.message); });
  }
  return ud;
};

test('Tailscale: Danish sentences are the same as before; English has none of Danish and keeps the login link', async () => {
  assert.deepEqual(await meddelelser(), [
    `Tailscale vil først have, at du slår deling til for dit net. Åbn ${LINK}, tryk på knappen dér, og tryk så på Del igen.`,
    'Tailscale kunne ikke dele Clawco. Se i Tailscale, hvad der mangler, og prøv igen.',
    'Tailscale er ikke installeret på denne maskine.',
  ]);
  const en = await medSprog('en', meddelelser);
  assert.deepEqual(en, [
    `Tailscale first wants you to turn sharing on for your network. Open ${LINK}, press the button there, and then press Share again.`,
    'Tailscale could not share Clawco. Look in Tailscale for what is missing, and try again.',
    'Tailscale is not installed on this machine.',
  ]);
  for (const m of en) assert.deepEqual(danskeLinjer(m), []);
});

test('the shell table has the new keys in both languages', () => {
  for (const sprog of ['da', 'en'] as const) {
    const t = TEKSTER[sprog];
    for (const k of ['gjorde', 'at', 'kanal', 'revisionTom', 'revisionIngenNej', 'vaerktoej', 'koerLabels', 'tailscale', 'omk'] as const) assert.ok(k in t, `${sprog}.${k}`);
  }
});
