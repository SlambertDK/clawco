// KC-0142: the rules file is Henrik's own text. Parse/serialise round trip,
// invalid rules ignored and listed (never half-applied), ids never reused, and
// a file that is not a rules file at all fails as a whole.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyRegel, parseRegler, ReglerFejl, serialiserRegler, validerRegel, type Regelsaet } from '../../src/tillid/regler.ts';

const FIL = `# Regler for Clawco

naeste-id: R-0004

Det, Hermes må gøre af sig selv.

## R-0001 · Mail sorteres i mapper
- trin: 1
- gaelder: mail / indbakke
- oprindelse: import 2026-10-31
- status: aktiv

Hermes flytter mail fra Indbakken til mapperne.

## R-0002 · Regnskabslinjer for abonnementer
- trin: 2
- gaelder: mail / regning
- oprindelse: ret 2026-11-02 (kort k_x)
- status: aktiv

Appen skriver linjen; Hermes foreslår den.

## R-0003 · Revisor er aldrig rutine
- trin: 0
- gælder: mail / revisor
- oprindelse: haand 2026-11-03
- status: pause
`;

test('parseRegler reads ids, trin, scope, origin, status and free text', () => {
  const s = parseRegler(FIL);
  assert.equal(s.naesteId, 4);
  assert.deepEqual(s.ugyldige, []);
  assert.deepEqual(s.regler.map((r) => r.id), ['R-0001', 'R-0002', 'R-0003']);
  const r2 = s.regler[1];
  assert.deepEqual(r2, {
    id: 'R-0002', titel: 'Regnskabslinjer for abonnementer', tekst: 'Appen skriver linjen; Hermes foreslår den.', trin: 2,
    gaelder: { kilde: 'mail', slags: 'regning' }, oprindelse: { art: 'ret', dato: '2026-11-02', kortId: 'k_x' }, status: 'aktiv',
  });
  assert.equal(s.regler[2]?.status, 'pause');
  assert.deepEqual(s.regler[2]?.gaelder, { kilde: 'mail', slags: 'revisor' }, 'gælder with æ is accepted');
  assert.equal(s.regler[2]?.tekst, '');
});

test('parse/serialise round trip', () => {
  const s = parseRegler(FIL);
  assert.deepEqual(parseRegler(serialiserRegler(s)), s);
  assert.equal(serialiserRegler(parseRegler(serialiserRegler(s))), serialiserRegler(s), 'serialising is stable');
});

test('keys without a bullet, extra blank lines and a scope without slags parse', () => {
  const s = parseRegler('naeste-id: R-0002\n\n## R-0001 · Kalender\n\ntrin: 3\ngaelder: Kalender\noprindelse: import 2026-10-31\nstatus: aktiv\n\nForbered møder.\n\nAndet afsnit.\n');
  assert.deepEqual(s.ugyldige, []);
  assert.deepEqual(s.regler[0]?.gaelder, { kilde: 'kalender' });
  assert.equal(s.regler[0]?.tekst, 'Forbered møder.\n\nAndet afsnit.');
});

for (const trin of ['5', '-1', 'grænse', '2.5', '']) {
  test(`trin "${trin}" makes the rule invalid, listed with its id`, () => {
    const s = parseRegler(FIL.replace('- trin: 2', `- trin: ${trin}`));
    assert.deepEqual(s.regler.map((r) => r.id), ['R-0001', 'R-0003']);
    assert.equal(s.ugyldige.length, 1);
    assert.equal(s.ugyldige[0]?.id, 'R-0002');
    assert.match(s.ugyldige[0]?.hvorfor ?? '', /trin/);
  });
}

test('a duplicate id makes both rules invalid (neither is half-applied)', () => {
  const s = parseRegler(FIL.replace('## R-0003 · Revisor', '## R-0001 · Revisor'));
  assert.deepEqual(s.regler.map((r) => r.id), ['R-0002']);
  assert.deepEqual(s.ugyldige.map((u) => u.id), ['R-0001', 'R-0001']);
  for (const u of s.ugyldige) assert.match(u.hvorfor, /to gange/);
});

for (const felt of ['trin', 'gaelder', 'oprindelse', 'status']) {
  test(`a missing ${felt} makes the rule invalid`, () => {
    const s = parseRegler(FIL.replace(new RegExp(`- ${felt}: [^\\n]*\\n`), ''));
    assert.ok(!s.regler.some((r) => r.id === 'R-0001'));
    assert.equal(s.ugyldige[0]?.id, 'R-0001');
    assert.match(s.ugyldige[0]?.hvorfor ?? '', new RegExp(felt === 'gaelder' ? 'gælder' : felt));
  });
}

test('a heading without an id, a bad origin and an unknown status are invalid', () => {
  const s = parseRegler(`${FIL}\n## Noget jeg skrev\n- trin: 1\n\n## R-0005 · X\n- trin: 1\n- gaelder: mail\n- oprindelse: i går\n- status: aktiv\n\n## R-0006 · Y\n- trin: 1\n- gaelder: mail\n- oprindelse: import 2026-10-31\n- status: måske\n`);
  assert.deepEqual(s.ugyldige.map((u) => [u.id, u.overskrift]), [[undefined, 'Noget jeg skrev'], ['R-0005', 'R-0005 · X'], ['R-0006', 'R-0006 · Y']]);
});

test('serialise keeps invalid sections verbatim', () => {
  const md = FIL.replace('- trin: 2', '- trin: grænse');
  const ud = serialiserRegler(parseRegler(md));
  assert.ok(ud.includes('- trin: grænse'), 'Henrik\'s broken section is not lost');
  assert.equal(parseRegler(ud).ugyldige[0]?.id, 'R-0002');
});

test('an id is never reused after a rule is deleted by hand', () => {
  const uden = FIL.replace(/## R-0003[\s\S]*$/, '');
  const s = parseRegler(uden);
  assert.equal(s.naesteId, 4, 'the header keeps the deleted id taken');
  const { saet, regel } = nyRegel(s, { titel: 'Ny', tekst: '', trin: 1, gaelder: { kilde: 'mail' }, oprindelse: { art: 'haand', dato: '2026-11-04' }, status: 'aktiv' });
  assert.equal(regel.id, 'R-0004');
  assert.equal(saet.naesteId, 5);
  assert.match(serialiserRegler(saet), /naeste-id: R-0005/);
});

test('nyRegel never reuses an id present in the file, even when the header lags', () => {
  const s = parseRegler(FIL.replace('naeste-id: R-0004', 'naeste-id: R-0002'));
  assert.equal(s.naesteId, 4);
  assert.equal(nyRegel(s, { titel: 'Z', tekst: '', trin: 1, gaelder: { kilde: 'mail' }, oprindelse: { art: 'haand', dato: '2026-11-04' }, status: 'aktiv' }).regel.id, 'R-0004');
});

test('a file without naeste-id, with two, or with a malformed one is not a rules file', () => {
  for (const md of ['', 'hej', '## R-0001 · X\n- trin: 1\n', FIL.replace('naeste-id: R-0004', 'naeste-id: fire'), `naeste-id: R-0009\n${FIL}`]) {
    assert.throws(() => parseRegler(md), ReglerFejl, JSON.stringify(md.slice(0, 30)));
  }
});

test('validerRegel accepts a whole rule and names the first missing or wrong field', () => {
  const ok = { id: 'R-0001', titel: 'X', tekst: '', trin: 2, gaelder: { kilde: 'mail' }, oprindelse: { art: 'import', dato: '2026-10-31' }, status: 'aktiv' };
  assert.deepEqual(validerRegel(ok), ok);
  assert.match((validerRegel({ ...ok, trin: 5 }) as { fejl: string }).fejl, /trin/);
  assert.match((validerRegel({ ...ok, id: 'R-1' }) as { fejl: string }).fejl, /id/);
  assert.match((validerRegel({ ...ok, titel: ' ' }) as { fejl: string }).fejl, /titel/);
  assert.match((validerRegel({ ...ok, oprindelse: { art: 'mail', dato: '2026-10-31' } }) as { fejl: string }).fejl, /oprindelse/);
});

test('an empty set serialises to a file that parses back empty', () => {
  const tom: Regelsaet = { naesteId: 1, regler: [], ugyldige: [] };
  assert.deepEqual(parseRegler(serialiserRegler(tom)), tom);
});
