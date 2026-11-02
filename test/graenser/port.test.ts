// KC-0122: the port. Every room module the server can reach is wrapped, and
// nothing outside port.ts can start a handling on an unwrapped module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GraenseAfvist, vogt } from '../../src/graenser/port.ts';
import { lavTegn } from '../../src/graenser/tegn.ts';
import { ROOM_MODULES, getRoomModule } from '../../src/rooms/modules.ts';
import type { RoomDeps, RoomModule } from '../../src/rooms/module.ts';
import type { RunRecord } from '../../src/runs.ts';
import { ENEBRUGER, INGEN } from '../../src/identitet/identitet.ts';

async function filer(dir: string): Promise<string[]> {
  const ud: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ud.push(...(await filer(p)));
    else if (e.name.endsWith('.ts')) ud.push(p);
  }
  return ud;
}

test('structural: no file under src/ calls .startHandling( / .startAction( / .startFortryd( / .startOpdater( / .startChat( outside port.ts', async () => {
  const src = new URL('../../src/', import.meta.url).pathname;
  const fund: string[] = [];
  for (const f of await filer(src)) {
    if (f.endsWith(path.join('graenser', 'port.ts'))) continue;
    (await readFile(f, 'utf8')).split('\n').forEach((l, i) => { if (/\.start(Handling|Action|Fortryd|Opdater|Chat)\(/.test(l)) fund.push(`${path.relative(src, f)}:${i + 1}`); });
  }
  assert.deepEqual(fund, []);
});

test('getRoomModule and ROOM_MODULES only hand out wrapped modules', () => {
  for (const m of ROOM_MODULES) assert.ok(!('startHandling' in m) && typeof m.handling === 'function', m.id);
  const u = getRoomModule('univers-noget');
  assert.ok(u && !('startHandling' in u) && typeof u.handling === 'function');
});

// A fake room: one handling "h1" whose verb is given, actions with fixed verbs.
const koerte: string[] = [];
const run = { id: 'r' } as RunRecord;
function rum(verb: string): RoomModule {
  return {
    id: 'proeve', korsel: 'privat',
    aktionVerber: { flyt: 'sorter', send: 'send-til-andre', betal: 'betal' },
    async handlingVerb(_d, id) { return id === 'h1' ? { verb, zoner: ['privat'] } : null; },
    async view() { return { main: '' as never, hermesStatus: '' }; },
    async startOpdater() { koerte.push('opdater'); return run; },
    async startHandling(_d, id) { koerte.push(`handling:${id}`); return run; },
    async startFortryd() { koerte.push('fortryd'); return run; },
    async startChat() { koerte.push('chat'); return run; },
    async startAction(_d, name) { koerte.push(`aktion:${name}`); return run; },
    async venter() { return 0; }, async hjemVenter() { return []; },
  };
}
const rapporter: string[] = [];
const deps = (person = ENEBRUGER) => ({ person, store: { appendLog: async () => ({}) } } as unknown as RoomDeps);

test('a denied verb never reaches the room; the decision is reported', async () => {
  koerte.length = 0; rapporter.length = 0;
  const v = vogt(rum('betal'), { tegn: lavTegn(), rapporter: async (_d, a) => { rapporter.push(`${a.forslag.verb}:${a.udfald}`); } });
  await assert.rejects(v.handling(deps(), 'h1', { kanal: 'knap' }), (e: unknown) => e instanceof GraenseAfvist && /betal/.test(e.message));
  await assert.rejects(v.aktion!(deps(), 'betal', {}, { kanal: 'knap' }), GraenseAfvist);
  assert.deepEqual(koerte, []);
  assert.deepEqual(rapporter, ['betal:afvis', 'betal:afvis']);
});

test('send-to-others runs only with a token for exactly that action, never by voice', async () => {
  koerte.length = 0;
  const tegn = lavTegn();
  const v = vogt(rum('udfoer-med-fortryd'), { tegn, rapporter: async () => {} });
  await assert.rejects(v.aktion!(deps(), 'send', { mailId: 'm1' }, { kanal: 'knap' }), (e: unknown) => e instanceof GraenseAfvist && e.udfald === 'kraever-ja');
  const ja = tegn.udsted({ person: ENEBRUGER.id, rum: 'proeve', slags: 'aktion', id: 'send|{"mailId":"m1"}' });
  await assert.rejects(v.aktion!(deps(), 'send', { mailId: 'm2' }, { kanal: 'knap', ja }), GraenseAfvist, 'a token for another mail does not count');
  const ja2 = tegn.udsted({ person: ENEBRUGER.id, rum: 'proeve', slags: 'aktion', id: 'send|{"mailId":"m1"}' });
  await assert.rejects(v.aktion!(deps(), 'send', { mailId: 'm1' }, { kanal: 'stemme', ja: ja2 }), GraenseAfvist, 'never by voice');
  const ja3 = tegn.udsted({ person: ENEBRUGER.id, rum: 'proeve', slags: 'aktion', id: 'send|{"mailId":"m1"}' });
  assert.equal(await v.aktion!(deps(), 'send', { mailId: 'm1' }, { kanal: 'knap', ja: ja3 }), run);
  assert.deepEqual(koerte, ['aktion:send']);
});

test('allowed verbs pass; unknown handlings and actions run nothing (null, as before)', async () => {
  koerte.length = 0;
  const v = vogt(rum('udfoer-med-fortryd'), { tegn: lavTegn(), rapporter: async () => {} });
  assert.equal(await v.handling(deps(), 'h1', { kanal: 'knap' }), run);
  assert.equal(await v.handling(deps(), 'ukendt', { kanal: 'knap' }), null);
  assert.equal(await v.aktion!(deps(), 'ukendt', {}, { kanal: 'knap' }), null);
  assert.equal(await v.aktion!(deps(), 'flyt', {}, { kanal: 'knap' }), run);
  assert.equal(await v.opdater(deps(INGEN), 'opdater', { kanal: 'baggrund' }), run, 'reading is allowed for the timers');
  assert.deepEqual(koerte, ['handling:h1', 'aktion:flyt', 'opdater']);
});

test('a guest can read but not act', async () => {
  const v = vogt(rum('udfoer-med-fortryd'), { tegn: lavTegn(), rapporter: async () => {} });
  const gaest = { id: 'g', login: null, navn: 'G', rolle: 'gaest' as const };
  await assert.rejects(v.handling(deps(gaest), 'h1', { kanal: 'knap' }), GraenseAfvist);
  await assert.rejects(v.chat(deps(gaest), 'hej', undefined, { kanal: 'chat' }), GraenseAfvist);
});
