import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laesConfig, STANDARD_BASEDOMAIN, STANDARD_PORT } from '../src/config.ts';

const gyldig = {
  SKY_DATABASE_URL: 'postgres://sky:hemmelig-adgang@127.0.0.1:5432/sky',
  SKY_PUBLIC_URL: 'https://kontrol.example.test',
};

/** Asserts laesConfig refuses `env`, names `noegle`, and never echoes a value from `env`. */
function afviser(env: Record<string, string | undefined>, noegle: string): void {
  assert.throws(() => laesConfig(env), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.match(err.message, new RegExp(noegle));
    for (const v of Object.values(env)) if (v && v.length > 3) assert.ok(!err.message.includes(v), `fejlen viser værdien af en nøgle: ${err.message}`);
    assert.ok(!err.message.includes('hemmelig'), 'fejlen viser en del af en hemmelighed');
    return true;
  });
}

test('a valid environment gives the config with defaults for port and tenant domain', () => {
  const c = laesConfig(gyldig);
  assert.deepEqual(c, { databaseUrl: gyldig.SKY_DATABASE_URL, publicUrl: gyldig.SKY_PUBLIC_URL, port: STANDARD_PORT, basedomain: STANDARD_BASEDOMAIN, rpId: 'kontrol.example.test', dev: false, flaade: { driver: 'ingen' }, tilmelding: 'invitation' });
  assert.equal(STANDARD_PORT, 8781);
  assert.equal(STANDARD_BASEDOMAIN, 'clawco' + '.work');
});

test('explicit port and tenant domain are used', () => {
  const c = laesConfig({ ...gyldig, SKY_PORT: '9000', SKY_BASEDOMAIN: 'sky.example.test' });
  assert.equal(c.port, 9000);
  assert.equal(c.basedomain, 'sky.example.test');
});

test('a missing SKY_DATABASE_URL refuses to start and names the key', () => {
  afviser({ SKY_PUBLIC_URL: gyldig.SKY_PUBLIC_URL }, 'SKY_DATABASE_URL');
  afviser({ ...gyldig, SKY_DATABASE_URL: '   ' }, 'SKY_DATABASE_URL');
});

test('a missing SKY_PUBLIC_URL refuses to start and names the key', () => {
  afviser({ SKY_DATABASE_URL: gyldig.SKY_DATABASE_URL }, 'SKY_PUBLIC_URL');
});

test('an invalid database URL names the key, never the value (it can hold a password)', () => {
  afviser({ ...gyldig, SKY_DATABASE_URL: 'mysql://sky:hemmelig@db/sky' }, 'SKY_DATABASE_URL');
});

test('an invalid public URL, port or tenant domain names the key and not the value', () => {
  afviser({ ...gyldig, SKY_PUBLIC_URL: 'ikke en adresse' }, 'SKY_PUBLIC_URL');
  afviser({ ...gyldig, SKY_PUBLIC_URL: 'ftp://kontrol.example.test' }, 'SKY_PUBLIC_URL');
  afviser({ ...gyldig, SKY_PORT: 'abcd' }, 'SKY_PORT');
  afviser({ ...gyldig, SKY_PORT: '70000' }, 'SKY_PORT');
  afviser({ ...gyldig, SKY_BASEDOMAIN: 'https://sky.example.test' }, 'SKY_BASEDOMAIN');
});

test('the passkey relying-party id is the public host by default (gate G7), or a dotted suffix of it', () => {
  assert.equal(laesConfig({ ...gyldig, SKY_PUBLIC_URL: 'http://localhost:8782' }).rpId, 'localhost');
  assert.equal(laesConfig({ ...gyldig, SKY_RP_ID: 'example.test' }).rpId, 'example.test');
  assert.equal(laesConfig({ ...gyldig, SKY_RP_ID: 'kontrol.example.test' }).rpId, 'kontrol.example.test');
});

test('an SKY_RP_ID that does not cover the public host, a bare top-level name or an IP host refuses to start', () => {
  afviser({ ...gyldig, SKY_RP_ID: 'andet.test' }, 'SKY_RP_ID');
  afviser({ ...gyldig, SKY_RP_ID: 'test' }, 'SKY_RP_ID');
  afviser({ ...gyldig, SKY_RP_ID: 'ple.test' }, 'SKY_RP_ID');
  afviser({ ...gyldig, SKY_PUBLIC_URL: 'http://127.0.0.1:8781' }, 'SKY_PUBLIC_URL');
});

test('SKY_DEV=1 turns on dev mode (the outbox page); anything else leaves it off', () => {
  assert.equal(laesConfig({ ...gyldig, SKY_DEV: '1' }).dev, true);
  assert.equal(laesConfig({ ...gyldig, SKY_DEV: 'true' }).dev, false);
  assert.equal(laesConfig(gyldig).dev, false);
});

test('KC-0212: SKY_FLAADE picks the fleet driver; ingen by default, lokal needs the tenant image and the gateway\'s public key', () => {
  const P = 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg';
  assert.deepEqual(laesConfig({ ...gyldig, SKY_FLAADE: 'ingen' }).flaade, { driver: 'ingen' });
  assert.deepEqual(laesConfig({ ...gyldig, SKY_FLAADE: 'hetzner' }).flaade, { driver: 'hetzner' });
  assert.deepEqual(laesConfig({ ...gyldig, SKY_FLAADE: 'lokal', SKY_TENANT_BILLEDE: 'ghcr.io/slambertdk/clawco:1.2.3', SKY_KONTO_PUBKEY: P }).flaade, { driver: 'lokal', billede: 'ghcr.io/slambertdk/clawco:1.2.3', netvaerk: 'clawco-sky', kontoPubkey: P });
  assert.deepEqual(laesConfig({ ...gyldig, SKY_FLAADE: 'lokal', SKY_TENANT_BILLEDE: 'clawco:test', SKY_TENANT_NETVAERK: 'eget-net', SKY_KONTO_PUBKEY: P }).flaade, { driver: 'lokal', billede: 'clawco:test', netvaerk: 'eget-net', kontoPubkey: P });
  afviser({ ...gyldig, SKY_FLAADE: 'lokal' }, 'SKY_TENANT_BILLEDE');
  afviser({ ...gyldig, SKY_FLAADE: 'lokal', SKY_TENANT_BILLEDE: 'clawco test; rm', SKY_KONTO_PUBKEY: P }, 'SKY_TENANT_BILLEDE');
  afviser({ ...gyldig, SKY_FLAADE: 'lokal', SKY_TENANT_BILLEDE: 'clawco:test', SKY_TENANT_NETVAERK: 'host', SKY_KONTO_PUBKEY: P }, 'SKY_TENANT_NETVAERK');
  afviser({ ...gyldig, SKY_FLAADE: 'sky' }, 'SKY_FLAADE');
});

test('KC-0182: lokal refuses to start without a well-formed SKY_KONTO_PUBKEY (tenants would refuse every request)', () => {
  const lokal = { ...gyldig, SKY_FLAADE: 'lokal', SKY_TENANT_BILLEDE: 'clawco:test' };
  afviser(lokal, 'SKY_KONTO_PUBKEY');
  for (const v of ['kort', 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=', 'A6EHv+POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg', 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbgA', 'A6EHv_POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbh']) {
    afviser({ ...lokal, SKY_KONTO_PUBKEY: v }, 'SKY_KONTO_PUBKEY');
  }
  // Not needed when nothing is provisioned here.
  assert.equal(laesConfig({ ...gyldig, SKY_FLAADE: 'hetzner' }).flaade.driver, 'hetzner');
});

test('KC-0183: the base domain localhost (tenants on <slug>.localhost) is for local development only', () => {
  assert.equal(laesConfig({ ...gyldig, SKY_DEV: '1', SKY_BASEDOMAIN: 'localhost' }).basedomain, 'localhost');
  afviser({ ...gyldig, SKY_BASEDOMAIN: 'localhost' }, 'SKY_BASEDOMAIN');
  afviser({ ...gyldig, SKY_DEV: '1', SKY_BASEDOMAIN: 'intranet' }, 'SKY_BASEDOMAIN');
});

test('KC-0198: SKY_TILMELDING is invitation (closed beta) by default or open; anything else refuses to start and names the key', () => {
  assert.equal(laesConfig(gyldig).tilmelding, 'invitation');
  assert.equal(laesConfig({ ...gyldig, SKY_TILMELDING: 'invitation' }).tilmelding, 'invitation');
  assert.equal(laesConfig({ ...gyldig, SKY_TILMELDING: 'open' }).tilmelding, 'open');
  assert.throws(() => laesConfig({ ...gyldig, SKY_TILMELDING: 'aaben' }), /SKY_TILMELDING er ugyldig/);
});

// KC-0185: the backup store's settings. All four R2 keys or none (none = backups off, said at start); the
// jurisdiction defaults to eu; the two credentials are removed from the environment once read, so a child process
// (docker, pg_dump) never inherits them; nothing prints the secret.
test('KC-0185: no R2 keys means backups are off; a partial set names what is missing, never a value', async () => {
  const { laesKopiConfig } = await import('../src/config.ts');
  assert.deepEqual(laesKopiConfig({}), { kopi: null, fejl: null });
  const delvis = laesKopiConfig({ SKY_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', SKY_R2_SECRET_ACCESS_KEY: 'meget-hemmelig-vaerdi' });
  assert.equal(delvis.kopi, null);
  assert.match(delvis.fejl!, /SKY_R2_ACCESS_KEY_ID/);
  assert.match(delvis.fejl!, /SKY_R2_BUCKET/);
  assert.ok(!delvis.fejl!.includes('meget-hemmelig-vaerdi'));
});

test('KC-0185: a full R2 set gives the EU jurisdiction by default, removes the credentials from env, and hides the secret', async () => {
  const { laesKopiConfig } = await import('../src/config.ts');
  const env: Record<string, string | undefined> = {
    SKY_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef', SKY_R2_ACCESS_KEY_ID: 'noegle-id-123', SKY_R2_SECRET_ACCESS_KEY: 'meget-hemmelig-vaerdi', SKY_R2_BUCKET: 'clawco-sky-backup',
    SKY_KOPI_TESTTENANT: 'hus-testtest',
  };
  const { kopi, fejl } = laesKopiConfig(env);
  assert.equal(fejl, null);
  assert.equal(kopi!.jurisdiktion, 'eu');
  assert.equal(kopi!.bucket, 'clawco-sky-backup');
  assert.equal(kopi!.testTenant, 'hus-testtest');
  assert.equal(kopi!.hemmelighed(), 'meget-hemmelig-vaerdi');
  assert.ok(!JSON.stringify(kopi).includes('meget-hemmelig-vaerdi'));
  assert.equal(env['SKY_R2_SECRET_ACCESS_KEY'], undefined);
  assert.equal(env['SKY_R2_ACCESS_KEY_ID'], undefined);
  assert.equal(laesKopiConfig({ ...env, SKY_R2_ACCESS_KEY_ID: 'x', SKY_R2_SECRET_ACCESS_KEY: 'y', SKY_R2_JURISDICTION: '' }).kopi!.jurisdiktion, '');
  assert.match(laesKopiConfig({ ...env, SKY_R2_ACCESS_KEY_ID: 'x', SKY_R2_SECRET_ACCESS_KEY: 'y', SKY_R2_JURISDICTION: 'e.u' }).fejl!, /SKY_R2_JURISDICTION/);
  assert.match(laesKopiConfig({ ...env, SKY_R2_ACCESS_KEY_ID: 'x', SKY_R2_SECRET_ACCESS_KEY: 'y', SKY_KOPI_TESTTENANT: 'Ikke Gyldig' }).fejl!, /SKY_KOPI_TESTTENANT/);
});
