import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERBER, strengeste, verbFra } from '../../src/graenser/verber.ts';
import { afgoer, type Forslag, type Kontekst } from '../../src/graenser/afgoer.ts';
import { ROLLER, kan, type Rolle } from '../../src/identitet/roller.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import type { DataZone } from '../../src/identitet/zoner.ts';
import { GRAENSEKLASSER, TRIN } from '../../src/tillid/trin.ts';
import type { Regel, Trin } from '../../src/tillid/regler.ts';
import type { ReglerLaest } from '../../src/tillid/lager.ts';

const p = (rolle: Rolle): Person => ({ id: rolle, login: null, navn: rolle, rolle });
const f = (verb: string, zoner: DataZone[] = ['privat']): Forslag => ({ rum: 'mail', id: 'h1', verb, zoner });
const ctx = (o: Partial<Kontekst> = {}): Kontekst => ({ person: p('ejer'), kanal: 'knap', ja: false, ...o });

test('the verbs are the closed list mirroring the trust ladder', () => {
  assert.deepEqual([...VERBER], ['laes', 'sorter', 'bogfoer', 'forbered', 'udfoer-med-fortryd', 'betal', 'send-til-andre', 'slet', 'kopier-paa-tvaers']);
});

test('full table: verb × zone mix × channel × role × token', () => {
  const ZONER: DataZone[][] = [['privat'], ['privat', 'privat'], ['privat', 'arbejde'], ['husstand', 'privat']];
  for (const verb of VERBER) for (const zoner of ZONER) for (const kanal of ['knap', 'stemme', 'chat'] as const) for (const rolle of ROLLER) for (const ja of [false, true]) {
    const u = afgoer(f(verb, zoner), ctx({ person: p(rolle), kanal, ja }));
    const blandet = new Set(zoner).size > 1;
    const ret = verb === 'laes' ? 'laese' : 'handle';
    let forventet: 'tillad' | 'afvis' | 'kraever-ja';
    if (verb === 'betal' || verb === 'kopier-paa-tvaers' || blandet) forventet = 'afvis';
    else if (!kan(rolle, ret)) forventet = 'afvis';
    else if (verb === 'send-til-andre' || verb === 'slet') forventet = kanal === 'stemme' ? 'afvis' : ja ? 'tillad' : 'kraever-ja';
    else forventet = 'tillad';
    assert.equal(u.udfald, forventet, `${verb} ${zoner.join('+')} ${kanal} ${rolle} ja=${ja}`);
    assert.ok(u.hvorfor.length > 10, 'a Danish reason every time');
  }
});

test('a missing or unknown verb is denied (fail-closed)', () => {
  for (const verb of ['', 'koeb', 'LAES', 'send']) assert.equal(afgoer(f(verb), ctx()).udfald, 'afvis', verb);
  assert.equal(afgoer({ rum: 'x', id: 'y', zoner: ['privat'] } as unknown as Forslag, ctx()).udfald, 'afvis');
});

test('the reasons say in Danish what Clawco did not do', () => {
  assert.match(afgoer(f('betal'), ctx()).hvorfor, /betal/i);
  assert.match(afgoer(f('send-til-andre'), ctx({ kanal: 'stemme', ja: true })).hvorfor, /stemme/i);
  assert.match(afgoer(f('laes', ['privat', 'arbejde']), ctx()).hvorfor, /zone/i);
});

test('verbFra: the declared verb counts only when stricter than the floor; unknown stays unknown (and is denied)', () => {
  assert.equal(verbFra(undefined, 'udfoer-med-fortryd'), 'udfoer-med-fortryd');
  assert.equal(verbFra('laes', 'udfoer-med-fortryd'), 'udfoer-med-fortryd', 'the model cannot lower the floor');
  assert.equal(verbFra('slet', 'udfoer-med-fortryd'), 'slet', 'the model can raise it');
  assert.equal(verbFra('send-til-andre', 'forbered'), 'send-til-andre');
  assert.equal(verbFra('pay', 'laes'), 'pay');
  assert.equal(afgoer(f(verbFra('pay', 'laes')), ctx()).udfald, 'afvis');
  assert.equal(strengeste('betal', 'laes'), 'betal');
});

// KC-0143: on its own (kanal baggrund) a handling above trin 0 runs only when an active rule's trin covers it;
// otherwise it waits for Henrik (kraever-ja = a card). A limit never runs on its own, token or not.
const regel = (trin: Trin, kilde: string, slags?: string, status: Regel['status'] = 'aktiv'): Regel => ({
  id: `R-000${trin}`, titel: 't', tekst: '', trin, gaelder: { kilde, ...(slags ? { slags } : {}) }, oprindelse: { art: 'haand', dato: '2026-11-01' }, status,
});
const ok = (...regler: Regel[]): ReglerLaest => ({ tilstand: 'ok', saet: { naesteId: 9, regler, ugyldige: [] }, aendretUdenfor: false });
const auto = (verb: string, gaelder: Forslag['gaelder'] = { kilde: 'mail', slags: 'regning' }): Forslag => ({ ...f(verb), ...(gaelder ? { gaelder } : {}) });

test('KC-0143: baggrund × ladder verb × rule trin — a rule at trin N covers exactly the verbs up to N', () => {
  for (const rt of [0, 1, 2, 3, 4] as Trin[]) for (const t of TRIN) {
    const u = afgoer(auto(t.verb), ctx({ kanal: 'baggrund', regler: ok(regel(rt, 'mail', 'regning')) }));
    const forventet = t.trin === 0 || t.trin <= rt ? 'tillad' : 'kraever-ja';
    assert.equal(u.udfald, forventet, `regel ${rt} × ${t.verb}`);
  }
});

test('KC-0143: without a covering rule nothing above trin 0 happens on its own; reading always may', () => {
  for (const regler of [undefined, { tilstand: 'mangler' } as const, { tilstand: 'ulaeselig', hvorfor: 'x', aendretUdenfor: false } as const, ok(regel(4, 'mail', 'regning', 'pause')), ok(regel(4, 'kalender'))]) {
    assert.equal(afgoer(auto('laes'), ctx({ kanal: 'baggrund', regler })).udfald, 'tillad', 'the timers may read');
    const u = afgoer(auto('bogfoer'), ctx({ kanal: 'baggrund', regler }));
    assert.equal(u.udfald, 'kraever-ja');
    assert.match(u.hvorfor, /hvilken regel skal dække det\?/);
  }
  assert.equal(afgoer(f('bogfoer'), ctx({ kanal: 'baggrund', regler: ok(regel(4, '*')) })).udfald, 'kraever-ja', 'a handling that names no scope is never covered');
  assert.match(afgoer(auto('bogfoer'), ctx({ kanal: 'baggrund', regler: ok(regel(1, 'mail', 'regning')) })).hvorfor, /for lavt trin/);
});

test('KC-0143: a limit never runs on its own — not with a trin-4 rule for everything, not with a token', () => {
  for (const verb of GRAENSEKLASSER) for (const ja of [false, true]) {
    const u = afgoer(auto(verb), ctx({ kanal: 'baggrund', ja, regler: ok(regel(4, '*')) }));
    assert.notEqual(u.udfald, 'tillad', `${verb} ja=${ja}`);
  }
});

test('KC-0143: a human tap is not governed by rules (the knap/chat channels ignore them)', () => {
  for (const kanal of ['knap', 'chat'] as const) assert.equal(afgoer(auto('udfoer-med-fortryd'), ctx({ kanal, regler: { tilstand: 'mangler' } })).udfald, 'tillad');
});

test('KC-0143: on its own the owner\'s rules are the authority, not who happened to be looking (timers run as INGEN, a guest)', () => {
  for (const rolle of ROLLER) {
    assert.equal(afgoer(auto('bogfoer'), ctx({ person: p(rolle), kanal: 'baggrund', regler: ok(regel(2, 'mail', 'regning')) })).udfald, 'tillad', rolle);
    assert.equal(afgoer(auto('bogfoer'), ctx({ person: p(rolle), kanal: 'baggrund' })).udfald, 'kraever-ja', rolle);
    assert.equal(afgoer(auto('betal'), ctx({ person: p(rolle), kanal: 'baggrund', regler: ok(regel(4, '*')) })).udfald, 'afvis', rolle);
  }
});
