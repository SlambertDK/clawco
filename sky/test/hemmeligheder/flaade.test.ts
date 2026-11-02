// KC-0181 wiring: the fleet's key seam over the real envelope code and a real (PGlite) database, driven
// through the real provisioner and afprovisioner with the in-memory fleet. Plus the master-key gate:
// without SKY_MASTERNOEGLE no tenant is ever started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afled } from '../../src/hemmeligheder/afled.ts';
import { flaadeNoegler, ingenMasternoegle } from '../../src/hemmeligheder/flaade.ts';
import { NOEGLE_STI, type KoerselMedInput } from '../../src/hemmeligheder/levering.ts';
import { destruerUdloebne, hentDataNoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { afprovisioner } from '../../src/fleet/afprovisioner.ts';
import { provisioner } from '../../src/fleet/provisioner.ts';
import { bestil, hentTenant, laase } from '../../src/fleet/tilstand.ts';
import { falskFlaade, opsaet } from '../fleet/hjaelp.ts';
import { former, ring } from './hjaelp.ts';

type Kald = { argv: string[]; input: string };

async function opsaetMedNoegler() {
  const o = await opsaet();
  const r = ring();
  const kald: Kald[] = [];
  const koer: KoerselMedInput = async (argv, input) => { kald.push({ argv, input }); return { kode: 0, ud: '', fejl: '' }; };
  const noegler = flaadeNoegler({ db: o.db, ring: r, koer, nu: o.ur.nu });
  const f = falskFlaade();
  const laas = laase();
  const pdeps = { db: o.db, flaade: f, noegler, billede: 'clawco:test', laas, nu: o.ur.nu, vent: async () => {}, sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async () => {} };
  return { o, r, kald, noegler, f, pdeps, laas };
}

test('a tenant is provisioned with its data key: the row exists wrapped, and the lager key reached docker exec on stdin only', async () => {
  const { o, r, kald, pdeps } = await opsaetMedNoegler();
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  assert.equal((await provisioner(pdeps, slug)).tilstand, 'klar');
  const [raekke] = await o.db.query<{ status: string; kek_version: number }>('SELECT status, kek_version FROM hemmeligheder.tenant_noegle WHERE tenant = $1', [slug]);
  assert.deepEqual({ ...raekke }, { status: 'aktiv', kek_version: 1 });
  const lager = afled(await hentDataNoegle(o.db, r, slug), slug, 'lager').aaben();
  assert.equal(kald.length, 1);
  assert.deepEqual(kald[0]!.argv.slice(0, 4), ['docker', 'exec', '-i', `clawco-t-${slug}`]);
  assert.equal(kald[0]!.argv.at(-1), NOEGLE_STI);
  assert.equal(kald[0]!.input, `${lager.toString('base64')}\n`);
  for (const form of former(lager)) assert.ok(!kald[0]!.argv.join(' ').includes(form), 'never in argv');
  await o.db.close();
});

test('sikr never re-keys: a second provisioning pass keeps the same data key', async () => {
  const { o, r, noegler } = await opsaetMedNoegler();
  await noegler.sikr('hus-aaaaaaaa');
  const foer = (await hentDataNoegle(o.db, r, 'hus-aaaaaaaa')).aaben().toString('hex');
  await noegler.sikr('hus-aaaaaaaa');
  assert.equal((await hentDataNoegle(o.db, r, 'hus-aaaaaaaa')).aaben().toString('hex'), foer);
  await o.db.close();
});

test('deleting the tenant marks its key for purge 30 days out; the daily job destroys it and the key can never be opened again', async () => {
  const { o, r, pdeps } = await opsaetMedNoegler();
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await provisioner(pdeps, slug);
  const slettetDa = o.ur.nu();
  await afprovisioner({ db: o.db, flaade: pdeps.flaade, noegler: pdeps.noegler, laas: pdeps.laas, nu: o.ur.nu, udAfGateway: async () => {} }, slug);
  assert.equal((await hentTenant(o.db, slug))!.tilstand, 'slettet');
  const [m] = await o.db.query<{ status: string; destrueres: Date | string }>('SELECT status, destrueres FROM hemmeligheder.tenant_noegle WHERE tenant = $1', [slug]);
  assert.equal(m!.status, 'slettet');
  assert.equal(new Date(m!.destrueres).getTime(), slettetDa.getTime() + 30 * 86_400_000);
  await hentDataNoegle(o.db, r, slug); // still opens during the retention window
  assert.equal(await destruerUdloebne(o.db, new Date(slettetDa.getTime() + 29 * 86_400_000)), 0);
  assert.equal(await destruerUdloebne(o.db, new Date(slettetDa.getTime() + 31 * 86_400_000)), 1);
  await assert.rejects(hentDataNoegle(o.db, r, slug), /destrueret/);
  await o.db.close();
});

test('deleting a tenant that never got a key is quiet (nothing to revoke)', async () => {
  const { o, noegler } = await opsaetMedNoegler();
  await noegler.markerSlettet('hus-zzzzzzzz');
  assert.equal((await o.db.query('SELECT 1 FROM hemmeligheder.tenant_noegle')).length, 0);
  await o.db.close();
});

test('without a master key (SKY_MASTERNOEGLE) nothing is provisioned: the key step refuses first, the fleet is never asked, no Docker call', async () => {
  const o = await opsaet();
  const f = falskFlaade();
  const koerte: string[][] = [];
  const noegler = ingenMasternoegle({ db: o.db, koer: async (a) => { koerte.push(a); return { kode: 0, ud: '', fejl: '' }; }, nu: o.ur.nu });
  const { slug } = await bestil(o.db, { kontoId: o.kontoId, driver: 'lokal', nu: o.ur.nu() });
  await assert.rejects(
    provisioner({ db: o.db, flaade: f, noegler, billede: 'clawco:test', laas: laase(), nu: o.ur.nu, vent: async () => {}, sundhed: async () => ({ ok: true, sha: 'abc' }), iGateway: async () => {} }, slug),
    /SKY_MASTERNOEGLE/,
  );
  assert.deepEqual(f.kald, [], 'the fleet was never asked to start anything');
  assert.deepEqual(koerte, []);
  const t = (await hentTenant(o.db, slug))!;
  assert.equal(t.tilstand, 'bestilt');
  assert.match(t.fejl ?? '', /SKY_MASTERNOEGLE/);
  await assert.rejects(noegler.lever(slug, 'clawco-t-x'), /SKY_MASTERNOEGLE/);
  await noegler.markerSlettet(slug); // a deletion needs no master key and is never held up by its absence
  await o.db.close();
});
