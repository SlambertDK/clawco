// Detective control (KC-0122). Hermes' api_server chooses its own tools — its
// toolsets come from the gateway config, not per run (verified against
// hermes-agent on kira-home 2026-10-31) — so the app cannot block a tool before
// it runs. src/runs.ts watches every `tool.started` instead and aborts the run
// (KC-0118 signal) when a tool or a terminal command reaches past the verb the
// handling passed `afgoer` with. It is detective, not preventive: it sees a
// tool's name and the preview Hermes sends, after the tool has started, and
// matches known shapes. The terminal can still do anything a pattern does not
// know, and a preview may be truncated (KC-0125's threat model); the real
// guard is the verb the app gives a handling (verber.ts). Scratch files and
// code are not limited by verb: with the terminal allowed that would block
// real runs without stopping anything — the limits that matter are send and
// delete. KC-0270 (B2) widened the shapes after the security review's bypasses.

import { AsyncLocalStorage } from 'node:async_hooks';
import { graenserTekst } from './tekster.ts';

/** The verb the current handling passed the policy layer with; port.ts sets it, runs.ts reads it when a run starts. */
export const VERB_NU = new AsyncLocalStorage<string>();

/** A run outside any handling (timers, Kuratoren): reading and preparing, never sending or deleting. */
export const STANDARD_VERB = 'udfoer-med-fortryd';

/** Tools no app run may use: standing schedules, connections, the physical home, skills, delegation, form clicks in a browser. */
const ALDRIG = new Set(['cronjob_manage', 'manage_connections', 'ha_call_service', 'skill_manage', 'delegate_task',
  'browser_click', 'browser_type', 'browser_press', 'browser_exec', 'browser_cdp', 'browser_dialog', 'browser_vault']);

/** KC-0270 (B2): a tool that talks to people by its name (send_message, gmail_send, telegram_…, post_…). */
const BESKED_VAERKTOEJ = /send|mail|sms|telegram|whatsapp|signal|post_/i;

/** Terminal commands that reach other people or carry data out: mail, uploads, raw SMTP, and code fetched or decoded into a shell (unknown = may send). */
const SEND: readonly RegExp[] = [
  /himalaya\s+(?:\S+\s+)*(?:message|template)\s+(?:send|reply|forward)\b/i, /\bsendmail\b/i, /\bmsmtp\b/i, /smtp/i,
  /\bcurl\b[^|;&\n]*\s(?:-[a-zA-Z]*[dTF]|--data(?:-\S*)?|--upload-file|--form|--json)(?=[\s=@'"]|$)/,
  /\bwget\b[^|;&\n]*--post-(?:data|file)/i,
  /\bopenssl\s+s_client\b/i, /\b(?:nc|ncat|netcat)\b[^|;&\n]*\b(?:25|465|587)\b/i,
  /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|python[0-9.]*|perl|ruby|node)\b/i,
  /\bbase64\s+(?:-[a-zA-Z]*[dD]|--decode)\b/, /(?:^|[\s;&|(])eval\b/,
];
/** Terminal commands that delete: delete/expunge/purge, a move to the bin, a deleted flag. */
const SLET: readonly RegExp[] = [
  /himalaya\s+(?:\S+\s+)*(?:message|folder)\s+(?:delete|expunge|purge)\b/i,
  /himalaya\s+(?:\S+\s+)*message\s+move\s+(?:\S+\s+)*["']?Trash\b/i,
  /himalaya\s+(?:\S+\s+)*flag\s+(?:add|set)\b[^|;&\n]*\bdeleted\b/i,
];
/** A web address and a file under the home folder in one preview: data on its way out. */
const URL_TEGN = /https?:\/\//i;
const HJEMMEFIL = /\$HOME\b|\$\{HOME\}|(?:^|[\s=?&"'])~\/|\/home\/|\/Users\/|\/root\//;

export function vaerktoejTilladt(verb: string, tool: string, preview: string): { ok: boolean; hvorfor: string } {
  const stop = (hvad: string): { ok: false; hvorfor: string } => ({ ok: false, hvorfor: graenserTekst().stoppedeKoerslen(hvad) });
  if (ALDRIG.has(tool)) return stop(graenserTekst().hvadVaerktoej(tool));
  if (tool === 'terminal' || tool === 'process_manage') {
    if (SLET.some((r) => r.test(preview)) && verb !== 'slet') return stop(graenserTekst().hvadSlet);
    if (SEND.some((r) => r.test(preview)) && verb !== 'send-til-andre') return stop(graenserTekst().hvadSendMail);
    return { ok: true, hvorfor: '' };
  }
  if (verb === 'send-til-andre') return { ok: true, hvorfor: '' };
  if (BESKED_VAERKTOEJ.test(tool)) return stop(graenserTekst().hvadVaerktoej(tool));
  if (URL_TEGN.test(preview) && HJEMMEFIL.test(preview)) return stop(graenserTekst().hvadVaerktoej(tool));
  return { ok: true, hvorfor: '' };
}
