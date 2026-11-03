// KC-0244: the five screens on the front page of clawco.work are captured from the test world. Its content was Danish on
// purpose (KC-0170), so an English capture showed an English interface over Danish cards. The cards the images need now come
// out in English when the profile is English: the moments `engelsk` (the morning), `aften-engelsk` (the evening, with the
// Saturday card) and `kold-engelsk`. Danish moments stay exactly as they were.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALLE_MOMENTER, MOMENTER, froe } from '../../src/testtilstand/indhold.ts';
import { AFTEN_ENGELSK, ENGELSK, momentNr } from '../../src/testtilstand/indhold/fakta.ts';
import { lavTestverden } from '../../src/testtilstand/verden.ts';

const DAG = '2026-10-26';
const rod = await mkdtemp(path.join(tmpdir(), 'kc-site-engelsk-'));
after(() => rm(rod, { recursive: true, force: true }));
const json = (v: unknown): string => JSON.stringify(v);

test('aften-engelsk is the evening with an English profile; it is not part of the day\'s order', () => {
  assert.ok(ALLE_MOMENTER.some((m) => m.id === AFTEN_ENGELSK));
  assert.ok(!MOMENTER.some((m) => m.id === AFTEN_ENGELSK));
  assert.equal(momentNr(AFTEN_ENGELSK), momentNr('aften'));
  assert.deepEqual(froe(AFTEN_ENGELSK, DAG).profil, { navn: 'Henrik', sprog: 'en', husstand: 'husstand' });
  assert.equal(froe('aften', DAG).profil, undefined);
});

test('the Saturday card: English at aften-engelsk (headline, recommendation, button, week letters), unchanged in Danish', () => {
  const en = json(froe(AFTEN_ENGELSK, DAG).rum['hjem']!.state);
  const da = json(froe('aften', DAG).rum['hjem']!.state);
  assert.match(en, /Saturday is free – say yes\?/);
  assert.match(en, /"navn":"mon"[^]*"navn":"sat"/, 'the week picture has English weekday letters');
  assert.ok(!en.includes('Lørdag er fri'));
  assert.match(da, /Lørdag er fri – sig ja\?/);
  assert.match(da, /"navn":"man"[^]*"navn":"lør"/);
  assert.ok(!da.includes('Saturday'));
  // The instruction Hermes runs when the button is pressed stays what the scripted Hermes recognises.
  assert.match(en, /Opret en kalenderaftale lørdag den/);
});

test('the Mail decision card (2401): English at engelsk, Danish unchanged', () => {
  const en = json(froe(ENGELSK, DAG).rum['mail']!.state);
  const da = json(froe('morgen', DAG).rum['mail']!.state);
  assert.match(en, /Confirm: see you at 11/);
  assert.ok(!en.includes('Bekræft: vi ses kl. 11'));
  assert.match(da, /Bekræft: vi ses kl\. 11/);
  assert.ok(!da.includes('Confirm: see you'));
});

test('Husstanden: the request, the cars and the double booking read English at engelsk, Danish unchanged', () => {
  const en = json(froe(ENGELSK, DAG).rum['husstand']!.state);
  const da = json(froe('morgen', DAG).rum['husstand']!.state);
  for (const s of ['Can you pick up Ella from swimming tomorrow?', 'Can do 17.00', 'The big car', 'The little car', 'To Odense', 'Big shop for the birthday']) assert.ok(en.includes(s), s);
  for (const s of ['Kan du hente Ella fra svømning i morgen?', 'Kan 17.00', 'Den store bil', 'Den lille bil', 'Til Odense', 'Storindkøb til fødselsdagen']) assert.ok(!en.includes(s), `English still has ${s}`);
  for (const s of ['Kan du hente Ella fra svømning i morgen?', 'Kan 17.00', 'Den store bil', 'Den lille bil', 'Til Odense', 'Storindkøb til fødselsdagen']) assert.ok(da.includes(s), s);
});

test('rendered through the world: the English moments show English cards, the Danish ones Danish', async () => {
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
  const side = async (id: string, rum: string): Promise<string> => { assert.ok(await v.hop(id), id); const r = await v.app.request(`/rum/${rum}`); assert.equal(r.status, 200); return r.text(); };
  const hjem = await side(AFTEN_ENGELSK, 'hjem');
  assert.match(hjem, /Saturday is free – say yes\?/);
  assert.ok(!hjem.includes('Lørdag er fri'));
  const mail = await side(ENGELSK, 'mail');
  assert.match(mail, /Confirm: see you at 11/);
  const husstand = await side(ENGELSK, 'husstand');
  assert.match(husstand, /Can you pick up Ella from swimming tomorrow\?/);
  assert.match(husstand, /The big car/);
  assert.ok(!husstand.includes('Den store bil'));
  assert.match(await side('aften', 'hjem'), /Lørdag er fri – sig ja\?/);
  assert.match(await side('morgen', 'husstand'), /Den store bil/);
});
