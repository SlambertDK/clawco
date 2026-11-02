// The calendar poller (shape of the Kuratoren tick): every 15 minutes between
// 06:00 and 22:00 Copenhagen time, plus once at start, read the next 14 days
// through scripts/kalender_uge.py and merge the meetings into the Univers
// index ("Nye møder"); meetings that already sit in a univers get their
// time, title and people refreshed there. Off without a calendar script (dev).

import type { RoomDeps } from '../module.ts';
import { UNIVERS, endreIndeks, endreUnivers, flettKandidater, laesIndeks, laesUnivers, moedeFraKandidat, tilfoejMoede, universRum } from './lager.ts';
import { moederFraKalender, type KalenderMoede } from './kalender.ts';
import { standardId, type Moede, type MoedeKandidat } from './schema.ts';
import { iVinduet } from './tid.ts';

export type MoedeTikDeps = Pick<RoomDeps, 'store' | 'mailRunner' | 'kalenderScript' | 'now' | 'live'>;
export type MoedeTikResultat = { nye: number; opdateret: number };

const INTERVAL_MS = 15 * 60_000;

const lige = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Did the calendar change anything the meeting shows? */
function aendret(m: Moede, k: KalenderMoede): boolean {
  return m.titel !== k.titel || m.start !== k.start || m.slut !== k.slut || (m.sted ?? '') !== (k.sted ?? '') || !lige(m.deltagere, k.deltagere);
}

/** One poll. Null when it cannot run (no script, script failed, unreadable output); never throws for those. */
export async function koerMoedeTik(deps: MoedeTikDeps): Promise<MoedeTikResultat | null> {
  if (!deps.kalenderScript) return null;
  const r = await deps.mailRunner('python3', [deps.kalenderScript, '--days', '14']).catch(() => null);
  if (!r || r.code !== 0 || !r.stdout.trim()) return null;
  let kalender: KalenderMoede[];
  try { kalender = moederFraKalender(JSON.parse(r.stdout)); } catch { return null; }
  const kandidater: MoedeKandidat[] = kalender.map((k) => ({ eventId: k.eventId, titel: k.titel, start: k.start, slut: k.slut, deltagere: k.deltagere, ...(k.sted ? { sted: k.sted } : {}) }));
  const efterId = new Map(kalender.map((k) => [k.eventId, k]));

  // Placed meetings: refresh each univers (all of them, archived too, so a placed meeting never comes back as new).
  let opdateret = 0;
  const placerede = new Set<string>();
  const indeks0 = await laesIndeks(deps.store);
  for (const u of indeks0.univers) {
    const rum = universRum(u.id);
    let aendringer = 0;
    const state = await endreUnivers(deps.store, rum, (s) => {
      let ny = s;
      for (const m of s.moeder) {
        const k = m.eventId ? efterId.get(m.eventId) : undefined;
        if (k && aendret(m, k)) { ny = tilfoejMoede(ny, moedeFraKandidat(k, standardId)); aendringer++; }
      }
      return ny;
    });
    for (const m of state.moeder) if (m.eventId) placerede.add(m.eventId);
    if (aendringer) { opdateret += aendringer; deps.live.notify(rum); }
  }

  // The index: placed ids are read again inside the lock so a placement that lands meanwhile is not offered twice.
  const indeks = await endreIndeks(deps.store, async (i) => {
    const alle = new Set(placerede);
    for (const u of i.univers) for (const m of (await laesUnivers(deps.store, u.id)).moeder) if (m.eventId) alle.add(m.eventId);
    return flettKandidater(i, kandidater, alle);
  });
  if (!lige(indeks0.nyeMoeder, indeks.nyeMoeder)) deps.live.notify(UNIVERS);
  return { nye: indeks.nyeMoeder.length, opdateret };
}

/**
 * Starts the poller; returns a stop function. A tick outside 06–22 does nothing; the first one at start always runs.
 * `aktiv` (KC-0124): false while Clawco is paused — every tick, the first one too, does nothing then.
 */
export function startMoedeTik(deps: MoedeTikDeps, intervalMs = INTERVAL_MS, aktiv: () => boolean = () => true): () => void {
  if (!deps.kalenderScript) return () => {};
  let koerer = false;
  const tik = (): void => {
    if (koerer || !aktiv()) return;
    koerer = true;
    void koerMoedeTik(deps).catch((e: unknown) => { console.error('møder: kalenderen kunne ikke hentes', e); }).finally(() => { koerer = false; });
  };
  tik();
  const t = setInterval(() => { if (iVinduet(deps.now())) tik(); }, intervalMs);
  t.unref();
  return () => clearInterval(t);
}
