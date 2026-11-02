import { test } from 'node:test';
import assert from 'node:assert/strict';
import { falskPost, ingenPost } from '../../src/delt/post.ts';
import { haendelser } from '../../src/delt/haendelser.ts';

test('the fake Post records every message in its outbox', async () => {
  const p = falskPost();
  await p.send({ til: 'a@example.test', skabelon: 'maillink', data: { link: 'https://konto.example.test/log-ind/link?t=x', minutter: '15' } });
  assert.equal(p.udbakke.length, 1);
  assert.equal(p.udbakke[0]?.til, 'a@example.test');
});

test('the fake Post can be told to fail (fail-closed tests)', async () => {
  const p = falskPost();
  p.fejl = true;
  await assert.rejects(p.send({ til: 'a@example.test', skabelon: 'maillink', data: { link: 'https://konto.example.test/log-ind/link?t=x', minutter: '15' } }));
  assert.equal(p.udbakke.length, 0);
});

test('ingenPost always refuses: production without a mail provider sends nothing', async () => {
  await assert.rejects(ingenPost().send({ til: 'a@example.test', skabelon: 'maillink', data: { link: 'https://konto.example.test/log-ind/link?t=x', minutter: '15' } }), /mailudbyder/);
});

test('events reach every listener of that name, and a listener can stop listening', () => {
  const h = haendelser();
  const set: number[] = [];
  const stop = h.lyt('konto.slettet', (e) => { set.push(e.kontoId); });
  h.udsend({ navn: 'konto.slettet', kontoId: 7, tidspunkt: '2026-10-31T00:00:00.000Z' });
  stop();
  h.udsend({ navn: 'konto.slettet', kontoId: 8, tidspunkt: '2026-10-31T00:00:00.000Z' });
  assert.deepEqual(set, [7]);
});
