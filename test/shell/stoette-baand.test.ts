// KC-0188: the red band "Support kigger med til hh.mm" is drawn by the shell from the tenant's own record, on every page
// with the skeleton, for everyone in the household; only the owner gets "Slå fra" and the switch's card. Hostile text (the
// owner's reason) is escaped. Pure: shell() in, HTML out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shell, type ShellOpts } from '../../src/shell/layout.ts';
import { html } from '../../src/shell/html.ts';
import { ROOMS } from '../../src/rooms/registry.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { renderRevision } from '../../src/shell/revision.ts';

const EJER: Person = { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' };
const MEDLEM: Person = { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' };
const STOETTE: Person = { id: 'stoette:7', login: null, navn: 'Support', rolle: 'stoette', stoette: { ejer: 'henrik', adgang: '41', personale: '7', session: '0123456789abcdef' } };
// 13.05 UTC on 2 November 2026 = 14.05 in Copenhagen (CET).
const AKTIV = { adgang: { udloeber: '2026-11-02T13:05:00.000Z', grund: '<img src=x onerror=alert(1)> "Mail" & co' }, slaaTil: '/_sky/stoette', slaaFra: '/_sky/stoette/slaa-fra' };
const FRA = { adgang: null, slaaTil: '/_sky/stoette', slaaFra: '/_sky/stoette/slaa-fra' };

const side = (o: Partial<ShellOpts>): string => String(shell({ roomId: 'hjem', hermesStatus: 'Klar', venter: {}, main: html`<p>x</p>`, chat: [], ...o }));
const baand = (out: string): string => { const i = out.indexOf('data-stoette="baand"'); return i < 0 ? '' : out.slice(i, out.indexOf('</div>', i)); };

test('while a grant is active, every room shows the band with the time it ends, for every person', () => {
  for (const r of ROOMS) {
    for (const person of [EJER, MEDLEM, STOETTE]) {
      const out = side({ roomId: r.id, person, stoette: AKTIV });
      const b = baand(out);
      assert.ok(b, `${r.id} for ${person.rolle}`);
      assert.match(b, /Support kigger med til 14\.05/);
      assert.ok(out.indexOf('data-stoette="baand"') < out.indexOf('<div class="frame">'), 'above the skeleton, so no room can leave it out');
    }
  }
});

test('the hostile reason is escaped, never markup', () => {
  const out = side({ person: EJER, stoette: AKTIV });
  assert.ok(!out.includes('<img src=x'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt; &quot;Mail&quot; &amp; co'));
});

test('only the owner gets Slå fra; it posts to the switch', () => {
  const ejer = side({ person: EJER, stoette: AKTIV });
  assert.match(ejer, /<form[^>]*method="post"[^>]*action="\/_sky\/stoette\/slaa-fra"[^>]*>\s*<button[^>]*data-stoette="slaa-fra"/);
  for (const p of [MEDLEM, STOETTE]) assert.doesNotMatch(side({ person: p, stoette: AKTIV }), /data-stoette="slaa-fra"/, p.rolle);
});

test('off: no band; the owner (only) has the card with 1, 4 or 24 hours, a one-line reason and the sentence about mail and calendar', () => {
  const ejer = side({ person: EJER, stoette: FRA });
  assert.equal(baand(ejer), '');
  assert.match(ejer, /data-stoette="fra"/);
  assert.match(ejer, /<form[^>]*method="post"[^>]*action="\/_sky\/stoette"/);
  assert.deepEqual([...ejer.matchAll(/name="timer" value="(\d+)"/g)].map((m) => m[1]), ['1', '4', '24']);
  assert.match(ejer, /name="grund"[^>]*maxlength="120"/);
  assert.match(ejer, /også din mail og din kalender/);
  assert.match(ejer, /Lad support se med/);
  for (const p of [MEDLEM, STOETTE]) assert.doesNotMatch(side({ person: p, stoette: FRA }), /data-stoette="fra"/, p.rolle);
});

test('on: the owner\'s card says until when instead of offering it again', () => {
  const ejer = side({ person: EJER, stoette: AKTIV });
  assert.match(ejer, /data-stoette="til"/);
  assert.doesNotMatch(ejer, /data-stoette="fra"/);
});

test('"Hvad Clawco har gjort" says in plain Danish who turned support on and off, each session and each page support opened', () => {
  const l = (verb: string, rum: string, person: string, hvorfor: string) => ({ tid: '2026-11-02T12:00:00.000Z', person, kanal: 'stoette' as const, rum, verb, udfald: 'tillad' as const, hvorfor, zoner: [], kilde: 'stoette', forrige: '0'.repeat(64) });
  const out = String(renderRevision([
    l('stoette-givet', 'stoette', 'henrik', 'Ejeren lod support se med til kl. 14.05.'),
    l('stoette-start', 'stoette', 'stoette:7', 'Support begyndte at kigge med.'),
    l('stoette-aabnet', '/rum/mail', 'stoette:7', 'Support åbnede en side.'),
    l('stoette-aabnet', '/api/rum/:id/fragment', 'stoette:7', 'Support åbnede en side.'),
    { ...l('stoette-aabnet', '/viden', 'stoette:7', 'Support fik nej til en side.'), udfald: 'afvist' as const },
    l('stoette-slut', 'stoette', 'henrik', 'Ejeren slog support fra.'),
    l('stoette-udloeb', 'stoette', 'stoette', 'Supportadgangen sluttede af sig selv kl. 14.05.'),
  ], { nu: new Date('2026-11-02T12:30:00.000Z'), navne: { henrik: 'Henrik' } }));
  for (const tekst of ['Henrik lod support se med', 'Support (medarbejder 7) begyndte at kigge med', 'Support (medarbejder 7) åbnede Mail', 'Support (medarbejder 7) åbnede /api/rum/:id/fragment', 'Support (medarbejder 7) fik nej til /viden', 'Henrik slog support fra', 'Supportadgangen sluttede af sig selv']) assert.ok(out.includes(tekst), tekst);
  assert.ok(out.includes('til kl. 14.05'), 'the reason line carries the time');
});

test('without the switch (a tailnet install) there is neither band nor card', () => {
  const out = side({ person: EJER });
  assert.doesNotMatch(out, /data-stoette=/);
});
