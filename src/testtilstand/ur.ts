// The demo clock (KC-0058): now() = the real time + an offset, so time keeps
// running after a jump. saetTil() picks the offset so Copenhagen wall time on
// `dag` reads `hhmm` right now.

import { idagKbh, koebenhavnTilIso } from '../shell/tid.ts';

export type Ur = {
  now(): Date;
  offsetMs(): number;
  /** dag = YYYY-MM-DD, hhmm = "HH:MM" Copenhagen wall time. Throws on unreadable input. */
  saetTil(dag: string, hhmm: string): void;
};

export { idagKbh };

export function lavUr(): Ur {
  let offset = 0;
  return {
    now: () => new Date(Date.now() + offset),
    offsetMs: () => offset,
    saetTil(dag, hhmm) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dag) || !/^\d{2}:\d{2}$/.test(hhmm)) throw new Error(`ugyldigt tidspunkt: ${dag} ${hhmm}`);
      const iso = koebenhavnTilIso(`${dag}T${hhmm}`);
      if (!iso) throw new Error(`ugyldigt tidspunkt: ${dag} ${hhmm}`);
      offset = Date.parse(iso) - Date.now();
    },
  };
}
