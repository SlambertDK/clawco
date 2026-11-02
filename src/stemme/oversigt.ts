// The cross-room overview the voice agent gets: every room's spoken view in
// one numbered text, plus the ids behind each choice (the agent passes them
// back through a tool, so they ARE in the text here, as "(id rum:xyz)").

import type { RoomDeps, RoomModule } from '../rooms/module.ts';
import { findRoom } from '../rooms/registry.ts';
import type { Oversigt, StemmeRum } from './types.ts';
import type { Person } from '../identitet/husstand.ts';
import { kunSynlige, type Kort } from '../rooms/hjem/kort.ts';
import { synligeKort } from '../kurator/senere.ts';
import { SITUATIONER } from '../situation/regler.ts';

/** Without a situation the voice uses the day's order. */
const ORDEN = SITUATIONER.dagen.stemme;

function plads(rum: string, orden: readonly string[]): number {
  const i = orden.indexOf(rum);
  return i < 0 ? orden.length : i;
}

function navn(rum: string): string {
  return findRoom(rum)?.navn ?? rum.charAt(0).toUpperCase() + rum.slice(1);
}

/** Pure: rooms in the situation's order (KC-0114; default mail, dagen, nyheder, skrive, others last) → numbered text and punkter. */
export function oversigtAf(rum: StemmeRum[], orden: readonly string[] = ORDEN): Oversigt {
  const sorteret = rum.map((r, i) => ({ r, i })).sort((a, b) => plads(a.r.rum, orden) - plads(b.r.rum, orden) || a.i - b.i).map((x) => x.r);
  const punkter: Oversigt['punkter'] = [];
  for (const r of sorteret) for (const p of r.punkter) punkter.push({ ...p, rum: r.rum, nr: punkter.length + 1 });
  const top = punkter.length === 0 ? 'Intet venter på dig lige nu.' : punkter.length === 1 ? 'Der venter én ting.' : `Der venter ${punkter.length} ting.`;
  const linjer = [top, ...sorteret.map((r) => `${navn(r.rum)}: ${r.resume}`)];
  for (const p of punkter) {
    const valg = p.valg.length ? ` Valg: ${p.valg.map((v) => `${v.label} (id ${p.rum}:${v.id})`).join(', ')}.` : '';
    linjer.push(`${p.nr}. ${p.sig}${valg}`);
  }
  return { tekst: linjer.join('\n'), punkter };
}

export async function bygOversigt(modules: readonly Pick<RoomModule, 'id' | 'stemme'>[], deps: RoomDeps, orden?: readonly string[]): Promise<Oversigt> {
  const rum: StemmeRum[] = [];
  for (const m of modules) {
    if (!m.stemme) continue;
    try {
      rum.push(await m.stemme(deps));
    } catch (e) {
      console.error(`stemme: ${m.id} kunne ikke bygge sin oversigt:`, e);
    }
  }
  return oversigtAf(rum, orden);
}

/**
 * KC-0028 + KC-0117: Kuratoren's top cards (by prioritet) before the rooms, in the spoken overview. Of `kort` (the stored
 * cards) only those on screen now (not expired, not put away) that `person` may see are counted or read out. Cards are not
 * voice-executable: the punkter stay as they are.
 */
export function medKuratorKort(o: Oversigt, kort: readonly Kort[], person: Person, now: Date): Oversigt {
  const alle = kunSynlige(synligeKort(kort, now), person);
  if (alle.length === 0) return o;
  const top = [...alle].sort((a, b) => a.prioritet - b.prioritet).slice(0, 3);
  const n = alle.length;
  const lead = n === 1 ? 'Kuratoren har ét kort til dig.' : `Kuratoren har ${n} kort til dig.`;
  return { ...o, tekst: [lead, ...top.map((k) => `${k.titel}: ${k.anbefaling}`), o.tekst].join('\n') };
}

/** KC-0139: a broken source is said once, in one sentence, before the rooms (the sentences come from the fixed table). */
export function medKildeHelbred(o: Oversigt, saetninger: readonly string[]): Oversigt {
  if (saetninger.length === 0) return o;
  return { ...o, tekst: [...new Set(saetninger)].slice(0, 3).concat(o.tekst).join('\n') };
}
