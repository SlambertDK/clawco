// KC-0215 through createApp: a member adds a bil, rum or ting, an owner of it edits it, and removes it again. Direct
// taps (no Hermes): input validated against the stored state, every write logged, a removal needs the red yes.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { TOM_HUSSTAND } from '../src/hushold/schema.ts';
import { nyForespoergsel } from '../src/hushold/foresp.ts';
import { ELLA, HENRIK, RIKKE, LOERDAG, lavBil, MAJA, nyRod, SEED, START, type BilApp, type Hvem } from './helpers/bil.ts';

const rod = await nyRod();
after(() => rm(rod, { recursive: true, force: true }));

const opret = (a: BilApp, p: Hvem, b: Record<string, unknown>) => a.aktion(p, 'tilfoej-ressource', b);
const ret = (a: BilApp, p: Hvem, b: Record<string, unknown>) => a.aktion(p, 'ret-ressource', b);
const fjern = (a: BilApp, p: Hvem, ressourceId: string, medJa = true) => a.aktion(p, 'fjern-ressource', { ressourceId }, medJa);
const book = (a: BilApp, p: Hvem, ressourceId: string, fra = '10:00', til = '12:00') => a.aktion(p, 'book', { ressourceId, dag: LOERDAG, start: fra, slut: til, titel: 'Tur' });
const ressourcer = async (a: BilApp) => (await a.state()).ressourcer;
const find = async (a: BilApp, id: string) => (await ressourcer(a)).find((r) => r.id === id);
const linjer = async (a: BilApp, ejer: string) => (await a.log()).filter((e) => e.ejer === ejer).map((e) => e.tekst);

test('create: a rum and a ting with their kind, owners and a log line in the right words; a car stays the default', async () => {
  const a = await lavBil(rod, 'opret');
  assert.equal((await opret(a, HENRIK, { navn: 'Gæsteværelset', slags: 'rum', 'ejer-henrik': 'on', 'ejer-rikke': 'on' })).status, 202);
  assert.equal((await opret(a, RIKKE, { navn: 'Stigen', slags: 'ting', 'ejer-rikke': 'on' })).status, 202);
  assert.equal((await opret(a, RIKKE, { navn: 'Varevognen', 'ejer-rikke': 'on' })).status, 202, 'no kind = bil');
  const rum = (await find(a, 'gaestevaerelset'))!;
  assert.deepEqual([rum.navn, rum.slags, rum.ejere, rum.kalender], ['Gæsteværelset', 'rum', ['henrik', 'rikke'], []]);
  assert.equal((await find(a, 'stigen'))!.slags, 'ting');
  assert.equal((await find(a, 'varevognen'))!.slags, 'bil');
  assert.ok((await linjer(a, 'henrik')).includes('Du tilføjede et rum: Gæsteværelset'));
  assert.ok((await linjer(a, 'rikke')).includes('Du tilføjede en ting: Stigen'));
  assert.ok((await linjer(a, 'rikke')).includes('Du tilføjede en bil: Varevognen'));
});

test('create is validated: only the kinds of the list (not person), a child may not', async () => {
  const a = await lavBil(rod, 'opret-validering');
  for (const slags of ['person', 'fly', 5, '']) {
    const r = await opret(a, HENRIK, { navn: 'Noget', slags, 'ejer-henrik': 'on' });
    assert.equal(r.status, slags === '' ? 202 : 400, String(slags));
  }
  assert.equal((await opret(a, ELLA, { navn: 'Hytten', slags: 'rum', 'ejer-ella': 'on' })).status, 403);
});

const kreds = (...ider: string[]) => Object.fromEntries(ider.map((i) => [`ejer-${i}`, 'on']));

test('edit: name, kind and owners change; the owners before and after hear about it, the others do not', async () => {
  const a = await lavBil(rod, 'ret');
  const r = await ret(a, HENRIK, { ressourceId: 'lille-bil', navn: 'Den grønne bil', slags: 'bil', ...kreds('henrik', 'maja') });
  assert.equal(r.status, 202);
  const x = (await find(a, 'lille-bil'))!;
  assert.deepEqual([x.navn, x.slags, x.ejere, x.id], ['Den grønne bil', 'bil', ['henrik', 'maja'], 'lille-bil']);
  assert.ok((await linjer(a, 'henrik')).some((t) => /^Du rettede Den grønne bil/.test(t)));
  assert.ok((await linjer(a, 'rikke')).some((t) => /Henrik rettede Den grønne bil/.test(t)), 'rikke was an owner before');
  assert.ok((await linjer(a, 'maja')).some((t) => /Henrik rettede Den grønne bil/.test(t)), 'maja is an owner now');
  assert.deepEqual((await linjer(a, 'ella')).filter((t) => /grønne/.test(t)), []);
  // kind change, and the bookings stay
  await book(a, HENRIK, 'lille-bil');
  assert.equal((await ret(a, HENRIK, { ressourceId: 'lille-bil', navn: 'Den grønne bil', slags: 'ting', ...kreds('henrik') })).status, 202);
  const y = (await find(a, 'lille-bil'))!;
  assert.deepEqual([y.slags, y.ejere, y.kalender.length], ['ting', ['henrik'], 1]);
});

test('edit: who may — an adult in the circle or the household owner; a child, a guest-listed owner or an outsider may not', async () => {
  const a = await lavBil(rod, 'ret-hvem');
  const b = (extra: Record<string, unknown> = {}) => ({ ressourceId: 'lille-bil', navn: 'Lille', ...kreds('henrik', 'rikke'), ...extra });
  assert.equal((await ret(a, MAJA, b())).status, 403, 'a member outside the circle');
  assert.equal((await ret(a, ELLA, b())).status, 403, 'a child');
  assert.equal((await ret(a, RIKKE, b())).status, 202, 'a member in the circle');
  assert.equal((await ret(a, HENRIK, b({ navn: 'Lille igen' }))).status, 202);
  const seed = { ...SEED, ressourcer: [{ ...SEED.ressourcer[1]!, ejere: ['rikke'] }] };
  const b2 = await lavBil(rod, 'ret-hvem-husejer', { seed });
  assert.equal((await ret(b2, HENRIK, { ressourceId: 'lille-bil', navn: 'Lille', ...kreds('rikke') })).status, 202, 'the household owner outside the circle');
});

test('edit is validated: unknown id, name, duplicate name, owners, kind, a person-resource keeps its kind', async () => {
  const seed = { ...SEED, ressourcer: [...SEED.ressourcer, { id: 'ella', navn: 'Ella', slags: 'person' as const, ejere: ['henrik'], kalender: [] }] };
  const a = await lavBil(rod, 'ret-validering', { seed });
  const b = (extra: Record<string, unknown> = {}) => ({ ressourceId: 'lille-bil', navn: 'Lille', slags: 'bil', ...kreds('henrik'), ...extra });
  assert.equal((await ret(a, HENRIK, b({ ressourceId: 'findes-ikke' }))).status, 404);
  assert.equal((await ret(a, HENRIK, b({ navn: '' }))).status, 400);
  assert.equal((await ret(a, HENRIK, b({ navn: 'x'.repeat(81) }))).status, 400);
  assert.equal((await ret(a, HENRIK, b({ navn: 'den STORE bil' }))).status, 409, 'taken by another, any case');
  assert.equal((await ret(a, HENRIK, b({ navn: 'DEN LILLE BIL' }))).status, 202, 'its own name in another case is fine');
  assert.equal((await ret(a, HENRIK, b({ 'ejer-henrik': '' }))).status, 400, 'no owner');
  assert.equal((await ret(a, HENRIK, b({ 'ejer-henrik': '', 'ejer-farmor': 'on' }))).status, 400, 'a stranger');
  assert.equal((await ret(a, HENRIK, b({ slags: 'person' }))).status, 400, 'cannot become a person');
  assert.equal((await ret(a, HENRIK, b({ slags: 'fly' }))).status, 400);
  assert.equal((await ret(a, HENRIK, { ressourceId: 'ella', navn: 'Ella R', ...kreds('henrik', 'maja') })).status, 202, 'a person-resource is renamed without a kind');
  assert.equal((await find(a, 'ella'))!.slags, 'person');
  assert.equal((await ret(a, HENRIK, { ressourceId: 'ella', navn: 'Ella R', slags: 'bil', ...kreds('henrik') })).status, 400, 'nor change kind');
});

test('edit: an owner with an open clash option on this resource cannot be dropped (they would book what they no longer own)', async () => {
  const a = await lavBil(rod, 'ret-sammenfald');
  await book(a, HENRIK, 'stor-bil', '10:00', '12:00');
  assert.equal((await book(a, MAJA, 'stor-bil', '11:00', '13:00')).status, 202);
  const st = await a.state();
  assert.equal(st.sammenfald.length, 1, 'the clash card');
  const anden = st.sammenfald[0]!.valg.find((v) => v.slags === 'anden');
  assert.ok(anden && anden.slags === 'anden', 'an option to take another car');
  const mål = anden.ressourceId;
  const rest = (await find(a, mål))!.ejere.filter((x) => x !== anden.hvem);
  assert.ok(rest.includes('rikke'));
  const r = await ret(a, RIKKE, { ressourceId: mål, navn: (await find(a, mål))!.navn, slags: 'bil', ...kreds(...rest) });
  assert.equal(r.status, 409);
  assert.ok((await find(a, mål))!.ejere.includes(anden.hvem), 'nothing changed');
});

test('remove: needs the red yes, takes the thing, the own upcoming bookings, a draft; the log and the other owners say so', async () => {
  const a = await lavBil(rod, 'fjern');
  await book(a, HENRIK, 'lille-bil');
  assert.equal((await fjern(a, HENRIK, 'lille-bil', false)).status, 403, 'no yes, no removal');
  assert.ok(await find(a, 'lille-bil'));
  const udkast = { id: 'u1', af: 'rikke', ressourceId: 'lille-bil', start: '2026-11-08T09:00:00.000Z', slut: '2026-11-08T10:00:00.000Z', titel: 'x', oprettet: START.toISOString() };
  await a.store.writeState('husstand', { ...(await a.state()), udkast: [udkast] });
  assert.equal((await fjern(a, HENRIK, 'lille-bil')).status, 202);
  const st = await a.state();
  assert.deepEqual(st.ressourcer.map((r) => r.id), ['stor-bil']);
  assert.deepEqual(st.udkast, []);
  const h = (await linjer(a, 'henrik')).find((t) => /^Du fjernede/.test(t))!;
  assert.match(h, /Den lille bil/);
  assert.match(h, /1 kommende booking/);
  assert.ok((await linjer(a, 'rikke')).some((t) => /Henrik fjernede Den lille bil/.test(t)));
  assert.deepEqual((await linjer(a, 'maja')).filter((t) => /fjernede/.test(t)), [], 'maja never owned it');
  assert.doesNotMatch(await a.side(HENRIK), /data-ressource="lille-bil"/);
  assert.equal((await fjern(a, HENRIK, 'lille-bil')).status, 404, 'once');
});

test('remove: who may, and what blocks it', async () => {
  const a = await lavBil(rod, 'fjern-hvem');
  assert.equal((await fjern(a, MAJA, 'lille-bil')).status, 403, 'outside the circle');
  assert.equal((await fjern(a, ELLA, 'lille-bil')).status, 403, 'a child');
  // another person's upcoming booking
  await book(a, RIKKE, 'lille-bil');
  assert.equal((await fjern(a, HENRIK, 'lille-bil')).status, 409);
  assert.equal((await fjern(a, RIKKE, 'lille-bil')).status, 202, 'her own booking is hers to take with it');
  // an open clash
  await book(a, HENRIK, 'stor-bil', '10:00', '12:00');
  await book(a, MAJA, 'stor-bil', '11:00', '13:00');
  assert.equal((await a.state()).sammenfald.length, 1);
  const r = await fjern(a, HENRIK, 'stor-bil');
  assert.equal(r.status, 409);
  assert.ok(await find(a, 'stor-bil'), 'nothing changed');
});

test('remove: an open request for the thing blocks it; an answered one does not', async () => {
  const f = nyForespoergsel({ id: 'f1', fra: 'maja', til: 'henrik', titel: 'Må jeg låne den lille bil?', ressourceId: 'lille-bil', tid: { start: '2026-11-07T09:00:00.000Z', slut: '2026-11-07T11:00:00.000Z' } }, START);
  const a = await lavBil(rod, 'fjern-foresp', { seed: { ...SEED, forespoergsler: [f] } });
  assert.equal((await fjern(a, HENRIK, 'lille-bil')).status, 409);
  await a.store.writeState('husstand', { ...(await a.state()), forespoergsler: [{ ...f, tilstand: 'afvist', historik: [...f.historik, { tid: START.toISOString(), tilstand: 'afvist', af: 'henrik' }] }] });
  assert.equal((await fjern(a, HENRIK, 'lille-bil')).status, 202);
});

test('a name from a person is escaped on the page and the page still validates after every change', async () => {
  const a = await lavBil(rod, 'escape', { seed: TOM_HUSSTAND });
  assert.equal((await opret(a, HENRIK, { navn: '<img src=x onerror=alert(1)>', slags: 'ting', ...kreds('henrik') })).status, 202);
  const id = (await ressourcer(a))[0]!.id;
  assert.equal((await ret(a, HENRIK, { ressourceId: id, navn: '"><script>x</script>', slags: 'rum', ...kreds('henrik') })).status, 202);
  const h = await a.side(HENRIK);
  assert.doesNotMatch(h, /<img src=x|<script>x/);
  assert.match(h, /&lt;script&gt;x/);
});
