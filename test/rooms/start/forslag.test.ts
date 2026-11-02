// KC-0126: "returns when worth it" — a source not yet connected whose trigger fires.
// The one real trigger: calendar not connected while connected mail has >= 3 calendar invites in 14 days.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erInvitation, foreslaaTilfoejelse, type KildeSyn, type MailSyn } from '../../../src/rooms/start/forslag.ts';

const nu = new Date('2026-10-31T10:00:00.000Z');
const dageSiden = (n: number): string => new Date(nu.getTime() - n * 86_400_000).toISOString();
const kalender: KildeSyn = { id: 'kal', navn: 'Google Kalender', slags: 'kalender', forbundet: false };
const mailKilde: KildeSyn = { id: 'post', navn: 'Mail', slags: 'mail', forbundet: true };
const inv = (n: number, emne = 'Invitation: Frokostmøde'): MailSyn => ({ emne, modtaget: dageSiden(n) });

async function forslag(o: { kilder?: KildeSyn[]; mail?: MailSyn[]; afvist?: Record<string, string> } = {}): Promise<{ liste: Awaited<ReturnType<typeof foreslaaTilfoejelse>>; laest: number }> {
  let laest = 0;
  const liste = await foreslaaTilfoejelse({ kilder: o.kilder ?? [kalender, mailKilde], mail: async () => { laest += 1; return o.mail ?? []; }, nu, afvist: o.afvist ?? {} });
  return { liste, laest };
}

test('calendar invites are recognised in Danish and English, other mail is not', () => {
  for (const e of ['Invitation: Frokostmøde @ fre 7. nov', 'Opdateret invitation: Standup', 'Updated invitation: Review', 'Mødeindkaldelse: Budget', 'Invitation opdateret: Fællesspisning']) assert.ok(erInvitation(e), e);
  for (const e of ['Faktura 4.210 kr.', 'Tak for invitationen', 'Accepteret: Frokost', 'Din ordre er afsendt']) assert.ok(!erInvitation(e), e);
});

test('three invites in 14 days and no calendar connected: the calendar is suggested', async () => {
  const { liste } = await forslag({ mail: [inv(1), inv(5, 'Opdateret invitation: Standup'), inv(13), { emne: 'Faktura', modtaget: dageSiden(2) }] });
  assert.equal(liste.length, 1);
  assert.equal(liste[0]?.kildeId, 'kal');
  assert.equal(liste[0]?.slags, 'kalender');
  assert.match(liste[0]?.grund ?? '', /3 invitationer/);
});

test('two invites, or invites older than 14 days, do not fire', async () => {
  assert.equal((await forslag({ mail: [inv(1), inv(2)] })).liste.length, 0);
  assert.equal((await forslag({ mail: [inv(1), inv(2), inv(15)] })).liste.length, 0);
});

test('a connected calendar is never suggested, and mail is not read for it', async () => {
  const r = await forslag({ kilder: [{ ...kalender, forbundet: true }, mailKilde], mail: [inv(1), inv(2), inv(3)] });
  assert.equal(r.liste.length, 0);
  assert.equal(r.laest, 0, 'no candidate, no mail read');
});

test('a dismissal holds for 30 days, then the suggestion may return', async () => {
  const mail = [inv(1), inv(2), inv(3)];
  assert.equal((await forslag({ mail, afvist: { kal: dageSiden(29) } })).liste.length, 0);
  assert.equal((await forslag({ mail, afvist: { kal: dageSiden(31) } })).liste.length, 1);
});
