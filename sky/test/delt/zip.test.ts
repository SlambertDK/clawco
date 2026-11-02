// KC-0206: Sky's zip writer is the tenant's (src/tillid/zip.ts, KC-0146) lifted byte for byte — Sky shares no
// code path with src/ (aftryk.test.ts), so the copy is held identical here instead of imported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lavZip } from '../../src/delt/zip.ts';

test('the zip writer is byte-identical to the tenant\'s', () => {
  const sky = readFileSync(new URL('../../src/delt/zip.ts', import.meta.url));
  const tenant = readFileSync(new URL('../../../src/tillid/zip.ts', import.meta.url));
  assert.ok(sky.equals(tenant), 'sky/src/delt/zip.ts must equal src/tillid/zip.ts');
});

test('a zip names every entry in its central directory', () => {
  const z = lavZip([{ navn: 'konto/konto.json', data: Buffer.from('{}') }, { navn: 'clawco.zip', data: Buffer.from('x') }]);
  const s = z.toString('latin1');
  assert.ok(s.includes('konto/konto.json'));
  assert.ok(s.includes('clawco.zip'));
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
});
