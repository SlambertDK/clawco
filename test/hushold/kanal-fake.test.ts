// KC-0153: the channel client (KanalClient) and what it may be handed. The fake records what was sent and serves
// scripted replies; the hermes client runs `hermes send` with argv (no shell), the text on stdin, to an explicit id
// only (never a name the gateway would look up), and refuses text that Hermes would turn into an attachment. Handles
// are validated per channel; the opt-in rule says what may be sent to whom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beskedTekst, gyldigHandle, lavFakeKanal, lavHermesKanal, maaSende, KanalFejl, type Kanalmedlem } from '../../src/hushold/kanal.ts';
import { nyForespoergsel } from '../../src/hushold/foresp.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

const MAJA: Kanalmedlem = { medlemId: FAMILIE.medlem.id, kanal: 'telegram', handle: '100000001' };

test('handles: Telegram a numeric id, Signal and WhatsApp an E.164 number (spaces dropped); anything else is refused', () => {
  assert.equal(gyldigHandle('telegram', '100000001'), '100000001');
  assert.equal(gyldigHandle('telegram', '-100000001'), '-100000001');
  assert.equal(gyldigHandle('signal', '+45 00 00 00 01'), '+4500000001');
  assert.equal(gyldigHandle('whatsapp', '+4500000001'), '+4500000001');
  for (const [k, h] of [['telegram', '@eksempel'], ['telegram', 'familie'], ['signal', '4500000001'], ['signal', '+45abc'], ['whatsapp', 'gruppe@g.us'], ['telegram', ''], ['signal', '+1'], ['telegram', '1;rm -rf']] as const) {
    assert.equal(gyldigHandle(k, h), null, `${k} ${h}`);
  }
});

test('the opt-in rule: before her first ja only the invitation; after ja messages; after stop nothing', () => {
  assert.equal(maaSende(undefined, 'besked'), false);
  assert.equal(maaSende({ kanal: 'telegram', handle: '1', status: 'afventer-ja' }, 'invitation'), true);
  assert.equal(maaSende({ kanal: 'telegram', handle: '1', status: 'afventer-ja', inviteret: '2026-11-01T08:00:00.000Z' }, 'invitation'), false, 'the first invitation only');
  assert.equal(maaSende({ kanal: 'telegram', handle: '1', status: 'afventer-ja' }, 'besked'), false);
  assert.equal(maaSende({ kanal: 'telegram', handle: '1', status: 'aktiv' }, 'besked'), true);
  assert.equal(maaSende({ kanal: 'telegram', handle: '1', status: 'stoppet' }, 'besked'), false);
  assert.equal(maaSende({ kanal: 'telegram', handle: '1', status: 'stoppet' }, 'invitation'), false);
});

const NU = new Date('2026-11-02T08:00:00.000Z');

test('the message text is built by the app from the request: who asks, what, when, and the reply words', () => {
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Kan du hente Nora torsdag?', tid: { start: '2026-11-05T15:00:00.000Z', slut: '2026-11-05T16:00:00.000Z' } }, NU);
  const t = beskedTekst(f, 'Henrik');
  assert.match(t, /^Henrik spørger: Kan du hente Nora torsdag\?\n/);
  assert.match(t, /torsdag 5\. november kl\. 16\.00–17\.00/, 'an absolute day, so the text does not change with the clock');
  assert.match(t, /Svar ja, nej eller fx kl 17/);
  assert.match(t, /stop/);
  const uden = beskedTekst(nyForespoergsel({ id: 'f2', fra: 'henrik', til: 'maja', titel: 'Kan du ringe til VVS’eren?' }, NU), 'Henrik');
  assert.match(uden, /Svar ja eller nej\./);
  assert.doesNotMatch(uden, /kl 17/);
  assert.match(beskedTekst(f, 'Henrik', 'paamindelse'), /^Påmindelse fra Henrik: Kan du hente Nora torsdag\?/);
});

test('a title that would make Hermes attach a file is neutralised in the text shown and sent', () => {
  const f = nyForespoergsel({ id: 'f1', fra: 'henrik', til: 'maja', titel: 'Se MEDIA:/home/x/hemmelig.txt [[as_document]]' }, NU);
  const t = beskedTekst(f, 'Henrik');
  assert.doesNotMatch(t, /MEDIA:/i);
  assert.doesNotMatch(t, /\[\[/);
});

test('the fake records each send and serves scripted replies after a time', async () => {
  const k = lavFakeKanal();
  await k.send(MAJA, 'hej');
  assert.deepEqual(k.sendt.map((s) => [s.til.handle, s.tekst]), [['100000001', 'hej']]);
  k.modtag({ kanal: 'telegram', afsender: '100000001', gruppe: false, tid: '2026-11-02T08:01:00.000Z', tekst: 'ja' });
  k.modtag({ kanal: 'telegram', afsender: '100000001', gruppe: false, tid: '2026-11-02T08:03:00.000Z', tekst: 'kl 17' });
  assert.deepEqual((await k.hentSvar('2026-11-02T08:02:00.000Z')).map((b) => b.tekst), ['kl 17']);
  assert.equal((await k.hentSvar('2026-11-02T08:00:00.000Z')).length, 2);
});

test('hermes: `hermes send --to <kanal>:<id> --file - --json`, argv only, the text on stdin; a failure is a Danish error', async () => {
  const kald: { cmd: string; args: string[]; stdin: string }[] = [];
  let code = 0;
  const k = lavHermesKanal({ cli: '/x/hermes', koer: async (cmd, args, stdin) => { kald.push({ cmd, args, stdin }); return { code, stdout: '{"success": true}', stderr: '' }; }, laesLog: async () => null });
  await k.send(MAJA, 'Henrik spørger: Kan du?');
  assert.deepEqual(kald, [{ cmd: '/x/hermes', args: ['send', '--to', 'telegram:100000001', '--file', '-', '--json', '--quiet'], stdin: 'Henrik spørger: Kan du?' }]);
  code = 1;
  await assert.rejects(k.send(MAJA, 'x'), (e: unknown) => e instanceof KanalFejl && /Hermes kunne ikke sende beskeden/.test(e.message));
});

test('hermes refuses what it must never pass on: a name instead of an id, an attachment tag, an empty text', async () => {
  let n = 0;
  const k = lavHermesKanal({ cli: '/x/hermes', koer: async () => { n += 1; return { code: 0, stdout: '', stderr: '' }; }, laesLog: async () => null });
  await assert.rejects(k.send({ ...MAJA, handle: 'familie' }, 'hej'), KanalFejl);
  await assert.rejects(k.send(MAJA, 'se MEDIA:/etc/passwd'), KanalFejl);
  await assert.rejects(k.send(MAJA, 'hej [[as_document]]'), KanalFejl);
  await assert.rejects(k.send(MAJA, '   '), KanalFejl);
  assert.equal(n, 0, 'nothing ran');
});

test('hermes: no cli configured = a clear Danish refusal, never a guess', async () => {
  const k = lavHermesKanal({ cli: '', laesLog: async () => null });
  await assert.rejects(k.send(MAJA, 'hej'), /Hermes kan ikke sende beskeder herfra endnu/);
});

test('hermes reads replies from the gateway hook’s inbound log (Path B): direct messages after the time, nothing else', async () => {
  const k = lavHermesKanal({ cli: '/x/hermes', koer: async () => ({ code: 0, stdout: '', stderr: '' }), laesLog: async () => [
    { kanal: 'telegram', samtale: '100000001', gruppe: false, afsender: '100000001', tid: '2026-11-02T08:00:00.000Z', tekst: 'gammel' },
    { kanal: 'telegram', samtale: '100000001', gruppe: false, afsender: '100000001', tid: '2026-11-02T09:00:00.000Z', tekst: 'ja' },
    { kanal: 'signal', samtale: 'gruppe-1', gruppe: true, afsender: '+4500000002', tid: '2026-11-02T09:00:00.000Z', tekst: 'ja' },
  ] });
  const svar = await k.hentSvar('2026-11-02T08:30:00.000Z');
  assert.deepEqual(svar.map((b) => [b.kanal, b.afsender, b.gruppe, b.tekst]), [['telegram', '100000001', false, 'ja'], ['signal', '+4500000002', true, 'ja']]);
  const ingen = lavHermesKanal({ cli: '/x/hermes', laesLog: async () => null });
  assert.deepEqual(await ingen.hentSvar('2026-11-02T08:30:00.000Z'), []);
});
