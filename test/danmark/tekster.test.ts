// KC-0170 slice 3: the refusals of the Digital Post window in English or Danish. Danish (no language chosen, or da chosen)
// is byte for byte what vindue.ts said before (literals captured before the strings moved); English has no Danish word
// left; the names (Digital Post, mit.dk, e-Boks, borger.dk, Clawco) stay.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afsenderAfvist, DanmarkAfvist, lavDanmark, type MailSyn } from '../../src/danmark/vindue.ts';
import { DANMARK_TEKSTER } from '../../src/danmark/tekster.ts';
import { lavDanmarkLager } from '../../src/danmark/tilstand.ts';
import { medSprog } from '../../src/store/sprog.ts';
import type { Kuvert } from '../../src/kilder/types.ts';
import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-danmark-t-'));
after(() => rm(rod, { recursive: true, force: true }));
const NU = new Date('2026-11-02T10:00:00Z');
const A = 'post@notifikation.digitalpost.example';
const kv = (id: string): Kuvert => ({ id, emne: 'Du har ny Digital Post', fra: 'Digital Post', fraEmail: A, modtaget: new Date(NU.getTime() - 86_400_000).toISOString(), laest: false, flag: false, vedhaeftning: false, messageId: `<${id}@x.example>` });
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

let nr = 0;
const opsaet = (mail: MailSyn) => lavDanmark({ lager: lavDanmarkLager({ dir: path.join(rod, `t${++nr}`) }), laesMail: async () => mail, nu: () => NU, domaener: ['digitalpost.example'], cacheMs: 0 });

/** Every refusal the window has, by name, over a mail seam shaped to provoke it. */
const SCENARIER: Record<string, () => Promise<string>> = {
  afsenderAfvist: () => afvist(() => opsaet({ forbundet: true, kuverter: [kv('1')] }).gem('post@gmail.example', 'mit.dk')),
  vaelgViser: () => afvist(() => opsaet({ forbundet: true, kuverter: [kv('1')] }).gem(A, 'google.com')),
  forbindMailFoerst: () => afvist(() => opsaet({ forbundet: false, kuverter: [] }).gem(A, 'mit.dk')),
  ingenBeskedAtSaette: async () => { const v = opsaet({ forbundet: true, kuverter: [kv('1')] }); return afvist(() => v.setAlle()); },
  kanIkkeLaeseMail: async () => { const v = opsaet({ forbundet: true, kuverter: null }); await v.gem(A, 'mit.dk'); return afvist(() => v.setAlle()); },
  beskedFindesIkke: async () => { const v = opsaet({ forbundet: true, kuverter: [kv('1')] }); await v.gem(A, 'mit.dk'); return afvist(() => v.set('<findes-ikke@x.example>')); },
};
async function afvist(f: () => Promise<unknown>): Promise<string> {
  const e = await f().then(() => undefined, (x: unknown) => x);
  assert.ok(e instanceof DanmarkAfvist, 'a DanmarkAfvist');
  return e.message;
}

const DA: Record<string, string> = {
  afsenderAfvist: 'Det er ikke en adresse, Digital Post sender fra. Skriv adressen i notifikationsmailen (den slutter på digitalpost.dk, e-boks.dk, mit.dk, borger.dk), eller vælg en fra listen.',
  vaelgViser: 'Vælg, hvor du læser din Digital Post: mit.dk, e-Boks eller borger.dk.',
  forbindMailFoerst: 'Forbind først den mail, Digital Post sender notifikationen til.',
  ingenBeskedAtSaette: 'Der er ingen besked at sætte.',
  kanIkkeLaeseMail: 'Clawco kan ikke læse din mail lige nu. Prøv igen om lidt.',
  beskedFindesIkke: 'Den besked findes ikke længere.',
};

test("English has exactly Danish's keys and shapes; no string is empty; none copied over", () => {
  const { da, en } = DANMARK_TEKSTER;
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(tabel(da)), []);
  assert.deepEqual(tomme(tabel(en)), []);
  assert.deepEqual(ensStrenge(tabel(da), tabel(en)), []);
});

test('Danish, with no language chosen and with da chosen, is byte for byte what the window said before', async () => {
  for (const [navn, kor] of Object.entries(SCENARIER)) {
    assert.equal(await kor(), DA[navn], `${navn}, no language`);
    assert.equal(await medSprog('da', kor), DA[navn], `${navn}, da`);
  }
  assert.equal(afsenderAfvist(), DA['afsenderAfvist']);
});

test('English: every refusal reads as English; the status codes and the names stay', async () => {
  for (const [navn, kor] of Object.entries(SCENARIER)) {
    const t = await medSprog('en', kor);
    assert.ok(!DANSK.test(t), `${navn}: ${t}`);
    assert.notEqual(t, DA[navn], navn);
  }
  const t = await medSprog('en', SCENARIER['afsenderAfvist']!);
  assert.match(t, /Digital Post/);
  assert.match(t, /digitalpost\.dk, e-boks\.dk, mit\.dk, borger\.dk/, 'the hint domains are data');
  assert.match(await medSprog('en', SCENARIER['vaelgViser']!), /mit\.dk, e-Boks or borger\.dk/);
  assert.match(await medSprog('en', SCENARIER['kanIkkeLaeseMail']!), /^Clawco /);
  const e = await medSprog('en', async () => opsaet({ forbundet: false, kuverter: [] }).gem(A, 'mit.dk').then(() => null, (x: unknown) => x));
  assert.ok(e instanceof DanmarkAfvist && e.status === 409, 'the status is not a word');
});
