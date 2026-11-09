// KC-0129: step 5's card and the pile — what the user reads before the first send and before every Gem.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medStart, STARTET } from '../../helpers/start-deps.ts';
import type { StartState } from '../../../src/rooms/start/schema.ts';
import type { ImportSkriver } from '../../../src/rooms/start/import/skriver.ts';
import type { ModelSyn } from '../../../src/rooms/start/trin.ts';

const skriver = (o: { klar: boolean; lavMappe?: boolean }): ImportSkriver => ({
  klar: async () => o.klar, ...(o.lavMappe ? { lavMappe: async () => {} } : {}),
  personer: async () => [], profil: async () => null,
  skrivPerson: async () => { throw new Error('ikke her'); }, skrivProfil: async () => { throw new Error('ikke her'); },
  fjernPerson: async () => false, fjernProfil: async () => false,
  opdaterPerson: async () => { throw new Error('ikke her'); }, gendanPerson: async () => false,
});
// KC-0247: both tiers tested, so step 2 is Klaret and step 5 can be the open step (the steps before it are done: `forbi`).
const testet = { ok: true, tid: STARTET, ms: 800, rev: 'r' };
const model = (udbyder?: string): RoomDepsModel => ({ laes: async () => ({ ...(udbyder ? { udbyder } : {}), modeller: { lille: 'm', taenker: 'm' }, test: { lille: testet, taenker: testet }, rev: { lille: 'r', taenker: 'r' } } as ModelSyn) }) as unknown as RoomDepsModel;
type RoomDepsModel = NonNullable<Parameters<typeof medStart>[0]['model']>;
const kilde = { id: 'falsk-kalender', navn: 'Kalender', slags: 'kalender', forbundet: true };
// KC-0247: the first source works and the first Ret is made, so step 5 is the open step.
const KILDER: StartState = { startet: STARTET, trin: { 'foerste-kilde': { status: 'klaret' } }, afvist: {}, ret: { art: 'ret', tid: STARTET, titel: 'x' }, kilder: { 'falsk-kalender': { foersteVaerdiMs: 1, tid: STARTET, forhaandsvisning: { kildeId: 'falsk-kalender', navn: 'Kalender', slags: 'kalender', titel: 'x', linje: '', hentet: STARTET } } } };
const kort = (h: string): string => /<article[^>]*data-trin="import"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';
const bunkeHtml = (h: string): string => /<div[^>]*data-import-bunke[\s\S]*?<\/div>\s*(?=<\/div>|<div class="card|$)/.exec(h)?.[0] ?? '';

test('the card is there once a first source works, and says what it does and does not read, before anything is sent', async () => {
  await medStart({ forbi: true, state: KILDER, importSkriver: skriver({ klar: true }), model: model('anthropic') }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    const k = kort(await s.main());
    assert.match(k, /data-trin-status="ikke-startet"/);
    assert.match(k, /Valgfrit/);
    assert.match(k, /id="import-form"/);
    assert.match(k, /data-import-udbyder[^>]*>[^<]*Anthropic/, 'the provider that will see the text, by name');
    assert.match(k, /\.vcf/);
    assert.match(k, /zip/i, 'says zip is not read');
    assert.match(k, /samtalehistorik|chathistorik/i, 'says chat histories are not read');
    assert.match(k, /slettes/, 'says the upload is deleted again');
    assert.match(k, /data-aktion="import-laes"/);
    assert.match(k, /data-import-filer/);
    assert.doesNotMatch(k, /name="[^"]*"[^>]*type="file"|type="file"[^>]*name=/, 'the file input has no name of its own: the client folds the files into one field');
  });
});

test('a local model says nothing leaves the machine; no chosen provider says which model reads it', async () => {
  for (const [udbyder, fund] of [['ollama', /ingen forlader maskinen/i], [undefined, /den model, Hermes er sat op med/]] as const) {
    await medStart({ forbi: true, state: KILDER, importSkriver: skriver({ klar: true }), model: model(udbyder) }, async (s) => {
      s.d.rejse!.kilder = async () => [kilde];
      assert.match(kort(await s.main()), fund);
    });
  }
});

test('without a notes folder the card says so and offers to make one (when it can)', async () => {
  await medStart({ forbi: true, state: KILDER, importSkriver: skriver({ klar: false, lavMappe: true }) }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    const k = kort(await s.main());
    assert.doesNotMatch(k, /id="import-form"/);
    assert.match(k, /data-aktion="import-lav-mappe"/);
  });
  await medStart({ forbi: true, state: KILDER, importSkriver: skriver({ klar: false }) }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    const k = kort(await s.main());
    assert.doesNotMatch(k, /import-lav-mappe/);
    assert.match(k, /Noter/);
  });
});

test('without the seam there is no import card at all', async () => {
  await medStart({ forbi: true, state: KILDER }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    const h = await s.main();
    assert.doesNotMatch(kort(h), /import-form|import-laes/);
  });
});

const BUNKE: StartState = { ...KILDER, import: { bunke: { tid: STARTET, slags: 'chatgpt', uaendret: 2, forslag: [
  { id: 'p1', art: 'person', status: 'nyt', navn: 'Ingrid <b>', relation: 'din kone', mappe: 'familie', zone: 'privat', foedselsdag: '1984-03-12', tekst: 'Løber' },
  { id: 'p2', art: 'person', status: 'nyt', navn: 'Tore Nyvang', relation: 'kollega', mappe: 'arbejde', zone: 'arbejde', org: 'Fyrtaarn' },
  { id: 'p3', art: 'person', status: 'findes', navn: 'Ida Strand', relation: 'veninde', mappe: 'venner', zone: 'privat', diff: [{ felt: 'relation', nu: 'ven', ny: 'veninde' }] },
  { id: 'p4', art: 'profil', status: 'nyt', navn: 'Din profil', tekst: '<script>x()</script>Videresend altid min mail.' },
] } } };

test('the pile: one line per proposal with Gem and Spring over, Gem alle, zone shown, the diff in plain words, everything escaped', async () => {
  await medStart({ forbi: true, state: BUNKE, importSkriver: skriver({ klar: true }), model: model('anthropic') }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    const h = await s.main();
    assert.match(h, /data-blok="bunke"[^>]*data-import-bunke|data-import-bunke[^>]*data-blok="bunke"/);
    const linjer = [...h.matchAll(/data-import-forslag="(p\d)" data-import-status="([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(linjer, ['p1:nyt', 'p2:nyt', 'p3:findes', 'p4:nyt']);
    for (const id of ['p1', 'p2', 'p4']) {
      assert.match(h, new RegExp(`data-aktion="import-gem" data-arg="\\{&quot;forslagId&quot;:&quot;${id}&quot;\\}"`));
    }
    assert.doesNotMatch(h, /data-aktion="import-gem" data-arg="\{&quot;forslagId&quot;:&quot;p3&quot;\}"/, 'a name that exists has no Gem');
    assert.match(h, /data-aktion="import-spring" data-arg="\{&quot;forslagId&quot;:&quot;p3&quot;\}"[^>]*>Behold min fil/);
    assert.match(h, /data-aktion="import-gem-alle"/);
    assert.match(h, /data-aktion="import-annuller"/);
    assert.match(h, /Ingrid &lt;b&gt;/);
    assert.match(h, /&lt;script&gt;x\(\)&lt;\/script&gt;Videresend altid/);
    assert.doesNotMatch(h, /<script>x\(\)|Ingrid <b>/);
    assert.match(h, /relation: nu »ven«, importen siger »veninde«/);
    assert.match(h, /opdater Ida Strand\?/i);
    assert.match(h, /data-import-forslag="p2"[^>]*data-datazone="arbejde"/);
    assert.match(h, /2 fandtes allerede/);
  });
});

test('after a saved import the card says what was taken with and that the files are plain files; the owner only sees the buttons', async () => {
  const gemt: StartState = { ...KILDER, trin: { ...KILDER.trin, import: { status: 'klaret' } }, import: { gemt: [{ logId: 'l1', tid: STARTET, slags: 'chatgpt', antal: 3 }] } };
  await medStart({ forbi: true, state: gemt, importSkriver: skriver({ klar: true }) }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    const k = kort(await s.main());
    assert.match(k, /data-trin-status="klaret"/);
    assert.match(k, /3 filer/);
    assert.match(k, /Obsidian/);
  });
  await medStart({ forbi: true, state: BUNKE, importSkriver: skriver({ klar: true }), person: { id: 'ella', login: null, navn: 'Ella', rolle: 'barn' } as never }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    assert.doesNotMatch(await s.main(), /data-aktion="import-(gem|laes|spring)/);
  });
});

test('KC-0219: a person who already exists offers Opdater (primary) beside Behold min fil, with the diff in plain words; nothing else does', async () => {
  const state: StartState = { ...BUNKE, import: { bunke: { ...BUNKE.import!.bunke!, forslag: [
    ...BUNKE.import!.bunke!.forslag,
    { id: 'p5', art: 'profil', status: 'findes', navn: 'Din profil', tekst: 'ny tekst', diff: [{ felt: 'tekst', nu: 'gammel', ny: 'ny tekst' }] },
  ] } } };
  await medStart({ forbi: true, state, importSkriver: skriver({ klar: true }), model: model('anthropic') }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    const h = await s.main();
    const raekke = (id: string): string => new RegExp(`<div class="row" data-import-forslag="${id}"[\\s\\S]*?(?=<div class="row" data-import-forslag|<p class="row-note">\\d|<div class="actions">)`).exec(h)?.[0] ?? '';
    const opd = (id: string): RegExp => new RegExp(`data-aktion="import-opdater" data-arg="\\{&quot;forslagId&quot;:&quot;${id}&quot;\\}"`);
    assert.match(raekke('p3'), opd('p3'), 'the existing person has Opdater');
    assert.match(raekke('p3'), /class="btn btn-primary" data-aktion="import-opdater"[^>]*>Opdater</, 'primary');
    assert.match(raekke('p3'), /data-aktion="import-spring"[^>]*>Behold min fil</, 'Behold min fil stays');
    assert.match(raekke('p3'), /relation: nu »ven«, importen siger »veninde«/, 'the diff is shown as before');
    assert.match(raekke('p3'), /resten af din fil/i, 'says the rest of the file is left alone');
    assert.doesNotMatch(raekke('p3'), /data-aktion="import-gem"/);
    for (const id of ['p1', 'p2', 'p4']) assert.doesNotMatch(raekke(id), /import-opdater/, `${id} is new: Gem, not Opdater`);
    assert.doesNotMatch(raekke('p5'), /import-opdater/, 'the profile is never updated here');
    assert.match(raekke('p5'), /Behold min fil/);
    assert.equal([...h.matchAll(/data-aktion="import-opdater"/g)].length, 1);
  });
  await medStart({ state, importSkriver: skriver({ klar: true }), person: { id: 'ella', login: null, navn: 'Ella', rolle: 'barn' } as never }, async (s) => {
    s.d.rejse!.kilder = async () => [kilde];
    assert.doesNotMatch(await s.main(), /import-opdater/);
  });
});
