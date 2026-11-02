// KC-0170: Mail's actions, log lines, run labels and status in English or Danish. The Danish is what the room wrote
// before the strings moved (captured first); in English nothing Danish reaches the toast, the log, the chat, the I gang
// label, the status line or the placeholder subject, in all three ways the room can be built (Hermes' tools, a connector
// that can act, a connection that can only read).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailRoom } from '../../src/rooms/mail/room.ts';
import type { MailState } from '../../src/rooms/mail/schema.ts';
import type { MailForbindelse, RoomDeps } from '../../src/rooms/module.ts';
import { aktion, iSprog, laes, lavVerden, type Verden } from '../fixtures/sprog-handling.ts';
import { DANSK } from '../fixtures/sprog-tjek.ts';
import type { Sprog } from '../../src/store/profil.ts';

const besl = (mailId: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({ mailId, betydning: 'It matters', zone: 'privat', ...o });
const PLAN = '```json\n' + JSON.stringify({ beslutninger: [
  besl('1', { type: 'info' }),
  besl('2', { type: 'svar', emne: 'Lunch?', fra: 'Tom', muligheder: [{ id: 'ja', label: 'Say yes', instruktion: 'Reply yes.', fortryd: 'Undo the reply.' }] }),
  besl('3', { type: 'kvittering', emne: 'Receipt', fra: 'Shop' }),
  besl('4', { type: 'aktion', emne: 'Needs you', fra: 'Boss', muligheder: [{ id: 'gor', label: 'Do it', instruktion: 'Do it.' }] }),
] }) + '\n```';
const kuvert = (id: string, emne: string) => ({ id, subject: emne, from: [{ name: 'Tom', email: 'tom@example.com' }], date: '2026-10-27T08:00:00Z', flags: [] });
const handlingListe = JSON.stringify([kuvert('1', ''), kuvert('2', 'Lunch?'), kuvert('3', 'Receipt'), kuvert('4', 'Needs you')]);

const statusAf = (v: Verden, sprog: Sprog | undefined): Promise<string> => iSprog(sprog, async () => (await mailRoom.view(v.deps)).hermesStatus);
const labels = (v: Verden): string => v.deps.runs.list().map((r) => r.label).filter(Boolean).sort().join(' | ');

/** Hermes' tool path (Henrik's install). */
async function himalayaScenarie(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const v = await lavVerden({
    svar: [PLAN, '', '', '', '', '', '', '', '', '', ''],
    mail: async (_c, args) => (args[args.indexOf('-m') + 1] === 'Folders/Handling' ? { code: 0, stdout: handlingListe, stderr: '' } : { code: 1, stdout: '', stderr: 'boom' }),
  });
  try {
    const k = (navn: string, body: Record<string, unknown>) => laes(sprog, aktion(mailRoom, v, navn, body));
    ud.push(`ukendt: ${await k('faerdig', { mailId: '9' })}`);
    ud.push(`opdater: ${(await (await iSprog(sprog, () => mailRoom.startOpdater(v.deps, 'opdater')))!.finished).status}`);
    ud.push(`status: ${await statusAf(v, sprog)}`);
    const s = (await v.store.readState<MailState>('mail'))!;
    ud.push(`emne1: ${s.beslutninger[0]!.emne} / ${s.beslutninger[0]!.fra}`);
    ud.push(`faerdig: ${await k('faerdig', { mailId: '1' })}`);
    ud.push(`faerdig-igen: ${await k('faerdig', { mailId: '1' })}`);
    ud.push(`alle-ingen: ${await k('faerdig-alle', { mailIds: [] })}`);
    ud.push(`alle-ukendt: ${await k('faerdig-alle', { mailIds: ['9'] })}`);
    ud.push(`alle-andet: ${await k('faerdig-alle', { mailIds: ['2'] })}`);
    ud.push(`alle: ${await k('faerdig-alle', { mailIds: ['3'] })}`);
    ud.push(`send-tom: ${await k('send', { mailId: '2', tekst: '' })}`);
    ud.push(`send: ${await k('send', { mailId: '2', tekst: 'Yes, lunch.' })}`);
    ud.push(`send-igen: ${await k('send', { mailId: '2', tekst: 'Yes.' })}`);
    ud.push(`kladde-tom: ${await k('kladde', { mailId: '4', tekst: '' })}`);
    ud.push(`kladde: ${await k('kladde', { mailId: '4', tekst: 'Draft' })}`);
    const h = await iSprog(sprog, () => mailRoom.startHandling(v.deps, '4-gor'));
    const hr = await h!.finished;
    ud.push(`handling: ${hr.result?.text ?? hr.error}`);
    for (const e of (await v.store.readLog('mail')).filter((x) => x.fortryd)) {
      const r = await (await iSprog(sprog, () => mailRoom.startFortryd(v.deps, e.id)))!.finished;
      ud.push(`fortryd: ${r.result?.text ?? r.error}`);
    }
    ud.push(`log: ${(await v.store.readLog('mail')).map((e) => e.tekst).reverse().join(' | ')}`);
    ud.push(`labels: ${labels(v)}`);
    const c = await (await iSprog(sprog, () => mailRoom.startChat(v.deps, 'Hi', undefined))).finished;
    ud.push(`chat-tom: ${c.result?.text ?? c.error}`);
  } finally { await v.ryd(); }
  return ud;
}

/** A connector that can act (a Sky tenant), and one that can only read. */
function forbindelse(kanHandle: boolean, o: { laesFejl?: boolean; flytFejl?: boolean } = {}): MailForbindelse {
  return {
    navn: 'Example Mail', kanHandle,
    laes: async () => { if (o.laesFejl) throw new Error('connection refused'); return [1, 2, 3, 4].map((i) => ({ id: String(i), emne: i === 1 ? '' : `Subject ${i}`, fra: 'Tom', modtaget: '2026-10-27T08:00:00Z', laest: false, flag: false, vedhaeftning: false })); },
    handl: async (navn) => {
      if (navn === 'flyt' && o.flytFejl) throw new Error('no archive folder');
      return { ok: true, tekst: `${navn} done at the connector`, ...(navn === 'flyt' ? { fortryd: { navn: 'flyt', args: { id: '1', fra: 'Archive', til: 'INBOX' } } } : {}) };
    },
  };
}

async function forbindelseScenarie(sprog: Sprog | undefined): Promise<string[]> {
  const ud: string[] = [];
  const v = await lavVerden({ svar: [PLAN, PLAN, PLAN, ''] });
  const med = (f: MailForbindelse): RoomDeps => ({ ...v.deps, mailForbindelse: async () => f });
  try {
    const k = (deps: RoomDeps, navn: string, body: Record<string, unknown>) => laes(sprog, () => mailRoom.startAction!(deps, navn, body));
    // The connection cannot be read
    ud.push(`laes-fejl: ${await laes(sprog, () => mailRoom.startOpdater(med(forbindelse(true, { laesFejl: true })), 'opdater'))}`);
    // It can act
    const akt = med(forbindelse(true));
    ud.push(`opdater: ${(await (await iSprog(sprog, () => mailRoom.startOpdater(akt, 'opdater')))!.finished).status}`);
    ud.push(`status: ${await statusAf(v, sprog)}`);
    ud.push(`faerdig: ${await k(akt, 'faerdig', { mailId: '1' })}`);
    ud.push(`send: ${await k(akt, 'send', { mailId: '2', tekst: 'Yes' })}`);
    ud.push(`kladde: ${await k(akt, 'kladde', { mailId: '2', tekst: 'Draft' })}`);
    await Promise.all(v.deps.runs.list().map((r) => v.deps.runs.get(r.id)?.finished));
    for (const e of (await v.store.readLog('mail')).filter((x) => x.fortryd)) {
      const r = await (await iSprog(sprog, () => mailRoom.startFortryd(akt, e.id)))!.finished;
      ud.push(`fortryd: ${r.result?.text ?? r.error}`);
    }
    // The connector refuses to move one
    const nej = med(forbindelse(true, { flytFejl: true }));
    ud.push(`faerdig-nej: ${await k(nej, 'faerdig', { mailId: '3' })}`);
    await Promise.all(v.deps.runs.list().map((r) => v.deps.runs.get(r.id)?.finished));
    ud.push(`log: ${(await v.store.readLog('mail')).map((e) => e.tekst).reverse().join(' | ')}`);
    ud.push(`labels: ${labels(v)}`);
    // It can only read
    const kun = med(forbindelse(false));
    ud.push(`kun-opdater: ${(await (await iSprog(sprog, () => mailRoom.startOpdater(kun, 'opdater')))!.finished).status}`);
    ud.push(`kun-faerdig: ${await k(kun, 'faerdig', { mailId: '1' })}`);
    ud.push(`kun-alle: ${await k(kun, 'faerdig-alle', { mailIds: ['1'] })}`);
    ud.push(`kun-log: ${(await v.store.readLog('mail', 1)).map((e) => e.tekst).join(' | ')}`);
  } finally { await v.ryd(); }
  return ud;
}

test('Mail: a stored Danish placeholder and status read in English; Danish shows what it stored', async () => {
  const v = await lavVerden({ svar: [PLAN], mail: async (_c, args) => (args[args.indexOf('-m') + 1] === 'Folders/Handling' ? { code: 0, stdout: handlingListe, stderr: '' } : { code: 0, stdout: '[]', stderr: '' }) });
  try {
    await (await iSprog(undefined, () => mailRoom.startOpdater(v.deps, 'opdater')))!.finished;
    assert.equal(await statusAf(v, undefined), 'Holder øje med Handling');
    assert.equal(await statusAf(v, 'en'), 'Watching Handling');
    const vis = async (sprog: Sprog): Promise<string> => String((await iSprog(sprog, () => mailRoom.view(v.deps))).main);
    assert.match(await vis('da'), /\(uden emne\)/);
    assert.match(await vis('da'), /\(ukendt afsender\)/);
    assert.ok(!/\(uden emne\)/.test(await vis('en')), 'no Danish placeholder in English');
    assert.match(await vis('en'), /\(no subject\)/);
    assert.match(await vis('en'), /\(unknown sender\)/);
  } finally { await v.ryd(); }
});

test('Mail: Danish (no language, and da) is what the room said before', async () => {
  for (const [navn, kor, forventet] of [['himalaya', himalayaScenarie, DANSK_HIMALAYA], ['connector', forbindelseScenarie, DANSK_FORBINDELSE]] as const) {
    const a = await kor(undefined);
    assert.deepEqual(await kor('da'), a, navn);
    assert.deepEqual(a, forventet, navn);
  }
});

test('Mail: English says everything in English, and no Danish line is left', async () => {
  for (const [navn, kor, forventet] of [['himalaya', himalayaScenarie, ENGELSK_HIMALAYA], ['connector', forbindelseScenarie, ENGELSK_FORBINDELSE]] as const) {
    const en = await kor('en');
    assert.deepEqual(en.filter((l) => DANSK.test(l)), [], navn);
    assert.deepEqual(en, forventet, navn);
  }
});

const DANSK_HIMALAYA: string[] = [
  "ukendt: afvist 400: Mailen findes ikke i rummet",
  "opdater: done",
  "status: Holder øje med Handling",
  "emne1: (uden emne) / (ukendt afsender)",
  "faerdig: ok: Færdig. Flyttes til Archive.",
  "faerdig-igen: afvist 400: Mailen er allerede færdig",
  "alle-ingen: afvist 400: Vælg mindst én mail",
  "alle-ukendt: afvist 400: Mailen findes ikke i rummet",
  "alle-andet: afvist 400: Mailen har andet at gøre end Færdig",
  "alle: ok: 1 mail færdig.",
  "send-tom: afvist 400: Svaret er tomt",
  "send: ok: Sendt.",
  "send-igen: afvist 400: Mailen er allerede sendt eller færdig",
  "kladde-tom: afvist 400: Svaret er tomt",
  "kladde: ok: Kladden er gemt.",
  "handling: Do it: gjort.",
  "fortryd: ",
  "fortryd: ",
  "fortryd: ",
  "log: Hermes læste Handling (4 mails, 0 sorteret i dag). Kunne ikke læse: Folders/Afventer: boom; Folders/Regninger: boom; Inbox: boom. | Færdig med \"(uden emne)\"; flyttes til Archive i baggrunden. | Flyttet. | Færdig med \"Receipt\"; flyttes til Archive i baggrunden. | Flyttet. | Sendt. | Flyttet. | Kladden er gemt. | Do it: gjort. | Fortrudt. | Fortrudt. | Fortrudt.",
  "labels: Mail: flytter \"(uden emne)\" til Archive | Mail: flytter \"Lunch?\" til Archive | Mail: flytter \"Receipt\" til Archive | Mail: sender svar på \"Lunch?\"",
  "chat-tom: (intet svar)",
];
const ENGELSK_HIMALAYA: string[] = [
  "ukendt: afvist 400: The mail is not in the room",
  "opdater: done",
  "status: Watching Handling",
  "emne1: (no subject) / (unknown sender)",
  "faerdig: ok: Done. Moving to Archive.",
  "faerdig-igen: afvist 400: The mail is already done",
  "alle-ingen: afvist 400: Choose at least one mail",
  "alle-ukendt: afvist 400: The mail is not in the room",
  "alle-andet: afvist 400: This mail needs more than Done",
  "alle: ok: 1 mail done.",
  "send-tom: afvist 400: The reply is empty",
  "send: ok: Sent.",
  "send-igen: afvist 400: The mail has already been sent or is done",
  "kladde-tom: afvist 400: The reply is empty",
  "kladde: ok: The draft is saved.",
  "handling: Do it: done.",
  "fortryd: ",
  "fortryd: ",
  "fortryd: ",
  "log: Hermes read Handling (4 mails, 0 sorted today). Could not read: Folders/Afventer: boom; Folders/Regninger: boom; Inbox: boom. | Done with \"(no subject)\"; moving it to Archive in the background. | Moved. | Done with \"Receipt\"; moving it to Archive in the background. | Moved. | Sent. | Moved. | The draft is saved. | Do it: done. | Undone. | Undone. | Undone.",
  "labels: Mail: moving \"(no subject)\" to Archive | Mail: moving \"Lunch?\" to Archive | Mail: moving \"Receipt\" to Archive | Mail: sending the reply to \"Lunch?\"",
  "chat-tom: (no answer)",
];
const DANSK_FORBINDELSE: string[] = [
  "laes-fejl: afvist 400: Mailen kunne ikke læses: connection refused",
  "opdater: done",
  "status: Holder øje med Handling",
  "faerdig: ok: Færdig. Flyttes til arkivet.",
  "send: afvist 400: Clawco kan ikke sende mail herfra. Gem svaret som kladde, og send det fra din mailapp.",
  "kladde: ok: kladde done at the connector",
  "fortryd: flyt done at the connector",
  "faerdig-nej: ok: Færdig. Flyttes til arkivet.",
  "log: Hermes læste indbakken (4 mails). | Færdig med \"\"; flyttes til Archive i baggrunden. | flyt done at the connector | kladde done at the connector | flyt done at the connector | Færdig med \"Receipt\"; flyttes til Archive i baggrunden. | Mailen \"Receipt\" blev ikke flyttet: no archive folder",
  "labels: Mail: flytter \"\" til arkivet | Mail: flytter \"Receipt\" til arkivet | Mail: flytter mailen tilbage | Mail: gemmer kladden til \"Lunch?\"",
  "kun-opdater: done",
  "kun-faerdig: afvist 400: Clawco kan kun læse denne mailkonto, så mailen flyttes og besvares i din egen mailapp.",
  "kun-alle: afvist 400: Clawco kan kun læse denne mailkonto, så mailen flyttes og besvares i din egen mailapp.",
  "kun-log: Hermes læste indbakken (4 ulæste eller markerede mails).",
];
const ENGELSK_FORBINDELSE: string[] = [
  "laes-fejl: afvist 400: The mail could not be read: connection refused",
  "opdater: done",
  "status: Watching Handling",
  "faerdig: ok: Done. Moving to the archive.",
  "send: afvist 400: Clawco cannot send mail from here. Save the reply as a draft and send it from your mail app.",
  "kladde: ok: kladde done at the connector",
  "fortryd: flyt done at the connector",
  "faerdig-nej: ok: Done. Moving to the archive.",
  "log: Hermes read the inbox (4 mails). | Done with \"\"; moving it to Archive in the background. | flyt done at the connector | kladde done at the connector | flyt done at the connector | Done with \"Receipt\"; moving it to Archive in the background. | The mail \"Receipt\" was not moved: no archive folder",
  "labels: Mail: moving \"\" to the archive | Mail: moving \"Receipt\" to the archive | Mail: moving the mail back | Mail: saving the draft for \"Lunch?\"",
  "kun-opdater: done",
  "kun-faerdig: afvist 400: Clawco can only read this mail account, so the mail is moved and answered in your own mail app.",
  "kun-alle: afvist 400: Clawco can only read this mail account, so the mail is moved and answered in your own mail app.",
  "kun-log: Hermes read the inbox (4 unread or flagged mails).",
];
