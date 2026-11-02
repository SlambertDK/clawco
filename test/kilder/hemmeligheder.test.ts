// KC-0132: the one secret module. App-level keys go to the host's .env (an
// allowlist, mode 0600, process env updated in memory); per-source credentials
// to $KC_DATA_DIR/hemmeligheder/<kilde>.json (dir 0700, files 0600). A value is
// never returned, logged or put in an error message — key name and length only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  fjernKildeHemmelighed, gemKildeHemmelighed, HemmelighedFejl, laesKildeHemmelighed, lavAgentNoegleSkriver, saetAgentMiljoeNoegle, saetMiljoeNoegle, TILLADTE_NOEGLER,
} from '../../src/kilder/hemmeligheder.ts';

const VAERDI = 'GOCSPX-hemmelig-vaerdi-1234567890';

async function medMappe(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-hemmeligheder-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Everything written to the console while `fn` runs. */
async function konsol(fn: () => Promise<unknown>): Promise<string> {
  const linjer: string[] = [];
  const gemt = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(gemt) as (keyof typeof gemt)[]) console[k] = (...a: unknown[]) => { linjer.push(a.map(String).join(' ')); };
  try { await fn().catch((e: unknown) => { linjer.push(String(e), (e as Error)?.stack ?? ''); }); } finally { Object.assign(console, gemt); }
  return linjer.join('\n');
}

test('saetMiljoeNoegle writes an allowlisted key to the env file (mode 0600), keeps the other lines, updates the env and returns key + length only', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, '.env');
    await writeFile(fil, 'KC_PORT=8750\n# kommentar\nKC_GOOGLE_CLIENT_ID=gammel\n', 'utf8');
    const env: Record<string, string | undefined> = {};
    const svar = await saetMiljoeNoegle('KC_GOOGLE_CLIENT_ID', VAERDI, { fil, env });
    assert.deepEqual(svar, { noegle: 'KC_GOOGLE_CLIENT_ID', laengde: VAERDI.length });
    assert.equal(env['KC_GOOGLE_CLIENT_ID'], VAERDI);
    const tekst = await readFile(fil, 'utf8');
    assert.deepEqual(tekst.split('\n').filter(Boolean), ['KC_PORT=8750', '# kommentar', `KC_GOOGLE_CLIENT_ID=${VAERDI}`]);
    assert.equal((await stat(fil)).mode & 0o777, 0o600);
    assert.deepEqual((await readdir(dir)).sort(), ['.env'], 'no tmp file left behind');
  });
});

test('saetMiljoeNoegle creates the env file when there is none and appends a new key', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, '.env');
    const env: Record<string, string | undefined> = {};
    await saetMiljoeNoegle('KC_GOOGLE_CLIENT_SECRET', VAERDI, { fil, env });
    assert.equal(await readFile(fil, 'utf8'), `KC_GOOGLE_CLIENT_SECRET=${VAERDI}\n`);
    assert.equal((await stat(fil)).mode & 0o777, 0o600);
  });
});

test('saetMiljoeNoegle refuses a key outside the allowlist and touches nothing', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, '.env');
    const env: Record<string, string | undefined> = {};
    assert.ok(!TILLADTE_NOEGLER.includes('PATH' as never));
    await assert.rejects(saetMiljoeNoegle('PATH', '/tmp', { fil, env }), HemmelighedFejl);
    await assert.rejects(saetMiljoeNoegle('KC_HERMES_URL', VAERDI, { fil, env }), HemmelighedFejl);
    assert.deepEqual(env, {});
    await assert.rejects(stat(fil));
  });
});

test('saetMiljoeNoegle refuses values that would break the env file, without echoing them', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, '.env');
    for (const daarlig of ['', 'a b', 'a\nKC_X=1', 'a#b', 'a"b', "a'b", 'x'.repeat(2001)]) {
      await assert.rejects(saetMiljoeNoegle('KC_GOOGLE_CLIENT_ID', daarlig, { fil, env: {} }), (e: Error) => {
        assert.ok(e instanceof HemmelighedFejl);
        if (daarlig.length > 2) assert.ok(!e.message.includes(daarlig), 'the message never carries the value');
        return true;
      });
    }
  });
});

test('no secret value reaches the console, an error or a return value', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, '.env');
    const ud = await konsol(async () => {
      const a = await saetMiljoeNoegle('KC_GOOGLE_CLIENT_ID', VAERDI, { fil, env: {} });
      const b = await gemKildeHemmelighed(dir, 'falsk-mail', { adgangskode: VAERDI });
      assert.ok(!JSON.stringify([a, b]).includes(VAERDI));
      await saetMiljoeNoegle('KC_NOPE', VAERDI, { fil, env: {} });
    });
    assert.ok(!ud.includes(VAERDI), 'console and the error carry no value');
  });
});

test('per-source secrets: dir 0700, file 0600, round-trip, key + length out, remove', async () => {
  await medMappe(async (dir) => {
    const svar = await gemKildeHemmelighed(dir, 'falsk-mail', { brugernavn: 'ella', adgangskode: VAERDI });
    assert.deepEqual(svar, [{ noegle: 'brugernavn', laengde: 4 }, { noegle: 'adgangskode', laengde: VAERDI.length }]);
    const mappe = path.join(dir, 'hemmeligheder');
    assert.equal((await stat(mappe)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(mappe, 'falsk-mail.json'))).mode & 0o777, 0o600);
    assert.deepEqual(await laesKildeHemmelighed(dir, 'falsk-mail'), { brugernavn: 'ella', adgangskode: VAERDI });
    assert.equal(await laesKildeHemmelighed(dir, 'ukendt'), null);
    assert.equal(await fjernKildeHemmelighed(dir, 'falsk-mail'), true);
    assert.equal(await laesKildeHemmelighed(dir, 'falsk-mail'), null);
    assert.equal(await fjernKildeHemmelighed(dir, 'falsk-mail'), false);
  });
});

test('per-source secrets refuse an id that could leave the folder and non-string values', async () => {
  await medMappe(async (dir) => {
    for (const id of ['../ud', 'a/b', '', 'A']) await assert.rejects(gemKildeHemmelighed(dir, id, { x: 'y' }), HemmelighedFejl);
    await assert.rejects(gemKildeHemmelighed(dir, 'ok', { x: 1 } as unknown as Record<string, string>), HemmelighedFejl);
    await assert.rejects(laesKildeHemmelighed(dir, '../ud'), HemmelighedFejl);
  });
});

// KC-0127: Clawco's own key to Hermes is entered in Start's step 2 on a keyless install (KC-0156).
test('KC_HERMES_API_KEY is an app-level key Start may set', async () => {
  await medMappe(async (dir) => {
    const env: Record<string, string | undefined> = {};
    assert.deepEqual(await saetMiljoeNoegle('KC_HERMES_API_KEY', VAERDI, { fil: path.join(dir, '.env'), env }), { noegle: 'KC_HERMES_API_KEY', laengde: VAERDI.length });
    assert.equal(env['KC_HERMES_API_KEY'], VAERDI);
  });
});

// KC-0127: the agent's env file (Hermes' own .env) takes the provider key names the caller allows, through the same writer.
test('saetAgentMiljoeNoegle writes only an allowed name, 0600, never into the process env', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, 'hermes.env');
    await writeFile(fil, 'API_SERVER_KEY=x\n');
    const tilladte = ['OPENAI_API_KEY'];
    assert.deepEqual(await saetAgentMiljoeNoegle(fil, 'OPENAI_API_KEY', VAERDI, tilladte), { noegle: 'OPENAI_API_KEY', laengde: VAERDI.length });
    assert.equal(await readFile(fil, 'utf8'), `API_SERVER_KEY=x\nOPENAI_API_KEY=${VAERDI}\n`);
    assert.equal((await stat(fil)).mode & 0o777, 0o600);
    assert.equal(process.env['OPENAI_API_KEY'], undefined);
    await assert.rejects(saetAgentMiljoeNoegle(fil, 'API_SERVER_KEY', VAERDI, tilladte), (e: unknown) => e instanceof HemmelighedFejl && !e.message.includes(VAERDI));
    await assert.rejects(saetAgentMiljoeNoegle(fil, 'KC_HERMES_API_KEY', VAERDI, ['KC_HERMES_API_KEY']), HemmelighedFejl, 'never one of Clawco\'s own keys');
    await assert.rejects(saetAgentMiljoeNoegle(fil, 'OPENAI_API_KEY', 'med mellemrum', tilladte), HemmelighedFejl);
  });
});

// KC-0127: the writer the composition root injects into the agent: the same write path, null where it cannot write.
test('lavAgentNoegleSkriver writes through saetAgentMiljoeNoegle, answers null for a file it cannot write, refuses other names', async () => {
  await medMappe(async (dir) => {
    const fil = path.join(dir, 'hermes.env');
    const skriv = lavAgentNoegleSkriver(fil, ['OPENAI_API_KEY']);
    assert.deepEqual(await skriv('OPENAI_API_KEY', VAERDI), { noegle: 'OPENAI_API_KEY', laengde: VAERDI.length });
    assert.equal((await stat(fil)).mode & 0o777, 0o600);
    await assert.rejects(skriv('API_SERVER_KEY', VAERDI), HemmelighedFejl);
    assert.equal(await lavAgentNoegleSkriver(path.join(dir, 'findes-ikke', '.env'), ['OPENAI_API_KEY'])('OPENAI_API_KEY', VAERDI), null);
  });
});

// KC-0125: what this module reads or writes is registered with the one redactor, so a failure message elsewhere cannot carry it.
test('KC-0125: a connector credential is masked after it is stored and after it is read back; an env key after it is saved', async () => {
  const { redigeres, MASKE, nulstilRegistrerede } = await import('../../src/graenser/redaktion.ts');
  await medMappe(async (dir) => {
    nulstilRegistrerede();
    await gemKildeHemmelighed(dir, 'mail-imap', { adgangskode: 'imap-pass-0123456789' });
    assert.equal(redigeres('fejl imap-pass-0123456789', {}), `fejl ${MASKE}`);
    nulstilRegistrerede();
    assert.equal(redigeres('fejl imap-pass-0123456789', {}), 'fejl imap-pass-0123456789');
    await laesKildeHemmelighed(dir, 'mail-imap');
    assert.equal(redigeres('fejl imap-pass-0123456789', {}), `fejl ${MASKE}`);
    nulstilRegistrerede();
    await saetMiljoeNoegle('KC_GOOGLE_CLIENT_SECRET', 'GOCSPX-klient-hemmelighed-9', { fil: path.join(dir, '.env'), env: {} });
    assert.equal(redigeres('x GOCSPX-klient-hemmelighed-9', {}), `x ${MASKE}`);
    nulstilRegistrerede();
  });
});
