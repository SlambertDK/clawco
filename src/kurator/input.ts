// Raw data in for Kuratoren: which mail is new since the last run. Read-only
// (himalaya `envelope list`, or KC-0214 the mail connector's INBOX envelopes
// in a Clawco without agent tools); never bodies, never moves, drafts or sends.

import { parseAll } from '../rooms/mail/source.ts';
import type { Envelope, Runner } from '../rooms/mail/source.ts';

export type NyMail = { id: string; mappe: string; emne: string; fra: string; modtaget: string; /** Message-ID when himalaya gives one: the dedupe key, never sent to Hermes. */ messageId?: string };

/** The Proton folders Hermes' mail plan sorts into, plus Inbox. */
export const KURATOR_MAPPER = ['Inbox', 'Folders/Handling', 'Folders/Regninger', 'Folders/køb', 'Archive'];

const MAX_MAILS = 40;
const MAX_SETE = 500;
const FIRST_RUN_DAYS = 7;
/** Mail can arrive (or be listed) later than its Date header: look this far behind the cursor; `sete` dedupes. */
const SLAEK_MS = 24 * 3_600_000;

const ts = (iso: string): number => {
  const n = Date.parse(iso);
  return Number.isNaN(n) ? 0 : n;
};

/** Sender name only: a name that is really an address keeps the part before "@". */
function afsender(fra: string): string {
  const at = fra.indexOf('@');
  if (at === -1) return fra;
  return fra.slice(0, at).trim() || '(ukendt afsender)';
}

/** One folder; a failure is logged and counts as an empty folder. Never throws. */
async function listMappe(run: Runner, himalaya: string, mappe: string): Promise<NyMail[]> {
  try {
    const r = await run(himalaya, ['envelope', 'list', '-m', mappe, '-s', '120', '-p', '1', '--json']);
    if (r.code !== 0) {
      console.error(`kurator: ${mappe}: ${(r.stderr || `exit ${r.code}`).slice(0, 120)}`);
      return [];
    }
    return parseAll(JSON.parse(r.stdout)).map((e) => ({
      id: e.id,
      mappe,
      emne: e.emne,
      fra: afsender(e.fra),
      modtaget: e.modtaget,
      ...(e.messageId ? { messageId: e.messageId } : {}),
    }));
  } catch (err) {
    console.error(`kurator: ${mappe}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
    return [];
  }
}

/** KC-0214: the folder name the mail connector reads (its ids are INBOX UIDs). */
export const FORBINDELSE_MAPPE = 'INBOX';

/** KC-0214: the connector's envelopes as INBOX mail. Never throws: a failed read is logged and counts as no mail. */
async function listForbindelse(laes: () => Promise<Envelope[]>): Promise<NyMail[]> {
  try {
    return (await laes()).map((e) => ({ id: e.id, mappe: FORBINDELSE_MAPPE, emne: e.emne, fra: afsender(e.fra), modtaget: e.modtaget, ...(e.messageId ? { messageId: e.messageId } : {}) }));
  } catch (err) {
    console.error(`kurator: ${FORBINDELSE_MAPPE}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
    return [];
  }
}

const noegle = (m: NyMail): string => m.messageId ?? `${m.mappe}:${m.id}`;

/** Where the mail is read: Hermes' folders through himalaya, or (KC-0214) the mail connector's inbox. */
export type MailKilde = { run: Runner; himalaya: string; mapper: string[] } | { forbindelse: () => Promise<Envelope[]> };

export async function nyeMails(o: MailKilde & {
  sete: string[];
  cursor?: string;
  now: Date;
}): Promise<{ mails: NyMail[]; cursor: string; sete: string[] }> {
  const since = o.cursor ? ts(o.cursor) - SLAEK_MS : o.now.getTime() - FIRST_RUN_DAYS * 86_400_000;
  // Seen keys: the Message-ID (the same mail moved to another folder is not new), else <mappe>:<id>;
  // the <mappe>:<id> key is checked too, for mail seen before Message-IDs were kept.
  const seen = new Set(o.sete);
  const lists = 'forbindelse' in o ? [await listForbindelse(o.forbindelse)] : await Promise.all(o.mapper.map((m) => listMappe(o.run, o.himalaya, m)));
  const nye = lists
    .flat()
    .filter((m) => ts(m.modtaget) >= since && !seen.has(`${m.mappe}:${m.id}`) && !seen.has(noegle(m)))
    .sort((a, b) => ts(b.modtaget) - ts(a.modtaget))
    .filter((m) => { const k = noegle(m); if (seen.has(k)) return false; seen.add(k); return true; });
  const mails = nye.slice(0, MAX_MAILS);
  const nyeste = mails[0]?.modtaget;
  // The cursor never moves backwards (a late mail is older than the cursor).
  const cursor = o.cursor && (!nyeste || ts(nyeste) < ts(o.cursor)) ? o.cursor : nyeste ?? new Date(since).toISOString();
  const sete = [...o.sete, ...[...nye].reverse().map(noegle)].slice(-MAX_SETE);
  return { mails, cursor, sete };
}
