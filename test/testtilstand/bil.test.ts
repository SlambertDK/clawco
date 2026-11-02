// KC-0151 in the test world (AGENTS §4 r11): the moment "Lørdag i næste uge". Maja's course holds the big car that
// Saturday 09–13, Henrik has a card waiting for the small car on the Sunday, and his sentence (the moment's replik) is
// answered by the scripted Hermes with a booking block — the clash card for him and Maja, then "Tag den lille bil".

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MOMENTER, froe, svar } from '../../src/testtilstand/indhold.ts';
import { bilBooking, loerdagNaesteUge } from '../../src/testtilstand/indhold/husstand.ts';
import { fakta } from '../../src/testtilstand/indhold/fakta.ts';
import { parseHusstandState } from '../../src/hushold/schema.ts';
import { dobbeltBooket } from '../../src/hushold/ressource.ts';
import { parseBookingSvar, valider } from '../../src/hushold/bil.ts';
import { buildHusstandChatRun } from '../../src/hushold/prompt.ts';
import { lavTestverden, type Testverden } from '../../src/testtilstand/verden.ts';

const DAG = '2026-10-29';
const rod = await mkdtemp(path.join(tmpdir(), 'kc-bil-verden-'));
after(() => rm(rod, { recursive: true, force: true }));
const moment = MOMENTER.find((m) => m.id === 'bil-loerdag')!;

const post = (v: Testverden, sti: string, body: unknown) => v.app.request(sti, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function vent(v: Testverden, sti: string, moenster: RegExp): Promise<string> {
  let h = '';
  for (let i = 0; i < 100; i++) { h = await (await v.app.request(sti)).text(); if (moenster.test(h)) return h; await new Promise((r) => setTimeout(r, 20)); }
  return h;
}

test('the moment: the Saturday of the cars, a story in the test world (the deny-list test in indhold.test.ts covers its text)', () => {
  assert.equal(moment.navn, 'Lørdag i næste uge');
  assert.equal(moment.url, '/rum/husstand');
  assert.match(moment.replik, /store bil lørdag 10 til 15/);
  const s = parseHusstandState(froe('bil-loerdag', DAG).rum['husstand']?.state);
  const stor = s.ressourcer.find((r) => r.id === 'stor-bil')!;
  const kursus = stor.kalender.find((b) => b.id === 'b-kursus')!;
  assert.equal(kursus.af, 'maja');
  assert.ok(s.ressourcer.some((r) => r.id === 'lille-bil'));
  assert.ok(s.ressourcer.every((r) => !dobbeltBooket(r)));
  assert.equal(s.udkast.length, 1);
  assert.equal(s.udkast[0]!.af, 'henrik');
  for (const m of MOMENTER.filter((x) => x.id !== 'bil-loerdag')) assert.ok(!JSON.stringify(froe(m.id, DAG).rum['husstand']?.state).includes('b-kursus'), `${m.id} has no course`);
});

test('the scripted Hermes answers the moment\'s sentence with a booking the app accepts — the Saturday next week, the big car, 10–15', () => {
  const f = fakta(DAG);
  const req = buildHusstandChatRun(moment.replik, undefined, [], [], [{ id: 'stor-bil', navn: 'Den store bil', slags: 'bil', ejere: ['henrik'], kalender: [] }], new Date(f.iso('19:30', 1)));
  const o = parseBookingSvar(svar(req, { moment, dag: DAG }));
  assert.ok(o, 'a booking block');
  assert.equal(o.ressource, 'stor-bil');
  assert.equal(o.start, `${f.plus(loerdagNaesteUge(f))}T10:00`);
  assert.equal(o.slut, `${f.plus(loerdagNaesteUge(f))}T15:00`);
  const stor = parseHusstandState(froe('bil-loerdag', DAG).rum['husstand']?.state).ressourcer;
  assert.ok(valider(o, stor, new Date(f.iso('19:30', 1))).ok, 'inside 14 days at the moment\'s clock');
  assert.equal(bilBooking('Hvad skal vi i denne uge?', f, 'bil-loerdag'), null, 'only a car sentence');
  assert.equal(bilBooking('Jeg skal bruge den lille bil lørdag 9.30 til 11', f, 'morgen')?.ressource, 'lille-bil');
});

test('the flow in the test world: the sentence makes the clash card for Henrik and Maja; "Tag den lille bil" books the small car', async () => {
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
  assert.deepEqual(await v.hop('bil-loerdag'), { url: '/rum/husstand' });
  const foer = await (await v.app.request('/rum/husstand')).text();
  assert.match(foer, /data-booking="b-kursus"/);
  assert.match(foer, /data-udkast="u-soendag"/);
  assert.match(foer, /data-ressource-form/);
  assert.doesNotMatch(foer, /data-sammenfald="s-[a-f0-9]{8}"/, 'no new card before the sentence');
  assert.equal((await post(v, '/api/rum/husstand/chat', { besked: moment.replik })).status, 202);
  const h = await vent(v, '/rum/husstand', /Tag den lille bil/);
  assert.match(h, /data-sammenfald="s-[a-f0-9]{8}"/);
  assert.match(h, /Den store bil er booket to gange/);
  assert.ok(h.indexOf('Tag den lille bil') < h.indexOf('Spørg Maja om at bytte') && h.indexOf('Spørg Maja om at bytte') < h.indexOf('Drop det'), 'the ticket order');
  assert.match(h, /Den lille bil er fri, så den kan klare det/, 'the scripted suggestion arrived');
  const knap = /<button[^>]*data-aktion="sammenfald-valg"[^>]*>Tag den lille bil<\/button>/.exec(h)![0];
  const arg = JSON.parse(/data-arg="([^"]*)"/.exec(knap)![1]!.replaceAll('&quot;', '"')) as Record<string, string>;
  const res = await post(v, '/api/rum/husstand/aktion/sammenfald-valg', arg);
  assert.equal(res.status, 202);
  const efter = await vent(v, '/rum/husstand', /Booket: Den lille bil/);
  assert.match(efter, /Booket: Den lille bil/);
  assert.doesNotMatch(efter, /data-sammenfald="s-[a-f0-9]{8}"/);
});
