// The rules file on disk (KC-0142): <vault>/Clawco/regler.md. Read fresh on
// every run (Hermes reads the rules each time it thinks); a missing file means
// no rules yet, a file that does not parse fails closed (the caller tells the
// agent trin 0 and Nu shows one card). Every write the app makes is atomic
// (§4 r5) and leaves the file's sha256 in <dataDir>/tillid/regler.sha, so a
// change made outside Clawco is noticed. KC-0270 (B3): such a file grants
// nothing and stays out of the prompt (trin.ts, prompt.ts) until the owner
// approves exactly that content with a tap on /viden (godkend).

import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { skrivAtomisk } from '../store/atomisk.ts';
import { parseRegler, ReglerFejl, serialiserRegler, type Regelsaet } from './regler.ts';
import { ULAESELIG } from './tekster.ts';

export type ReglerLaest =
  | { tilstand: 'mangler' }
  | { tilstand: 'ok'; saet: Regelsaet; aendretUdenfor: boolean; /** KC-0270: sha256 of the file as read (what an approval names). */ sha?: string }
  | { tilstand: 'ulaeselig'; hvorfor: string; aendretUdenfor: boolean };

export type ReglerLager = {
  /** The rules file's path. */
  readonly fil: string;
  /** Never throws: anything but a missing file that cannot be parsed is 'ulaeselig'. */
  laes(): Promise<ReglerLaest>;
  skriv(s: Regelsaet): Promise<void>;
  /** Writes `md` as it is (the test world's seed, a migration); same atomic write and sha as skriv. */
  skrivTekst(md: string): Promise<void>;
  /** KC-0270 (B3): the owner approves the file as it is now — only when `sha` is still its hash. True when recorded. */
  godkend(sha: string): Promise<boolean>;
};

const sha256 = (tekst: string): string => createHash('sha256').update(tekst).digest('hex');
const kode = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

export function lavReglerLager(o: { vaultDir: string; dataDir: string }): ReglerLager {
  const fil = path.join(o.vaultDir, 'Clawco', 'regler.md');
  const shaFil = path.join(o.dataDir, 'tillid', 'regler.sha');

  async function aendret(tekst: string): Promise<boolean> {
    try { return (await readFile(shaFil, 'utf8')).trim() !== sha256(tekst); } catch { return false; }
  }

  async function skrivTekst(md: string): Promise<void> {
    await mkdir(path.dirname(fil), { recursive: true });
    await skrivAtomisk(fil, md);
    await mkdir(path.dirname(shaFil), { recursive: true });
    await skrivAtomisk(shaFil, `${sha256(md)}\n`);
  }

  return {
    fil,
    async laes() {
      let tekst: string;
      try { tekst = await readFile(fil, 'utf8'); } catch (err) {
        if (kode(err) === 'ENOENT') return { tilstand: 'mangler' };
        return { tilstand: 'ulaeselig', hvorfor: ULAESELIG.aabne, aendretUdenfor: false };
      }
      const aendretUdenfor = await aendret(tekst);
      try { return { tilstand: 'ok', saet: parseRegler(tekst), aendretUdenfor, sha: sha256(tekst) }; } catch (err) {
        if (err instanceof ReglerFejl) return { tilstand: 'ulaeselig', hvorfor: err.message, aendretUdenfor };
        return { tilstand: 'ulaeselig', hvorfor: ULAESELIG.laese, aendretUdenfor };
      }
    },
    skriv: (s) => skrivTekst(serialiserRegler(s)),
    skrivTekst,
    async godkend(sha) {
      let tekst: string;
      try { tekst = await readFile(fil, 'utf8'); } catch { return false; }
      if (sha256(tekst) !== sha) return false; // changed again since it was shown: that content was not approved
      await mkdir(path.dirname(shaFil), { recursive: true });
      await skrivAtomisk(shaFil, `${sha}\n`);
      return true;
    },
  };
}
