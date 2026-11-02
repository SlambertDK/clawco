// KC-0134: a small scripted IMAP server for tests — just enough of RFC 3501
// for the mail connector (CAPABILITY, STARTTLS, LOGIN, LIST, LSUB, STATUS,
// EXAMINE, SELECT, FETCH, NOOP, LOGOUT; KC-0135: AUTHENTICATE XOAUTH2; KC-0214: UID MOVE with COPYUID and
// APPEND with a literal, for the connector's verbs). Every command name it
// receives is recorded in `kommandoer`, so a test can prove what was (never)
// sent; any other command is answered BAD. The mailboxes are a copy of the
// options (`postkasser`), so a move is visible to the test and never leaks
// into the next one. Listens on 127.0.0.1, an ephemeral port.

import { readFileSync } from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';

export type FalskBesked = { uid: number; flags?: string[]; dato: string; emne?: string; fra?: { navn?: string; adresse: string }; messageId?: string; vedhaeftning?: boolean };
export type FalskPostkasse = { navn: string; specialUse?: string; beskeder: FalskBesked[] };
export type FalskImapValg = {
  brugere: Record<string, string>;
  postkasser: FalskPostkasse[];
  /** 'starttls' (plain, then upgrade) or 'tls' (TLS from the first byte); absent = plaintext without STARTTLS. */
  tls?: 'starttls' | 'tls' | undefined;
  /** Which test certificate to present (test/helpers/certifikater/<cert>.crt). */
  cert?: 'bridge' | 'anden';
  /** Accept connections but never greet (a server that does not answer). */
  stum?: boolean;
  /** KC-0214: leave MOVE (RFC 6851) out of the capabilities. */
  udenMove?: boolean;
  /**
   * KC-0135: turns on AUTH=XOAUTH2 (Gmail's way in): `AUTHENTICATE XOAUTH2` is accepted when this says yes for the user
   * and bearer token in the initial response. A refusal is Google's shape: a `+` challenge with a JSON status, the
   * client's empty answer, then `NO [AUTHENTICATIONFAILED]`. Nothing the client sent is ever echoed back.
   */
  tokens?: (bruger: string, token: string) => boolean;
};
/** KC-0214: a message APPENDed: the mailbox, its flags and the raw message. */
export type Tilfoejet = { mappe: string; flag: string[]; tekst: string };
export type FalskImap = { port: number; kommandoer: string[]; logins: number; postkasser: FalskPostkasse[]; tilfoejet: Tilfoejet[]; luk(): Promise<void> };

const certFil = (n: string, ext: string): string => readFileSync(new URL(`./certifikater/${n}.${ext}`, import.meta.url), 'utf8');
export const testCertifikat = (n: 'bridge' | 'anden'): { cert: string; key: string } => ({ cert: certFil(n, 'crt'), key: certFil(n, 'key') });

const q = (v: string | undefined): string => {
  if (v === undefined || v === '') return 'NIL';
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7e]/.test(v)) return `"=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?="`;
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};
const adr = (a: FalskBesked['fra']): string => {
  if (!a) return 'NIL';
  const [mbox, host] = a.adresse.split('@');
  return `((${q(a.navn)} NIL ${q(mbox)} ${q(host)}))`;
};
const envelope = (b: FalskBesked): string =>
  `(${q(new Date(b.dato).toUTCString())} ${q(b.emne)} ${adr(b.fra)} ${adr(b.fra)} ${adr(b.fra)} NIL NIL NIL NIL ${q(b.messageId)})`;
const TEKST = '("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 12 1)';
const struktur = (b: FalskBesked): string => (b.vedhaeftning
  ? `(${TEKST}("application" "pdf" ("name" "bilag.pdf") NIL NIL "base64" 120 NIL ("attachment" ("filename" "bilag.pdf")) NIL NIL) "mixed")`
  : TEKST);

/** "1:3,7,9:*" against the sequence numbers 1..n. */
function saet(spec: string, n: number): number[] {
  const ud = new Set<number>();
  for (const del of spec.split(',')) {
    const [a, b] = del.split(':');
    const tal = (x: string | undefined): number => (x === '*' ? n : Number(x));
    const fra = tal(a);
    const til = b === undefined ? fra : tal(b);
    for (let i = Math.min(fra, til); i <= Math.max(fra, til); i++) if (i >= 1 && i <= n) ud.add(i);
  }
  return [...ud].sort((x, y) => x - y);
}

/** Splits an IMAP argument list into atoms, "quoted strings" and (parenthesised) groups. */
function tokens(s: string): string[] {
  const ud: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ') { i++; continue; }
    if (s[i] === '"') {
      let v = ''; i++;
      while (i < s.length && s[i] !== '"') { if (s[i] === '\\') i++; v += s[i]; i++; }
      ud.push(v); i++;
    } else if (s[i] === '(') {
      let d = 0; const start = i;
      do { if (s[i] === '(') d++; if (s[i] === ')') d--; i++; } while (i < s.length && d > 0);
      ud.push(s.slice(start, i));
    } else {
      const start = i;
      while (i < s.length && s[i] !== ' ') i++;
      ud.push(s.slice(start, i));
    }
  }
  return ud;
}

export async function startFalskImap(o: FalskImapValg): Promise<FalskImap> {
  const kommandoer: string[] = [];
  const stat = { logins: 0 };
  const kasser: FalskPostkasse[] = structuredClone(o.postkasser);
  const tilfoejet: Tilfoejet[] = [];
  const sockets = new Set<net.Socket>();
  const certogkey = testCertifikat(o.cert ?? 'bridge');

  function session(raa: net.Socket): void {
    sockets.add(raa);
    raa.on('close', () => sockets.delete(raa));
    raa.on('error', () => {});
    if (o.stum) return;
    let sock: net.Socket = raa;
    let sikker = o.tls === 'tls';
    let logget = false;
    let valgt: FalskPostkasse | undefined;
    let buf = '';
    /** KC-0214: an APPEND waiting for its literal (`{n}`): the tag, mailbox, flags and how many bytes are left. */
    let literal: { tag: string; mappe: string; flag: string[]; n: number } | undefined;
    const skriv = (l: string): void => { sock.write(`${l}\r\n`); };
    /** KC-0135: the tag of an AUTHENTICATE answered with a failure challenge, waiting for the client's empty line. */
    let authFejl: string | undefined;
    const caps = (): string => ['IMAP4rev1', 'SPECIAL-USE', ...(o.tokens ? ['AUTH=XOAUTH2', 'SASL-IR'] : []), ...(o.udenMove ? [] : ['MOVE']), ...(o.tls === 'starttls' && !sikker ? ['STARTTLS', 'LOGINDISABLED'] : [])].join(' ');
    const postkasse = (navn: string): FalskPostkasse | undefined => kasser.find((p) => p.navn.toUpperCase() === navn.toUpperCase());

    const linje = (l: string): void => {
      if (authFejl !== undefined) {
        const t = authFejl; authFejl = undefined;
        return skriv(`${t} NO [AUTHENTICATIONFAILED] Invalid credentials`);
      }
      const m = /^(\S+) (UID )?(\S+) ?(.*)$/.exec(l);
      if (!m) return;
      const [, tag, uid, navnRaa, rest = ''] = m;
      const navn = `${uid ? 'UID ' : ''}${(navnRaa ?? '').toUpperCase()}`;
      kommandoer.push(navn);
      const ok = (t = `${navn} completed`): void => skriv(`${tag} OK ${t}`);
      const args = tokens(rest);
      switch (navn) {
        case 'CAPABILITY': skriv(`* CAPABILITY ${caps()}`); return ok();
        case 'NOOP': return ok();
        case 'LOGOUT': skriv('* BYE ses'); ok(); sock.end(); return;
        case 'STARTTLS': {
          if (o.tls !== 'starttls' || sikker) return skriv(`${tag} BAD no`);
          ok('Begin TLS');
          sock.removeAllListeners('data');
          const t = new tls.TLSSocket(sock, { isServer: true, ...certogkey });
          t.on('error', () => {});
          sockets.add(t);
          t.on('data', data);
          sock = t; sikker = true; buf = '';
          return;
        }
        case 'AUTHENTICATE': {
          if (!o.tokens || (o.tls === 'starttls' && !sikker)) return skriv(`${tag} NO AUTHENTICATE ikke tilladt`);
          if ((args[0] ?? '').toUpperCase() !== 'XOAUTH2') return skriv(`${tag} NO ukendt mekanisme`);
          // eslint-disable-next-line no-control-regex
          const ind = /^user=(.*)\u0001auth=Bearer (.*)\u0001\u0001$/.exec(Buffer.from(args[1] ?? '', 'base64').toString('utf8'));
          if (ind && o.tokens(ind[1] ?? '', ind[2] ?? '')) { logget = true; stat.logins++; return ok('AUTHENTICATE completed'); }
          authFejl = tag;
          return skriv(`+ ${Buffer.from(JSON.stringify({ status: '401', schemes: 'Bearer', scope: 'https://mail.google.com/' })).toString('base64')}`);
        }
        case 'LOGIN': {
          if (o.tls === 'starttls' && !sikker) return skriv(`${tag} NO LOGINDISABLED`);
          const [bruger = '', kode = ''] = args;
          if (o.brugere[bruger] !== kode) return skriv(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials (${kode})`);
          logget = true; stat.logins++;
          return ok('LOGIN completed');
        }
      }
      if (!logget) return skriv(`${tag} BAD log ind først`);
      switch (navn) {
        case 'LIST': case 'LSUB':
          // LIST "" "" asks for the hierarchy delimiter only.
          if (args[1] === '') { skriv(`* ${navn} (\\Noselect) "/" ""`); return ok(); }
          for (const p of kasser) skriv(`* ${navn} (\\HasNoChildren${p.specialUse ? ` ${p.specialUse}` : ''}) "/" ${q(p.navn)}`);
          return ok();
        case 'STATUS': {
          const p = postkasse(args[0] ?? '');
          if (!p) return skriv(`${tag} NO findes ikke`);
          const usete = p.beskeder.filter((b) => !(b.flags ?? []).includes('\\Seen')).length;
          skriv(`* STATUS ${q(p.navn)} (MESSAGES ${p.beskeder.length} UNSEEN ${usete} UIDNEXT ${p.beskeder.length + 1} UIDVALIDITY 1)`);
          return ok();
        }
        case 'EXAMINE': case 'SELECT': {
          const p = postkasse(args[0] ?? '');
          if (!p) return skriv(`${tag} NO findes ikke`);
          valgt = p;
          skriv('* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)');
          skriv(`* ${p.beskeder.length} EXISTS`);
          skriv('* 0 RECENT');
          skriv('* OK [UIDVALIDITY 1] UIDs valid');
          skriv(`* OK [UIDNEXT ${Math.max(0, ...p.beskeder.map((b) => b.uid)) + 1}] next`);
          skriv(`* OK [PERMANENTFLAGS (${navn === 'SELECT' ? '\\Seen \\Flagged \\Deleted' : ''})] flags`);
          return ok(`[${navn === 'SELECT' ? 'READ-WRITE' : 'READ-ONLY'}] ${navn} completed`);
        }
        case 'FETCH': case 'UID FETCH': {
          if (!valgt) return skriv(`${tag} BAD ingen postkasse`);
          const b = valgt.beskeder;
          const seqs = navn === 'FETCH' ? saet(args[0] ?? '', b.length) : b.map((x, i) => ({ x, i })).filter(({ x }) => saet(args[0] ?? '', Math.max(0, ...b.map((y) => y.uid))).includes(x.uid)).map(({ i }) => i + 1);
          for (const s of seqs) {
            const x = b[s - 1] as FalskBesked;
            skriv(`* ${s} FETCH (UID ${x.uid} FLAGS (${(x.flags ?? []).join(' ')}) ENVELOPE ${envelope(x)} BODYSTRUCTURE ${struktur(x)})`);
          }
          return ok();
        }
        case 'UID MOVE': {
          if (!valgt) return skriv(`${tag} BAD ingen postkasse`);
          const maal = postkasse(args[1] ?? '');
          if (!maal) return skriv(`${tag} NO [TRYCREATE] findes ikke`);
          const uids = saet(args[0] ?? '', Math.max(0, ...valgt.beskeder.map((b) => b.uid)));
          const flyttes = valgt.beskeder.filter((b) => uids.includes(b.uid));
          const gamle: number[] = []; const nye: number[] = [];
          for (const b of flyttes) {
            const ny = Math.max(0, ...maal.beskeder.map((x) => x.uid)) + 1;
            gamle.push(b.uid); nye.push(ny);
            maal.beskeder.push({ ...b, uid: ny });
          }
          if (flyttes.length) skriv(`* OK [COPYUID 1 ${gamle.join(',')} ${nye.join(',')}] flyttet`);
          for (const b of flyttes) {
            const seq = valgt.beskeder.indexOf(b) + 1;
            valgt.beskeder.splice(seq - 1, 1);
            skriv(`* ${seq} EXPUNGE`);
          }
          return ok();
        }
        case 'APPEND': {
          // APPEND <mailbox> [(<flags>)] [<date>] {<n>}: the literal follows after our continuation.
          const m2 = /\{(\d+)\+?\}$/.exec(rest);
          const p = postkasse(args[0] ?? '');
          if (!m2) return skriv(`${tag} BAD literal mangler`);
          const flag = (args.find((a) => a.startsWith('(')) ?? '()').slice(1, -1).split(' ').filter(Boolean);
          literal = { tag: tag ?? '', mappe: p?.navn ?? '', flag, n: Number(m2[1]) };
          skriv('+ klar');
          return;
        }
        default: return skriv(`${tag} BAD ukendt kommando`);
      }
    };
    function data(d: Buffer): void {
      // latin1: one char per byte, so a literal's announced size is counted exactly.
      buf += d.toString('latin1');
      for (;;) {
        if (literal) {
          // The command line ends with CRLF after the literal: answer once both are here.
          const slut = buf.indexOf('\r\n', literal.n);
          if (buf.length < literal.n || slut < 0) return;
          const l = literal; literal = undefined;
          const tekst = Buffer.from(buf.slice(0, l.n), 'latin1').toString('utf8');
          buf = buf.slice(slut + 2);
          const p = postkasse(l.mappe);
          if (!p) { skriv(`${l.tag} NO [TRYCREATE] findes ikke`); continue; }
          const uid = Math.max(0, ...p.beskeder.map((x) => x.uid)) + 1;
          p.beskeder.push({ uid, flags: l.flag, dato: new Date().toISOString(), emne: '(tilføjet)' });
          tilfoejet.push({ mappe: p.navn, flag: l.flag, tekst });
          skriv(`${l.tag} OK [APPENDUID 1 ${uid}] APPEND completed`);
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const l = buf.slice(0, i); buf = buf.slice(i + 2); linje(l);
      }
    }
    sock.on('data', data);
    skriv(`* OK [CAPABILITY ${caps()}] falsk imap klar`);
  }

  const server = o.tls === 'tls' ? tls.createServer({ ...certogkey }, session) : net.createServer(session);
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port, kommandoer, postkasser: kasser, tilfoejet,
    get logins() { return stat.logins; },
    async luk() {
      // TLS sockets (added after their plain socket) first: a plain socket destroyed under live TLS can crash Node.
      for (const s of [...sockets].reverse()) s.destroy();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}

/** A port on 127.0.0.1 with nothing listening (a server that refuses). */
export async function lukketPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((res) => s.listen(0, '127.0.0.1', res));
  const port = (s.address() as net.AddressInfo).port;
  await new Promise<void>((res) => s.close(() => res()));
  return port;
}
