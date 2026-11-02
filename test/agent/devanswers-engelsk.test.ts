// KC-0241: the dev fake (npm run dev, KC_AGENT=fake) recognises a run by the words the prompt builders write; with an
// English profile they write English, and the fake must answer exactly as it does to the Danish run. The requests are built
// by the real prompt builders, once without a language and once inside medSprog('en', …).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devAnswer } from '../../src/agent/devAnswers.ts';
import type { AgentRunRequest } from '../../src/agent/types.ts';
import { medSprog } from '../../src/store/sprog.ts';
import { froe } from '../../src/testtilstand/indhold.ts';
import { testMailRunner } from '../../src/testtilstand/skriv.ts';
import { buildChatRun, buildFortrydRun, buildHandlingRun, buildHentRun, buildRefreshRun } from '../../src/rooms/dagen/prompt.ts';
import { trimAvisData } from '../../src/rooms/dagen/source.ts';
import { handlingerI, type DagenState } from '../../src/rooms/dagen/schema.ts';
import { buildBaggrundFlytRun, buildKladdeRun, buildMailChatRun, buildMailFortrydRun, buildMailHandlingRun, buildMailRefreshRun, buildSendRun } from '../../src/rooms/mail/prompt.ts';
import { handlingerIMail, type MailState } from '../../src/rooms/mail/schema.ts';
import { handlingensVerb } from '../../src/rooms/dagen/schema.ts';
import { readMailSource } from '../../src/rooms/mail/source.ts';
import { buildNyhederChatRun, buildNyhederHentRun, buildNyhederRefreshRun } from '../../src/rooms/nyheder/prompt.ts';
import { trimNyheder } from '../../src/rooms/nyheder/source.ts';
import { buildForslagRun, buildNytRun, buildSkriveChatRun } from '../../src/rooms/skrive/prompt.ts';
import { parseNytDokument, type SkriveState } from '../../src/rooms/skrive/schema.ts';
import { buildKortFortrydRun, buildLaerRun } from '../../src/kurator/kortprompt.ts';
import { buildKuratorRun } from '../../src/kurator/prompt.ts';
import { buildForberedRun, buildOversigtChatRun, buildUniversChatRun } from '../../src/rooms/univers/prompt.ts';
import { tomtIndeks, tomtUnivers, type Moede, type UniversInfo } from '../../src/rooms/univers/schema.ts';
import type { KuratorState } from '../../src/rooms/hjem/kort.ts';

const NU = new Date('2026-10-29T08:00:00Z');
const f = froe('morgen', '2026-10-29');
const dagen = f.rum['dagen']?.state as DagenState;
const mail = f.rum['mail']?.state as MailState;
const hjem = f.rum['hjem']?.state as KuratorState;
const info: UniversInfo = { id: 'min-arena', navn: 'Min arena', om: 'Rollen', oprettet: NU.toISOString() };
const moede: Moede = { id: 'moede-1', kilde: 'manuel', titel: 'Pitch til Tom', start: '2026-10-28T08:00:00.000Z', slut: '2026-10-28T09:00:00.000Z', deltagere: [{ navn: 'Jonas Holm', email: 'tom@x.example' }, { navn: 'Line Berg' }] };

async function kald(): Promise<[string, AgentRunRequest][]> {
  const mailData = await readMailSource({ run: testMailRunner(() => f), stateDir: '/findes/ikke', now: NU });
  const skrive = f.rum['skrive']?.state as SkriveState;
  const dok = skrive.dokumenter[0] ?? parseNytDokument({ titel: 'Test', afsnit: ['Første afsnit.', 'Andet afsnit.'] }, { brief: 'test' }, NU);
  const dh = [...handlingerI(dagen).values()].find((h) => h.fortryd)!;
  const mh = [...handlingerIMail(mail).values()].find((h) => h.fortryd)!;
  const b = mail.beslutninger[0]!;
  return [
    ['dagen opdater', buildRefreshRun(trimAvisData(f.avis), NU)],
    ['dagen hent', buildHentRun(NU)],
    ['dagen handling', buildHandlingRun(dh, dagen)],
    ['dagen fortryd', buildFortrydRun(dh.fortryd!, dagen)],
    ['dagen chat', buildChatRun('Flyt mødet', undefined, dagen)],
    ['dagen chat med kontekst', buildChatRun('Hvad betyder den?', 'Anbefalingen: noget', dagen)],
    ['mail opdater', buildMailRefreshRun(mailData, NU)],
    ['mail handling', buildMailHandlingRun(mh.label, mh.instruktion, mail, handlingensVerb(mh))],
    ['mail fortryd', buildMailFortrydRun(mh.fortryd!, mail)],
    ['mail kladde', buildKladdeRun(b.mailId, b.emne, 'Hej')],
    ['mail send', buildSendRun(b.mailId, b.emne, 'Hej')],
    ['mail baggrund', buildBaggrundFlytRun(b.mailId, b.arkivmappe)],
    ['mail chat', buildMailChatRun('Hvad skal jeg svare?', undefined, mail)],
    ['nyheder opdater', buildNyhederRefreshRun(trimNyheder(f.avis), NU)],
    ['nyheder hent', buildNyhederHentRun(NU)],
    ['nyheder chat', buildNyhederChatRun('Hvad er vigtigst?', undefined, null)],
    ['skrive nyt', buildNytRun('Orientering', 'Skriv en kort besked til Tom om reserverne')],
    ['skrive nyt uden titel', buildNytRun('', 'Skriv en kort besked til Tom om reserverne')],
    ['skrive forslag', buildForslagRun(dok, 'a1', 'kortere')],
    ['skrive chat', buildSkriveChatRun('Gør den varmere', undefined, dok)],
    ['kuratoren', buildKuratorRun({ mails: [], nyheder: ['x'], aabne: hjem.kort, dyb: false, now: NU, stier: { vault: '' } })],
    ['kort lukket', buildLaerRun(hjem.kort[0]!, 'Det har jeg selv klaret', NU)],
    ['kort fortryd', buildKortFortrydRun('Slet kalenderaftalen "X".', NU)],
    ['univers forbered', buildForberedRun(info, tomtUnivers(), moede, 'Få rollen afklaret', NU)],
    ['univers forbered uden ønske', buildForberedRun(info, tomtUnivers(), moede, '', NU)],
    ['univers chat', buildUniversChatRun(info, tomtUnivers(), 'Lav en note om kunderne', undefined, NU)],
    ['univers spørgsmål', buildUniversChatRun(info, tomtUnivers(), 'Hvornår er næste møde?', 'Møde: Pitch til Tom', NU)],
    ['oversigt nyt', buildOversigtChatRun(tomtIndeks(), 'Lav et univers om min arena', undefined, NU)],
    ['oversigt chat', buildOversigtChatRun(tomtIndeks(), 'Hvad har jeg?', undefined, NU)],
  ];
}

test('dev fake: an English run gets exactly the answer the Danish run gets (Dagen, Mail, Nyheder, handling, undo, first draft, Skrive, Kuratoren, Univers)', async () => {
  const da = await kald();
  const en = await medSprog('en', () => kald());
  assert.deepEqual(en.map(([n]) => n), da.map(([n]) => n));
  const svarDa = da.map(([, r]) => devAnswer(r));
  const svarEn = en.map(([, r]) => devAnswer(r));
  assert.deepEqual(da.flatMap(([n], k) => (svarEn[k] === svarDa[k] ? [] : [n])), [], 'runs where the English prompt gets another answer than the Danish');
  // Not every answer is the fall-through: each kind has its own scripted one.
  assert.ok(new Set(svarDa).size >= 20, `${new Set(svarDa).size} different answers`);
  const af = (navn: string): string => svarDa[da.findIndex(([n]) => n === navn)] ?? '';
  assert.match(af('dagen opdater'), /"treLinjer"/);
  assert.match(af('mail opdater'), /"beslutninger"/);
  assert.match(af('nyheder opdater'), /"femLinjer"/);
  assert.match(af('dagen handling'), /^Gjort: /);
  assert.match(af('dagen fortryd'), /^Gjort om: /);
  assert.match(af('mail send'), /^Sendt \(fake Hermes/);
  assert.match(af('mail baggrund'), /^Flyttet \(fake Hermes/);
  assert.match(af('skrive nyt'), /"afsnit"/);
  assert.match(af('skrive forslag'), /"forslag"/);
  assert.match(af('skrive chat'), /"forslag"/);
  assert.match(af('kuratoren'), /"kort"/);
  assert.match(af('univers forbered'), /"forberedelse"/);
});
