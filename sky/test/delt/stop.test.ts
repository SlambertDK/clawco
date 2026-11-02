// KC-0221: Sky stops within a few seconds even with open connections. Found live 2026-11-01: a customer's
// live-update connection through the gateway kept server.close() waiting, systemd killed Sky after its 90 s
// stop timeout, and konto.clawco.work answered 502 meanwhile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { stopPaaSignal } from '../../src/delt/stop.ts';

async function serverMedAabenForbindelse(): Promise<{ server: http.Server; lukket: Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(': hej\n\n'); // an SSE stream that never ends
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const lukket = new Promise<void>((resolve) => {
    http.get(`http://127.0.0.1:${port}/`, (res) => { res.on('data', () => {}); res.on('close', () => resolve()); res.on('error', () => resolve()); });
  });
  await new Promise((r) => setTimeout(r, 50));
  return { server, lukket };
}

test('KC-0221: an open stream does not hold the stop: connections are cut after the drain, the rest runs, exit 0', async () => {
  const { server, lukket } = await serverMedAabenForbindelse();
  const kald: string[] = [];
  const t0 = Date.now();
  const kode = await stopPaaSignal({ server, frist: 200, foer: () => { kald.push('løkker'); }, efter: async () => { kald.push('db'); } });
  assert.equal(kode, 0);
  assert.ok(Date.now() - t0 < 2_000, `stoppede efter ${Date.now() - t0} ms`);
  await lukket;
  assert.deepEqual(kald, ['løkker', 'db']);
  assert.equal(server.listening, false);
});

test('KC-0221: with no open connection the stop is immediate', async () => {
  const server = http.createServer((_q, s) => s.end('ok'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const t0 = Date.now();
  assert.equal(await stopPaaSignal({ server, frist: 5_000, foer: () => {}, efter: async () => {} }), 0);
  assert.ok(Date.now() - t0 < 1_000);
});

test('KC-0221: a failing cleanup still ends the stop, with exit code 1', async () => {
  const server = http.createServer((_q, s) => s.end('ok'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  assert.equal(await stopPaaSignal({ server, frist: 100, foer: () => {}, efter: async () => { throw new Error('db lukkede ikke'); }, log: () => {} }), 1);
});
