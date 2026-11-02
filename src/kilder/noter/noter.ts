// KC-0136: the notes connector (spec §3 step 4, D7). On the card "Noter" the
// user picks "Lav en ny mappe til mig" or "Jeg har allerede en Obsidian-vault"
// (with the vaults found on the machine offered); connecting runs the setup
// (vault.ts) and stores the folder in kilder.json, from which the inbox and the
// people register are derived (stier.ts). read() lists the zone's people (name,
// relation, folder) and the newest note titles — never a body; always untrusted.
// `kira-noter` is the same reader over Henrik's NAS vault from the env
// (registered by legacyKilder, connected by the host). No act(): KC-0129 writes
// people and the profile through personer.ts / profil.ts, not through a route.

import { access, constants, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { KildeFejl, type Felt, type Helbred, type Kilde, type KildeKontekst, type KildeKort, type NoterData } from '../types.ts';
import { laesPersoner } from './personer.ts';
import { noterTekst } from './tekster.ts';
import { NOTER_ID } from './stier.ts';
import { adopterVault, findVaults, kandidatRoedder, lavNyVault, NY_VAULT, STRUKTUR } from './vault.ts';

const MAKS_PERSONER = 500;
const MAKS_NOTER = 50;
const MAKS_POSTER = 20_000;
const MAKS_DYBDE = 8;
const FUND_LEVETID_MS = 60_000;

export type KortTilstand = 'ikke-valgt' | 'ny' | 'eksisterende' | 'mangler';

/** Which of the card's four states `ctx` is in; `findes` = the chosen folder exists. */
export function noterKortTilstand(ctx: KildeKontekst, findes: boolean): KortTilstand {
  if (!ctx.valg['mappe']) return 'ikke-valgt';
  if (!findes) return 'mangler';
  return ctx.valg['opsaetning'] === 'ny' ? 'ny' : 'eksisterende';
}

const erMappe = async (p: string): Promise<boolean> => (await stat(p).catch(() => null))?.isDirectory() ?? false;
/** A path in card text: the card is text, never HTML (the conformance suite holds it to no < or >). */
const vis = (p: string): string => p.replace(/[<>]/g, '');
/** "a", "a og b", "a, b og c". */
const opremsning = (l: string[]): string => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} ${noterTekst().og} ${l.at(-1)}`);
const posix = (p: string): string => p.split(path.sep).join('/');

async function helbredFor(rod: string): Promise<Helbred> {
  if (!rod || !(await erMappe(rod))) return { status: 'nede', tekst: noterTekst().mappenFindesIkke };
  try { await access(rod, constants.W_OK); } catch { return { status: 'nede', tekst: noterTekst().kanIkkeSkrive }; }
  return { status: 'ok' };
}

/** The newest notes under `rod` by mtime: titles and paths only. Hidden folders, symlinks, Clawco/ and the register are skipped. */
async function noteliste(rod: string, personer: string): Promise<NoterData['noter']> {
  const ud: { titel: string; sti: string; ms: number }[] = [];
  const udelad = new Set([path.resolve(rod, STRUKTUR.clawco), path.resolve(personer)]);
  const koe: [string, number][] = [[rod, 0]];
  let set = 0;
  while (koe.length && set < MAKS_POSTER) {
    const [dir, dybde] = koe.shift() as [string, number];
    let poster: Dirent[];
    try { poster = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const p of poster) {
      set += 1;
      if (p.name.startsWith('.')) continue;
      const fuld = path.join(dir, p.name);
      // isDirectory()/isFile() are false for a symlink: a link is never followed out of the vault.
      if (p.isDirectory()) { if (dybde < MAKS_DYBDE && !udelad.has(path.resolve(fuld))) koe.push([fuld, dybde + 1]); continue; }
      if (!p.isFile() || !p.name.endsWith('.md')) continue;
      const s = await stat(fuld).catch(() => null);
      if (s) ud.push({ titel: p.name.slice(0, -3).slice(0, 200), sti: posix(path.relative(rod, fuld)), ms: s.mtimeMs });
    }
  }
  return ud.sort((a, b) => b.ms - a.ms).slice(0, MAKS_NOTER).map((n) => ({ titel: n.titel, sti: n.sti, aendret: new Date(n.ms).toISOString() }));
}

async function laesVault(rod: string, personer: string, ctx: KildeKontekst): Promise<NoterData> {
  if (!rod || !(await erMappe(rod))) throw new KildeFejl(502, noterTekst().mappenFindesIkke);
  const folk = (await laesPersoner(personer, { zone: ctx.zone })).filter((p) => p.zone === ctx.zone).slice(0, MAKS_PERSONER);
  return {
    personer: folk.map((p) => {
      const rel = path.relative(rod, path.join(personer, p.mappe));
      return { navn: p.navn, relation: p.relation, mappe: rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? posix(rel) : p.mappe };
    }),
    noter: await noteliste(rod, personer),
  };
}

type Opsaet = { rod(ctx: KildeKontekst): string; personer(ctx: KildeKontekst): string };

function laeser(o: Opsaet): Pick<Kilde, 'read' | 'helbred'> {
  return {
    async read(ctx) {
      return { slags: 'noter', hentet: ctx.nu.toISOString(), uklar: true, data: await laesVault(o.rod(ctx), o.personer(ctx), ctx) };
    },
    helbred: async (ctx) => helbredFor(o.rod(ctx)),
  };
}

/**
 * The notes connector. `hjem` = the user's home (the default new vault is <hjem>/Clawco/Vault, detection looks under
 * the fixed roots there); `platform` picks the candidate roots. Options in kilder.json: `opsaetning` (ny |
 * eksisterende) and `mappe` (the absolute vault root, written by the setup).
 */
export function noterKilde(o: { hjem?: string; platform?: NodeJS.Platform | string } = {}): Kilde {
  const hjem = o.hjem ?? homedir();
  const platform = o.platform ?? process.platform;
  const standard = path.join(hjem, NY_VAULT);
  let fund: { tid: number; vaults: Promise<string[]> } | undefined;
  const fundne = (): Promise<string[]> => {
    if (!fund || Date.now() - fund.tid > FUND_LEVETID_MS) fund = { tid: Date.now(), vaults: findVaults(kandidatRoedder(hjem, platform)).catch(() => []) };
    return fund.vaults;
  };
  const rod = (ctx: KildeKontekst): string => ctx.valg['mappe'] || standard;
  const udvid = (p: string): string => (p === '~' ? hjem : p.startsWith('~/') ? path.join(hjem, p.slice(2)) : p);

  async function felter(): Promise<Felt[]> {
    const t = noterTekst().felt;
    return [
      { navn: 'opsaetning', etiket: t.opsaetning, type: 'tekst', paakraevet: true, muligheder: [{ vaerdi: 'ny', etiket: t.ny }, { vaerdi: 'eksisterende', etiket: t.eksisterende }] },
      { navn: 'mappe', etiket: t.mappe, type: 'mappe', paakraevet: false, forslag: await fundne() },
    ];
  }

  return {
    id: NOTER_ID, get navn() { return noterTekst().navn; }, slags: 'noter', zone: 'privat', auth: 'local', tillid: 'uklar',
    ...laeser({ rod, personer: (ctx) => path.join(rod(ctx), ...STRUKTUR.personer.split('/')) }),

    async kort(ctx): Promise<KildeKort> {
      const valgt = ctx.valg['mappe'] ?? '';
      const t = noterKortTilstand(ctx, valgt ? await erMappe(valgt) : false);
      const f = await felter();
      const m = noterTekst();
      if (t === 'ikke-valgt') {
        const n = f[1]?.forslag?.length ?? 0;
        return { titel: m.navn, handling: m.handling.vaelgMappe, felter: f, tekst: m.ikkeValgtTekst + (n ? m.fundet(n) : '') };
      }
      if (t === 'mangler') return { titel: m.navn, handling: m.handling.vaelgIgen, felter: f, tekst: m.manglerTekst(vis(valgt)) };
      if (t === 'ny') return { titel: m.navn, handling: m.handling.skiftMappe, felter: f, tekst: m.nyTekst(vis(valgt)) };
      return { titel: m.navn, handling: m.handling.skiftMappe, felter: f, tekst: m.eksisterendeTekst(vis(valgt)) };
    },

    async opsaet(ctx) {
      const opsaetning = ctx.valg['opsaetning'] === 'ny' ? 'ny' : 'eksisterende';
      const skrevet = udvid((ctx.valg['mappe'] ?? '').trim());
      if (!skrevet && opsaetning === 'eksisterende') throw new KildeFejl(400, noterTekst().vaelgVault);
      const mappe = skrevet || standard;
      if (!path.isAbsolute(mappe)) throw new KildeFejl(400, noterTekst().skrivHeleStien);
      const r = path.resolve(mappe);
      const lagt = opsaetning === 'ny' ? await lavNyVault(r) : await adopterVault(r);
      const m = noterTekst();
      const tekst = !lagt.length ? m.brugerMappe(r)
        : opsaetning === 'ny' ? m.lavede(r, opremsning(lagt)) : m.tilfoejede(opremsning(lagt), r);
      return { tekst, valg: { opsaetning, mappe: r } };
    },
  };
}

/** Henrik's NAS vault from the env (KC_VAULT_DIR / KC_VAULT_INBOX, KC_PEOPLE_DIR): read-only, connected by the host. */
export function kiraNoter(o: { rod: string; personer: string }): Kilde {
  return {
    id: 'kira-noter', get navn() { return noterTekst().kiraNavn; }, slags: 'noter', zone: 'privat', auth: 'local', tillid: 'uklar', standard: 'forbundet',
    ...laeser({ rod: () => o.rod, personer: () => o.personer }),
    kort: async () => ({ titel: noterTekst().kiraNavn, tekst: noterTekst().kiraTekst, felter: [], handling: noterTekst().handling.forbind }),
  };
}
