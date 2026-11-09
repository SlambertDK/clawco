// KC-0247: Start shows one step at a time (onboarding spec 2026-11-03, P6/G5). The top open step is the only expanded
// card; done steps fold to one line with a tick (their content still behind the fold, so nothing an advanced user had is
// lost); later steps show their title and a time estimate only. Mandatory steps come before optional ones (spec §5: the
// first Ret is taught right after the first source; the second source and the import wait). The cards under the steps
// (Tailscale, the Danmark-pakke) wait until the first source works. A source card whose form asks for something folds
// that form under "I'll do it myself"; a one-tap source keeps its button in sight.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alleTrin, type Trin } from '../../../src/rooms/start/trin.ts';
import { renderStart, type StartVisning } from '../../../src/rooms/start/render.ts';
import { forbindKort } from '../../../src/rooms/start/kilderender.ts';
import type { TrinStatus } from '../../../src/rooms/start/schema.ts';
import type { KildeKortSyn } from '../../../src/rooms/module.ts';
import { medSprog } from '../../../src/shell/tekster.ts';

const NU = new Date('2026-11-09T09:00:00.000Z');
const PROFIL = { navn: 'Alma', sprog: 'da' as const, husstand: 'alene' as const };

function med(status: Record<string, TrinStatus>): StartVisning['trin'] {
  return alleTrin().map((t: Trin) => ({ trin: t, status: status[t.id] ?? 'ikke-startet' }));
}
const render = (o: Partial<StartVisning>): string => String(renderStart({ trin: med({}), profil: null, standardNavn: '', forslag: [], kanGemme: true, now: NU, ...o }));
// KC-0248: step 0 (the pick) is the first step; the cases below start after it unless they say otherwise.
const klaret = (...ider: string[]): Record<string, TrinStatus> => Object.fromEntries(['situation', ...ider].map((i) => [i, 'klaret' as const]));

/** The expanded step cards (data-trin-aaben marks the one open card). */
const aabne = (h: string): string[] => [...h.matchAll(/<article[^>]*data-trin="([a-z-]+)"[^>]*data-trin-aaben/g)].map((m) => m[1]!);
const linje = (h: string, id: string): string => new RegExp(`<article[^>]*data-trin="${id}"[\\s\\S]*?</article>`).exec(h)?.[0] ?? '';

test('every step carries a time estimate in whole minutes', () => {
  for (const t of alleTrin()) assert.ok(Number.isInteger(t.minutter) && t.minutter >= 1 && t.minutter <= 10, `${t.id}: ${t.minutter}`);
});

test('a fresh journey shows one open card — step 0, the pick — and the rest as title lines with an estimate', () => {
  const h = render({});
  assert.deepEqual(aabne(h), ['situation']);
  assert.match(linje(h, 'situation'), /data-situation="mail"/);
  assert.doesNotMatch(h, /id="velkommen-form"/, 'nothing of a step not reached is on screen');
  for (const t of alleTrin().filter((x) => x.id !== 'situation')) {
    const l = linje(h, t.id);
    assert.match(l, /data-trin-naeste/, `${t.id} is a next line`);
    assert.ok(l.includes(t.titel), `${t.id} shows its title`);
    assert.ok(l.includes(`≈ ${t.minutter} min`), `${t.id} shows ≈ ${t.minutter} min`);
  }
});

test('after step 0 the next card is step 1, with its form', () => {
  const h = render({ trin: med(klaret()) });
  assert.deepEqual(aabne(h), ['velkommen']);
  assert.match(linje(h, 'velkommen'), /id="velkommen-form"/);
  assert.doesNotMatch(h, /id="model-form"/, 'nothing of a step not reached is on screen');
  for (const t of alleTrin().filter((x) => x.id !== 'velkommen' && x.id !== 'situation')) {
    const l = linje(h, t.id);
    assert.match(l, /data-trin-naeste/, `${t.id} is a next line`);
    assert.ok(l.includes(t.titel), `${t.id} shows its title`);
    assert.ok(l.includes(`≈ ${t.minutter} min`), `${t.id} shows ≈ ${t.minutter} min`);
  }
});

test('the open card says which step it is of how many', () => {
  const h = render({ trin: med(klaret('velkommen')), profil: PROFIL });
  assert.deepEqual(aabne(h), ['model']);
  assert.match(linje(h, 'model'), new RegExp(`trin-taeller">3 af ${alleTrin().length}<`));
  assert.match(medSprog('en', () => render({ trin: med(klaret('velkommen')), profil: PROFIL })), new RegExp(`trin-taeller">3 of ${alleTrin().length}<`));
});

test('a done step folds to one line with a tick, its content kept behind the fold', () => {
  const h = render({ trin: med(klaret('velkommen')), profil: PROFIL });
  const l = linje(h, 'velkommen');
  assert.match(l, /data-trin-status="klaret"/);
  assert.match(l, /data-trin-foldet/);
  assert.match(l, /<details[^>]*>\s*<summary[^>]*>[\s\S]*tilstand-ordnet[\s\S]*Velkommen/);
  assert.doesNotMatch(l, /<details[^>]* open/, 'folded, not open');
  assert.match(l, /Ret profilen/, 'the profile can still be edited from the fold');
});

test('mandatory before optional: after the first source the first Ret is the open step, the second source waits', () => {
  const h = render({ trin: med(klaret('velkommen', 'model', 'foerste-kilde')), profil: PROFIL, foersteRet: { punkt: { titel: 'Elregningen' }, kanSpringeOver: true } });
  assert.deepEqual(aabne(h), ['foerste-ret']);
  assert.match(linje(h, 'foerste-ret'), /data-foerste-ret="aaben"/);
  assert.match(linje(h, 'flere-kilder'), /data-trin-naeste/);
  assert.match(linje(h, 'import'), /data-trin-naeste/);
});

test('with every mandatory step done the first open optional step opens', () => {
  const h = render({ trin: med(klaret('velkommen', 'model', 'foerste-kilde', 'foerste-ret')), profil: PROFIL });
  assert.deepEqual(aabne(h), ['flere-kilder']);
  assert.match(linje(h, 'import'), /data-trin-naeste/);
});

test('a skipped step folds like a done one', () => {
  const h = render({ trin: med({ ...klaret('velkommen', 'model', 'foerste-kilde', 'flere-kilder', 'import'), 'foerste-ret': 'sprunget-over' }), profil: PROFIL });
  assert.deepEqual(aabne(h), []);
  assert.match(linje(h, 'foerste-ret'), /data-trin-foldet/);
  assert.match(linje(h, 'foerste-ret'), /Sprunget over/);
});

test('the cards under the steps wait until the first source works', () => {
  const ts = { syn: { tilstand: 'klar' as const, port: 8750, laptop: false }, kanDele: true };
  const under = render({ trin: med(klaret('velkommen', 'model')), profil: PROFIL, tailscale: ts });
  assert.doesNotMatch(under, /data-tailscale/, 'hidden while step 3 is open');
  const efter = render({ trin: med(klaret('velkommen', 'model', 'foerste-kilde')), profil: PROFIL, tailscale: ts });
  assert.match(efter, /data-tailscale/, 'shown once the first source works');
  const faerdig = render({ trin: med(klaret('velkommen')), profil: PROFIL, tailscale: ts, faerdig: true });
  assert.match(faerdig, /data-tailscale/, 'and once the journey is Done, whatever step is still open (an older installation)');
});

type Felt = KildeKortSyn['kort']['felter'][number];
const kort = (felter: Felt[], trin?: { tekst: string }[]): KildeKortSyn => ({
  id: 'imap', navn: 'Mail', slags: 'mail', zone: 'privat', forbundet: false, helbred: null,
  kort: { titel: 'Mail (IMAP)', tekst: 'Any mail account.', handling: 'Connect', felter, ...(trin ? { trin } : {}) },
} as KildeKortSyn);

test('a source whose form asks for something folds it under "I\'ll do it myself"', () => {
  const h = String(forbindKort(kort([{ navn: 'server', etiket: 'Server', type: 'tekst', paakraevet: true }]), { spring: false }));
  assert.match(h, /data-doer="selv"/);
  assert.match(h, /<details class="vis-mere"[^>]*data-doer="selv"[\s\S]*Jeg gør det selv[\s\S]*name="server"[\s\S]*data-kilde-forbind="imap"/);
  assert.match(medSprog('en', () => String(forbindKort(kort([{ navn: 'server', etiket: 'Server', type: 'tekst', paakraevet: true }]), { spring: false }))), /I&#39;ll do it myself|I'll do it myself/);
  const opsaet = String(forbindKort(kort([], [{ tekst: 'Open the console.' }]), { spring: false }));
  assert.match(opsaet, /data-doer="selv"[\s\S]*data-kilde-trin/, 'setup steps go behind the fold too');
});

test('a one-tap source keeps its button in sight', () => {
  const h = String(forbindKort(kort([]), { spring: true }));
  assert.doesNotMatch(h, /data-doer="selv"/);
  assert.match(h, /data-kilde-forbind="imap"/);
  assert.match(h, /data-aktion="kilde-spring-over"/);
});

test('Spring over stays in sight beside a folded form', () => {
  const h = String(forbindKort(kort([{ navn: 'server', etiket: 'Server', type: 'tekst', paakraevet: true }]), { spring: true }));
  const udenFold = h.replace(/<details[\s\S]*<\/details>/, '');
  assert.match(udenFold, /data-aktion="kilde-spring-over"/, 'outside the fold');
  assert.equal((h.match(/data-aktion="kilde-spring-over"/g) ?? []).length, 1, 'one Spring over');
});

// ---------- the room: the open step is never a dead end ----------

import { medStart, STARTET } from '../../helpers/start-deps.ts';

test('step 4 with nothing left to offer is not on screen, so it can never be the open card', async () => {
  // One calendar connected and read, no other source registered: step 4's pile is empty and only one source is connected.
  await medStart({ forbi: true, state: { startet: STARTET, trin: {}, afvist: {}, ret: { art: 'ret', tid: STARTET, titel: 'x' } } }, async (s) => {
    const h = await s.main();
    assert.equal(linje(h, 'flere-kilder'), '', 'step 4 is gone, not an empty card');
    assert.equal(linje(h, 'import'), '', 'step 5 without a notes writer (no seam here) is gone too');
    assert.deepEqual(aabne(h), [], 'no empty card is open');
  });
});
