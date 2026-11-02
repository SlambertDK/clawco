// KC-0122 detective control: Hermes' api_server picks its own tools (its toolsets
// come from its config, not per run — verified on kira-home 2026-10-31), so the
// app watches tool.started and stops a run that reaches past its verb.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERB_NU, vaerktoejTilladt } from '../../src/graenser/opsyn.ts';
import { createRunRegistry } from '../../src/runs.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';

test('tools that act outside the run (schedules, connections, the home, form clicks) are never allowed', () => {
  for (const tool of ['cronjob_manage', 'manage_connections', 'ha_call_service', 'skill_manage', 'delegate_task', 'browser_click', 'browser_type', 'browser_press', 'browser_vault']) {
    assert.equal(vaerktoejTilladt('udfoer-med-fortryd', tool, '').ok, false, tool);
  }
  for (const tool of ['web_search', 'web_extract', 'read_file', 'search_files', 'terminal', 'browser_navigate', 'browser_snapshot', 'vision_analyze', 'memory', 'todo_list']) {
    assert.equal(vaerktoejTilladt('laes', tool, 'ls').ok, true, tool);
  }
});

test('scratch files are not limited by verb (with the terminal allowed it would only break real runs)', () => {
  for (const verb of ['laes', 'sorter', 'forbered']) for (const tool of ['write_file', 'patch']) assert.equal(vaerktoejTilladt(verb, tool, '').ok, true, `${verb} ${tool}`);
});

test('a terminal command that sends or deletes mail stops a run whose verb does not allow it', () => {
  const send = ['himalaya message send < x.eml', 'himalaya message reply -m Folders/Handling 12', 'himalaya message forward 3', 'sendmail bob@example.com'];
  const slet = ['himalaya message delete 4', 'himalaya message move Trash 4', 'himalaya folder expunge INBOX'];
  for (const c of send) {
    assert.equal(vaerktoejTilladt('udfoer-med-fortryd', 'terminal', c).ok, false, c);
    assert.equal(vaerktoejTilladt('send-til-andre', 'terminal', c).ok, true, `${c} with a yes`);
  }
  for (const c of slet) {
    assert.equal(vaerktoejTilladt('send-til-andre', 'terminal', c).ok, false, c);
    assert.equal(vaerktoejTilladt('slet', 'terminal', c).ok, true, `${c} with a yes`);
  }
  assert.equal(vaerktoejTilladt('sorter', 'terminal', 'himalaya message move Archive 4 -f Folders/Handling').ok, true, 'moving to Archive is sorting');
  assert.match(vaerktoejTilladt('laes', 'terminal', 'himalaya message send').hvorfor, /stoppede/);
});

test('a run that reaches past its verb is aborted and fails with the reason', async () => {
  const hermes = createFakeAgent({ delayMs: 5, answer: () => ({ output: 'sendt', events: [{ type: 'tool.started', tool: 'terminal', preview: 'himalaya message send < svar.eml' }] }) });
  const runs = createRunRegistry(hermes);
  const r = VERB_NU.run('forbered', () => runs.start({ kind: 'handling', spec: { input: 'x', instructions: 'y' }, onDone: async () => ({ text: 'gjort' }) }));
  const ud = await r.finished;
  assert.equal(ud.status, 'failed');
  assert.match(ud.error ?? '', /stoppede/);
});

test('the same run under a verb that allows it finishes', async () => {
  const hermes = createFakeAgent({ delayMs: 5, answer: () => ({ output: 'sendt', events: [{ type: 'tool.started', tool: 'terminal', preview: 'himalaya message reply 12' }] }) });
  const runs = createRunRegistry(hermes);
  const r = VERB_NU.run('send-til-andre', () => runs.start({ kind: 'send', spec: { input: 'x', instructions: 'y' }, onDone: async () => ({ text: 'sendt' }) }));
  assert.equal((await r.finished).status, 'done');
});

test('scratch clean-up in the terminal is not a delete (only mail deletes are)', () => {
  assert.equal(vaerktoejTilladt('laes', 'terminal', 'rm -f /tmp/kc-udkast.txt').ok, true);
});
