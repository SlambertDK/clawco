// KC-0170 slice 3: what the owner reads when support is switched on or off and refused, in English or Danish. Danish (no
// language chosen, or da chosen) is byte for byte what stoette.ts and identitet.ts said before (literals captured before the strings moved);
// English has no Danish word left; the names (Clawco Sky, stoette.json) stay. konto.ts is unchanged on purpose (operator
// and log words only).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { kontoFraMiljoe, type KontoIndstilling } from '../../src/identitet/konto.ts';
import { lavStoetteLager, slaaStoetteFra, startStoette, StoetteFejl, verificerBevis } from '../../src/identitet/stoette.ts';
import { IDENTITET_TEKSTER } from '../../src/identitet/tekster.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { erAfvist, HUSSTAND_ULAESELIG, hvemKigger, hvemKontoKigger, husstandUlaeselig, vaelgKigger, type Anmodning } from '../../src/identitet/identitet.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { DANSK, ensStrenge, form, tomme } from '../fixtures/sprog-tjek.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-stoette-tekst-'));
after(() => rm(rod, { recursive: true, force: true }));

const V = JSON.parse(readFileSync(new URL('../fixtures/konto-vektorer.json', import.meta.url), 'utf8')) as { tenant: string; nu: number; noegler: Record<'a' | 'b', { froe: string; offentlig: string; id: string }> };
const K = kontoFraMiljoe({ KC_IDENTITET: 'konto', KC_KONTO_TENANT: V.tenant, KC_KONTO_PUBKEY: V.noegler.a.offentlig, KC_KONTO_GATEWAY: '10.20.0.2' }) as KontoIndstilling;
const PRIVAT = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(V.noegler.a.froe, 'hex')]), format: 'der', type: 'pkcs8' });
const signer = (krop: unknown, id = V.noegler.a.id): string => {
  const til = `s1.${id}.${Buffer.from(JSON.stringify(krop)).toString('base64url')}`;
  return `${til}.${sign(null, Buffer.from(til), PRIVAT).toString('base64url')}`;
};
const NU = V.nu;
const krop = (o: Record<string, unknown> = {}) => ({ t: V.tenant, a: '41', g: NU - 1, u: NU - 1 + 3600, h: 1, r: 'Mail viser ingenting', iat: NU, ...o });
const EJER: Person = { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: 'maja@example.com', navn: 'Maja', rolle: 'medlem' };
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

test("English has exactly Danish's keys and shapes; no string is empty; none copied over", () => {
  const { da, en } = IDENTITET_TEKSTER;
  assert.deepEqual(form(en), form(da));
  assert.deepEqual(tomme(tabel(da)), []);
  assert.deepEqual(tomme(tabel(en)), []);
  // 'stoette.json' lines and the one name are the same on purpose only where the whole string would be; none is.
  assert.deepEqual(ensStrenge(tabel(da), tabel(en)), []);
});

const refusal = async (kor: () => Promise<unknown>): Promise<string> => {
  const e = await kor().then(() => undefined, (x: unknown) => x);
  assert.ok(e instanceof StoetteFejl, 'a StoetteFejl');
  return e.message;
};

const SKAL_DA = {
  medlemTil: 'Kun ejeren kan slå support til.',
  ingenKonto: 'Support kan kun slås til gennem Clawco Sky.',
  forkert: 'Support blev ikke slået til: beviset har forkert form.',
  medlemFra: 'Kun ejeren kan slå support fra.',
};
const SKAL_EN = {
  medlemTil: 'Only the owner can switch support on.',
  ingenKonto: 'Support can only be switched on through Clawco Sky.',
  forkert: 'Support was not switched on: the proof has the wrong form.',
  medlemFra: 'Only the owner can switch support off.',
};

async function hverRefusal(): Promise<Record<keyof typeof SKAL_DA, string>> {
  const lager = lavStoetteLager(rod);
  const nu = new Date(NU * 1000);
  return {
    medlemTil: await refusal(() => startStoette(lager, { person: MEDLEM, bevis: signer(krop()), konto: K, nu })),
    ingenKonto: await refusal(() => startStoette(lager, { person: EJER, bevis: signer(krop()), konto: undefined, nu })),
    forkert: await refusal(() => startStoette(lager, { person: EJER, bevis: 'nonsens', konto: K, nu })),
    medlemFra: await refusal(() => slaaStoetteFra(lager, { person: MEDLEM, nu })),
  };
}

test('Danish, with no language chosen and with da chosen, is byte for byte what the owner was told before', async () => {
  assert.deepEqual(await hverRefusal(), SKAL_DA);
  assert.deepEqual(await medSprog('da', hverRefusal), SKAL_DA);
});

test('English: the owner reads English refusals; Clawco Sky stays', async () => {
  const en = await medSprog('en', hverRefusal);
  assert.deepEqual(en, SKAL_EN);
  for (const t of Object.values(en)) assert.ok(!DANSK.test(t), t);
});

test('the reason a bevis was refused is quoted in the owner\'s language', () => {
  const bevisIkkeJson = (() => {
    const til = `s1.${V.noegler.a.id}.${Buffer.from('ikke json').toString('base64url')}`;
    return `${til}.${sign(null, Buffer.from(til), PRIVAT).toString('base64url')}`;
  })();
  const sager: [unknown, keyof typeof IDENTITET_TEKSTER.da][] = [
    [undefined, 'bevisForkertForm'],
    [signer(krop(), 'AAAAAAAAAAA'), 'ukendtNoegle'],
    [bevisIkkeJson, 'bevisIkkeJson'],
    [signer(krop({ t: 'anden-tenant' })), 'andenTenant'],
    [signer(krop({ iat: NU - 61 })), 'bevisForGammelt'],
    [signer(krop({ h: 2 })), 'ugyldigVarighed'],
    [signer(krop({ u: NU - 1, g: NU - 3601, h: 1 })), 'alleredeUdloebet'],
    [signer(krop({ r: 'to\nlinjer' })), 'ugyldigGrund'],
  ];
  const DA_ORD: Record<string, string> = { bevisForkertForm: 'beviset har forkert form', ukendtNoegle: 'ukendt nøgle-id', bevisIkkeJson: 'beviset er ikke JSON', andenTenant: 'en anden tenant', bevisForGammelt: 'beviset er for gammelt', ugyldigVarighed: 'ugyldig varighed', alleredeUdloebet: 'allerede udløbet', ugyldigGrund: 'ugyldig grund' };
  for (const [bevis, nogle] of sager) {
    for (const sprog of ['da', 'en'] as const) {
      const r = medSprog(sprog, () => verificerBevis(bevis, K, NU));
      assert.equal(r.ok, false);
      if (r.ok) continue;
      assert.equal(r.grund, IDENTITET_TEKSTER[sprog][nogle] as string, `${nogle} ${sprog}`);
      if (sprog === 'da') assert.equal(r.grund, DA_ORD[nogle]);
      else assert.ok(!DANSK.test(r.grund), r.grund);
    }
  }
});

test('a damaged stoette.json reads in the language of the request; Danish as before', async () => {
  const mappe = await mkdtemp(path.join(rod, 'skadet-'));
  const lager = lavStoetteLager(mappe);
  const fil = path.join(mappe, 'stoette.json');
  const maal: [string, string, string][] = [
    ['{ ikke json', 'stoette.json er ikke gyldig JSON', 'stoette.json is not valid JSON'],
    ['[]', 'stoette.json er ikke et objekt', 'stoette.json is not an object'],
    [JSON.stringify({ x: 1 }), 'stoette.json har et ukendt felt', 'stoette.json has an unknown field'],
    [JSON.stringify({ id: 'abc', givet: '', udloeber: '', timer: 1, grund: '', sessioner: [] }), 'stoette.json: ugyldigt id', 'stoette.json: invalid id'],
  ];
  for (const [indhold, da, en] of maal) {
    await writeFile(fil, indhold, 'utf8');
    assert.equal(await refusal(() => lager.laes()), da);
    assert.equal(await medSprog('da', () => refusal(() => lager.laes())), da);
    assert.equal(await medSprog('en', () => refusal(() => lager.laes())), en);
  }
});

// ---- the "no access" refusals of identitet.ts -----------------------------------------------------------------------

const ANM = (h: Record<string, string>, peer = '127.0.0.1'): Anmodning => ({ headers: new Headers(h), peer });
const HUS = { personer: [EJER, MEDLEM] };
const hvorfor = (x: unknown): { afvist: number; hvorfor: string } => {
  assert.ok(erAfvist(x as Person), 'refused');
  return x as { afvist: number; hvorfor: string };
};
/** Every refusal the layer answers: [name, status, how to provoke it]. */
const AFVISNINGER: [string, number, () => unknown][] = [
  ['tailnetKun', 403, () => hvemKigger(ANM({ 'tailscale-funnel-request': '?1' }), HUS)],
  ['ukendtPerson', 401, () => hvemKigger(ANM({}), HUS)],
  ['ikkeInviteret', 403, () => hvemKigger(ANM({ 'tailscale-user-login': 'fremmed@example.com' }), HUS)],
  ['kontoUkendt', 401, () => hvemKontoKigger(ANM({}, '10.20.0.2'), HUS, K, NU)],
  ['husstandUlaeselig', 503, () => hvemKontoKigger(ANM({ 'clawco-konto': signerV1() }, '10.20.0.2'), null, K, NU)],
];
function signerV1(): string {
  const til = `v1.${V.noegler.a.id}.${Buffer.from(JSON.stringify({ t: V.tenant, k: '7', e: 'henrik@example.com', iat: NU })).toString('base64url')}`;
  return `${til}.${sign(null, Buffer.from(til), PRIVAT).toString('base64url')}`;
}
const DA_AFVIST: Record<string, string> = {
  tailnetKun: 'Clawco kan kun åbnes fra dit eget Tailscale-net, ikke fra internettet.',
  ukendtPerson: 'Clawco ved ikke, hvem du er. Åbn siden over Tailscale fra din egen enhed.',
  ikkeInviteret: 'Du er ikke inviteret endnu. Bed ejeren af husstanden om en invitation.',
  kontoUkendt: 'Clawco ved ikke, hvem du er.',
  husstandUlaeselig: 'Husstanden kunne ikke læses, så Clawco ved ikke, hvem du er. Ejeren skal rette husstand.json.',
};

test('no access: Danish, with no language chosen and with da chosen, is byte for byte what the refusal said before', () => {
  for (const [navn, status, kor] of AFVISNINGER) {
    assert.deepEqual({ status: hvorfor(kor()).afvist, tekst: hvorfor(kor()).hvorfor }, { status, tekst: DA_AFVIST[navn] }, navn);
    assert.equal(hvorfor(medSprog('da', kor)).hvorfor, DA_AFVIST[navn], navn);
  }
  assert.equal(HUSSTAND_ULAESELIG, DA_AFVIST['husstandUlaeselig']);
  assert.equal(husstandUlaeselig(), DA_AFVIST['husstandUlaeselig']);
});

test('no access: English reads as English; the status stays; the log words stay Danish (never shown)', () => {
  for (const [navn, status, kor] of AFVISNINGER) {
    const r = hvorfor(medSprog('en', kor));
    assert.equal(r.afvist, status, navn);
    assert.ok(!DANSK.test(r.hvorfor), `${navn}: ${r.hvorfor}`);
    assert.notEqual(r.hvorfor, DA_AFVIST[navn], navn);
    assert.match(r.hvorfor, /Clawco|household/);
  }
  assert.notEqual(husstandUlaeselig(), medSprog('en', () => husstandUlaeselig()));
  const konto = medSprog('en', () => hvemKontoKigger(ANM({}, '10.20.0.2'), HUS, K, NU)) as { log?: string };
  assert.equal(konto.log, 'konto afvist: ingen Clawco-Konto', 'the log line is the operator\'s and stays Danish-keyed as before');
  // A fixed person (the test world) still never answers Funnel traffic, in either language.
  const fast = vaelgKigger({ fast: EJER }, () => new Date(NU * 1000));
  assert.equal(hvorfor(medSprog('en', () => fast(ANM({ 'tailscale-funnel-request': '?1' }), HUS))).hvorfor, 'Clawco can only be opened from your own Tailscale network, not from the internet.');
});
