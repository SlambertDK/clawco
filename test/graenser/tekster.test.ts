// KC-0170 slice 3 (part B): the limits speak English or Danish. The table has exactly Danish's keys, English has no Danish
// word, and what a refusal says follows the language of the request — also in the audit line written at decision time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRAENSER_TEKSTER, graenserTekst } from '../../src/graenser/tekster.ts';
import { afgoer, aldrigTilladt, ikkeEndnu } from '../../src/graenser/afgoer.ts';
import { vaerktoejTilladt } from '../../src/graenser/opsyn.ts';
import { PAUSE_TEKST, pauseTekst, PauseFejl, startIgen, stopAlt } from '../../src/graenser/nodstop.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { form, tomme, ensStrenge, DANSK } from '../fixtures/sprog-tjek.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const EJER: Person = { id: 'ella', login: null, navn: 'Ella', rolle: 'ejer' };
const tabel = (t: unknown): Record<string, unknown> => t as Record<string, unknown>;

/** Every string the table can say: its plain strings and what each function answers to a sample argument. */
function ord(v: unknown, sti = ''): [string, string][] {
  if (typeof v === 'string') return [[sti, v]];
  if (typeof v === 'function') return ord((v as (...a: unknown[]) => unknown)(...Array.from({ length: v.length }, (_, i) => (i === 0 ? 'Navn' : 7))), sti);
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => ord(x, `${sti}${k}.`));
  return [];
}

test('English has exactly Danish\'s keys and shapes; no string is empty; none copied over; no Danish word', () => {
  assert.deepEqual(form(GRAENSER_TEKSTER.en), form(GRAENSER_TEKSTER.da));
  for (const t of [GRAENSER_TEKSTER.da, GRAENSER_TEKSTER.en]) assert.deepEqual(tomme(tabel(t)), []);
  assert.deepEqual(ensStrenge(tabel(GRAENSER_TEKSTER.da), tabel(GRAENSER_TEKSTER.en)), []);
  assert.deepEqual(ord(GRAENSER_TEKSTER.en).filter(([, s]) => DANSK.test(s)), []);
  // A refusal is also written to the audit log, which keeps `hvorfor` to 300 characters (revisionslog.ts).
  for (const [sti, s] of ord(GRAENSER_TEKSTER.en)) assert.ok(s.length <= 300, sti);
});

test('Danish is what it was: the reasons of a refusal, word for word', () => {
  const k = { person: EJER, ja: false } as const;
  assert.equal(afgoer({ rum: 'r', id: 'i', verb: 'betal', zoner: ['privat'] }, { ...k, kanal: 'knap' }).hvorfor, 'Clawco betaler aldrig noget. Det gør du selv.');
  assert.equal(afgoer({ rum: 'r', id: 'i', verb: 'slet', zoner: ['privat'] }, { ...k, kanal: 'knap' }).hvorfor, 'Clawco må kun slette noget, når du selv har trykket ja på knappen.');
  assert.equal(ikkeEndnu('bogfoer'), 'Jeg må ikke bogføre dette endnu: hvilken regel skal dække det?');
  assert.equal(PAUSE_TEKST, 'Clawco er sat på pause');
  for (const sprog of [undefined, 'da' as const]) {
    const kor = <T,>(fn: () => T): T => (sprog ? medSprog(sprog, fn) : fn());
    assert.equal(kor(() => aldrigTilladt('betal')), 'Clawco betaler aldrig noget. Det gør du selv.');
    assert.equal(kor(() => pauseTekst()), PAUSE_TEKST);
    assert.equal(kor(() => new PauseFejl().message), PAUSE_TEKST);
  }
});

test('English: what a refusal says, in the language of that request', () => {
  const en = <T,>(fn: () => T): T => medSprog('en', fn);
  const k = { person: EJER, ja: false } as const;
  assert.equal(en(() => afgoer({ rum: 'r', id: 'i', verb: 'betal', zoner: ['privat'] }, { ...k, kanal: 'knap' }).hvorfor), 'Clawco never pays for anything. You do that yourself.');
  assert.match(en(() => afgoer({ rum: 'r', id: 'i', verb: 'laes', zoner: ['privat', 'arbejde'] }, { ...k, kanal: 'knap' }).hvorfor), /never moves or copies/);
  assert.equal(en(() => afgoer({ rum: 'r', id: 'i', verb: 'slet', zoner: ['privat'] }, { ...k, kanal: 'stemme' }).hvorfor), 'Clawco may not delete something on a word from the voice. Press the button on the screen yourself.');
  assert.equal(en(() => afgoer({ rum: 'r', id: 'i', verb: 'laes', zoner: ['privat'] }, { ...k, kanal: 'knap' }).hvorfor), 'Within the limits.');
  assert.equal(en(() => ikkeEndnu('bogfoer')), 'I may not enter this in the ledger yet: which rule should cover it?');
  assert.equal(en(() => ikkeEndnu('noget-andet')), 'I may not do this yet: which rule should cover it?');
  assert.equal(en(() => aldrigTilladt('betal')), 'Clawco never pays for anything. You do that yourself.');
  assert.equal(en(() => aldrigTilladt('laes')), null);
  assert.equal(en(() => pauseTekst()), 'Clawco is paused');
  assert.equal(en(() => new PauseFejl().message), 'Clawco is paused');
  assert.match(en(() => vaerktoejTilladt('laes', 'terminal', 'himalaya message send').hvorfor), /^Clawco stopped the run: Hermes wanted to send an email/);
  assert.match(en(() => vaerktoejTilladt('laes', 'cronjob_manage', '').hvorfor), /wanted to use the tool cronjob_manage/);
  assert.equal(graenserTekst(), GRAENSER_TEKSTER.da, 'outside any request the language is Danish again');
});

test('the audit line of the kill switch is written in the language of the request', async () => {
  const skrevet: { hvorfor: string }[] = [];
  const revision = { skriv: async (e: { hvorfor: string }) => { skrevet.push(e); return undefined; } } as never;
  const runs = (n: number) => ({ stopAlle: async () => n, genoptag: async () => undefined, paaPause: () => true });
  await medSprog('en', async () => {
    await stopAlt({ runs: runs(0), revision, person: EJER, kanal: 'knap' });
    await stopAlt({ runs: runs(1), revision, person: EJER, kanal: 'knap' });
    await stopAlt({ runs: runs(3), revision, person: EJER, kanal: 'knap' });
    await startIgen({ runs: runs(1), revision, person: EJER, kanal: 'knap' });
    await assert.rejects(stopAlt({ runs: runs(1), revision, person: { ...EJER, rolle: 'gaest' }, kanal: 'knap' }), /Your role in the household cannot stop Clawco\./);
    await assert.rejects(startIgen({ runs: runs(1), revision, person: { ...EJER, rolle: 'medlem' }, kanal: 'knap' }), /Only the owner can start Clawco again\./);
  });
  assert.deepEqual(skrevet.map((e) => e.hvorfor), [
    'Stop everything: nothing was running.', 'Stop everything: 1 task was stopped.', 'Stop everything: 3 tasks were stopped.', 'Start again: Clawco is working again.',
  ]);
});

test('the line a refusal leaves in the room\'s log carries the reason in the language of the request', async () => {
  const { logSink } = await import('../../src/graenser/port.ts');
  const linjer: string[] = [];
  const d = { store: { appendLog: async (_rum: string, e: { tekst: string }) => { linjer.push(e.tekst); } } } as never;
  const r = { udfald: 'afvis', hvorfor: 'Clawco never pays for anything. You do that yourself.', forslag: { rum: 'mail', id: 'i', verb: 'betal', zoner: ['privat'] }, kanal: 'knap' } as never;
  await medSprog('en', () => logSink(d, r));
  await logSink(d, { ...(r as object), hvorfor: 'Clawco betaler aldrig noget. Det gør du selv.' } as never);
  assert.deepEqual(linjer, ['Not done: Clawco never pays for anything. You do that yourself.', 'Ikke gjort: Clawco betaler aldrig noget. Det gør du selv.']);
});
