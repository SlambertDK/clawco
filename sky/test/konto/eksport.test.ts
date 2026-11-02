// KC-0206 "Hent alt" in Sky: a 24-hour link for one account (stored as a hash only), and the zip it opens —
// the account data Sky holds plus, for an owner, the tenant's own KC-0146 export untouched as clawco.zip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyDb, ur } from './hjaelp.ts';
import { laesZip } from '../delt/laes-zip.ts';
import { lavZip } from '../../src/delt/zip.ts';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { gemProfil } from '../../src/konto/profil.ts';
import { opretSession } from '../../src/konto/session.ts';
import { opretEksportLink, gyldigtEksportLink, bygEksport, EKSPORT_MS } from '../../src/konto/eksport.ts';
import { ingenHusstand, type Husstand, type Tilknytning } from '../../src/konto/slet.ts';
import type { Database } from '../../src/db/pool.ts';

const husstand = (t: Tilknytning | null): Husstand => ({ async forKonto() { return t; }, async forlad() {} });
const EJER: Tilknytning = { tenantId: 'hus-abcdefgh', rolle: 'ejer', medlemmer: [] };

async function konto(db: Database, email: string, nu: Date): Promise<number> {
  const { konto: k } = await findEllerOpretKonto(db, email, nu);
  return k.id;
}

test('a link lives 24 hours, for the account that made it only, and only its hash is stored', async () => {
  const db = await nyDb();
  const u = ur();
  const a = await konto(db, 'a@example.test', u.nu());
  const b = await konto(db, 'b@example.test', u.nu());
  const t = await opretEksportLink(db, a, u.nu());
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await gyldigtEksportLink(db, t, a, u.nu()), true);
  assert.equal(await gyldigtEksportLink(db, t, b, u.nu()), false, 'another account cannot use it');
  assert.equal(await gyldigtEksportLink(db, 'gaet', a, u.nu()), false);
  assert.equal(await gyldigtEksportLink(db, '', a, u.nu()), false);
  assert.ok(!JSON.stringify(await db.query('SELECT * FROM eksportlink')).includes(t), 'the token itself is never stored');
  assert.equal(EKSPORT_MS, 24 * 3_600_000);
  u.frem(EKSPORT_MS - 1);
  assert.equal(await gyldigtEksportLink(db, t, a, u.nu()), true);
  u.frem(2);
  assert.equal(await gyldigtEksportLink(db, t, a, u.nu()), false, 'expired after 24 h');
  await db.close();
});

test('an owner\'s zip: the account data plus the tenant\'s own Hent alt untouched as clawco.zip', async () => {
  const db = await nyDb();
  const u = ur();
  const id = await konto(db, 'ejer@example.test', u.nu());
  await gemProfil(db, id, { land: 'DK', sprog: 'da', vilkaar: '2026-10', privatliv: '2026-10', nu: u.nu() });
  const s = await opretSession(db, { kontoId: id, metode: 'link', enhed: 'Mac', nu: u.nu() });
  const tenantZip = lavZip([{ navn: 'data/rum/dagen/chat.jsonl', data: Buffer.from('{"tekst":"hej"}\n') }]);
  const kald: number[] = [];
  const zip = await bygEksport({
    db, husstand: husstand(EJER),
    kilder: { tenant: async (k) => { kald.push(k); return tenantZip; }, abonnement: async () => ({ plan: 'sky-solo', fakturaer: [{ nummer: 'F-1' }] }) },
  }, id, u.nu());
  const f = laesZip(zip);
  assert.deepEqual([...f.keys()].sort(), ['LAES-MIG.txt', 'clawco.zip', 'konto/abonnement.json', 'konto/konto.json', 'konto/passkeys.json', 'konto/sessioner.json']);
  assert.ok(f.get('clawco.zip')!.equals(tenantZip));
  assert.deepEqual(kald, [id]);
  const k = JSON.parse(f.get('konto/konto.json')!.toString('utf8'));
  assert.equal(k.email, 'ejer@example.test');
  assert.equal(k.land, 'DK');
  assert.equal(k.vilkaarVersion, '2026-10');
  assert.equal(JSON.parse(f.get('konto/abonnement.json')!.toString('utf8')).fakturaer[0].nummer, 'F-1');
  const alt = [...f.values()].map((b) => b.toString('utf8')).join('\n');
  assert.ok(!alt.includes(s.session.csrf), 'no CSRF value');
  const [hash] = await db.query<{ hash: string }>('SELECT hash FROM session');
  assert.ok(!alt.includes(hash!.hash), 'no session hash');
  await db.close();
});

test('a member or an account without a Clawco gets only the account data; the tenant is never asked', async () => {
  const db = await nyDb();
  const u = ur();
  const id = await konto(db, 'medlem@example.test', u.nu());
  for (const h of [husstand({ tenantId: 'hus-abcdefgh', rolle: 'medlem', medlemmer: [] }), ingenHusstand()]) {
    const zip = await bygEksport({ db, husstand: h, kilder: { tenant: async () => { throw new Error('må ikke kaldes'); } } }, id, u.nu());
    assert.deepEqual([...laesZip(zip).keys()].sort(), ['LAES-MIG.txt', 'konto/konto.json', 'konto/passkeys.json', 'konto/sessioner.json']);
  }
  await db.close();
});

test('an owner whose Clawco cannot be read gets an error, never a zip that silently lacks it', async () => {
  const db = await nyDb();
  const u = ur();
  const id = await konto(db, 'ejer2@example.test', u.nu());
  await assert.rejects(bygEksport({ db, husstand: husstand(EJER), kilder: { tenant: async () => { throw new Error('tenant svarede 502'); } } }, id, u.nu()), /502/);
  await db.close();
});
