// KC-0161: a handling can need a human tap (a one-time yes bound to exactly that press) without being one of the
// limits: Forslag.tap. Only a tap by a person who may act runs it; nobody-asked (timers, Kuratoren), the voice and a
// press without the token do not, whatever Henrik's rules say. A room names such handlings in aktionTap.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afgoer, type Forslag, type Kontekst } from '../../src/graenser/afgoer.ts';
import { GraenseAfvist, vogt } from '../../src/graenser/port.ts';
import { lavTegn } from '../../src/graenser/tegn.ts';
import { ROLLER, kan, type Rolle } from '../../src/identitet/roller.ts';
import { ENEBRUGER } from '../../src/identitet/identitet.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import type { RoomDeps, RoomModule } from '../../src/rooms/module.ts';
import type { RunRecord } from '../../src/runs.ts';

const p = (rolle: Rolle): Person => ({ id: rolle, login: null, navn: rolle, rolle });
const f = (tap: boolean): Forslag => ({ rum: 'start', id: 'tailscale-del|{}', verb: 'udfoer-med-fortryd', zoner: ['privat'], ...(tap ? { tap: true as const } : {}) });
const ctx = (o: Partial<Kontekst> = {}): Kontekst => ({ person: p('ejer'), kanal: 'knap', ja: false, ...o });

test('a tap handling: only a redeemed tap by a person who may act runs it', () => {
  for (const rolle of ROLLER) for (const kanal of ['knap', 'stemme', 'chat', 'baggrund'] as const) for (const ja of [false, true]) {
    const u = afgoer(f(true), ctx({ person: p(rolle), kanal, ja })).udfald;
    let forventet: string;
    if (kanal === 'baggrund') forventet = 'kraever-ja'; // nobody tapped: never on its own, rules or not
    else if (!kan(rolle, 'handle')) forventet = 'afvis';
    else if (kanal === 'stemme') forventet = 'afvis';
    else forventet = ja ? 'tillad' : 'kraever-ja';
    assert.equal(u, forventet, `${rolle} ${kanal} ja=${ja}`);
  }
});

test('without tap the verb decides as before (nothing else changes)', () => {
  assert.equal(afgoer(f(false), ctx()).udfald, 'tillad');
  assert.equal(afgoer(f(false), ctx({ kanal: 'stemme' })).udfald, 'tillad');
});

test('the limits stay limits with a tap', () => {
  const betal: Forslag = { ...f(true), verb: 'betal' };
  assert.equal(afgoer(betal, ctx({ ja: true })).udfald, 'afvis');
});

const koerte: string[] = [];
const run = { id: 'r' } as RunRecord;
const rum: RoomModule = {
  id: 'proeve', korsel: 'privat',
  aktionVerber: { del: 'udfoer-med-fortryd', flyt: 'udfoer-med-fortryd' },
  aktionTap: ['del'],
  async handlingVerb() { return null; },
  async view() { return { main: '' as never, hermesStatus: '' }; },
  async startOpdater() { return run; }, async startHandling() { return run; }, async startFortryd() { return run; }, async startChat() { return run; },
  async startAction(_d, name) { koerte.push(name); return run; },
  async venter() { return 0; }, async hjemVenter() { return []; },
};
const deps = { person: ENEBRUGER, store: { appendLog: async () => ({}) } } as unknown as RoomDeps;

test('the port: an action named in aktionTap needs the token bound to exactly this body; one not named does not', async () => {
  const tegn = lavTegn();
  const v = vogt(rum, { tegn, rapporter: async () => {} });
  await assert.rejects(() => v.aktion!(deps, 'del', { port: 8750 }, { kanal: 'knap' }), (e: unknown) => e instanceof GraenseAfvist && e.udfald === 'kraever-ja');
  assert.deepEqual(koerte, []);
  await v.aktion!(deps, 'flyt', {}, { kanal: 'knap' });
  const ja = tegn.udsted({ person: ENEBRUGER.id, rum: 'proeve', slags: 'aktion', id: 'del|{"port":8750}' });
  await assert.rejects(() => v.aktion!(deps, 'del', { port: 9 }, { kanal: 'knap', ja }), GraenseAfvist, 'a token for another body does not count');
  const ja2 = tegn.udsted({ person: ENEBRUGER.id, rum: 'proeve', slags: 'aktion', id: 'del|{"port":8750}' });
  await v.aktion!(deps, 'del', { port: 8750 }, { kanal: 'knap', ja: ja2 });
  assert.deepEqual(koerte, ['flyt', 'del']);
  await assert.rejects(() => v.aktion!(deps, 'del', { port: 8750 }, { kanal: 'baggrund' }), GraenseAfvist, 'a timer can never do it');
});
