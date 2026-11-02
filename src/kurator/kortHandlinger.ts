// What Henrik can do with a Kuratoren card in Hjem, behind the buttons: close
// it ("Luk", with his reason kept for Kuratoren and taught to Hermes), press its handling, and
// undo / move / choose the ledger row of a bill. Every write goes through
// endreKurator (one chain per store, the state re-read inside it), so neither a
// Kuratoren run finishing nor another button in between is lost.
// The invariant for ledger rows: `state.regnskab[id]` always says where the row
// of card `id` is (status 'skrevet') or was ('fortrudt'), and the card's
// `skrevet` is set exactly while the row is in a file.

import path from 'node:path';
import type { RoomDeps } from '../rooms/module.ts';
import type { RunRecord } from '../runs.ts';
import { MAX_LUKKET, zoneFelter, type Kort, type KuratorState, type Regnskabslinje, type RegnskabsStatus } from '../rooms/hjem/kort.ts';
import { endreKurator, HJEM, laesKurator } from './kurator.ts';
import { FORTRYD_FJERN, FORTRYD_FLYT, fjernRegnskab, harRegnskab, regnskabsfil, skrivRegnskab } from './regnskab.ts';
import { buildKortFortrydRun, buildKortHandlingRun, buildLaerRun } from './kortprompt.ts';
import { FORTRYD_SENERE, senereTekst, senereTid, type Senere } from './senere.ts';
import { extractForslagBlok } from '../tillid/forslag.ts';
import { gemRegelforslag, kanForeslaa } from './regelforslag.ts';

type Hvor = Regnskabslinje['hvor'];
export type Udfald = { ok: true; run?: RunRecord } | { ok: false; status: 404 | 409 | 503; error: string };

const HVOR_TEKST = { shelfatlas: 'ShelfAtlas-regnskabet', privat: 'det private regnskab' } as const;
const ukendt: Udfald = { ok: false, status: 404, error: 'Kortet findes ikke' };
const ingenVault: Udfald = { ok: false, status: 503, error: 'Ingen vault sat op' };
const konflikt = (error: string): Udfald => ({ ok: false, status: 409, error });
const anden = (hvor: Hvor): Hvor => (hvor === 'shelfatlas' ? 'privat' : 'shelfatlas');

/** One step in Hjem's state chain: `fn` returns the next state (the same object = no write) and what to tell the caller. */
async function gem<T>(d: RoomDeps, fn: (s: KuratorState) => [KuratorState, T] | Promise<[KuratorState, T]>): Promise<T> {
  let ud!: T;
  await endreKurator(d.store, async (s) => { const [ny, u] = await fn(s); ud = u; return ny; });
  d.live.notify(HJEM);
  return ud;
}

/** The ledger row's status carries the card's zone and owner (KC-0117), so it is shown only to who may see the card. */
const status = (l: Regnskabslinje, k: Kort): RegnskabsStatus => ({ hvor: l.hvor, status: 'skrevet', leverandoer: l.leverandoer, beloeb: l.beloeb, valuta: l.valuta, ...zoneFelter(k) });
const tabt = (): Udfald => konflikt('Linjen står ikke længere i regnskabet');

function medKort(s: KuratorState, id: string, fn: (k: Kort) => Kort): Kort[] {
  return s.kort.map((k) => (k.id === id ? fn(k) : k));
}

const uden = (k: Kort, felt: 'skrevet' | 'udsatTil'): Kort => { const c = { ...k }; delete c[felt]; return c; };

/**
 * Senere (KC-0096): puts the card away until tonight 18.00 or tomorrow 07.00. It stays in state.kort (not
 * dismissed, so Kuratoren still stands by it) with `udsatTil` set; the log line carries a Fortryd the app
 * answers itself. "I aften" from 17.00 on is a 409.
 */
export async function udsaet(d: RoomDeps, id: string, til: Senere): Promise<Udfald> {
  const nu = d.now();
  const tid = senereTid(til, nu);
  const k = await gem(d, (s): [KuratorState, Kort | undefined | 'for-sent'] => {
    const k = s.kort.find((x) => x.id === id);
    if (!k) return [s, undefined];
    if (!tid) return [s, 'for-sent'];
    return [{ ...s, kort: medKort(s, id, (c) => ({ ...c, udsatTil: tid })) }, k];
  });
  if (!k) return ukendt;
  if (k === 'for-sent') return konflikt('I aften kan kun vælges før kl. 17');
  await d.store.appendLog(HJEM, { kilde: 'henrik', tekst: senereTekst(til, k.titel), handlingId: `senere:${id}`, fortryd: FORTRYD_SENERE });
  return { ok: true };
}

export async function luk(d: RoomDeps, id: string, grund: string, personer?: string): Promise<Udfald> {
  const dato = d.now().toISOString();
  const k = await gem(d, (s): [KuratorState, Kort | undefined] => {
    const k = s.kort.find((x) => x.id === id);
    if (!k) return [s, undefined];
    const lukket = [{ id, titel: k.titel, grund, dato, ...zoneFelter(k) }, ...(s.lukket ?? [])].slice(0, MAX_LUKKET);
    return [{ ...s, kort: s.kort.filter((x) => x.id !== id), afvist: [...new Set([...s.afvist, id])], lukket }, k];
  });
  if (!k) return ukendt;
  await d.store.appendLog(HJEM, { kilde: 'henrik', tekst: `Lukkede "${k.titel}"${grund ? `: ${grund}` : ''}` });
  // KC-0130: Luk is the app's Ikke relevant — Start's first-Ret step listens (src/rooms/rethaendelse.ts).
  await d.retBus?.meld(d, { art: 'ikke-relevant', tid: dato, titel: k.titel, kortId: id, ...(grund ? { tekst: grund } : {}) });
  if (!grund) return { ok: true };
  // KC-0144: the owner's answer may carry ONE rule proposal; decided here, in the request (a run's callback has no person).
  const forslag = kanForeslaa(d);
  const regler = forslag && d.regler ? await d.regler.laes() : undefined;
  const run = d.runs.start({
    kind: 'laer',
    room: HJEM,
    label: 'Nu: lærer af dit svar',
    spec: buildLaerRun(k, grund, d.now(), personer, forslag ? { regler } : undefined),
    onDone: async (output) => {
      const { tekst, blok } = forslag ? extractForslagBlok(output) : { tekst: output, blok: undefined };
      const text = tekst.trim().slice(0, 600) || 'Noteret.';
      await d.store.appendLog(HJEM, { kilde: 'hermes', tekst: text });
      // A pending proposal only: the rules file changes with Henrik's own Ja (server.ts), never here.
      if (forslag) await gemRegelforslag(d, { kort: k, art: 'ikke-relevant', blok }).catch((err: unknown) => console.error('regelforslag:', err instanceof Error ? err.message : err));
      return { text };
    },
  });
  return { ok: true, run };
}

export async function startKortHandling(d: RoomDeps, id: string): Promise<Udfald> {
  const k = (await laesKurator(d.store)).kort.find((x) => x.id === id);
  if (!k) return ukendt;
  const h = k.handling;
  if (!h) return { ok: false, status: 404, error: 'Kortet har ingen handling' };
  const run = d.runs.start({
    kind: 'handling',
    room: HJEM,
    label: `Nu: ${h.label}`,
    spec: buildKortHandlingRun(k, h, d.now()),
    onDone: async (output) => {
      const text = output.trim().slice(0, 600) || `${h.label}: gjort.`;
      await d.store.appendLog(HJEM, { kilde: 'hermes', tekst: text, handlingId: h.id, ...(h.fortryd ? { fortryd: h.fortryd } : {}) });
      return { text };
    },
  });
  return { ok: true, run };
}

/** Marks every still-open log entry of this card's ledger row as undone. */
async function markerFortrudt(d: RoomDeps, id: string): Promise<void> {
  const tid = d.now().toISOString();
  for (const e of await d.store.readLog(HJEM, 1000)) {
    if (e.handlingId === `regnskab:${id}` && !e.fortrudt) await d.store.updateLog(HJEM, e.id, { fortrudt: tid });
  }
}

const logTekst = (verbum: string, l: Pick<Regnskabslinje, 'leverandoer' | 'beloeb' | 'valuta'>, hvor: Hvor): string => `${verbum} ${l.leverandoer} ${l.beloeb} ${l.valuta} ${verbum === 'Skrev' ? 'ind i' : 'til'} ${HVOR_TEKST[hvor]}`;

/**
 * Inside a state step: removes the row of card `id` from the ledger `hvor` and returns the state that records
 * it (state.regnskab, the card's `skrevet` if the card is still there). Null when the file has no such row:
 * then nothing is recorded as undone.
 */
async function fjernRaekke(d: RoomDeps, s: KuratorState, id: string, hvor: Hvor): Promise<KuratorState | null> {
  if (!(await fjernRegnskab(regnskabsfil(path.dirname(d.vaultInbox), hvor), id))) return null;
  return { ...s, kort: medKort(s, id, (c) => uden(c, 'skrevet')), regnskab: { ...s.regnskab, [id]: { ...s.regnskab?.[id], hvor, status: 'fortrudt' } } };
}

/**
 * Fortryd: removes exactly the card's row, no Hermes run. The card keeps its `regnskab` entry so it is never
 * written again. A retired card's row is found through state.regnskab ("Skrevet i regnskab" in Hjem).
 */
export async function regnskabFortryd(d: RoomDeps, id: string): Promise<Udfald> {
  const u = await gem(d, async (s): Promise<[KuratorState, Udfald]> => {
    const k = s.kort.find((x) => x.id === id);
    const r = s.regnskab?.[id];
    if (!k && !r) return [s, ukendt];
    if (!d.vaultInbox) return [s, ingenVault];
    const hvor = k ? k.skrevet?.hvor : r?.status === 'skrevet' ? r.hvor : undefined;
    if (!hvor) return [s, konflikt(k ? 'Kortet er ikke skrevet i et regnskab' : 'Linjen står ikke længere i et regnskab')];
    const ny = await fjernRaekke(d, s, id, hvor);
    return ny ? [ny, { ok: true }] : [s, tabt()];
  });
  if (u.ok) await markerFortrudt(d, id);
  return u;
}

/**
 * Flyt: write the row to the other ledger, then remove it from the one it is in — in that order, so a failed
 * write loses nothing. A row Henrik removed by hand is not brought back (409). With `til` (the chat's
 * correction), a row already in `til` stays where it is.
 */
export async function regnskabFlyt(d: RoomDeps, id: string, til?: Hvor): Promise<Udfald> {
  const ud = await gem(d, async (s): Promise<[KuratorState, { u: Udfald; linje?: Regnskabslinje }]> => {
    const k = s.kort.find((x) => x.id === id);
    if (!k) return [s, { u: ukendt }];
    if (!d.vaultInbox) return [s, { u: ingenVault }];
    if (!k.skrevet || !k.regnskab) return [s, { u: konflikt('Kortet er ikke skrevet i et regnskab') }];
    const fra = k.skrevet.hvor;
    if (til === fra) return [s, { u: { ok: true } }];
    const rod = path.dirname(d.vaultInbox);
    if (!(await harRegnskab(regnskabsfil(rod, fra), id))) return [s, { u: tabt() }];
    const maal = anden(fra);
    const linje: Regnskabslinje = { ...k.regnskab, hvor: maal };
    const fil = regnskabsfil(rod, maal);
    await skrivRegnskab(fil, id, linje); // throws: nothing removed, nothing stored, nothing logged
    await fjernRegnskab(regnskabsfil(rod, fra), id);
    return [{ ...s, kort: medKort(s, id, (c) => ({ ...c, regnskab: linje, skrevet: { hvor: maal, fil } })), regnskab: { ...s.regnskab, [id]: status(linje, k) } }, { u: { ok: true }, linje }];
  });
  if (ud.linje) await d.store.appendLog(HJEM, { kilde: 'henrik', tekst: logTekst('Flyttede', ud.linje, ud.linje.hvor), handlingId: `regnskab:${id}`, fortryd: FORTRYD_FLYT });
  return ud.u;
}

/**
 * The line to write for a card Hermes could not place: Hermes' proposed line
 * (`regnskabForslag`) with the chosen ledger. Only when Hermes gave none, what
 * the card itself says: the title as supplier, the lead as subject, today as date.
 */
function linjeForUklart(k: Kort, hvor: Hvor, now: Date): Regnskabslinje {
  if (k.regnskab) return { ...k.regnskab, hvor };
  if (k.regnskabForslag) return { ...k.regnskabForslag, hvor };
  const dato = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Copenhagen' }).format(now);
  return { hvor, dato, leverandoer: k.titel, beloeb: 'se mail', valuta: '', art: 'koeb', emne: k.betyder.slice(0, 200) };
}

/** Henrik chose the ledger for an unclear bill, or wrote a bill back after undoing its row (KC-0066). */
export async function regnskabVaelg(d: RoomDeps, id: string, hvor: Hvor): Promise<Udfald> {
  const ud = await gem(d, async (s): Promise<[KuratorState, { u: Udfald; linje?: Regnskabslinje }]> => {
    const k = s.kort.find((x) => x.id === id);
    if (!k) return [s, { u: ukendt }];
    if (!d.vaultInbox) return [s, { u: ingenVault }];
    if (k.skrevet || !(k.regnskabUklart || k.regnskab)) return [s, { u: konflikt('Kortet venter ikke på et valg af regnskab') }];
    const linje = linjeForUklart(k, hvor, d.now());
    const fil = regnskabsfil(path.dirname(d.vaultInbox), hvor);
    await skrivRegnskab(fil, id, linje);
    return [{ ...s, kort: medKort(s, id, (c) => { const { kraeverRegel: _svaret, ...uden } = c; const ny: Kort = { ...uden, regnskab: linje, skrevet: { hvor, fil }, regnskabUklart: false }; return ny; }), regnskab: { ...s.regnskab, [id]: status(linje, k) } }, { u: { ok: true }, linje }];
  });
  if (ud.linje) await d.store.appendLog(HJEM, { kilde: 'henrik', tekst: logTekst('Skrev', ud.linje, hvor), handlingId: `regnskab:${id}`, fortryd: FORTRYD_FJERN });
  return ud.u;
}

/**
 * Fortryd on one of Hjem's own log entries. A ledger entry (handlingId regnskab:<id>)
 * is undone by the app: its row goes (found through state.regnskab, so it works after
 * the card was dismissed; without an entry there, in whichever ledger file holds its
 * marker), or, for a Flyt entry, goes back to the other ledger. Any other entry runs
 * the instruction stored with it as a Hermes run.
 */
export async function fortrydLog(d: RoomDeps, logId: string): Promise<Udfald> {
  const e = (await d.store.readLog(HJEM, 1000)).find((x) => x.id === logId);
  if (!e) return { ok: false, status: 404, error: 'Linjen findes ikke' };
  if (e.fortrudt) return konflikt('Allerede fortrudt');
  if (e.fortryd === FORTRYD_SENERE && e.handlingId?.startsWith('senere:')) {
    const id = e.handlingId.slice('senere:'.length);
    const u = await gem(d, (s): [KuratorState, Udfald] => {
      const k = s.kort.find((x) => x.id === id);
      if (!k) return [s, konflikt('Kortet er væk, så der er intet at hente tilbage')];
      return k.udsatTil ? [{ ...s, kort: medKort(s, id, (c) => uden(c, 'udsatTil')) }, { ok: true }] : [s, { ok: true }]; // already back by itself: only the line is marked
    });
    if (u.ok) await d.store.updateLog(HJEM, logId, { fortrudt: d.now().toISOString() });
    return u;
  }
  const raekke = e.handlingId?.startsWith('regnskab:') ? e.handlingId.slice('regnskab:'.length) : null;
  if (raekke !== null) {
    if (!d.vaultInbox) return ingenVault;
    if (e.fortryd === FORTRYD_FLYT) {
      // A read for the message only: regnskabFlyt checks again inside the chain.
      const s = await laesKurator(d.store);
      if (s.regnskab?.[raekke]?.status !== 'skrevet') return konflikt('Linjen står ikke længere i et regnskab');
      if (!s.kort.some((x) => x.id === raekke)) return konflikt('Kortet er væk, så linjen kan ikke flyttes; fortryd linjen i stedet');
      const u = await regnskabFlyt(d, raekke);
      if (!u.ok) return u;
      await d.store.updateLog(HJEM, logId, { fortrudt: d.now().toISOString() });
      return u;
    }
    const rod = path.dirname(d.vaultInbox);
    const u = await gem(d, async (s): Promise<[KuratorState, Udfald]> => {
      const nu = s.regnskab?.[raekke];
      if (nu && nu.status !== 'skrevet') return [s, konflikt('Linjen står ikke længere i et regnskab')];
      let hvor: Hvor | undefined = nu?.hvor;
      // No entry (a write that was never recorded): the marker says which ledger holds the row.
      for (const h of ['shelfatlas', 'privat'] as const) if (!hvor && (await harRegnskab(regnskabsfil(rod, h), raekke))) hvor = h;
      if (!hvor) return [s, tabt()];
      const ny = await fjernRaekke(d, s, raekke, hvor);
      return ny ? [ny, { ok: true }] : [s, tabt()];
    });
    if (u.ok) await markerFortrudt(d, raekke);
    return u;
  }
  const fortryd = e.fortryd;
  if (!fortryd) return { ok: false, status: 404, error: 'Kan ikke fortrydes' };
  // An undo only the app itself knows (server.ts) is never handed to Hermes as an instruction.
  if (fortryd.startsWith('lokal:')) return { ok: false, status: 404, error: 'Kan ikke fortrydes her' };
  const run = d.runs.start({
    kind: 'fortryd',
    room: HJEM,
    label: 'Nu: fortryder',
    spec: buildKortFortrydRun(fortryd, d.now()),
    onDone: async (output) => {
      const text = output.trim().slice(0, 600) || 'Fortrudt.';
      await d.store.updateLog(HJEM, logId, { fortrudt: d.now().toISOString() });
      await d.store.appendLog(HJEM, { kilde: 'hermes', tekst: text });
      return { text };
    },
  });
  return { ok: true, run };
}
