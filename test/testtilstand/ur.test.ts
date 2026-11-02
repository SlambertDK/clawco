import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idagKbh, lavUr } from '../../src/testtilstand/ur.ts';

const kbh = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

test('lavUr: uden saetTil er offset 0 og now() er det rigtige nu', () => {
  const ur = lavUr();
  assert.equal(ur.offsetMs(), 0);
  assert.ok(Math.abs(ur.now().getTime() - Date.now()) < 50);
});

test('saetTil: now() lander på den ønskede københavnske tid og kører videre', async () => {
  const ur = lavUr();
  ur.saetTil('2026-10-29', '10:00');
  assert.equal(kbh(ur.now()), '2026-10-29 10:00');
  const a = ur.now().getTime();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(ur.now().getTime() - a >= 25, 'uret kører');
});

test('saetTil: offset = mål minus rigtigt nu og kan sættes igen', () => {
  const ur = lavUr();
  ur.saetTil('2026-07-01', '06:30'); // sommertid
  assert.equal(kbh(ur.now()), '2026-07-01 06:30');
  assert.ok(Math.abs(ur.offsetMs() - (Date.parse('2026-07-01T04:30:00Z') - Date.now())) < 50);
  ur.saetTil('2026-12-24', '21:30'); // vintertid
  assert.equal(kbh(ur.now()), '2026-12-24 21:30');
});

test('saetTil: afviser en ugyldig dag eller tid', () => {
  const ur = lavUr();
  assert.throws(() => ur.saetTil('i dag', '10:00'));
  assert.throws(() => ur.saetTil('2026-10-29', '25:00'));
  assert.equal(ur.offsetMs(), 0);
});

test('idagKbh giver YYYY-MM-DD i København (ikke UTC)', () => {
  assert.equal(idagKbh(new Date('2026-10-29T23:30:00Z')), '2026-10-30');
  assert.equal(idagKbh(new Date('2026-10-29T10:00:00Z')), '2026-10-29');
});
