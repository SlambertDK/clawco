// KC-0266: the subprocessor list promises 30 days' e-mail notice before a new subprocessor processes an existing
// customer's data. AWS was added 2026-11-03 with ibrugtagning 2026-12-03: an account from before the addition gets the
// included model from 2026-12-03; an account created on or after it accepted the list with AWS and gets it at once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ibrugtagningFor, maaBehandle } from '../../src/model/udbyder.ts';

const I = '2026-12-03';

test('no start date: processing is allowed for every account', () => {
  assert.equal(maaBehandle(null, new Date('2026-01-01'), new Date('2026-11-04')), true);
});

test('an account from before the addition waits until the start date, then it is allowed', () => {
  const gammel = new Date('2026-10-31T12:00:00Z');
  assert.equal(maaBehandle(I, gammel, new Date('2026-11-04T08:00:00Z')), false);
  assert.equal(maaBehandle(I, gammel, new Date('2026-12-02T23:59:59Z')), false);
  assert.equal(maaBehandle(I, gammel, new Date('2026-12-03T00:00:00Z')), true);
});

test('an account created on or after the addition (start date minus 30 days) is allowed at once', () => {
  assert.equal(maaBehandle(I, new Date('2026-11-03T00:00:00Z'), new Date('2026-11-03T10:00:00Z')), true);
  assert.equal(maaBehandle(I, new Date('2026-11-20T09:00:00Z'), new Date('2026-11-20T09:05:00Z')), true);
  assert.equal(maaBehandle(I, new Date('2026-11-02T23:59:59Z'), new Date('2026-11-20T09:05:00Z')), false);
});

test('ibrugtagningFor reads the start date of the listed subprocessor that covers the host; unlisted is null', () => {
  const d = { underdatabehandlere: [
    { id: 'aws', vaerter: ['bedrock-runtime.eu-north-1.amazonaws.com'], ibrugtagning: '2026-12-03' },
    { id: 'x', vaerter: ['*.x.example'], ibrugtagning: null },
  ] };
  assert.equal(ibrugtagningFor('bedrock-runtime.eu-north-1.amazonaws.com', d), '2026-12-03');
  assert.equal(ibrugtagningFor('a.x.example', d), null);
  assert.equal(ibrugtagningFor('api.anthropic.com', d), null);
});

test('the real list: AWS covers the configured Bedrock host and starts 2026-12-03', async () => {
  const { laesBehandlingsdata, udbyderVaert } = await import('../../src/model/udbyder.ts');
  const { laesModelpriser } = await import('../../src/model/priser.ts');
  const p = laesModelpriser();
  const b = p.udbydere['bedrock']!;
  assert.equal(ibrugtagningFor(udbyderVaert(b.url, b.region ?? null), laesBehandlingsdata()), '2026-12-03');
});
