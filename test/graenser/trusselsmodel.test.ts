import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { legacyKilder } from '../../src/kilder/legacy/legacy.ts';
import { falskeKilder, type FalskData } from '../../src/kilder/falsk/falsk.ts';
import { noterKilde } from '../../src/kilder/noter/noter.ts';
import { mailImapKilde } from '../../src/kilder/mail-imap/mail-imap.ts';
import { googleKalender } from '../../src/kilder/google-kalender/kilde.ts';
import { nyhederRss } from '../../src/kilder/nyheder-rss/kilde.ts';
import { mailGmail } from '../../src/kilder/mail-gmail/kilde.ts';
import { beskederKilde } from '../../src/kilder/beskeder/kilde.ts';
import type { Kilde } from '../../src/kilder/types.ts';

// KC-0125 invariant: every connector a host can register has a row in the threat model, so a new connection is
// assessed before it is connected (AGENTS.md §4 r12).
const DOK = readFileSync(fileURLToPath(new URL('../../docs/superpowers/specs/2026-10-31-trusselsmodel.md', import.meta.url)), 'utf8');
const AGENTS_FIL = fileURLToPath(new URL('../../AGENTS.md', import.meta.url));
// AGENTS.md lives in the private record only; the public mirror (KC-0228) skips the test that reads it.
const AGENTS = existsSync(AGENTS_FIL) ? readFileSync(AGENTS_FIL, 'utf8') : '';

/** Every connector any host can register: the host's own (all env set), the four offered to a product install, and the fakes. */
function registreredeKilder(): Kilde[] {
  const env = { KC_DAGEN_SOURCE_GLOB: '/x/{date}.json', KC_HIMALAYA: '/x/himalaya', KC_VAULT_DIR: '/x/vault' };
  const legacy = legacyKilder(env, { run: async () => ({ code: 1, stdout: '', stderr: '' }), laesNyheder: async () => null, parseMail: () => [], kalenderScript: '/x/kalender.py' });
  const tom = (): never => { throw new Error('ikke brugt'); };
  const falsk = falskeKilder({ data: { kalender: tom, mail: tom, nyheder: tom, noter: tom, beskeder: tom } as FalskData });
  return [...legacy, noterKilde(), mailImapKilde(), googleKalender(), nyhederRss(), mailGmail(), beskederKilde({ dataDir: '/x/data' }), ...falsk];
}

const raekker = DOK.split('\n').filter((l) => l.startsWith('|'));
const harRaekke = (noegle: string): boolean => raekker.some((l) => new RegExp(`^\\|\\s*\`${noegle.replace(/[*]/g, '\\*')}\``).test(l));

test('the registry has the connectors we expect (so the test below is not vacuous)', () => {
  const ids = registreredeKilder().map((k) => k.id);
  for (const id of ['kira-kalender', 'kira-morgenavis', 'kira-mail', 'kira-noter', 'noter', 'mail-imap', 'google-kalender', 'nyheder-rss', 'mail-gmail', 'beskeder']) assert.ok(ids.includes(id), id);
});

test('every registered connector has a row in the per-connector table (the fakes by their one `falsk-*` row)', () => {
  const mangler = registreredeKilder().map((k) => k.id).filter((id) => !harRaekke(id.startsWith('falsk-') ? 'falsk-*' : id));
  assert.deepEqual(mangler, [], `no row in docs/superpowers/specs/2026-10-31-trusselsmodel.md for: ${mangler.join(', ')}`);
});

test('a row names the three legs, the cut leg and the controls — none is left empty', () => {
  const ids = [...new Set(registreredeKilder().map((k) => (k.id.startsWith('falsk-') ? 'falsk-*' : k.id)))];
  for (const id of ids) {
    const celler = raekker.find((l) => new RegExp(`^\\|\\s*\`${id.replace(/[*]/g, '\\*')}\``).test(l))!.split('|').slice(1, -1).map((c) => c.trim());
    assert.equal(celler.length, 6, `${id}: columns`);
    celler.forEach((c, i) => assert.ok(c.length > 1, `${id}: column ${i} is empty`));
  }
});

test('the surfaces that are not connectors have their rows too', () => {
  for (const flade of ['hermes-gateway', 'husstand-kanal', 'husstand-invitation', 'husstandsforespoergsler', 'import', 'stemme', 'agent-vaerktoejer', 'sky-gateway', 'direkte-agent', 'skrive-nyheder-vault', 'stoette-adgang']) assert.ok(harRaekke(flade), flade);
});

test('the document has its fixed sections: assets, actors, trust boundaries, residual risks, assumed items, review rule', () => {
  for (const h of [/^## Assets/m, /^## Actors/m, /^## Trust boundaries/m, /^## Per-connector table/m, /^## Residual risks/m, /^## ASSUMED/m, /^## Review rule/m]) assert.match(DOK, h);
  for (const aktoer of ['hostile sender', 'hostile web page', 'household member', 'curious guest', 'compromised model provider', 'stolen device']) assert.ok(DOK.toLowerCase().includes(aktoer), aktoer);
  assert.match(DOK, /`\/v1\/runs`/);
});

test('AGENTS.md §4 has rule 12: a new connector or agent tool updates the table in the same PR', { skip: !AGENTS && 'no AGENTS.md in the public mirror' }, () => {
  const afsnit4 = AGENTS.slice(AGENTS.indexOf('## §4'), AGENTS.indexOf('## §5'));
  assert.match(afsnit4, /^12\. A new connector or agent tool updates the threat model's per-connector table in the same PR\./m);
});
