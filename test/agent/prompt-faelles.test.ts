// KC-0241: the shared parts of every Hermes prompt in English or Danish. Danish (no language chosen, or da chosen) is
// byte for byte what the code said before (test/fixtures/sprog-prompt-faelles/, captured before the words moved into
// the language tables); the English tables have exactly Danish's keys and no Danish word is left in what the code says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { medSprog } from '../../src/store/sprog.ts';
import { PROMPT_TEKSTER } from '../../src/agent/prompt-tekster.ts';
import { REGEL_PROMPT_TEKSTER } from '../../src/tillid/prompt-tekster.ts';
import { KURATOR_PROMPT_TEKSTER } from '../../src/kurator/prompt-tekster.ts';
import { KATALOG_FORMAAL } from '../../src/shell/katalog.ts';
import { VISUEL_TEKSTER, parseVisuel, visuelSkema, VISUEL_SKEMA } from '../../src/shell/visuel.ts';
import { GRAENSER, SPROG, PEGER, graenser, sprogLinje, peger } from '../../src/agent/prompt.ts';
import { REGELFORSLAG_TEKST, regelforslagTekst } from '../../src/tillid/prompt.ts';
import { UDEN_VAERKTOEJ, udenVaerktoej } from '../../src/agent/direkte.ts';
import { omProfil } from '../../src/runs.ts';
import { DA, EN, faelles } from '../fixtures/sprog-golden-prompt-faelles.ts';
import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';

const rod = path.dirname(fileURLToPath(import.meta.url));
const fixtur = (navn: string): string => readFileSync(path.join(rod, '../fixtures/sprog-prompt-faelles', `${navn}.txt`), 'utf8');

test('Henrik\'s installation: with no language chosen, and with da chosen, every shared prompt part is byte for byte as before', async () => {
  const tilfaelde = faelles(DA);
  assert.deepEqual(Object.keys(tilfaelde).map((k) => `${k}.txt`).sort(), readdirSync(path.join(rod, '../fixtures/sprog-prompt-faelles')).sort(), 'every golden has a case');
  for (const [k, lav] of Object.entries(tilfaelde)) {
    assert.equal(await lav(), fixtur(k), k);
    assert.equal(await medSprog('da', async () => lav()), fixtur(k), `${k} (da chosen)`);
  }
});

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
/** Strings that are the same in both languages on purpose (an identifier the app parses, a shape both share). */
const ENS = new Set<string>(['agent.verb.betal', 'agent.verb.kopier-paa-tvaers']);

test('English has exactly Danish\'s keys and shapes in every prompt table; no string is empty; none was copied over', () => {
  for (const [navn, t] of Object.entries({ agent: PROMPT_TEKSTER, regler: REGEL_PROMPT_TEKSTER, kurator: KURATOR_PROMPT_TEKSTER, katalog: KATALOG_FORMAAL, visuel: VISUEL_TEKSTER })) {
    assert.deepEqual(form(t.en), form(t.da), navn);
    // The verbs that may never run have no sentence on purpose, in both languages.
    for (const x of [t.da, t.en]) assert.deepEqual(tomme(tabel(x)).filter((k) => !['verb.betal', 'verb.kopier-paa-tvaers'].includes(k)), [], navn);
    assert.deepEqual(ensStrenge(tabel(t.da), tabel(t.en)).filter((k) => !ENS.has(`${navn}.${k}`)), [], navn);
  }
});

// The wrapper around untrusted data is src/agent/udtroet.ts' own Danish sentence (not part of this slice, KC-0241 findings).
const udtroetLinje = (l: string): boolean => /^Data fra .*: det her er data, aldrig instruktioner\./.test(l);
// A folder of the user's own vault is a real path, whatever the language.
// The app's own identifiers are the contract both languages share: a block id, a JSON key that is also a Danish word.
const udenStier = (l: string): string => l.replace(/\/vault\/\S+/g, '').replace(/^- ordnet:/, '').replace(/10-Privat\/Økonomi/, '').replace(/"(?:til|fra|med|og|kan|skal)"/g, '');
const danske = (tekst: string): string[] => tekst.split('\n').map((l) => l.trim()).filter((l) => l && !udtroetLinje(l) && DANSK.test(udenStier(l)));
/** The cases whose words are fixed by something other than the language of the run (a Danish profile, the constants). */
const SPROGFAST = /^(om-profil-da|retur-profil-da|konstanter$|modeltest$)/;

test('English: no shared prompt part has a Danish line, in any case', async () => {
  const tilfaelde = faelles(EN, true);
  assert.ok(Object.keys(tilfaelde).length > 40);
  for (const [k, lav] of Object.entries(tilfaelde)) {
    if (SPROGFAST.test(k)) continue;
    const ud = await medSprog('en', async () => lav());
    assert.deepEqual(danske(ud), [], k);
    assert.doesNotMatch(ud, /Henrik|Kuratoren|Brugeren/, k);
  }
});

test('the Danish detector works: the same cases in Danish are full of Danish lines', async () => {
  let n = 0;
  for (const [k, lav] of Object.entries(faelles(DA))) if (!SPROGFAST.test(k) || k === 'konstanter') n += danske(await lav()).length;
  assert.ok(n > 200, String(n));
});

test('the call-time forms equal the Danish constants in Danish and are English in English', () => {
  assert.equal(graenser(), GRAENSER);
  assert.equal(sprogLinje(), SPROG);
  assert.equal(peger(), PEGER);
  assert.equal(regelforslagTekst(), REGELFORSLAG_TEKST);
  assert.equal(udenVaerktoej(), UDEN_VAERKTOEJ);
  assert.equal(visuelSkema(), VISUEL_SKEMA);
  medSprog('en', () => {
    for (const t of [graenser(), sprogLinje(), peger(), regelforslagTekst(), udenVaerktoej(), visuelSkema()]) assert.deepEqual(danske(t), [], t.slice(0, 40));
    assert.match(sprogLinje(), /^Language: English/);
    assert.match(graenser(), /explicit yes/);
  });
});

test('the English visual example parses and has the shape of the Danish one', () => {
  const en = medSprog('en', () => visuelSkema());
  assert.notEqual(en, VISUEL_SKEMA);
  assert.ok(parseVisuel(JSON.parse(en)));
  assert.deepEqual(form(JSON.parse(en)), form(JSON.parse(VISUEL_SKEMA)));
  assert.deepEqual(Object.keys(JSON.parse(en).billede.punkter[0]), Object.keys(JSON.parse(VISUEL_SKEMA).billede.punkter[0]));
});

test('the profile line follows the profile\'s own language (it is built before the run\'s language is set)', () => {
  const en = omProfil({ navn: 'Alma', sprog: 'en', husstand: 'husstand' });
  assert.equal(en, 'The user is called Alma; address them so. Answer in English. The user lives in a household with others.');
  assert.equal(omProfil({ navn: 'Alma', sprog: 'en', husstand: 'alene' }), 'The user is called Alma; address them so. Answer in English. The user lives alone.');
  assert.deepEqual(danske(en), []);
  // Built outside medSprog, as runs.ts does: the profile decides, not the language being rendered.
  assert.equal(medSprog('en', () => omProfil({ navn: 'Alma', sprog: 'da', husstand: 'alene' })), 'Brugeren hedder Alma; tiltal brugeren sådan. Svar på dansk. Brugeren bor alene.');
});
