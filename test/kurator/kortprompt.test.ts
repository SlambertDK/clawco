import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKortHandlingRun, buildKortFortrydRun, buildLaerRun } from '../../src/kurator/kortprompt.ts';
import { GRAENSER } from '../../src/agent/prompt.ts';
import { udenData, udpak } from '../../src/agent/udtroet.ts';
import type { Handling, Kort } from '../../src/rooms/hjem/kort.ts';

const NOW = new Date('2026-10-27T13:00:00Z');
const kort: Kort = {
  id: 'mail:inbox:1', type: 'familie', titel: 'Rikke beder om hjælp', betyder: 'Rikke vil have svar inden fredag.',
  grundlag: ['mail fra Rikke'], kilder: ['mail fra Rikke'], anbefaling: 'Svar i dag', prioritet: 1,
};
const handling = { label: 'Arkivér', instruktion: 'Arkivér mailen.' } as Handling;

// KC-0123: the instruction, the undo and the card are afledt segments; Henrik's reason is his own (betroet).
test('card runs go through the shared builder: limits once, zone line, the card and its handling as afledt data', () => {
  const h = buildKortHandlingRun(kort, handling, NOW);
  const f = buildKortFortrydRun('Flyt mailen tilbage.', NOW);
  const l = buildLaerRun(kort, 'Allerede klaret', NOW);
  for (const r of [h, f, l]) {
    assert.equal(r.instructions.split(GRAENSER).length - 1, 1);
    assert.match(r.instructions, /Zone: privat/);
    assert.match(r.instructions, /Du må aldrig betale, sende mail til andre mennesker eller slette data/);
  }
  assert.deepEqual(udpak(h.input).map((d) => [d.kilde, d.tillid]), [['handling', 'afledt'], ['kort', 'afledt']]);
  assert.equal(udpak(h.input)[0]!.tekst, 'Arkivér mailen.');
  assert.match(udpak(h.input)[1]!.tekst, /Knappen: "Arkivér"\nKortet fra Kuratoren: "Rikke beder om hjælp"/);
  assert.deepEqual(udpak(f.input).map((d) => [d.kilde, d.tillid, d.tekst]), [['fortryd', 'afledt', 'Flyt mailen tilbage.']]);
  assert.equal(udenData(l.input), 'Henriks grund: Allerede klaret');
  assert.match(udpak(l.input)[0]!.tekst, /^Kortet fra Kuratoren/);
});
