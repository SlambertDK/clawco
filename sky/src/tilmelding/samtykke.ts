// The consent versions (KC-0198, KC-0204) read from the frontmatter of the texts themselves (docs/legal/*.da.md),
// the one place a version lives (AGENTS §0 r6): bump a text's `version` and every account is asked again. Sky
// shares no code with the site build (aftryk.test.ts), so it has its own small reader; a root test
// (test/juridisk.test.ts) holds that the two agree. The texts are served on the public site at the paths below.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Tekst = { version: string; sti: string };
export type Samtykke = { vilkaar: Tekst; privatliv: Tekst };

export const JURIDISK_MAPPE = fileURLToPath(new URL('../../../docs/legal', import.meta.url));
/** The public paths on the site (clawco.work) of the two texts a person accepts. */
export const STIER = { vilkaar: '/vilkaar', privatliv: '/privatliv' } as const;

function tekst(v: unknown, navn: string): Tekst {
  if (typeof v !== 'object' || v === null) throw new Error(`samtykke: ${navn} mangler`);
  const o = v as Record<string, unknown>;
  if (typeof o['version'] !== 'string' || !o['version'].trim()) throw new Error(`samtykke: ${navn}.version skal være en tekst`);
  const sti = o['sti'];
  if (typeof sti !== 'string' || !/^\/[a-z0-9-]+$/.test(sti)) throw new Error(`samtykke: ${navn}.sti skal være en sti på kontoværten, fx /vilkaar`);
  return { version: o['version'].trim(), sti };
}

/** Both texts accepted at their CURRENT version. The one rule behind sign-up, the re-accept screen, billing's plan
 *  gate and the gateway, so they never disagree. */
export function samtykkeGyldigt(p: { vilkaar: string | null; privatliv: string | null } | null, s: Samtykke): boolean {
  return !!p && p.vilkaar === s.vilkaar.version && p.privatliv === s.privatliv.version;
}

/** The profile step is done: country, language and the CURRENT consent versions are recorded (KC-0220). */
export function profilErKlar(p: { land: string | null; sprog: string | null; vilkaar: string | null; privatliv: string | null } | null, s: Samtykke): boolean {
  return !!p && !!p.land && !!p.sprog && samtykkeGyldigt(p, s);
}

export function validerSamtykke(raw: unknown): Samtykke {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { vilkaar: tekst(o['vilkaar'], 'vilkaar'), privatliv: tekst(o['privatliv'], 'privatliv') };
}

function versionFra(mappe: string, fil: string): string {
  let tekst: string;
  try { tekst = fs.readFileSync(path.join(mappe, fil), 'utf8'); } catch { throw new Error(`samtykke: ${fil} kan ikke læses i ${mappe}`); }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(tekst);
  const v = m ? /^version:[ \t]*(\S+)[ \t]*$/m.exec(m[1]!)?.[1] : undefined;
  if (!v) throw new Error(`samtykke: ${fil} har ingen version i sin frontmatter`);
  return v;
}

export function laesSamtykke(mappe = JURIDISK_MAPPE): Samtykke {
  return validerSamtykke({
    vilkaar: { version: versionFra(mappe, 'vilkaar.da.md'), sti: STIER.vilkaar },
    privatliv: { version: versionFra(mappe, 'privatlivspolitik.da.md'), sti: STIER.privatliv },
  });
}
