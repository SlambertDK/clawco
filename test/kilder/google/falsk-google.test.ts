// KC-0135: the fake Google knows scopes, so two connectors can be tested on one
// Google app: incremental consent (include_granted_scopes) merges what the
// account already granted, a token only opens the API its scope covers, and
// the ID token names the account when openid and email were asked for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIL_KRAV, KALENDER_KRAV, type ScopeKrav, SCOPE_ADRESSE, SCOPE_KALENDER, SCOPE_MAIL, byttKode, forny, lavVerifier, samtykkeUrl, scopesFra, udfordring } from '../../../src/kilder/google/oauth.ts';
import { falskGoogle } from '../../../src/kilder/google/falsk-google.ts';

const KLIENT = { id: 'klient-1.apps.googleusercontent.com', hemmelighed: 'GOCSPX-k' };
const TILBAGE = 'https://kontrol.example/api/kilder/x/tilbage';

/** One consent round on the fake: URL → redirect with a code → code exchanged. */
async function loginMed(g: ReturnType<typeof falskGoogle>, scopes: readonly string[], udvid: boolean, krav: ScopeKrav) {
  const verifier = lavVerifier();
  const url = samtykkeUrl({ klientId: KLIENT.id, tilbage: TILBAGE, state: 's', udfordring: udfordring(verifier), scopes, udvid });
  const kode = new URL(g.samtykke(url)).searchParams.get('code')!;
  return byttKode({ hent: g.hent, klient: KLIENT, kode, verifier, tilbage: TILBAGE, krav });
}

test('incremental consent: mail asked on top of a calendar grant (udvid) holds both; asked alone it holds mail only', async () => {
  const g = falskGoogle({ klient: KLIENT, kalendere: () => [] });
  const kal = await loginMed(g, [SCOPE_KALENDER], false, KALENDER_KRAV);
  assert.deepEqual(kal.scopes, [SCOPE_KALENDER]);
  const flettet = await loginMed(g, [SCOPE_MAIL, ...SCOPE_ADRESSE], true, MAIL_KRAV);
  assert.ok(flettet.scopes.includes(SCOPE_KALENDER) && flettet.scopes.includes(SCOPE_MAIL));
  assert.deepEqual(g.givetScopes().sort(), [SCOPE_KALENDER, SCOPE_MAIL, 'email', 'openid'].sort());
  const alene = await loginMed(falskGoogle({ klient: KLIENT, kalendere: () => [] }), [SCOPE_MAIL, ...SCOPE_ADRESSE], false, MAIL_KRAV);
  assert.ok(!alene.scopes.includes(SCOPE_KALENDER));
});

test('the account\'s address comes in the ID token when openid and email were granted, and never without them', async () => {
  const g = falskGoogle({ klient: KLIENT, kalendere: () => [], konto: 'ella@gmail.example' });
  assert.equal((await loginMed(g, [SCOPE_MAIL, ...SCOPE_ADRESSE], false, MAIL_KRAV)).adresse, 'ella@gmail.example');
  assert.equal((await loginMed(falskGoogle({ klient: KLIENT, kalendere: () => [] }), [SCOPE_MAIL], false, MAIL_KRAV)).adresse, undefined);
  assert.equal(g.udstedteIdTokens().length, 1);
});

test('the fake refuses a consent request for a scope it does not know', () => {
  const g = falskGoogle({ klient: KLIENT, kalendere: () => [] });
  const url = samtykkeUrl({ klientId: KLIENT.id, tilbage: TILBAGE, state: 's', udfordring: 'u', scopes: ['https://www.googleapis.com/auth/drive'] });
  assert.throws(() => g.samtykke(url), /ugyldigt|samtykke/);
});

test('a refresh token keeps its scopes; afvis(scopes) refuses only the matching grant (invalid_grant)', async () => {
  const g = falskGoogle({ klient: KLIENT, kalendere: () => [], kendteRefresh: ['1//kal'], kendteMailRefresh: ['1//mail'], afvis: (s) => s.includes(SCOPE_MAIL) });
  const kal = await forny({ hent: g.hent, klient: KLIENT, refresh: '1//kal' });
  assert.ok(g.erAdgang(kal.adgang, SCOPE_KALENDER));
  assert.ok(!g.erAdgang(kal.adgang, SCOPE_MAIL));
  await assert.rejects(forny({ hent: g.hent, klient: KLIENT, refresh: '1//mail' }), /Google/);
  assert.deepEqual(scopesFra('a b'), ['a', 'b']);
});

test('the calendar API answers 403 to a token without the calendar scope', async () => {
  const g = falskGoogle({ klient: KLIENT, kalendere: () => [], kendteMailRefresh: ['1//mail'] });
  const t = await forny({ hent: g.hent, klient: KLIENT, refresh: '1//mail' });
  const r = await g.hent('https://www.googleapis.com/calendar/v3/users/me/calendarList', { headers: { authorization: `Bearer ${t.adgang}` } });
  assert.equal(r.status, 403);
});
