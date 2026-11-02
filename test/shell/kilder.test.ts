// KC-0120: "Kilder" in the Kø panel — every connected source with its zone,
// its state in plain Danish (Forbundet / Log ind igen / Nede / Langsom), when
// it was last read, and Frakobl for the owner only. Unconnected sources are not
// listed (KC-0052: Start offers them). One bunke block; all text escaped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KILDE_TILSTANDE, kildeTilstand, renderKilder, type KildeVisning } from '../../src/shell/kilder.ts';

const NU = new Date('2026-10-31T13:30:00Z'); // 14.30 in Copenhagen
const k = (o: Partial<KildeVisning>): KildeVisning => ({ id: 'falsk-kalender', navn: 'Falsk kalender', slags: 'kalender', auth: 'oauth', zone: 'privat', forbundet: true, helbred: { status: 'ok' }, sidstLaest: null, ...o });

test('the health states map to four plain Danish states; snart-udloebet still counts as Forbundet', () => {
  assert.deepEqual(KILDE_TILSTANDE, ['forbundet', 'log-ind-igen', 'nede', 'langsom']);
  assert.deepEqual(
    (['ok', 'snart-udloebet', 'log-ind-igen', 'nede', 'langsomt'] as const).map((status) => kildeTilstand({ status })),
    ['forbundet', 'forbundet', 'log-ind-igen', 'nede', 'langsom'],
  );
  assert.equal(kildeTilstand(null), 'nede');
});

test('one bunke with a row per connected source: name, zone, state, last read; unconnected sources are left out', () => {
  const h = String(renderKilder([
    k({ sidstLaest: '2026-10-31T13:05:00.000Z' }),
    k({ id: 'falsk-mail', navn: 'Falsk mail', slags: 'mail', auth: 'bridge', zone: 'arbejde', helbred: { status: 'log-ind-igen', tekst: 'Adgangen er udløbet. Log ind igen.' } }),
    k({ id: 'falsk-nyheder', navn: 'Falske nyheder', helbred: { status: 'nede' } }),
    k({ id: 'falsk-noter', navn: 'Falske noter', zone: 'husstand', helbred: { status: 'langsomt' } }),
    k({ id: 'falsk-beskeder', navn: 'Falske beskeder', forbundet: false, helbred: null }),
  ], { nu: NU, maaFrakoble: true }));
  assert.equal((h.match(/data-blok="bunke"/g) ?? []).length, 1);
  assert.match(h, /<h3 class="eyebrow">Kilder<\/h3>/);
  assert.equal((h.match(/data-kilde="/g) ?? []).length, 4);
  assert.doesNotMatch(h, /Falske beskeder/);
  assert.match(h, /data-kilde="falsk-kalender" data-kilde-tilstand="forbundet"[\s\S]*?Falsk kalender[\s\S]*?Privat · Sidst læst 14\.05[\s\S]*?Forbundet/);
  assert.match(h, /data-kilde="falsk-mail" data-kilde-tilstand="log-ind-igen"[\s\S]*?Arbejde · Adgangskoden til din mail virker ikke længere<[\s\S]*?tilstand-kraever\">Log ind igen</);
  assert.match(h, /data-kilde-tilstand="nede"[\s\S]*?Nede/);
  assert.match(h, /data-kilde-tilstand="langsom"[\s\S]*?Husstand[\s\S]*?Langsom/);
  assert.equal((h.match(/Sidst læst/g) ?? []).length, 1, 'no last read time when the registry has none');
});

test('Frakobl on every row for the owner, on none for anyone else', () => {
  const liste = [k({}), k({ id: 'falsk-mail', navn: 'Falsk mail' })];
  const ejer = String(renderKilder(liste, { nu: NU, maaFrakoble: true }));
  assert.equal((ejer.match(/data-kilde-frakobl="/g) ?? []).length, 2);
  assert.match(ejer, /<button type="button" class="btn kilde-frakobl" data-kilde-frakobl="falsk-mail">Frakobl<\/button>/);
  assert.doesNotMatch(String(renderKilder(liste, { nu: NU, maaFrakoble: false })), /Frakobl|data-kilde-frakobl/);
});

test('names are escaped and the connector\'s own health words never reach the panel; no connected source = nothing at all', () => {
  const h = String(renderKilder([k({ navn: '<script>x</script>', helbred: { status: 'nede', tekst: '"><img src=x>' } })], { nu: NU, maaFrakoble: true }));
  assert.doesNotMatch(h, /<script>|<img/);
  assert.match(h, /&lt;script&gt;/);
  assert.doesNotMatch(h, /"&gt;|x&gt;/, 'the provider text is not shown at all');
  assert.match(h, /Din kalender svarer ikke/);
  assert.equal(String(renderKilder([], { nu: NU, maaFrakoble: true })), '');
  assert.equal(String(renderKilder([k({ forbundet: false })], { nu: NU, maaFrakoble: true })), '');
});
