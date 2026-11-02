// KC-0137: the fetcher, against a stub HTTP server on 127.0.0.1 (nothing leaves the machine).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { HentFejl, lavHenter } from '../../../src/kilder/nyheder-rss/hent.ts';

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
const lukkes: (() => Promise<void>)[] = [];
async function stub(h: Handler): Promise<{ port: number; url: (sti?: string) => string }> {
  const s = http.createServer(h);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  lukkes.push(() => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); }));
  const port = (s.address() as AddressInfo).port;
  return { port, url: (sti = '/') => `http://127.0.0.1:${port}${sti}` };
}
after(async () => { for (const l of lukkes) await l(); });

const bruger = { oprindelse: 'bruger' } as const;
const afvist = (kode: HentFejl['kode']) => (e: unknown): boolean => e instanceof HentFejl && e.kode === kode;

test('200: the text, the validators, the final address and a polite User-Agent', async () => {
  let ua = '';
  const s = await stub((req, res) => { ua = String(req.headers['user-agent']); res.writeHead(200, { 'content-type': 'application/rss+xml', etag: '"v1"', 'last-modified': 'Mon, 02 Nov 2026 06:00:00 GMT' }); res.end('<rss/>'); });
  const hent = lavHenter({ agent: 'Clawco/9.9' });
  const r = await hent(s.url('/feed'), bruger);
  assert.deepEqual(r, { status: 'ny', tekst: '<rss/>', etag: '"v1"', sidstRettet: 'Mon, 02 Nov 2026 06:00:00 GMT', endeligAdresse: s.url('/feed') });
  assert.equal(ua, 'Clawco/9.9');
});

test('304: the conditional headers go out and "uændret" comes back', async () => {
  let set: Record<string, unknown> = {};
  const s = await stub((req, res) => { set = { inm: req.headers['if-none-match'], ims: req.headers['if-modified-since'] }; res.writeHead(304); res.end(); });
  const r = await lavHenter()(s.url(), { ...bruger, etag: '"v1"', sidstRettet: 'Mon, 02 Nov 2026 06:00:00 GMT' });
  assert.deepEqual(r, { status: 'uaendret' });
  assert.deepEqual(set, { inm: '"v1"', ims: 'Mon, 02 Nov 2026 06:00:00 GMT' });
});

test('three redirects are followed, a fourth is refused', async () => {
  const s = await stub((req, res) => {
    const m = /^\/r(\d)$/.exec(req.url ?? '');
    if (m && Number(m[1]) < 4) { res.writeHead(302, { location: `/r${Number(m[1]) + 1}` }); res.end(); return; }
    res.writeHead(200); res.end('ok');
  });
  // The stub is on loopback; this test is about the count, so redirects may reach loopback here (never in the app).
  const hent = lavHenter({ tilladLoopbackUdefra: true });
  assert.equal(((await hent(s.url('/r1'), bruger)) as { tekst: string }).tekst, 'ok');
  await assert.rejects(hent(s.url('/r0'), bruger), afvist('omdirigering'));
});

test('a redirect into the local network is refused by default; to link-local always', async () => {
  const s = await stub((req, res) => {
    if (req.url === '/lokal') { res.writeHead(302, { location: `http://127.0.0.1:${(res.socket?.localPort) ?? 0}/maal` }); res.end(); return; }
    if (req.url === '/meta') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); return; }
    if (req.url === '/navn') { res.writeHead(302, { location: 'http://meta.test/x' }); res.end(); return; }
    if (req.url === '/cred') { res.writeHead(302, { location: 'http://u:p@example.com/x' }); res.end(); return; }
    res.writeHead(200); res.end('maal');
  });
  const opslag = async (v: string) => (v === 'meta.test' ? [{ address: '169.254.169.254', family: 4 as const }] : [{ address: '93.184.216.34', family: 4 as const }]);
  assert.equal(((await lavHenter({ opslag, tilladLoopbackUdefra: true })(s.url('/maal'), bruger)) as { tekst: string }).tekst, 'maal');
  await assert.rejects(lavHenter({ opslag })(s.url('/lokal'), bruger), afvist('afvist'));
  await assert.rejects(lavHenter({ opslag, tilladLoopbackUdefra: true })(s.url('/meta'), bruger), afvist('afvist'));
  await assert.rejects(lavHenter({ opslag, tilladLoopbackUdefra: true })(s.url('/navn'), bruger), afvist('afvist'));
  await assert.rejects(lavHenter({ opslag, tilladLoopbackUdefra: true })(s.url('/cred'), bruger), afvist('afvist'));
});

test('credentials in the address are refused before anything is sent', async () => {
  let kald = 0;
  const s = await stub((_req, res) => { kald += 1; res.end('x'); });
  await assert.rejects(lavHenter()(`http://u:p@127.0.0.1:${s.port}/`, bruger), afvist('afvist'));
  assert.equal(kald, 0);
});

test('a server that never answers hits the timeout; so does one that stalls in the body', async () => {
  const s = await stub((req, res) => { if (req.url === '/krop') { res.writeHead(200); res.write('<rss>'); } /* then silence */ });
  const hent = lavHenter({ tidMs: 200 });
  await assert.rejects(hent(s.url('/intet'), bruger), afvist('tid'));
  await assert.rejects(hent(s.url('/krop'), bruger), afvist('tid'));
});

test('a body over the cap is refused: declared length, streamed, and decompressed', async () => {
  const s = await stub((req, res) => {
    if (req.url === '/laengde') { res.writeHead(200, { 'content-length': '5000' }); res.end('x'.repeat(5000)); return; }
    if (req.url === '/strom') { res.writeHead(200); res.write('x'.repeat(600)); setTimeout(() => res.end('x'.repeat(600)), 20); return; }
    if (req.url === '/gzip') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(gzipSync(Buffer.alloc(2_000_000, 0x20))); return; }
    res.writeHead(200); res.end('x'.repeat(900));
  });
  const hent = lavHenter({ maksBytes: 1000 });
  await assert.rejects(hent(s.url('/laengde'), bruger), afvist('stor'));
  await assert.rejects(hent(s.url('/strom'), bruger), afvist('stor'));
  await assert.rejects(hent(s.url('/gzip'), bruger), afvist('stor'));
  assert.equal(((await hent(s.url('/lille'), bruger)) as { tekst: string }).tekst.length, 900);
});

test('gzip-encoded feeds are read', async () => {
  const s = await stub((_req, res) => { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(gzipSync('<rss>æøå</rss>')); });
  assert.equal(((await lavHenter()(s.url(), bruger)) as { tekst: string }).tekst, '<rss>æøå</rss>');
});

test('a charset in the Content-Type is honoured', async () => {
  const s = await stub((_req, res) => { res.writeHead(200, { 'content-type': 'application/rss+xml; charset=iso-8859-1' }); res.end(Buffer.from([0x3c, 0x72, 0x3e, 0xe6, 0xf8, 0xe5, 0x3c, 0x2f, 0x72, 0x3e])); });
  assert.equal(((await lavHenter()(s.url(), bruger)) as { tekst: string }).tekst, '<r>æøå</r>');
});

test('a non-2xx answer is an error naming the status', async () => {
  const s = await stub((_req, res) => { res.writeHead(503); res.end('nede'); });
  await assert.rejects(lavHenter()(s.url(), bruger), (e: unknown) => e instanceof HentFejl && e.kode === 'status' && e.message.includes('503'));
});

test('DNS rebinding: the connection goes to the address that was checked, resolved once', async () => {
  const s = await stub((_req, res) => { res.writeHead(200); res.end('fra den kontrollerede adresse'); });
  let opslagTal = 0;
  const opslag = async () => { opslagTal += 1; return opslagTal === 1 ? [{ address: '127.0.0.1', family: 4 as const }] : [{ address: '169.254.169.254', family: 4 as const }]; };
  const r = await lavHenter({ opslag })(`http://rebind.test:${s.port}/feed`, bruger);
  assert.equal((r as { tekst: string }).tekst, 'fra den kontrollerede adresse');
  assert.equal(opslagTal, 1);
});

test('a name that resolves to any refused address is refused as a whole', async () => {
  const opslag = async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '169.254.169.254', family: 4 as const }];
  await assert.rejects(lavHenter({ opslag })('http://blandet.test/feed', bruger), afvist('afvist'));
  await assert.rejects(lavHenter({ opslag: async () => { throw new Error('ENOTFOUND'); } })('http://findes-ikke.test/feed', bruger), afvist('net'));
});

test('at most two requests per host at a time', async () => {
  let nu = 0; let maks = 0;
  const s = await stub((_req, res) => { nu += 1; maks = Math.max(maks, nu); setTimeout(() => { nu -= 1; res.writeHead(200); res.end('x'); }, 60); });
  const hent = lavHenter({ perVaert: 2 });
  const alle = await Promise.all(Array.from({ length: 6 }, () => hent(s.url(), bruger)));
  assert.equal(alle.length, 6);
  assert.equal(maks, 2);
});
