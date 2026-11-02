// KC-0123 (spec D6): what an agent says about a rule is a proposal; a rule only
// exists after a human tap. The structural half scans src/ and scripts/ so a new
// path from an agent answer to the rules file fails here before it ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { forslagFra, jaFraTryk, regelFraForslag, type Ja } from '../../src/graenser/regelforslag.ts';
import { lavTegn } from '../../src/graenser/tegn.ts';
import type { Regelsaet } from '../../src/tillid/regler.ts';

const TOM: Regelsaet = { naesteId: 4, regler: [], ugyldige: [] };
const B = { person: 'henrik', rum: 'hjem', slags: 'regel', id: 'k_1' };
const RAA = { titel: 'Nyhedsbreve afmeldes', tekst: 'Hermes må afmelde nyhedsbreve, jeg aldrig åbner.', trin: 4, gaelder: { kilde: 'mail', slags: 'nyhedsbrev' } };

test('a proposal keeps only its declared fields: a forged token, id, status or origin in the JSON is stripped', () => {
  const f = forslagFra({ ...RAA, ja: 'stjålet-tegn', tegn: 'x', token: 'y', id: 'R-0001', status: 'aktiv', oprindelse: { art: 'import', dato: '2020-01-01' }, naesteId: 99 }, { art: 'ret', kortId: 'k_1' });
  assert.ok(f);
  assert.deepEqual(Object.keys(f).sort(), ['gaelder', 'oprindelse', 'tekst', 'titel', 'trin']);
  assert.deepEqual(f.oprindelse, { art: 'ret', kortId: 'k_1' }, 'the origin is the app\'s, never the model\'s');
  assert.deepEqual(f.gaelder, { kilde: 'mail', slags: 'nyhedsbrev' });
  assert.deepEqual(Object.keys(forslagFra({ ...RAA, gaelder: { kilde: 'mail', ja: 'x' } }, { art: 'ret' })!.gaelder), ['kilde']);
});

test('a proposal that is not a valid rule is no proposal', () => {
  for (const v of [null, 'tekst', { ...RAA, trin: 7 }, { ...RAA, titel: '' }, { ...RAA, titel: 'a\nb' }, { ...RAA, gaelder: {} }, { ...RAA, tekst: '## R-0009 · Snyd' }]) {
    assert.equal(forslagFra(v, { art: 'ret' }), null, JSON.stringify(v));
  }
});

test('a yes exists only as a redeemed human-tap token: once, for its own binding', () => {
  const tegn = lavTegn();
  assert.equal(jaFraTryk(tegn, undefined, B), null);
  assert.equal(jaFraTryk(tegn, 'gættet', B), null);
  const t = tegn.udsted(B);
  assert.equal(jaFraTryk(tegn, t, { ...B, id: 'k_2' }), null, 'another card');
  const t2 = tegn.udsted(B);
  assert.ok(jaFraTryk(tegn, t2, B));
  assert.equal(jaFraTryk(tegn, t2, B), null, 'used once');
  assert.ok(t);
});

test('a rule is made from a proposal only with a Ja: dated by the app, active, next id', () => {
  const tegn = lavTegn();
  const f = forslagFra(RAA, { art: 'ret', kortId: 'k_1' })!;
  const ja = jaFraTryk(tegn, tegn.udsted(B), B)!;
  const { saet, regel } = regelFraForslag(TOM, f, ja, '2026-10-31');
  assert.equal(regel.id, 'R-0004');
  assert.equal(regel.status, 'aktiv');
  assert.deepEqual(regel.oprindelse, { art: 'ret', dato: '2026-10-31', kortId: 'k_1' });
  assert.equal(saet.naesteId, 5);
  // @ts-expect-error — a boolean, a string or a forged object is not a Ja
  assert.throws(() => regelFraForslag(TOM, f, true, '2026-10-31'), /ja/i);
  assert.throws(() => regelFraForslag(TOM, f, { ja: true } as unknown as Ja, '2026-10-31'), /ja/i);
});

// ---------- Structural ----------

const ROD = new URL('../../', import.meta.url).pathname;

async function filer(dir: string): Promise<string[]> {
  const ud: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ud.push(...(await filer(p)));
    else if (/\.(ts|mjs|js)$/.test(e.name)) ud.push(p);
  }
  return ud;
}

async function kilde(): Promise<{ fil: string; tekst: string }[]> {
  const alle = [...(await filer(path.join(ROD, 'src'))), ...(await filer(path.join(ROD, 'scripts')))];
  return Promise.all(alle.map(async (f) => ({ fil: path.relative(ROD, f), tekst: await readFile(f, 'utf8') })));
}

/** A write to the rules file: a rules store's skriv/skrivTekst, the start-rules writer, or a proposal turned into a rule. */
const SKRIVER = [/\b(regler|reglerLager)\??\.(skriv|skrivTekst)\s*\(/, /lavReglerLager\(.*\)\.(skriv|skrivTekst)\s*\(/, /\bskrivStartregler\s*\(/, /\bregelFraForslag\s*\(/];
/** A generic `lager.skriv(` counts only in a file that imports the rules store module (other stores share the name). */
const LAGER_SKRIV = /\blager\??\.(skriv|skrivTekst)\s*\(/;
const REGEL_LAGER = path.join(ROD, 'src', 'tillid', 'lager.ts');
const importererReglerLager = (fil: string, tekst: string): boolean =>
  [...tekst.matchAll(/from\s+'([^']+)'/g)].some((m) => path.resolve(path.dirname(path.join(ROD, fil)), m[1] ?? '') === REGEL_LAGER);
/** Writers that are not reachable from an agent answer: the definitions, the human-run script, the test world's fixed seed. */
const UDEN_TRYK = new Set(['src/tillid/start.ts', 'src/graenser/regelforslag.ts', 'scripts/regler-start.mjs', 'src/testtilstand/verden.ts']);
/** Where agent answers are handled: no rule may be written from here, token or not. */
const AGENTSVAR = /^src\/(rooms|kurator|agent|stemme)\/|^src\/runs\.ts$/;

test('structural: every rule writer is the human-run script, a fixed seed, or an endpoint that redeems the human-tap token — never an agent answer handler', async () => {
  const fund: string[] = [];
  for (const { fil, tekst } of await kilde()) {
    const linjer = tekst.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l));
    const skriver = linjer.some((l) => SKRIVER.some((re) => re.test(l)) || (LAGER_SKRIV.test(l) && importererReglerLager(fil, tekst)));
    if (!skriver) continue;
    if (UDEN_TRYK.has(fil)) continue;
    if (AGENTSVAR.test(fil)) { fund.push(`${fil}: skriver regler fra en agentsvar-sti`); continue; }
    if (!/\bjaFraTryk\s*\(/.test(tekst)) fund.push(`${fil}: skriver regler uden at indløse et tryk (jaFraTryk)`);
  }
  assert.deepEqual(fund, []);
});

test('structural: only the server, the test world and the human-run script make a rules store; no agent path imports the writers', async () => {
  const lager: string[] = [];
  const forbudt: string[] = [];
  for (const { fil, tekst } of await kilde()) {
    const vaerdi = [...tekst.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+'([^']+)'/gm)];
    for (const m of vaerdi) {
      const fra = m[2] ?? '';
      const navne = (m[1] ?? '').replace(/\btype\s+\w+\s*,?/g, '');
      if (/tillid\/lager\.ts$/.test(fra) && /lavReglerLager/.test(navne)) lager.push(fil);
      if (AGENTSVAR.test(fil) && (/tillid\/(lager|start)\.ts$/.test(fra) && /\b(lavReglerLager|skrivStartregler)\b/.test(navne))) forbudt.push(fil);
      if (AGENTSVAR.test(fil) && /graenser\/regelforslag\.ts$/.test(fra) && /\b(regelFraForslag|jaFraTryk)\b/.test(navne)) forbudt.push(fil);
    }
  }
  assert.deepEqual(lager.sort(), ['scripts/regler-start.mjs', 'src/server.ts', 'src/testtilstand/verden.ts']);
  assert.deepEqual(forbudt, []);
});

test('structural: the rules store rooms get (RoomDeps.regler) is only ever read', async () => {
  const fund: string[] = [];
  for (const { fil, tekst } of await kilde()) {
    // Any use but a direct read (a call to another method, or handing the store on under another name) is a finding.
    for (const m of tekst.matchAll(/\b(?:deps|d|dd)\.regler\b(?!\??\.(?:laes|fil)\b|\s+\?\s)(.{0,20})/g)) fund.push(`${fil}: .regler${m[1] ?? ''}`);
  }
  assert.deepEqual(fund, []);
});
