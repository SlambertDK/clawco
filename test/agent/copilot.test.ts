// KC-0263: the Copilot transport of the built-in agent. The SDK sits behind a tiny interface, so a fake client answers
// here; the real one is never started in the suite and no real token is used. Each security invariant has its own test:
// no tools, no MCP servers, no custom agents or skills, every permission denied, a tool event fails the run closed,
// fresh empty directories under the OS tmp, an allowlisted child env, no store/memory/telemetry/instruction discovery.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createCopilot, koerselsMiljoe, sessionValg, type CopilotFejlArt, type CopilotHaendelse, type CopilotKlient, type CopilotKlientValg,
  type CopilotSession, type CopilotSessionValg,
} from '../../src/agent/copilot.ts';
import { AFBRUDT, AgentError, type AgentEvent } from '../../src/agent/types.ts';

const TOKEN = 'gho_HEMMELIGtoken0263abcdefghijklmnop';
const FEJL: Record<CopilotFejlArt, string> = {
  github: 'F-GITHUB', kredit: 'F-KREDIT', model: 'F-MODEL', vaerktoej: 'F-VAERKTOEJ', 'copilot-start': 'F-START', ukendt: 'F-UKENDT',
};

type Script = (s: FalskSession) => Promise<void> | void;
class FalskSession implements CopilotSession {
  readonly sessionId: string;
  handlere: ((e: CopilotHaendelse) => void)[] = [];
  sendt: string[] = [];
  afbrudt = false;
  frakoblet = false;
  readonly cfg: CopilotSessionValg;
  private script: Script;
  constructor(id: string, cfg: CopilotSessionValg, script: Script) { this.sessionId = id; this.cfg = cfg; this.script = script; }
  on(h: (e: CopilotHaendelse) => void): () => void { this.handlere.push(h); return () => { this.handlere = this.handlere.filter((x) => x !== h); }; }
  emit(type: string, data: unknown = {}): void { for (const h of [...this.handlere]) h({ type, data }); }
  async send(o: { prompt: string }): Promise<string> { this.sendt.push(o.prompt); queueMicrotask(() => void this.script(this)); return 'msg-1'; }
  async abort(): Promise<void> { this.afbrudt = true; }
  async disconnect(): Promise<void> { this.frakoblet = true; }
}
class FalskKlient implements CopilotKlient {
  startet = 0;
  stoppet = 0;
  sessioner: FalskSession[] = [];
  slettet: string[] = [];
  readonly valg: CopilotKlientValg;
  private script: Script;
  private startFejl: boolean;
  constructor(valg: CopilotKlientValg, script: Script, startFejl = false) { this.valg = valg; this.script = script; this.startFejl = startFejl; }
  async start(): Promise<void> { if (this.startFejl) throw new Error(`spawn failed ${TOKEN}`); this.startet++; }
  async stop(): Promise<unknown> { this.stoppet++; return []; }
  async createSession(cfg: CopilotSessionValg): Promise<CopilotSession> { const s = new FalskSession(`s${this.sessioner.length + 1}`, cfg, this.script); this.sessioner.push(s); return s; }
  async deleteSession(id: string): Promise<void> { this.slettet.push(id); }
}

function sut(script: Script, o: { startFejl?: boolean; timeoutMs?: number; env?: Record<string, string | undefined> } = {}) {
  const klienter: FalskKlient[] = [];
  const copilot = createCopilot({
    fejl: FEJL,
    lavKlient: (valg) => { const k = new FalskKlient(valg, script, o.startFejl); klienter.push(k); return k; },
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    env: o.env ?? { PATH: '/usr/bin:/bin', HOME: '/home/henrik', KC_HERMES_API_KEY: 'k', ANTHROPIC_API_KEY: 'sk', GITHUB_TOKEN: 'ghp_x', NODE_OPTIONS: '--inspect', LANG: 'da_DK.UTF-8' },
  });
  const events: AgentEvent[] = [];
  const koer = (extra: { model?: string; signal?: AbortSignal; token?: string } = {}) => copilot.koer({ system: 'SYSTEM', input: 'INPUT', model: extra.model ?? 'claude-haiku-5.5', onEvent: (e) => events.push(e), ...(extra.signal ? { signal: extra.signal } : {}) }, extra.token ?? TOKEN);
  return { copilot, klienter, events, koer };
}
const svar = (tekst: string[]): Script => (s) => {
  for (const t of tekst) s.emit('assistant.message_delta', { deltaContent: t });
  s.emit('assistant.message', { content: tekst.join('') });
  s.emit('session.idle');
};
const intetSted = (ting: unknown): void => assert.ok(!JSON.stringify(ting, (_k, v) => (v instanceof Error ? v.message : v)).includes(TOKEN), 'the token is in no event or error');

test('a run: one session with the prompt; deltas as message.delta, then run.completed; the session is closed and deleted', async () => {
  const s = sut(svar(['Hej ', 'med ', 'dig']));
  const r = await s.koer();
  assert.equal(r.output, 'Hej med dig');
  assert.match(r.runId, /^copilot_/);
  assert.deepEqual(s.events, [
    { type: 'message.delta', text: 'Hej ' }, { type: 'message.delta', text: 'med ' }, { type: 'message.delta', text: 'dig' },
    { type: 'run.completed', output: 'Hej med dig' },
  ]);
  const k = s.klienter[0]!;
  const ses = k.sessioner[0]!;
  assert.deepEqual(ses.sendt, ['INPUT']);
  assert.equal(ses.frakoblet, true);
  assert.deepEqual(k.slettet, ['s1'], 'no conversation is left in the runtime\'s session state');
  await s.copilot.stop();
});

test('invariant: the client runs in empty mode with the token, no logged-in user, its home and cwd fresh under the OS tmp', async () => {
  const s = sut(svar(['ok']));
  await s.koer();
  const v = s.klienter[0]!.valg;
  assert.equal(v.mode, 'empty');
  assert.equal(v.gitHubToken, TOKEN);
  assert.equal(v.useLoggedInUser, false);
  const tmp = path.resolve(tmpdir());
  for (const d of [v.baseDirectory, v.workingDirectory]) {
    assert.ok(path.resolve(d).startsWith(tmp + path.sep), `${d} is under the OS tmp`);
    assert.ok(existsSync(d));
  }
  assert.equal(readdirSync(v.workingDirectory).length, 0, 'the runtime starts in an empty directory');
  assert.notEqual(v.baseDirectory, v.workingDirectory);
  assert.equal(v.env['HOME'], v.baseDirectory, 'HOME is the tmp base, so nothing lands in the real home');
  await s.copilot.stop();
  assert.equal(existsSync(v.baseDirectory), false, 'stop removes the tmp directories');
});

test('invariant: the child env is an allowlist: PATH, HOME → tmp, telemetry off; nothing of KC_, no key, no NODE_OPTIONS', () => {
  const env = koerselsMiljoe({ PATH: '/usr/bin', HOME: '/home/h', KC_DATA_DIR: '/data', KC_HERMES_API_KEY: 'x', ANTHROPIC_API_KEY: 'sk', GITHUB_TOKEN: 'ghp', GH_TOKEN: 'g', COPILOT_GITHUB_TOKEN: 'c', NODE_OPTIONS: '--require x', LANG: 'da_DK.UTF-8', LC_ALL: 'C' }, '/tmp/clawco-copilot-x/home');
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/tmp/clawco-copilot-x/home', TMPDIR: '/tmp/clawco-copilot-x/home', LANG: 'da_DK.UTF-8', LC_ALL: 'C', COPILOT_TELEMETRY_DISABLED: 'true' });
  assert.deepEqual(koerselsMiljoe({}, '/t'), { HOME: '/t', TMPDIR: '/t', COPILOT_TELEMETRY_DISABLED: 'true' });
});

test('invariant: the session gets no tools, no MCP servers, no custom agents, no skills; store, memory, telemetry and discovery off', async () => {
  const s = sut(svar(['ok']));
  await s.koer({ model: 'claude-sonnet-5.5' });
  const c = s.klienter[0]!.sessioner[0]!.cfg;
  assert.equal(c.model, 'claude-sonnet-5.5');
  assert.deepEqual(c.availableTools, [], 'nothing is allowed');
  assert.deepEqual(c.excludedTools, ['builtin:*', 'mcp:*', 'custom:*'], 'and everything is excluded (exclusion always wins)');
  assert.deepEqual(c.tools, []);
  assert.deepEqual(c.mcpServers, {});
  assert.deepEqual(c.customAgents, []);
  assert.deepEqual(c.skillDirectories, []);
  assert.deepEqual(c.includedBuiltinSkills, []);
  assert.deepEqual(c.instructionDirectories, []);
  assert.deepEqual(c.pluginDirectories, []);
  assert.deepEqual(c.agentDirectories, []);
  assert.deepEqual(c.hookDirectories, []);
  for (const k of ['enableSkills', 'enableConfigDiscovery', 'enableSessionStore', 'enableSessionTelemetry', 'enableOnDemandInstructionDiscovery', 'enableFileHooks', 'enableHostGitOperations', 'enableMcpApps', 'enableExperimentalMode', 'coauthorEnabled', 'manageScheduleEnabled'] as const) {
    assert.equal(c[k], false, k);
  }
  assert.equal(c.skipCustomInstructions, true);
  assert.equal(c.customAgentsLocalOnly, true);
  assert.deepEqual(c.memory, { enabled: false });
  assert.deepEqual(c.infiniteSessions, { enabled: false });
  assert.equal(c.streaming, true);
  assert.deepEqual(c.systemMessage, { mode: 'replace', content: 'SYSTEM' }, 'the system text replaces the CLI persona and its tool instructions');
  const v = s.klienter[0]!.valg;
  assert.ok(c.workingDirectory.startsWith(v.workingDirectory + path.sep), 'each session in its own fresh dir under the client\'s');
  assert.equal(existsSync(c.workingDirectory), false, 'removed after the run');
  await s.copilot.stop();
});

test('invariant: every permission request is denied, whatever its kind', async () => {
  const cfg = sessionValg({ model: 'm', system: 's', arbejdsmappe: '/tmp/x' });
  for (const kind of ['shell', 'write', 'read', 'mcp', 'custom-tool', 'url', 'memory', 'hook', 'noget-nyt']) {
    const r = await cfg.onPermissionRequest({ kind } as never, {} as never);
    assert.equal((r as { kind: string }).kind, 'reject', kind);
  }
});

test('invariant: a tool event fails the run closed with the fixed sentence and aborts the session', async () => {
  for (const type of ['tool.execution_start', 'tool.user_requested', 'external_tool.requested', 'permission.requested', 'subagent.started', 'skill.invoked', 'hook.start']) {
    const s = sut((ses) => { ses.emit('assistant.message_delta', { deltaContent: 'Jeg kører ' }); ses.emit(type, { toolName: 'bash' }); });
    const err = await s.koer().catch((e: unknown) => e);
    assert.ok(err instanceof AgentError, type);
    assert.equal(err.message, 'F-VAERKTOEJ', type);
    assert.deepEqual(s.events.at(-1), { type: 'run.failed', error: 'F-VAERKTOEJ' });
    assert.ok(!s.events.some((e) => e.type.startsWith('tool.')), 'no tool.* event reaches the run watcher as if it were allowed');
    assert.equal(s.klienter[0]!.sessioner[0]!.afbrudt, true, `${type}: the session is aborted`);
    await s.copilot.stop();
  }
});

test('errors map to fixed sentences; the provider\'s text (which may echo the token) never leaves', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ errorType: 'authentication', message: `Bad credentials ${TOKEN}` }, 'F-GITHUB'],
    [{ errorType: 'authorization', message: 'not entitled' }, 'F-GITHUB'],
    [{ errorType: 'quota', message: 'quota_exceeded' }, 'F-KREDIT'],
    [{ errorType: 'rate_limit', message: 'slow' }, 'F-KREDIT'],
    [{ errorType: 'query', message: 'Model claude-x is not supported', statusCode: 404 }, 'F-MODEL'],
    [{ errorType: 'query', message: 'boom' }, 'F-UKENDT'],
  ];
  for (const [data, forventet] of cases) {
    const s = sut((ses) => ses.emit('session.error', data));
    const err = await s.koer().catch((e: unknown) => e);
    assert.ok(err instanceof AgentError);
    assert.equal(err.message, forventet, JSON.stringify(data));
    intetSted([s.events, err]);
    await s.copilot.stop();
  }
});

test('the runtime that will not start fails with its own sentence, never the spawn error', async () => {
  const s = sut(svar(['x']), { startFejl: true });
  const err = await s.koer().catch((e: unknown) => e);
  assert.ok(err instanceof AgentError);
  assert.equal(err.message, 'F-START');
  intetSted([s.events, err]);
});

test('the caller\'s signal aborts the session; the run rejects with AFBRUDT', async () => {
  const ac = new AbortController();
  const s = sut((ses) => { ses.emit('assistant.message_delta', { deltaContent: 'Halv' }); ac.abort(); });
  const err = await s.koer({ signal: ac.signal }).catch((e: unknown) => e);
  assert.ok(err instanceof AgentError);
  assert.equal(err.message, AFBRUDT);
  assert.equal(s.klienter[0]!.sessioner[0]!.afbrudt, true);
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(s.koer({ signal: pre.signal }), (e: Error) => e.message === AFBRUDT);
  await s.copilot.stop();
});

test('the transport\'s own timer stops a run that never ends', async () => {
  const s = sut(() => {}, { timeoutMs: 30 });
  const err = await s.koer().catch((e: unknown) => e);
  assert.ok(err instanceof AgentError);
  assert.notEqual(err.message, AFBRUDT);
  assert.equal(s.klienter[0]!.sessioner[0]!.afbrudt, true);
  await s.copilot.stop();
});

test('one client per installation: reused across runs, replaced when the token changes, stopped on stop', async () => {
  const s = sut(svar(['ok']));
  await s.koer();
  await s.koer();
  assert.equal(s.klienter.length, 1);
  assert.equal(s.klienter[0]!.startet, 1, 'started lazily, once');
  await s.koer({ token: 'gho_ANDETtoken0263abcdefghijklmnop' });
  assert.equal(s.klienter.length, 2);
  assert.equal(s.klienter[0]!.stoppet, 1, 'the old token\'s client is stopped');
  assert.equal(s.klienter[1]!.valg.gitHubToken, 'gho_ANDETtoken0263abcdefghijklmnop');
  await s.copilot.stop();
  assert.equal(s.klienter[1]!.stoppet, 1);
  await s.copilot.stop();
  assert.equal(s.klienter[1]!.stoppet, 1, 'a second stop is a no-op');
});

test('an answer without text completes with an empty output (the live test reads that as tom)', async () => {
  const s = sut((ses) => ses.emit('session.idle'));
  const r = await s.koer();
  assert.equal(r.output, '');
  await s.copilot.stop();
});

test('the final message is used when the runtime sent no deltas', async () => {
  const s = sut((ses) => { ses.emit('assistant.message', { content: 'Hele svaret' }); ses.emit('session.idle'); });
  assert.equal((await s.koer()).output, 'Hele svaret');
  await s.copilot.stop();
});
