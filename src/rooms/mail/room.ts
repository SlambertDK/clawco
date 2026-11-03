// The room Mail, wired: view, refresh, decisions, fortryd and chat.
// KC-0214: with a mail connector that can act (deps.mailForbindelse, a Sky
// tenant), refresh reads the inbox through it and Færdig, Fortryd and Gem som
// kladde run its verbs through the registry — local runs, never an agent run
// or himalaya; Send is not offered (IMAP cannot send). Without one (Henrik's
// install) every run is exactly the Hermes tool path it was.
// KC-0223: a connection that can only read (Gmail) is read the same way, but
// only the unread or flagged mails wait, the state carries `laeseKun`, and
// Færdig, Gem som kladde and Send are neither shown nor accepted.

import { agentFortryd } from '../../graenser/verber.ts';
import { graenserTekst } from '../../graenser/tekster.ts';
import { handlingIndhold } from '../../graenser/tegn.ts';
import type { LogEntry } from '../../store/types.ts';
import type { RunRecord, DoneResult } from '../../runs.ts';
import { ActionError, type MailForbindelse, type RoomDeps, type RoomModule, type RoomView } from '../module.ts';
import { handlingensVerb, kraevJson } from '../dagen/schema.ts';
import { handlingerIMail, KORSEL, kunFaerdig, parseMailState, synligMail, venterMail, type MailState } from './schema.ts';
import { synligFor } from '../../identitet/zoner.ts';
import { koebenhavnTilIso } from '../../shell/tid.ts';
import { fraForbindelse, readMailSource, type TrimmedMail } from './source.ts';
import { buildBaggrundFlytRun, buildKladdeRun, buildMailChatRun, buildMailFortrydRun, buildMailHandlingRun, buildMailRefreshForbindelseRun, buildMailRefreshRun, buildSendRun } from './prompt.ts';
import { renderMail, renderMailEmpty } from './render.ts';
import { erUdenEmne, mailEmne, mailStatus, mailTekst } from './tekster.ts';
import { tekst } from '../../shell/tekster.ts';
import { stemmeMail } from './stemme.ts';

export const RUM = 'mail';

async function current(deps: RoomDeps): Promise<{ state: MailState | null; log: LogEntry[] }> {
  const [state, log] = await Promise.all([deps.store.readState<MailState>(RUM), deps.store.readLog(RUM)]);
  return { state, log };
}

/** KC-0117: what the person looking may see — the only thing shown, counted or spoken (writes go on the full `current`). */
async function synlig(deps: RoomDeps): Promise<{ state: MailState | null; log: LogEntry[] }> {
  const { state, log } = await current(deps);
  return { state: state ? synligMail(state, deps.person) : null, log: log.filter((e) => synligFor(deps.person, e)) };
}

async function rendered(deps: RoomDeps, extra: Partial<DoneResult> = {}): Promise<DoneResult> {
  deps.live.notify(RUM);
  const { state, log } = await synlig(deps);
  const html = state ? String(renderMail(state, log, deps.now(), deps.runs.igang(RUM), await deps.kildeFriskhed?.('mail'))) : String(renderMailEmpty(mailTekst().ikkeHentetEndnu));
  return { html, venter: venterMail(state) ? { [RUM]: venterMail(state) } : {}, hermesStatus: state ? mailStatus(state.hermesStatus) : tekst().klar, ...extra };
}

async function view(deps: RoomDeps): Promise<RoomView> {
  const { state, log } = await synlig(deps);
  return { main: state ? renderMail(state, log, deps.now(), deps.runs.igang(RUM), await deps.kildeFriskhed?.('mail')) : renderMailEmpty(mailTekst().ikkeHentetEndnu), hermesStatus: state ? mailStatus(state.hermesStatus) : tekst().klar };
}

/** KC-0214: the mail connection the room reads (it can act, or KC-0223 only read), or null for Hermes' tool path. */
const vindue = async (deps: RoomDeps): Promise<MailForbindelse | null> => (deps.mailForbindelse ? deps.mailForbindelse() : null);
/** KC-0223: the connection only when it can move and draft; a read-only one is never handed to a handling. */
const handlevindue = async (deps: RoomDeps): Promise<MailForbindelse | null> => { const v = await vindue(deps); return v?.kanHandle ? v : null; };
/** The archive a connector move goes to: the account's \\Archive folder (the connector resolves the name). */
const ARKIV = 'Archive';
/** KC-0214: a connector's undo, stored on the log line as `lokal:<json>` (the canonical local fortryd, as in Skrive). */
type KildeFortryd = { kilde: { navn: 'flyt'; args: Record<string, string> } };
const lokalFortryd = (f: KildeFortryd): string => `lokal:${JSON.stringify(f)}`;
function laesKildeFortryd(fortryd: string): KildeFortryd | null {
  if (!fortryd.startsWith('lokal:')) return null;
  try {
    const f = JSON.parse(fortryd.slice('lokal:'.length)) as { kilde?: { navn?: unknown; args?: unknown } };
    const args = f.kilde?.args;
    if (f.kilde?.navn !== 'flyt' || typeof args !== 'object' || args === null || Array.isArray(args)) return null;
    if (!Object.values(args).every((v) => typeof v === 'string')) return null;
    return { kilde: { navn: 'flyt', args: args as Record<string, string> } };
  } catch { return null; }
}
const fejltekst = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 300);

async function startOpdater(deps: RoomDeps, mode: string): Promise<RunRecord | null> {
  if (mode !== 'opdater') return null;
  const v = await vindue(deps);
  if (v) return startOpdaterForbindelse(deps, v);
  const now = deps.now();
  const data = await readMailSource({ run: deps.mailRunner, stateDir: deps.mailStateDir, now, himalaya: deps.himalaya });
  const emner = new Map(data.handling.map((e) => [e.id, e]));
  return deps.runs.start({
    kind: 'opdater',
    spec: buildMailRefreshRun(data, now),
    onDone: async (output) => {
      const raw = kraevJson(output);
      const { state: previous } = await current(deps);
      const facts = {
        tal: { handling: data.tal.handling, afventer: data.tal.afventer, regninger: data.tal.regninger, sorteretIDag: data.tal.sorteretIDag },
        ordnet: data.ordnet,
      };
      const droppet: string[] = [];
      const state = parseMailState(raw, facts, deps.now(), previous, (id) => droppet.push(id));
      for (const b of state.beslutninger) { const e = emner.get(b.mailId); if (e) { b.emne = erUdenEmne(b.emne) ? e.emne : b.emne; b.modtaget = b.modtaget || e.modtaget; } }
      await deps.store.writeState(RUM, state);
      if (droppet.length) await deps.store.appendLog(RUM, { kilde: 'system', tekst: graenserTekst().dubletter(droppet.length) });
      // KC-0145: what the night's auto-sort put in Ordnet was kept off the screen — the app's own record, once per post.
      if (deps.skjulte && state.ordnet.length) {
        await deps.skjulte.noter(state.ordnet.map((o) => ({ id: `mail:${o.mailId}:${o.tid}`, tid: koebenhavnTilIso(o.tid) ?? deps.now().toISOString(), titel: o.emne || mailTekst().skjultTitel(o.til), kilde: 'mail' })))
          .catch((err: unknown) => console.error('skjulte:', err instanceof Error ? err.message : err));
      }
      const T = mailTekst();
      const fejl = data.fejl?.length ? T.logKunneIkkeLaese(data.fejl.join('; ').slice(0, 200)) : '';
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: `${T.logLaeste(state.beslutninger.length, data.tal.sorteretIDag)}${fejl}` });
      return rendered(deps);
    },
  });
}

/**
 * KC-0214: the refresh from the connector's inbox — no muligheder (nothing a toolless agent could run), Færdig archives.
 * KC-0223: from a read-only connection (`!v.kanHandle`) only unread or flagged mails wait, and nothing is offered at all.
 */
async function startOpdaterForbindelse(deps: RoomDeps, v: MailForbindelse): Promise<RunRecord> {
  const now = deps.now();
  const laeseKun = !v.kanHandle;
  let data: TrimmedMail;
  try { data = fraForbindelse(await v.laes(), now, { laeseKun }); } catch (err) { throw new ActionError(mailTekst().kunneIkkeLaeses(fejltekst(err))); }
  const emner = new Map(data.handling.map((e) => [e.id, e]));
  return deps.runs.start({
    kind: 'opdater',
    spec: buildMailRefreshForbindelseRun(data, now, v.navn, { laeseKun }),
    onDone: async (output) => {
      const raw = kraevJson(output);
      const { state: previous } = await current(deps);
      const facts = { tal: { handling: data.tal.handling, afventer: 0, regninger: 0, sorteretIDag: 0 }, ordnet: [] };
      const droppet: string[] = [];
      const state = parseMailState(raw, facts, deps.now(), previous, (id) => droppet.push(id));
      // Only mails that are in the inbox now (read-only: that wait); every one archives on Færdig, and nothing else is offered.
      state.beslutninger = state.beslutninger.filter((b) => emner.has(b.mailId));
      for (const b of state.beslutninger) {
        const e = emner.get(b.mailId);
        if (e) { b.emne = erUdenEmne(b.emne) ? e.emne : b.emne; b.modtaget = b.modtaget || e.modtaget; }
        b.arkivmappe = ARKIV;
        b.muligheder = [];
        if (laeseKun) { delete b.udkast; delete b.afgjort; }
      }
      state.forbindelse = v.navn;
      if (laeseKun) state.laeseKun = true;
      await deps.store.writeState(RUM, state);
      if (droppet.length) await deps.store.appendLog(RUM, { kilde: 'system', tekst: graenserTekst().dubletter(droppet.length) });
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: laeseKun ? mailTekst().logLaesteIndbakkeKun(state.beslutninger.length) : mailTekst().logLaesteIndbakke(state.beslutninger.length) });
      return rendered(deps);
    },
  });
}

async function startHandling(deps: RoomDeps, id: string): Promise<RunRecord | null> {
  const { state } = await synlig(deps);
  if (!state) return null;
  const h = handlingerIMail(state).get(id);
  if (!h) return null;
  const beslutning = state.beslutninger.find((b) => b.muligheder.some((m) => m.id === id));
  if (beslutning?.afgjort) return null;
  return deps.runs.start({
    kind: 'handling',
    spec: buildMailHandlingRun(h.label, h.instruktion, state, handlingensVerb(h)),
    onDone: async (output) => {
      const tekst = output.trim().slice(0, 600) || mailTekst().gjort(h.label);
      const entry = h.fortryd ? { kilde: 'hermes' as const, tekst, handlingId: h.id, fortryd: h.fortryd } : { kilde: 'hermes' as const, tekst, handlingId: h.id };
      await deps.store.appendLog(RUM, entry);
      return rendered(deps, { text: tekst });
    },
  });
}

async function startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null> {
  const { state, log } = await synlig(deps);
  const entry = log.find((e) => e.id === logId);
  if (!entry || !entry.fortryd || entry.fortrudt || !state) return null;
  const fortryd = entry.fortryd;
  // KC-0214: a connector's undo runs through the connector again, never as an instruction for an agent.
  if (fortryd.startsWith('lokal:')) {
    const f = laesKildeFortryd(fortryd);
    const v = f ? await handlevindue(deps) : null;
    if (!f || !v) return null;
    return deps.runs.local('fortryd', async () => {
      const r = await v.handl(f.kilde.navn, f.kilde.args, { person: deps.person, kanal: 'knap' });
      await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
      await deps.store.appendLog(RUM, { kilde: 'system', tekst: r.tekst.slice(0, 600) });
      return rendered(deps, { text: r.tekst });
    }, { room: RUM, label: mailTekst().labelFlytterTilbage });
  }
  return deps.runs.start({
    kind: 'fortryd',
    spec: buildMailFortrydRun(fortryd, state),
    onDone: async (output) => {
      await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: output.trim().slice(0, 600) || mailTekst().fortrudt });
      const fresh = await deps.store.readState<MailState>(RUM);
      const b = fresh?.beslutninger.find((x) => x.afgjort?.mulighedId === entry.handlingId);
      if (fresh && b) { delete b.afgjort; await deps.store.writeState(RUM, fresh); }
      return rendered(deps, { text: output.trim() });
    },
  });
}

async function startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const { state } = await synlig(deps);
  const v = await vindue(deps);
  await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst, ejer: deps.person.id } : { fra: 'henrik', tekst: besked, ejer: deps.person.id });
  return deps.runs.start({
    kind: 'chat',
    // KC-0218: on a mail connector (no Hermes tools) the chat answers from the envelopes, never from himalaya.
    spec: buildMailChatRun(besked, kontekst, state, v ? { navn: v.navn, kanHandle: v.kanHandle, nu: deps.now() } : undefined),
    onDone: async (output) => {
      const text = output.replace(/```(?:json)?\s*[\s\S]*?```/i, '').trim() || mailTekst().intetSvar;
      await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text, ejer: deps.person.id });
      return { text };
    },
  });
}

const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function startAction(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null> {
  if (name === 'faerdig-alle') return startFaerdigAlle(deps, body);
  if (name !== 'faerdig' && name !== 'kladde' && name !== 'send') return null;
  const mailId = str(body['mailId'], 40);
  const { state: fuld } = await current(deps);
  const b = fuld?.beslutninger.find((x) => x.mailId === mailId);
  if (!fuld || !b || !synligFor(deps.person, b)) throw new ActionError(mailTekst().fejlFindesIkke);
  const state = fuld;
  if (fuld.laeseKun) throw new ActionError(mailTekst().laeseKunSvar);
  const v = await handlevindue(deps);
  // KC-0214: IMAP cannot send, and the connector never will (send-til-andre is not a connector verb).
  if (name === 'send' && v) throw new ActionError(mailTekst().kanIkkeSende);
  if (name === 'send') {
    const tekst = str(body['tekst']);
    if (!tekst) throw new ActionError(mailTekst().svaretTomt);
    if (b.afgjort) throw new ActionError(mailTekst().alleredeSendtEllerFaerdig);
    b.udkast = tekst;
    await deps.store.writeState(RUM, state);
    return deps.runs.start({
      kind: 'send',
      room: RUM,
      label: mailTekst().labelSender(mailEmne(b.emne).slice(0, 40)),
      spec: buildSendRun(mailId, b.emne, tekst),
      onDone: async (output) => {
        const t = output.trim().slice(0, 400) || mailTekst().sendtTekst;
        const fresh = await deps.store.readState<MailState>(RUM);
        const x = fresh?.beslutninger.find((y) => y.mailId === mailId);
        if (fresh && x) { x.afgjort = { mulighedId: 'sendt', tid: deps.now().toISOString() }; await deps.store.writeState(RUM, fresh); }
        await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: t, handlingId: `send-${mailId}` });
        deps.runs.start({
          kind: 'baggrund',
          room: RUM,
          label: mailTekst().labelFlytter(mailEmne(b.emne).slice(0, 40), b.arkivmappe.replace(/^Folders\//, '')),
          spec: buildBaggrundFlytRun(mailId, b.arkivmappe),
          onDone: async (out2) => {
            await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: out2.trim().slice(0, 300) || mailTekst().flyttet, handlingId: `faerdig-${mailId}`, fortryd: `himalaya message move --from ${b.arkivmappe} --to Folders/Handling ${mailId}` });
            return rendered(deps);
          },
        });
        return rendered(deps, { text: t });
      },
    });
  }
  if (name === 'kladde') {
    const tekst = str(body['tekst']);
    if (!tekst) throw new ActionError(mailTekst().svaretTomt);
    b.udkast = tekst;
    await deps.store.writeState(RUM, state);
    if (v) {
      return deps.runs.local('kladde', async () => {
        const r = await v.handl('kladde', { id: mailId, tekst }, { person: deps.person, kanal: 'knap' });
        await deps.store.appendLog(RUM, { kilde: 'system', tekst: r.tekst.slice(0, 400), handlingId: `kladde-${mailId}` });
        return rendered(deps, { text: r.tekst });
      }, { room: RUM, label: mailTekst().labelGemmerKladde(mailEmne(b.emne).slice(0, 40)) });
    }
    return deps.runs.start({
      kind: 'kladde',
      spec: buildKladdeRun(mailId, b.emne, tekst),
      onDone: async (output) => {
        const t = output.trim().slice(0, 400) || mailTekst().kladdeGemt;
        await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: t, handlingId: `kladde-${mailId}` });
        return rendered(deps, { text: t });
      },
    });
  }
  if (b.afgjort) throw new ActionError(mailTekst().alleredeFaerdig);
  return deps.runs.local('faerdig', async () => rendered(deps, { text: mailTekst().faerdigFlyttes(await faerdigEn(deps, mailId, v)) }));
}

/**
 * The one canonical Færdig for a single mail: mark it, log it, start the background move. Returns the folder's short
 * name. KC-0214: with a connector (`v`) the move is a local run through its `flyt` verb; when the connector refuses
 * (the mail is gone, no archive folder) the mail waits again and the log says why.
 */
async function faerdigEn(deps: RoomDeps, mailId: string, v: MailForbindelse | null): Promise<string> {
  const fresh = await deps.store.readState<MailState>(RUM);
  const x = fresh?.beslutninger.find((y) => y.mailId === mailId);
  if (!fresh || !x) throw new ActionError(mailTekst().fejlFindesIkke);
  if (x.afgjort) throw new ActionError(mailTekst().alleredeFaerdig);
  x.afgjort = { mulighedId: 'faerdig', tid: deps.now().toISOString() };
  await deps.store.writeState(RUM, fresh);
  await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: mailTekst().logFaerdigMed(mailEmne(x.emne), x.arkivmappe) });
  if (v) {
    deps.runs.local('baggrund', async () => {
      try {
        const r = await v.handl('flyt', { id: mailId, til: ARKIV }, { person: deps.person, kanal: 'knap' });
        const f = r.fortryd?.navn === 'flyt' ? { fortryd: lokalFortryd({ kilde: { navn: 'flyt', args: r.fortryd.args } }) } : {};
        await deps.store.appendLog(RUM, { kilde: 'system', tekst: r.tekst.slice(0, 300), handlingId: `faerdig-${mailId}`, ...f });
      } catch (err) {
        const nu = await deps.store.readState<MailState>(RUM);
        const y = nu?.beslutninger.find((z) => z.mailId === mailId);
        if (nu && y) { delete y.afgjort; await deps.store.writeState(RUM, nu); }
        await deps.store.appendLog(RUM, { kilde: 'system', tekst: mailTekst().logIkkeFlyttet(mailEmne(x.emne).slice(0, 80), fejltekst(err)) });
      }
      return rendered(deps);
    }, { room: RUM, label: mailTekst().labelFlytterArkiv(mailEmne(x.emne).slice(0, 40)) });
    return mailTekst().arkivet;
  }
  // Background: the move itself. Not followed by the client; the live bus refreshes the page.
  deps.runs.start({
    kind: 'baggrund',
    room: RUM,
    label: mailTekst().labelFlytter(mailEmne(x.emne).slice(0, 40), x.arkivmappe.replace(/^Folders\//, '')),
    spec: buildBaggrundFlytRun(mailId, x.arkivmappe),
    onDone: async (output) => {
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: output.trim().slice(0, 300) || mailTekst().flyttet, handlingId: `faerdig-${mailId}`, fortryd: `himalaya message move --from ${x.arkivmappe} --to Folders/Handling ${mailId}` });
      return rendered(deps);
    },
  });
  return x.arkivmappe.replace(/^Folders\//, '');
}

/** KC-0097: Færdig for several informational mails at once — the single-mail Færdig in a loop, one answer. */
async function startFaerdigAlle(deps: RoomDeps, body: Record<string, unknown>): Promise<RunRecord> {
  const raw = body['mailIds'];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20 || !raw.every((v) => typeof v === 'string')) throw new ActionError(mailTekst().vaelgMindstEn);
  const ids = [...new Set((raw as string[]).map((v) => v.trim()))];
  const { state } = await synlig(deps);
  if (state?.laeseKun) throw new ActionError(mailTekst().laeseKunSvar);
  for (const id of ids) {
    const b = state?.beslutninger.find((x) => x.mailId === id);
    if (!b) throw new ActionError(mailTekst().fejlFindesIkke);
    if (!kunFaerdig(b)) throw new ActionError(mailTekst().andetAtGoere);
  }
  const v = await handlevindue(deps);
  return deps.runs.local('faerdig', async () => {
    for (const id of ids) await faerdigEn(deps, id, v);
    return rendered(deps, { text: mailTekst().mailFaerdig(ids.length) });
  });
}

export const mailRoom: RoomModule = {
  id: RUM,
  korsel: KORSEL,
  async fortrydTekst(deps, logId) { return agentFortryd((await synlig(deps)).log.find((e) => e.id === logId)?.fortryd); },
  aktionVerber: { faerdig: 'sorter', 'faerdig-alle': 'sorter', kladde: 'forbered', send: 'send-til-andre' },
  async handlingVerb(deps, id) {
    const { state } = await synlig(deps);
    const h = state ? handlingerIMail(state).get(id) : undefined;
    return h ? { verb: handlingensVerb(h), zoner: [KORSEL], indhold: handlingIndhold(h) } : null;
  },
  view,
  startOpdater,
  startHandling,
  startFortryd,
  startChat,
  startAction,
  stemme: async (deps) => stemmeMail((await synlig(deps)).state),
  venter: async (deps) => venterMail((await synlig(deps)).state),
  hjemVenter: async (deps) => {
    const { state } = await synlig(deps);
    return (state?.beslutninger ?? []).filter((b) => !b.afgjort).map((b) => ({ roomId: RUM, tekst: mailTekst().nuLinje(b.emne) }));
  },
};
