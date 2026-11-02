// KC-0170 slice 3 (part B): the card a failing connection gets in Nu, in English: the shell draws it (its own words are the
// shell's table), the connection's words come from src/kilder/helbred-tekst.ts. And the registry names a connection by the
// language of the request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kortTekst, stemmeSaetning, KNAP, GENFORBIND_KANAL } from '../../src/kilder/helbred-tekst.ts';
import { kildeHelbredElementer, type KildeHelbredKort } from '../../src/shell/kilde-helbred.ts';
import { lavRegister } from '../../src/kilder/register.ts';
import { googleKalender } from '../../src/kilder/google-kalender/kilde.ts';
import { nyhederRss } from '../../src/kilder/nyheder-rss/kilde.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { danskeLinjer } from '../fixtures/sprog-tjek.ts';
import { medData, NU } from './hjaelp.ts';

const kort = (over: Partial<KildeHelbredKort> = {}): KildeHelbredKort => ({
  id: 'falsk-kalender', navn: 'Calendar', slags: 'kalender', auth: 'oauth', vist: 'log-ind-igen', zone: 'privat', felter: [], kanForbinde: true,
  sidstLaest: '2026-11-01T06:05:00Z', ...over,
});
const doc = (k: KildeHelbredKort): string => kildeHelbredElementer([k], new Date('2026-11-01T12:00:00Z')).map((e) => String(e.html)).join('\n');

test('the card of a connection that logged out, in English, has no Danish word and says what is wrong', () => {
  const s = medSprog('en', () => doc(kort()));
  assert.deepEqual(danskeLinjer(s), []);
  assert.match(s, /Your calendar is logged out/);
  assert.match(s, /Clawco cannot fetch your calendar until you have logged in again\./);
  assert.match(s, />Log in again</);
});

test('every state, auth kind and slags in English: a title, a sentence and a button, none Danish', () => {
  for (const vist of ['snart-udloebet', 'log-ind-igen', 'nede'] as const) for (const auth of ['oauth', 'apikey', 'local', 'bridge'] as const) {
    for (const slags of ['kalender', 'mail', 'noter', 'nyheder', 'beskeder'] as const) {
      const t = medSprog('en', () => kortTekst(vist, auth, slags));
      assert.ok(t.titel && t.tekst && t.knap, `${vist}/${auth}/${slags}`);
      assert.deepEqual(danskeLinjer(`<p>${t.titel}</p><p>${t.tekst}</p><p>${t.knap}</p>`), [], `${vist}/${auth}/${slags}`);
    }
  }
});

test('the voice speaks the same fixed sentence, in the language of the request', () => {
  assert.equal(stemmeSaetning('nede', 'oauth', 'kalender'), 'Din kalender svarer ikke.');
  assert.equal(medSprog('en', () => stemmeSaetning('nede', 'oauth', 'kalender')), 'Your calendar is not answering.');
  assert.equal(medSprog('en', () => stemmeSaetning('ok', 'oauth', 'kalender')), null);
});

test('KNAP and GENFORBIND_KANAL stay one object each and follow the language', () => {
  assert.equal(KNAP.oauth, 'Log ind igen');
  assert.equal(medSprog('en', () => KNAP.oauth), 'Log in again');
  assert.deepEqual(Object.keys(medSprog('en', () => ({ ...GENFORBIND_KANAL }))), ['telegram', 'whatsapp', 'signal']);
  assert.match(medSprog('en', () => GENFORBIND_KANAL.whatsapp), /Run "hermes whatsapp" on the server/);
});

test('the registry names a connection by the language of the request', async () => {
  await medData(async (dir, store) => {
    const r = lavRegister({ dataDir: dir, store, nu: () => NU });
    r.registrer(googleKalender({ env: {} }));
    r.registrer(nyhederRss({ dataDir: dir }));
    const navne = async () => (await r.oversigt()).map((k) => k.navn);
    assert.deepEqual(await navne(), ['Google Kalender', 'Nyhedskilder']);
    assert.deepEqual(await medSprog('en', navne), ['Google Calendar', 'News sources']);
    assert.equal((await medSprog('en', () => r.oversigt()))[1]?.kort.titel, 'News sources');
  });
});
