// Raw data in for Mail: envelopes of Kira's Proton folders via the `himalaya`
// CLI (through an injectable runner) and today's auto-sort plan files in
// ~/.agent/state. Trimmed to what Hermes needs; never mail bodies.

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type Envelope = { id: string; emne: string; fra: string; fraEmail?: string; modtaget: string; laest: boolean; flag: boolean; vedhaeftning: boolean; /** The mail's Message-ID (stable across folders); for Kuratoren's dedupe only, never shown or sent. */ messageId?: string };
export type OrdnetPost = { mailId: string; til: string; hvorfor: string; tid: string };
export type TrimmedMail = {
  dato: string;
  hentet: string;
  handling: Envelope[];
  tal: { handling: number; afventer: number; regninger: number; indbakke: number; sorteretIDag: number };
  ordnet: OrdnetPost[];
  fejl?: string[];
};
export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const MAX_HANDLING = 20;
const MAX_ORDNET = 60;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const s = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function parseAll(json: unknown): Envelope[] {
  const list = Array.isArray(json) ? json : isObj(json) && Array.isArray(json['envelopes']) ? json['envelopes'] : [];
  const out: Envelope[] = [];
  for (const e of list) {
    if (!isObj(e)) continue;
    const id = typeof e['id'] === 'number' ? String(e['id']) : s(e['id'], 40);
    if (!id) continue;
    const flags = Array.isArray(e['flags']) ? e['flags'] : [];
    const has = (iana: string) => flags.some((f) => isObj(f) && f['iana'] === iana);
    const from = Array.isArray(e['from']) ? e['from'][0] : undefined;
    const fraEmail = isObj(from) ? s(from['email'], 200) : '';
    const env: Envelope = {
      id,
      emne: s(e['subject'], 300) || '(uden emne)',
      fra: (isObj(from) ? s(from['name'], 120) : '') || fraEmail || '(ukendt afsender)',
      modtaget: s(e['date'], 40),
      laest: has('seen'),
      flag: has('flagged'),
      vedhaeftning: e['has-attachment'] === true,
    };
    if (fraEmail) env.fraEmail = fraEmail;
    const messageId = s(e['message-id'], 300) || s(e['message_id'], 300);
    if (messageId) env.messageId = messageId;
    out.push(env);
  }
  const ts = (e: Envelope) => { const n = Date.parse(e.modtaget); return Number.isNaN(n) ? 0 : n; };
  out.sort((a, b) => ts(b) - ts(a));
  return out;
}

/** himalaya --json -> Envelope[], newest first, capped at 20. */
export function parseEnvelopes(json: unknown): Envelope[] {
  return parseAll(json).slice(0, MAX_HANDLING).map(({ messageId: _, ...e }) => e);
}

const PLAN_NAME = /^mail-plan-auto-(\d{4}-\d{2}-\d{2})-(\d{6})\.json$/;

/** "2026-10-27" + "083001" -> "2026-10-27T08:30:01" (local time, no zone suffix). */
function tidFromName(name: string): string {
  const m = PLAN_NAME.exec(name);
  if (!m) return '';
  const hms = m[2] ?? '';
  return `${m[1]}T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}`;
}

export function parsePlanFile(name: string, json: unknown): OrdnetPost[] {
  const tid = tidFromName(name);
  const actions = isObj(json) && Array.isArray(json['actions']) ? json['actions'] : [];
  const out: OrdnetPost[] = [];
  for (const a of actions) {
    if (!isObj(a)) continue;
    const mailId = typeof a['id'] === 'number' ? String(a['id']) : s(a['id'], 40);
    if (!mailId) continue;
    const op = s(a['op'], 20);
    const to = s(a['to'], 200);
    let til: string;
    if (op === 'archive') til = to || 'Archive';
    else if (op === 'move' && to) til = to;
    else continue;
    out.push({ mailId, til, hvorfor: s(a['why'], 300), tid });
  }
  return out;
}

const TZ = 'Europe/Copenhagen';

/** YYYY-MM-DD for `now` in Copenhagen time. */
function copenhagenDate(now: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

type Listing = { envelopes: Envelope[]; fejl?: string };

/** Never throws: a failed or unparsable listing becomes an empty list plus a fejl line. */
async function listMailbox(run: Runner, himalaya: string, mailbox: string): Promise<Listing> {
  const fail = (msg: string): Listing => ({ envelopes: [], fejl: `${mailbox}: ${msg.slice(0, 120)}` });
  try {
    const r = await run(himalaya, ['envelope', 'list', '-m', mailbox, '-s', '120', '-p', '1', '--json']);
    if (r.code !== 0) return fail(r.stderr || `exit ${r.code}`);
    return { envelopes: parseAll(JSON.parse(r.stdout)) };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Today's auto-sort plans, newest file first. A missing or unreadable dir or file counts as nothing. */
async function readOrdnet(stateDir: string, dato: string): Promise<OrdnetPost[]> {
  let names: string[];
  try {
    names = await readdir(stateDir);
  } catch {
    return [];
  }
  const today = names.filter((n) => PLAN_NAME.exec(n)?.[1] === dato).sort().reverse();
  const out: OrdnetPost[] = [];
  for (const name of today) {
    try {
      out.push(...parsePlanFile(name, JSON.parse(await readFile(path.join(stateDir, name), 'utf8'))));
    } catch {
      continue;
    }
  }
  return out.slice(0, MAX_ORDNET);
}

export async function readMailSource(opts: { run: Runner; stateDir: string; now: Date; himalaya?: string }): Promise<TrimmedMail> {
  const himalaya = opts.himalaya ?? 'himalaya';
  const [handling, afventer, regninger, indbakke] = await Promise.all(
    ['Folders/Handling', 'Folders/Afventer', 'Folders/Regninger', 'Inbox'].map((mb) => listMailbox(opts.run, himalaya, mb)),
  );
  const dato = copenhagenDate(opts.now);
  const ordnet = await readOrdnet(opts.stateDir, dato);
  const h = handling?.envelopes ?? [];
  const out: TrimmedMail = {
    dato,
    hentet: opts.now.toISOString(),
    handling: h.slice(0, MAX_HANDLING),
    tal: {
      handling: h.length,
      afventer: afventer?.envelopes.length ?? 0,
      regninger: regninger?.envelopes.length ?? 0,
      indbakke: indbakke?.envelopes.length ?? 0,
      sorteretIDag: ordnet.length,
    },
    ordnet,
  };
  const fejl = [handling, afventer, regninger, indbakke].flatMap((l) => (l?.fejl ? [l.fejl] : []));
  if (fejl.length) out.fejl = fejl;
  return out;
}

/**
 * KC-0214: the inbox as the mail connector read it (envelopes only), in the shape the refresh reads. The counts are
 * the ones the app can know — the inbox; no plan files, so nothing was sorted today.
 * KC-0223 `laeseKun`: a connection Clawco may only read shows what waits — unread or flagged — and `tal.handling`
 * counts those (before the cap); `tal.indbakke` stays the whole read.
 */
export function fraForbindelse(kuverter: Envelope[], now: Date, o: { laeseKun?: boolean } = {}): TrimmedMail {
  const venter = o.laeseKun ? kuverter.filter((k) => !k.laest || k.flag) : kuverter;
  return {
    dato: copenhagenDate(now),
    hentet: now.toISOString(),
    handling: venter.slice(0, MAX_HANDLING).map(({ messageId: _, ...e }) => e),
    tal: { handling: venter.length, afventer: 0, regninger: 0, indbakke: kuverter.length, sorteretIDag: 0 },
    ordnet: [],
  };
}

const RUN_TIMEOUT_MS = 60_000;

/** execFile with a 60 s timeout. Never rejects: a spawn error, timeout or non-zero exit resolves. */
export function defaultRunner(): Runner {
  return (cmd, args) =>
    new Promise((resolve) => {
      execFile(cmd, args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr });
        const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
        if (typeof code === 'number') return resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
        resolve({ code: -1, stdout: stdout ?? '', stderr: err.message });
      });
    });
}
