// Network harness for the gateway tests: a fake tenant on an ephemeral loopback port that records what reaches
// it, the gateway behind a real node:http server, and requests with a chosen Host (fetch cannot set Host).
import http, { type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gateway, type GatewayDeps } from '../../src/gateway/proxy.ts';
import { vaertsArt } from '../../src/gateway/rute.ts';

export type Modtaget = { metode: string; url: string; headers: IncomingHttpHeaders; krop: string };

export type FalskTenant = { adresse: string; modtaget: Modtaget[]; sseSlut: () => void; luk: () => Promise<void> };

export async function falskTenant(): Promise<FalskTenant> {
  const modtaget: Modtaget[] = [];
  let slut: (() => void) | null = null;
  const server = http.createServer((req, res) => {
    let krop = '';
    req.setEncoding('utf8').on('data', (d: string) => { krop += d; });
    req.on('end', () => {
      modtaget.push({ metode: req.method ?? '', url: req.url ?? '', headers: req.headers, krop });
      if (req.url === '/sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        res.write('data: foerste\n\n');
        slut = () => { res.end('data: sidste\n\n'); };
        return;
      }
      if (req.url === '/saet-cookie') {
        res.writeHead(200, { 'set-cookie': ['__Host-clawco=fra-tenant; Path=/; Secure', 'tenant=1; Path=/'], 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'max-age=7', etag: '"v1"' });
      res.end(JSON.stringify({ url: req.url }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    adresse: `http://127.0.0.1:${port}`, modtaget,
    sseSlut: () => slut?.(),
    luk: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export type Gw = { port: number; luk: () => Promise<void> };

export async function startGateway(d: GatewayDeps): Promise<Gw> {
  const gw = gateway(d);
  const server = http.createServer((req, res) => {
    const a = vaertsArt(req.headers.host, { kontoVaert: 'konto.eksempel.test', basedomain: 'eksempel.test' });
    if (a.art === 'tenant') gw(req, res, a.slug);
    else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, luk: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

export type Svar = { status: number; headers: IncomingHttpHeaders; krop: string };

export function anmod(port: number, o: { host: string; sti: string; metode?: string; headers?: Record<string, string>; krop?: string }): Promise<Svar> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: o.sti, method: o.metode ?? 'GET', headers: { host: o.host, ...o.headers }, agent: false }, (res) => {
      let krop = '';
      res.setEncoding('utf8').on('data', (d: string) => { krop += d; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, krop }));
    });
    r.on('error', reject);
    r.end(o.krop);
  });
}

/** Opens a streaming GET and resolves with the first chunk while the response is still open. */
export function foersteBid(port: number, o: { host: string; sti: string; headers?: Record<string, string> }): Promise<{ status: number; headers: IncomingHttpHeaders; bid: string; resten: Promise<string> }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: o.sti, headers: { host: o.host, ...o.headers }, agent: false }, (res) => {
      res.setEncoding('utf8');
      let resten = '';
      const slut = new Promise<string>((ok) => { res.on('end', () => ok(resten)); });
      res.once('data', (d: string) => {
        res.on('data', (x: string) => { resten += x; });
        resolve({ status: res.statusCode ?? 0, headers: res.headers, bid: d, resten: slut });
      });
    });
    r.on('error', reject);
    r.end();
  });
}
