// Detective control (KC-0122). Hermes' api_server chooses its own tools — its
// toolsets come from the gateway config, not per run (verified against
// hermes-agent on kira-home 2026-10-31) — so the app cannot block a tool before
// it runs. src/runs.ts watches every `tool.started` instead and aborts the run
// (KC-0118 signal) when a tool or a terminal command reaches past the verb the
// handling passed `afgoer` with. Residual risk (the terminal can do anything,
// a preview may be truncated) is KC-0125's threat model. Scratch files and code
// are not limited by verb: with the terminal allowed that would block real runs
// without stopping anything — the limits that matter are send and delete.

import { AsyncLocalStorage } from 'node:async_hooks';

/** The verb the current handling passed the policy layer with; port.ts sets it, runs.ts reads it when a run starts. */
export const VERB_NU = new AsyncLocalStorage<string>();

/** A run outside any handling (timers, Kuratoren): reading and preparing, never sending or deleting. */
export const STANDARD_VERB = 'udfoer-med-fortryd';

/** Tools no app run may use: standing schedules, connections, the physical home, skills, delegation, form clicks in a browser. */
const ALDRIG = new Set(['cronjob_manage', 'manage_connections', 'ha_call_service', 'skill_manage', 'delegate_task',
  'browser_click', 'browser_type', 'browser_press', 'browser_exec', 'browser_cdp', 'browser_dialog', 'browser_vault']);

const SEND = /himalaya\s+(?:\S+\s+)*message\s+(?:send|reply|forward)\b|\bsendmail\b|\bmsmtp\b|\bsmtp\b/i;
const SLET = /himalaya\s+(?:\S+\s+)*(?:message|folder)\s+(?:delete|expunge|purge)\b|himalaya\s+(?:\S+\s+)*message\s+move\s+(?:-\S+\s+)*["']?Trash\b/i;

export function vaerktoejTilladt(verb: string, tool: string, preview: string): { ok: boolean; hvorfor: string } {
  const stop = (hvad: string): { ok: false; hvorfor: string } => ({ ok: false, hvorfor: `Clawco stoppede kørslen: Hermes ville ${hvad}, og det må handlingen ikke.` });
  if (ALDRIG.has(tool)) return stop(`bruge værktøjet ${tool}`);
  if (tool === 'terminal' || tool === 'process_manage') {
    if (SEND.test(preview) && verb !== 'send-til-andre') return stop('sende en mail');
    if (SLET.test(preview) && verb !== 'slet') return stop('slette noget');
  }
  return { ok: true, hvorfor: '' };
}
