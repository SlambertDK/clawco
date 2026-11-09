// KC-0128: a source's first value in Start's rum-lager. The composition root
// hands Start the cleaned first read (the registry's foersteLaesning hook);
// Start builds the preview, stores it with foersteVaerdiMs (connect recorded →
// preview stored, i.e. ready for the next render) and logs it. The preview is
// shown in Nu and in Start until the curated view lands: its room's rebuild
// finishing done (calendar → Dagen, mail → Mail, news → Nyheder), or for a
// source with no room a Kuratoren run. It is never shown past the Copenhagen
// day it was read ("i dag" would turn false).

import type { KildeKortSyn, RoomDeps } from '../module.ts';
import { ActionError } from '../module.ts';
import { kan } from '../../identitet/roller.ts';
import type { DataZone } from '../../identitet/zoner.ts';
import { synligFor } from '../../identitet/zoner.ts';
import { dagStr } from '../../shell/friskhed.ts';
import { tekst } from '../../shell/tekster.ts';
import { parseStartState, type StartState } from './schema.ts';
import { byggForhaandsvisning, type Forhaandsvisning, type KildeNavn, type RaaLaesning } from './forhaandsvisning.ts';
import { startTekst } from './tekster.ts';
import { endreStart } from './laas.ts';
import { alleTrin, flereKilderKoe, FOERSTE_SLAGS, utenPakke, type KildeTrin, type TrinKontekst } from './trin.ts';
import type { KildeVisning } from './kilderender.ts';

const RUM = 'start';
/** The room whose rebuild turns a kind of source into curated elements. */
export const KILDE_RUM: Readonly<Record<string, string>> = { kalender: 'dagen', mail: 'mail', nyheder: 'nyheder' };

const ny = (deps: RoomDeps): StartState => ({ startet: deps.now().toISOString(), trin: {}, afvist: {} });
const laes = async (deps: RoomDeps): Promise<StartState> => parseStartState(await deps.store.readState(RUM)) ?? ny(deps);
const varighed = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString(tekst().lokale, { maximumFractionDigits: 1 })} s`);

/** Stores the preview of a first read. Returns the room to rebuild for it (none for notes and messages). */
export async function modtagFoersteLaesning(deps: RoomDeps, h: { kilde: KildeNavn; laesning: RaaLaesning; zone: DataZone; ejer: string; forbundet: string }): Promise<{ rum?: string }> {
  const nu = deps.now();
  const f: Forhaandsvisning = { ...byggForhaandsvisning(h.kilde, h.laesning, nu), zone: h.zone, ejer: h.ejer };
  const t0 = Date.parse(h.forbundet);
  const ms = Number.isNaN(t0) ? 0 : Math.max(0, nu.getTime() - t0);
  const rum = KILDE_RUM[h.kilde.slags];
  await endreStart(deps, (gemt) => { // KC-0281: in Start's queue
    const s = gemt ?? ny(deps);
    const trin = FOERSTE_SLAGS.includes(h.kilde.slags) && s.trin['foerste-kilde']?.status !== 'klaret' ? { ...s.trin, 'foerste-kilde': { status: 'klaret' as const, tid: nu.toISOString() } } : s.trin;
    const kilder = { ...(s.kilder ?? {}), [h.kilde.id]: { foersteVaerdiMs: ms, tid: nu.toISOString(), forhaandsvisning: f, ...(rum ? { rum } : {}) } };
    return { ...s, trin, kilder };
  });
  await deps.store.appendLog(RUM, { kilde: 'system', zone: h.zone, ejer: h.ejer, tekst: startTekst().fv.logFoersteKig(h.kilde.navn, varighed(ms), f.titel) });
  deps.live.notify(RUM);
  return rum ? { rum } : {};
}

/** A finished run: retires the previews it replaces (their room's rebuild, or Kuratoren for a source with no room, started after the preview). True when one was retired. */
export async function koerselFaerdig(deps: RoomDeps, r: { room?: string; kind: string; status: string; startedAt: number }): Promise<boolean> {
  if (r.status !== 'done') return false;
  const tid = deps.now().toISOString();
  let aendret = false;
  await endreStart(deps, (s) => { // KC-0281: in Start's queue
    if (!s?.kilder) return null;
    const kilder = Object.fromEntries(Object.entries(s.kilder).map(([id, v]) => {
      const matcher = v.rum ? r.room === v.rum : r.kind === 'kurator';
      if (v.erstattet || !matcher || r.startedAt < Date.parse(v.tid)) return [id, v];
      aendret = true;
      return [id, { ...v, erstattet: tid }];
    }));
    return aendret ? { ...s, kilder } : null;
  });
  return aendret;
}

/** The previews shown now for the person looking: not yet replaced, read today (Copenhagen), visible to them; oldest first. */
export async function forhaandsvisningerNu(deps: RoomDeps): Promise<Forhaandsvisning[]> {
  const s = parseStartState(await deps.store.readState(RUM));
  const idag = dagStr(deps.now());
  return Object.values(s?.kilder ?? {})
    .filter((v) => !v.erstattet && dagStr(new Date(v.tid)) === idag && synligFor(deps.person, v.forhaandsvisning))
    .sort((a, b) => a.tid.localeCompare(b.tid))
    .map((v) => v.forhaandsvisning);
}

/** What steps 3–4 read of the registry: every source and whether it is connected. No registry (or one that cannot be read) = none. */
export async function kildeKontekst(deps: RoomDeps): Promise<{ kilder?: KildeTrin[] }> {
  if (!deps.rejse) return {};
  try {
    // KC-0236: the Danmark-pakke's sources are not the journey's (they have their own group in Start).
    return { kilder: utenPakke(await deps.rejse.kilder()).map((k) => ({ id: k.id, navn: k.navn, slags: k.slags, forbundet: k.forbundet })) };
  } catch { return {}; } // fail closed: no source counts as connected
}

/** Start's view of steps 3–4: the registry's cards, the previews shown now and step 4's pile. Undefined without a registry window. */
export async function kildeVisning(deps: RoomDeps, s: StartState | null, ctx: TrinKontekst): Promise<KildeVisning | undefined> {
  if (!deps.rejse?.kort) return undefined;
  let kort: KildeKortSyn[];
  try { kort = await deps.rejse.kort(); } catch { return undefined; }
  return { kort, forhaandsvisninger: await forhaandsvisningerNu(deps), flere: flereKilderKoe(s, ctx).map((k) => k.id), kanForbinde: kan(deps.person.rolle, 'aendre-indstillinger'), ...(deps.laptop?.() ? { laptop: true } : {}), ...(s?.situation ? { situation: s.situation.valg } : {}) };
}

/** Step 4's Spring over: the source leaves the pile (and the screen); when nothing is left and nothing was added, the step is sprunget-over. */
export async function springOver(deps: RoomDeps, kildeId: string, ctx: TrinKontekst): Promise<string> {
  const tid = deps.now().toISOString();
  let k: KildeTrin | undefined;
  await endreStart(deps, (gemt) => { // KC-0281: in Start's queue
    const s = gemt ?? ny(deps);
    k = flereKilderKoe(s, ctx).find((x) => x.id === kildeId);
    if (!k) return null;
    const efter: StartState = { ...s, sprunget: { ...(s.sprunget ?? {}), [kildeId]: tid } };
    const flere = alleTrin().find((t) => t.id === 'flere-kilder');
    if (flereKilderKoe(efter, ctx).length === 0 && flere && !flere.erKlaret(efter, ctx)) efter.trin = { ...efter.trin, 'flere-kilder': { status: 'sprunget-over', tid } };
    return efter;
  });
  if (!k) throw new ActionError(startTekst().akt.kildeIkkeTilbudt);
  await deps.store.appendLog(RUM, { kilde: 'henrik', zone: 'privat', ejer: deps.person.id, tekst: startTekst().akt.sprangKilde(k.navn) });
  return k.navn;
}
