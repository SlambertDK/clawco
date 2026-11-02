// KC-0041/KC-0043: what the routes under /api/udvikling do — send an opgave
// from Hjem or the chat, list a repo's opgaver for the Mac, and take its status
// reports. Every change lands in Hjem's log and wakes Hjem's live bus.

import type { RoomDeps } from '../rooms/module.ts';
import { HJEM, laesKurator } from '../kurator/kurator.ts';
import { endreOpgaver, laesOpgaver } from './lager.ts';
import { nyOpgave, skiftStatus, svar, type Grundlag, type Opgave, type OpgaveStatus } from './opgaver.ts';
import { findProjekt, projektForRepo } from './projekter.ts';

export type Svar = { ok: true; opgave: Opgave } | { ok: false; status: 400 | 404 | 409; error: string };

const kort = (t: string): string => (t.length > 120 ? `${t.slice(0, 119)}…` : t);
const STATUS_TEKST: Record<OpgaveStatus, string> = { sendt: 'sendt igen', modtaget: 'modtaget', 'i-gang': 'i gang', parkeret: 'parkeret', faerdig: 'færdig' };

/** Sends an opgave. With `kortId` the card is copied from the stored state: the browser never supplies card content. */
export async function send(d: RoomDeps, b: Record<string, unknown>): Promise<Svar> {
  const { projekt, saetning, kortId, kontekst } = b;
  if (typeof projekt !== 'string' || typeof saetning !== 'string') return { ok: false, status: 400, error: 'projekt og saetning skal være tekst' };
  let grundlag: Grundlag | null = null;
  let kilde: Opgave['kilde'] = 'chat';
  if (typeof kortId === 'string' && kortId) {
    const k = (await laesKurator(d.store)).kort.find((x) => x.id === kortId);
    if (!k) return { ok: false, status: 404, error: 'Kortet findes ikke længere' };
    grundlag = { titel: k.titel, linjer: [k.betyder, ...k.grundlag], kilder: [...k.kilder] };
    kilde = 'kort';
  } else if (typeof kontekst === 'string' && kontekst.trim()) {
    grundlag = { titel: kontekst.trim().slice(0, 200), linjer: [], kilder: [] };
  }
  const u = nyOpgave({ projekt, saetning, grundlag, kilde }, d.now());
  if (!u.ok) return u;
  await endreOpgaver(d.store, (alle) => [[...alle, u.opgave], undefined]);
  await d.store.appendLog(HJEM, { kilde: 'henrik', tekst: `Sendte til Claude Code (${findProjekt(projekt)?.navn ?? projekt}): ${kort(u.opgave.saetning)}` });
  d.live.notify(HJEM);
  return u;
}

/** A repo's opgaver, oldest first, or undefined for a repo that is not on the project list. */
export async function forRepo(d: RoomDeps, repo: string): Promise<{ projekt: string; opgaver: Opgave[] } | undefined> {
  const p = projektForRepo(repo);
  if (!p) return undefined;
  return { projekt: p.id, opgaver: (await laesOpgaver(d.store)).filter((o) => o.projekt === p.id) };
}

export async function status(d: RoomDeps, id: string, b: Record<string, unknown>): Promise<Svar> {
  const [svar, foer] = await endreOpgaver(d.store, (alle): [Opgave[], [Svar, Opgave | undefined]] => {
    const i = alle.findIndex((o) => o.id === id);
    const o = alle[i];
    if (!o) return [alle, [{ ok: false, status: 404, error: 'Opgaven findes ikke' }, undefined]];
    const u = skiftStatus(o, b, d.now());
    if (!u.ok || u.opgave === o) return [alle, [u, o]];
    return [alle.map((x, j) => (j === i ? u.opgave : x)), [u, o]];
  });
  if (!svar.ok || !foer || svar.opgave === foer) return svar;
  const o = svar.opgave;
  // A line when the status moved or the ticket appeared; a changed bevis alone is not news.
  if (o.status !== foer.status || o.ticket !== foer.ticket) {
    const hvad = o.status === 'modtaget' && o.ticket ? `modtaget som ${o.ticket}` : `${o.ticket ?? 'opgaven'} er ${STATUS_TEKST[o.status]}`;
    await d.store.appendLog(HJEM, { kilde: 'system', tekst: `Claude Code: ${hvad} — ${kort(o.saetning)}` });
  }
  if (o.spoergsmaal && o.spoergsmaal !== foer.spoergsmaal) await d.store.appendLog(HJEM, { kilde: 'system', tekst: `Claude Code spørger (${o.ticket ?? 'opgaven'}): ${kort(o.spoergsmaal.tekst)}` });
  d.live.notify(HJEM);
  return svar;
}

/** KC-0045: Henrik answers Claude Code's question; the Mac writes the answer into the ticket on its next sync. */
export async function besvar(d: RoomDeps, id: string, b: Record<string, unknown>): Promise<Svar> {
  const u = await endreOpgaver(d.store, (alle): [Opgave[], Svar] => {
    const i = alle.findIndex((o) => o.id === id);
    const o = alle[i];
    if (!o) return [alle, { ok: false, status: 404, error: 'Opgaven findes ikke' }];
    const r = svar(o, b['svar'], d.now());
    return r.ok ? [alle.map((x, j) => (j === i ? r.opgave : x)), r] : [alle, r];
  });
  if (!u.ok) return u;
  await d.store.appendLog(HJEM, { kilde: 'henrik', tekst: `Svarede Claude Code (${u.opgave.ticket ?? 'opgaven'}): ${kort(u.opgave.svar?.tekst ?? '')}` });
  d.live.notify(HJEM);
  return u;
}
