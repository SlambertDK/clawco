// KC-0170 slice 3 (part B): the trust pages speak English or Danish. The table has exactly Danish's keys, English has no
// Danish word (but the typed word of Slet alt, SLET, which the server checks), the ladder's names follow the language, the
// reason a rules file cannot be read is Danish in the data (Hermes' prompt) and English on the page, and the rules file
// written in either language reads back the same.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TILLID_TEKSTER, ULAESELIG, flertal, tillidTekst } from '../../src/tillid/tekster.ts';
import { TRIN, trinNavn, trinSaetning } from '../../src/tillid/trin.ts';
import { parseRegler, serialiserRegler } from '../../src/tillid/regler.ts';
import { lavReglerLager } from '../../src/tillid/lager.ts';
import { reglerTilPrompt } from '../../src/tillid/prompt.ts';
import { renderViden, renderSletAlt, stoerrelse, type Viden } from '../../src/tillid/viden.ts';
import { sletAlt } from '../../src/tillid/slet.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { form, tomme, ensStrenge, DANSK } from '../fixtures/sprog-tjek.ts';

const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;
const en = <T,>(fn: () => T): T => medSprog('en', fn);

function ord(v: unknown, sti = ''): [string, string][] {
  if (typeof v === 'string') return [[sti, v]];
  if (typeof v === 'function') return ord((v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, (_, i) => (i === 0 ? 'Navn' : 7))), sti);
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => ord(x, `${sti}${k}.`));
  return [];
}

/** Strings that are the same in both languages on purpose. */
const ENS = new Set(['slags.mail']); // the word is the same

test('English has exactly Danish\'s keys and shapes; no string is empty; none copied over', () => {
  assert.deepEqual(form(TILLID_TEKSTER.en), form(TILLID_TEKSTER.da));
  for (const t of [TILLID_TEKSTER.da, TILLID_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  const kopier = ensStrenge(tabel(TILLID_TEKSTER.da), tabel(TILLID_TEKSTER.en)).filter((k) => !ENS.has(k));
  assert.deepEqual(kopier, []);
  const da = new Map(ord(TILLID_TEKSTER.da));
  assert.deepEqual(ord(TILLID_TEKSTER.en).filter(([sti, x]) => da.get(sti) === x && !['slags.mail.', 'fortrydForrige.'].includes(sti)), [], 'what a function says is not copied over either (but the word mail and a bracketed pair of arguments)');
});

test('no Danish word in English (SLET, the typed word, and the rules file\'s own keys are named)', () => {
  const dansk = ord(TILLID_TEKSTER.en).filter(([, s]) => DANSK.test(s));
  assert.deepEqual(dansk, []);
  assert.match(TILLID_TEKSTER.en.skrivOrd, /DELETE/);
});

test('every reason a rules file can be unreadable for has its English words, and Danish keeps its own', () => {
  for (const hvorfor of Object.values(ULAESELIG)) {
    assert.equal(TILLID_TEKSTER.da.ulaeseligHvorfor[hvorfor], hvorfor);
    assert.ok(TILLID_TEKSTER.en.ulaeseligHvorfor[hvorfor], hvorfor);
    assert.doesNotMatch(TILLID_TEKSTER.en.ulaeseligHvorfor[hvorfor] ?? '', /[æøå]/);
  }
});

test('the ladder: Danish is the TRIN table, English names every trin', () => {
  for (const t of TRIN) {
    assert.equal(trinNavn(t.trin), t.navn);
    assert.equal(trinSaetning(t.trin), t.saetning);
    assert.ok(en(() => trinNavn(t.trin)).length > 2);
    assert.ok(en(() => trinSaetning(t.trin)).startsWith('Hermes may'));
    assert.doesNotMatch(en(() => `${trinNavn(t.trin)} ${trinSaetning(t.trin)}`), DANSK);
  }
  assert.equal(en(() => trinNavn(1)), 'sort');
});

test('counts and sizes: the noun and the decimal follow the language', () => {
  assert.equal(flertal(1, 'linje'), '1 linje');
  assert.equal(flertal(3, 'fil'), '3 filer');
  assert.equal(en(() => flertal(1, 'linje')), '1 line');
  assert.equal(en(() => flertal(3, 'andenFil')), '3 other files');
  assert.equal(stoerrelse(2048), '2,0 kB');
  assert.equal(en(() => stoerrelse(2048)), '2.0 kB');
  assert.equal(en(() => stoerrelse(512)), '512 B');
  assert.equal(tillidTekst(), TILLID_TEKSTER.da, 'outside any request the language is Danish');
});

test('the rules file: the same rules read back from the file written in either language', () => {
  const md = 'naeste-id: R-0003\n\n## R-0001 · Mail sorted\n- trin: 1\n- gaelder: mail / indbakke\n- oprindelse: import 2026-10-31\n- status: aktiv\n\nMy own words.\n\n## R-0002 · Wide\n- trin: 3\n- gaelder: *\n- oprindelse: haand 2026-11-01\n- status: pause\n';
  const saet = parseRegler(md);
  const dansk = serialiserRegler(saet);
  const engelsk = en(() => serialiserRegler(saet));
  assert.match(dansk, /^# Regler for Clawco\n\nnaeste-id: R-0003\n\nDet, Hermes må gøre af sig selv\./);
  assert.match(engelsk, /^# Rules for Clawco\n\nnaeste-id: R-0003\n\nWhat Hermes may do on its own\./);
  assert.match(engelsk, /step \(0 look, 1 sort, 2 keep the ledger, 3 prepare, 4 act with undo\)/);
  assert.notEqual(engelsk, dansk);
  assert.deepEqual(parseRegler(engelsk), parseRegler(dansk));
  assert.deepEqual(parseRegler(engelsk).regler, saet.regler);
  assert.ok(engelsk.includes('My own words.'), 'the user\'s own text is never touched');
  // KC-0241: Hermes' prompt follows the language of the run (src/tillid/prompt-tekster.ts); the rule's own text passes through.
  const ok = { tilstand: 'ok', saet, aendretUdenfor: false } as const;
  assert.match(reglerTilPrompt(ok), /^Regler Henrik har godkendt .*\n- R-0001 · trin 1 · mail \/ indbakke: Mail sorted — My own words\./);
  assert.match(en(() => reglerTilPrompt(ok)), /^Rules the user has approved .*\n- R-0001 · step 1 · mail \/ indbakke: Mail sorted — My own words\./);
});

const VIDEN: Viden = {
  kilder: [{ id: 'k', navn: 'Calendar', slags: 'kalender', zone: 'husstand', forbundet: true }],
  regler: null, personer: null, gemt: { rum: [{ id: 'mail', log: 1, chat: 0, bytes: 1500, filer: [] }], clawco: [], andre: 0, noegler: 0, bytes: 1500 },
};

test('"Hvad Clawco ved om dig" in English: the headings, the zone and slags words, the buttons', () => {
  const s = en(() => String(renderViden(VIDEN)));
  for (const re of [/<h1>What Clawco knows about you<\/h1>/, />Sources</, />Rules</, />People</, />Saved</, /calendar · household/, /1 line in the log · 0 messages · 1\.5 kB/, />Download everything</, />Delete everything</, /Mail</]) assert.match(s, re);
  const d = String(renderViden(VIDEN));
  assert.match(d, /<h1>Hvad Clawco ved om dig<\/h1>/);
  assert.match(d, /kalender · husstand/);
  assert.match(d, /1 linje i loggen · 0 beskeder · 1,5 kB/);
});

test('a rules file that cannot be read: Danish reason in the data, English words on the page', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-tillid-sprog-'));
  try {
    await mkdir(path.join(dir, 'vault', 'Clawco'), { recursive: true });
    await writeFile(path.join(dir, 'vault', 'Clawco', 'regler.md'), '# No header line here\n');
    const lager = lavReglerLager({ vaultDir: path.join(dir, 'vault'), dataDir: path.join(dir, 'data') });
    const laest = await lager.laes();
    assert.equal(laest.tilstand, 'ulaeselig');
    assert.equal(laest.tilstand === 'ulaeselig' && laest.hvorfor, ULAESELIG.naesteMangler);
    const v: Viden = { ...VIDEN, regler: { fil: lager.fil, laest } };
    assert.match(String(renderViden(v)), /Filen kan ikke læses \(linjen &quot;naeste-id: R-…&quot; mangler øverst i filen\)\./);
    assert.match(en(() => String(renderViden(v))), /The file cannot be read \(the line &quot;naeste-id: R-…&quot; is missing at the top of the file\)\. Until it is fixed, Hermes may only look and suggest\./);
    assert.match(reglerTilPrompt(laest), /Reglerne kunne ikke læses \(linjen "naeste-id: R-…" mangler øverst i filen\)/);
    // KC-0241: the sentence follows the run's language, the reason stays Danish (data, like the file's own words).
    assert.match(en(() => reglerTilPrompt(laest)), /The rules could not be read \(linjen "naeste-id: R-…" mangler øverst i filen\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('"Slet alt" in English: the page, the typed word, and the audit line', async () => {
  const s = en(() => String(renderSletAlt(VIDEN, { fejl: 'Try again' })));
  for (const re of [/<h1>Delete everything<\/h1>/, />This cannot be undone\./, />What will be deleted</, />Download everything first</, /Type DELETE to confirm/, /What stays: your vault/]) assert.match(s, re);
  assert.match(String(renderSletAlt(VIDEN)), /Skriv SLET for at bekræfte/);

  const dir = await mkdtemp(path.join(tmpdir(), 'kc-tillid-slet-'));
  try {
    await mkdir(path.join(dir, 'data'), { recursive: true });
    await writeFile(path.join(dir, 'data', 'x.json'), '{}');
    const skrevet: string[] = [];
    const revision = { skriv: async (e: { hvorfor: string }) => { skrevet.push(e.hvorfor); return undefined; } };
    await en(() => sletAlt({ dataDir: path.join(dir, 'data') } as never, { person: 'ella', kanal: 'knap', revision }));
    await mkdir(path.join(dir, 'data'), { recursive: true });
    await writeFile(path.join(dir, 'data', 'y.json'), '{}');
    await sletAlt({ dataDir: path.join(dir, 'data') } as never, { person: 'ella', kanal: 'knap', revision });
    assert.deepEqual(skrevet, ['Delete everything: the owner confirmed with DELETE', 'Slet alt: ejeren bekræftede med SLET']);
    await assert.rejects(en(() => sletAlt({ dataDir: '' } as never, { person: 'ella', kanal: 'knap' })), /Delete everything only deletes in a data folder, not \(no folder\)/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
