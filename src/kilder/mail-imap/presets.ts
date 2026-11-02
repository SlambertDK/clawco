// KC-0134: the mail services a user can pick on the Mail card, as data, and
// the connection their choice resolves to. TLS rule (§0 r7): every host is
// verified normally; the one exception is a loopback IP literal (Proton
// Bridge's self-signed certificate) whose SHA-256 fingerprint was pinned on
// first use — then that certificate is the only trust anchor and the
// fingerprint must match exactly. There is no plaintext option.

import { X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import type { ConnectionOptions, PeerCertificate } from 'node:tls';
import { KildeFejl } from '../types.ts';
import { imapTekst } from './tekster.ts';

export const TJENESTER = ['proton-bridge', 'fastmail', 'icloud', 'gmail', 'anden'] as const;
export type TjenesteId = (typeof TJENESTER)[number];
export type Sikkerhed = 'tls' | 'starttls';
export type Preset = { navn: string; vaert: string; port: number; sikkerhed: Sikkerhed };

// KC-0170: `navn` is read in the language of the request each time (the service names are in ./tekster.ts).
export const PRESETS: Readonly<Record<TjenesteId, Preset>> = {
  'proton-bridge': { get navn() { return imapTekst().tjenester['proton-bridge']; }, vaert: '127.0.0.1', port: 1143, sikkerhed: 'starttls' },
  fastmail: { get navn() { return imapTekst().tjenester.fastmail; }, vaert: 'imap.fastmail.com', port: 993, sikkerhed: 'tls' },
  icloud: { get navn() { return imapTekst().tjenester.icloud; }, vaert: 'imap.mail.me.com', port: 993, sikkerhed: 'tls' },
  gmail: { get navn() { return imapTekst().tjenester.gmail; }, vaert: 'imap.gmail.com', port: 993, sikkerhed: 'tls' },
  anden: { get navn() { return imapTekst().tjenester.anden; }, vaert: '', port: 993, sikkerhed: 'tls' },
};

/** What a connection needs besides the password. `bruger` is the mail address (the IMAP login on every preset). */
export type Forbindelse = { tjeneste: TjenesteId; vaert: string; port: number; sikkerhed: Sikkerhed; bruger: string };
/** A pin: the fingerprint stored in kilder.json and the certificate fetched for this connection (already matched to it). */
export type Pin = { fingeraftryk: string; pem: string };

const erTjeneste = (v: unknown): v is TjenesteId => typeof v === 'string' && (TJENESTER as readonly string[]).includes(v);
const VAERT = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;

/** The connection the card's options describe. Only `anden` takes server and security; `port` overrides any preset. */
export function forbindelse(valg: Readonly<Record<string, string>>): Forbindelse {
  const tjeneste = valg['tjeneste'];
  if (!erTjeneste(tjeneste)) throw new KildeFejl(400, imapTekst().vaelgTjeneste);
  const bruger = (valg['adresse'] ?? '').trim();
  if (!bruger) throw new KildeFejl(400, imapTekst().skrivAdresse);
  const p = PRESETS[tjeneste];
  let { vaert, sikkerhed } = p;
  let port = p.port;
  if (tjeneste === 'anden') {
    vaert = (valg['server'] ?? '').trim();
    if (!vaert) throw new KildeFejl(400, imapTekst().skrivServer);
    if (!VAERT.test(vaert) && !isIP(vaert)) throw new KildeFejl(400, imapTekst().serverUgyldig);
    sikkerhed = valg['sikkerhed'] === 'starttls' ? 'starttls' : 'tls';
    port = sikkerhed === 'starttls' ? 143 : 993;
  }
  const egen = (valg['port'] ?? '').trim();
  if (egen) {
    const n = Number(egen);
    if (!/^\d{1,5}$/.test(egen) || n < 1 || n > 65535) throw new KildeFejl(400, imapTekst().portUgyldig);
    port = n;
  }
  return { tjeneste, vaert, port, sikkerhed, bruger };
}

/** A loopback IP literal (127.0.0.0/8 or ::1). A name, even "localhost", is not: it resolves elsewhere if DNS says so. */
export function erLoopback(vaert: string): boolean {
  if (isIP(vaert) === 4) return vaert.startsWith('127.');
  return vaert === '::1';
}

/** "ab12…" or "AB:12:…" → "AB:12:…" (32 bytes); anything else → ''. */
export function normalFingeraftryk(v: string): string {
  const hex = v.replace(/[:\s]/g, '').toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? (hex.match(/../g) as string[]).join(':') : '';
}

/** The certificate's SHA-256 fingerprint in Node's format ("AB:12:…"). */
export const fingeraftrykAf = (pem: string): string => new X509Certificate(pem).fingerprint256;

/**
 * The options handed to tls.connect. Verification is never off: a pin (loopback only) makes the pinned certificate the
 * only trust anchor and requires the exact fingerprint; without one, or on any other host, Node's normal checks apply.
 */
export function tlsValg(f: Forbindelse, pin?: Pin): ConnectionOptions {
  const servername = isIP(f.vaert) ? {} : { servername: f.vaert };
  if (!pin || !erLoopback(f.vaert)) return { ...servername, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  const forventet = normalFingeraftryk(pin.fingeraftryk);
  if (!forventet || fingeraftrykAf(pin.pem) !== forventet) throw new PinFejl();
  return {
    rejectUnauthorized: true, minVersion: 'TLSv1.2', ca: [pin.pem],
    checkServerIdentity: (_vaert: string, cert: PeerCertificate) => (cert.fingerprint256 === forventet ? undefined : new PinFejl()),
  };
}

/** The loopback server presented another certificate than the pinned one. */
export class PinFejl extends Error {
  constructor() { super('certifikatet matcher ikke det gemte fingeraftryk'); this.name = 'PinFejl'; }
}
