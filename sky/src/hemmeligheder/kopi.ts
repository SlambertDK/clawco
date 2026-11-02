// The backup job's key seam, wired (KC-0185): what drift/backup/typer.ts' KopiNoegler asks for, over the real
// envelope. A tenant's copies are sealed under its `backup` key (HKDF from its own DEK), so one tenant's key
// opens only that tenant's copies; Sky's database dump under the master-derived `db-backup` key of the
// master-key version it was sealed with (current or, during a rotation, previous). Typed structurally:
// drift/ and hemmeligheder/ never import each other; server.ts and the script are where they meet.
import type { Database } from '../db/pool.ts';
import { afled, afledKontrolplan } from './afled.ts';
import { kekForVersion, type Noeglering } from './masternoegle.ts';
import type { Hemmelig } from './skjul.ts';
import { hentDataNoegle } from './tenantnoegle.ts';

export { slettedeNoegler } from './tenantnoegle.ts';

export function kopiNoegler(o: { db: Database; ring: Noeglering }): { tenant(slug: string): Promise<Hemmelig>; db(version?: number): { version: number; noegle: Hemmelig } } {
  return {
    async tenant(slug) {
      const dek = await hentDataNoegle(o.db, o.ring, slug);
      try { return afled(dek, slug, 'backup'); } finally { dek.oedelaeg(); }
    },
    db(version) {
      const v = version ?? o.ring.aktuel.version;
      const kek = kekForVersion(o.ring, v);
      if (!kek) throw new Error(`ingen masternøgle med version ${v}: dumpet kan ikke åbnes med den nuværende nøglering`);
      return { version: v, noegle: afledKontrolplan(kek, 'db-backup') };
    },
  };
}
