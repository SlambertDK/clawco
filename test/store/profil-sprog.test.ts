// KC-0170: a refused profile is explained in the request's language; Danish is word for word what it was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFIL_TEKSTER, ProfilFejl, validerProfil } from '../../src/store/profil.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { form, ensStrenge, tomme } from '../fixtures/sprog-tjek.ts';

const fejl = (raw: unknown): string => { try { validerProfil(raw); } catch (e) { if (e instanceof ProfilFejl) return e.message; throw e; } return ''; };

test('English has exactly Danish\'s keys; nothing empty or copied', () => {
  assert.deepEqual(form(PROFIL_TEKSTER.en), form(PROFIL_TEKSTER.da));
  assert.deepEqual(tomme(PROFIL_TEKSTER.da), []);
  assert.deepEqual(ensStrenge(PROFIL_TEKSTER.da, PROFIL_TEKSTER.en), []);
});

test('Danish, chosen or not, says what it said; English says it in English', () => {
  const sager: [unknown, string, string][] = [
    [null, 'Profilen mangler', 'The profile is missing'],
    [{ navn: ' ', sprog: 'da', husstand: 'alene' }, 'Skriv hvad du hedder', 'Write what you are called'],
    [{ navn: 'x'.repeat(61), sprog: 'da', husstand: 'alene' }, 'Navnet må højst være 60 tegn', 'The name can be at most 60 characters'],
    [{ navn: 'Ib', sprog: 'sv', husstand: 'alene' }, 'Vælg dansk eller engelsk', 'Choose Danish or English'],
    [{ navn: 'Ib', sprog: 'da', husstand: 'to' }, 'Vælg alene eller husstand', 'Choose alone or household'],
  ];
  for (const [raw, da, en] of sager) {
    assert.equal(fejl(raw), da);
    assert.equal(medSprog('da', () => fejl(raw)), da);
    assert.equal(medSprog('en', () => fejl(raw)), en);
  }
});
