#!/usr/bin/env node
// KC-0159: back up and restore the user's folder. One way to do each (§0 r8):
//   npm run backup  [-- --til MAPPE] [--med-vault] [--med-noegler]
//   npm run restore -- FIL [--erstat]
// Which files count as the user's folder is decided in src/tillid/brugermappe.ts (the export "Hent alt" uses the
// same list); the archive format and the safe restore are in src/store/arkiv.ts. This file only reads flags and
// settings, prints, and sets the exit code: 0 done, 1 refused or failed (nothing changed on a refusal), 2 usage.
// It prints counts and paths, never file bodies and never a value from the settings file.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ArkivFejl, erFjernmonteret, gendan, skrivArkiv, valider } from '../src/store/arkiv.ts';
import { lavVaultStier, vaultRodAf } from '../src/kilder/noter/stier.ts';
import { listSikkerhedskopi } from '../src/tillid/brugermappe.ts';

const BRUG = `Brug:
  npm run backup  [-- --til MAPPE] [--med-vault] [--med-noegler]
  npm run restore -- FIL [--erstat]
Fælles: --data-mappe MAPPE (ellers KC_DATA_DIR), --vault-mappe MAPPE (ellers KC_VAULT_DIR eller den valgte noter-mappe)
Backup: --til MAPPE (ellers KC_BACKUP_DIR, ellers ~/Clawco-backups), --env-fil FIL (indstillingsfilen og nøglefilen KC_HEMMELIGHEDER_FIL tages kun med --med-noegler)
Restore: --erstat flytter en eksisterende mappe til side (den slettes aldrig), --port N (til sundhedstjekket)`;

/** Flags: `--navn værdi`, `--navn=værdi` and bare switches; everything else is positional. */
function laesArgs(args, vaerdier, kontakter) {
  const flag = {};
  const pos = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [navn, v] = a.slice(2).split(/=(.*)/s, 2);
    if (kontakter.includes(navn)) flag[navn] = true;
    else if (vaerdier.includes(navn)) {
      const vaerdi = v ?? args[++i];
      if (vaerdi === undefined || vaerdi.startsWith('--')) throw new ArkivFejl(`--${navn} mangler en værdi`);
      flag[navn] = vaerdi;
    } else throw new ArkivFejl(`ukendt flag --${navn}`);
  }
  return { flag, pos };
}

/** Settings the install keeps in $CLAWCO_HOME/.env: only these names are read, and only when the process has none of them. */
const NAVNE = ['KC_DATA_DIR', 'KC_VAULT_DIR', 'KC_VAULT_INBOX', 'KC_PORT', 'KC_ENV_FILE', 'KC_BACKUP_DIR', 'KC_HEMMELIGHEDER_FIL'];
function indlaesInstallMiljoe(env) {
  if (env.KC_DATA_DIR?.trim()) return;
  const fil = env.KC_ENV_FILE?.trim() || path.join(env.CLAWCO_HOME?.trim() || path.join(os.homedir(), '.clawco'), '.env');
  let tekst;
  try { tekst = readFileSync(fil, 'utf8'); } catch { return; }
  const laest = parseEnv(tekst);
  for (const n of NAVNE) if (!env[n]?.trim() && laest[n]?.trim()) env[n] = laest[n];
}

const mb = (b) => (b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : b >= 1 << 10 ? `${(b / (1 << 10)).toFixed(1)} KB` : `${b} B`);
const indenfor = (rod, p) => p === rod || p.startsWith(rod + path.sep);
const ud = (t = '') => process.stdout.write(t + '\n');

/** The vault root: the flag, else the one answer (env, the vault chosen on the notes card, <data>/vault). */
function findVault(dataDir, flag, env) {
  if (flag['vault-mappe']) return path.resolve(flag['vault-mappe']);
  // KC-0213: the one answer (kilder/noter/stier.ts): env, else the vault chosen on the notes card, else <data>/vault.
  const rod = lavVaultStier({ dataDir, env: { KC_VAULT_DIR: env.KC_VAULT_DIR, KC_VAULT_INBOX: env.KC_VAULT_INBOX } })().rod;
  return rod ? path.resolve(rod) : '';
}

async function backup(args, env) {
  const { flag } = laesArgs(args, ['til', 'data-mappe', 'vault-mappe', 'env-fil'], ['med-vault', 'med-noegler']);
  const dataDir = path.resolve(flag['data-mappe'] || env.KC_DATA_DIR || './data');
  const til = path.resolve(flag.til || env.KC_BACKUP_DIR || path.join(os.homedir(), 'Clawco-backups'));
  const vaultDir = findVault(dataDir, flag, env);
  const envFil = flag['env-fil'] || env.KC_ENV_FILE?.trim() || path.join(path.dirname(dataDir), '.env');
  const medNoegler = flag['med-noegler'] === true;
  const medVault = flag['med-vault'] === true;

  const fjern = vaultDir ? await erFjernmonteret(vaultDir) : false;
  const l = await listSikkerhedskopi({ dataDir, vaultDir }, { medNoegler, medVault, vaultFjern: fjern, envFil, noeglefil: env.KC_HEMMELIGHEDER_FIL?.trim() });
  if (!l.filer.some((f) => f.sti.startsWith('data/'))) throw new ArkivFejl(`der er ingen data at tage kopi af i ${dataDir}`);
  const tilReel = path.resolve(til);
  for (const rod of [dataDir, l.vault.status === 'med' ? vaultDir : '']) {
    if (rod && indenfor(rod, tilReel)) throw new ArkivFejl(`kopimappen ${til} ligger inde i ${rod}; vælg en mappe udenfor (--til), ellers kopierer kopien sig selv`);
  }

  const bytes = l.filer.reduce((s, f) => s + f.bytes, 0);
  ud(`Sikkerhedskopi af ${dataDir}`);
  ud(`  ${l.filer.length} filer, ca. ${mb(bytes)} før pakning.`);
  if (l.vault.status === 'ingen') ud('  Noter-mappe: ingen fundet (kun datamappen tages med).');
  else if (l.vault.status === 'ikke-lokal') ud(`  Noter-mappe ${vaultDir}: ikke med, den ligger allerede et andet sted (på et netværksdrev). Tag den med --med-vault.`);
  else ud(`  Noter-mappe: ${vaultDir} er med.`);
  if (medNoegler) {
    ud('  ADVARSEL: kopien tages MED nøgler og adgangskoder og er derfor selv en hemmelighed. Opbevar den som en adgangskode og del den ikke.');
  } else if (l.udeladt) ud(`  ${l.udeladt} filer med nøgler er ikke med i kopien (brug --med-noegler for at tage dem med).`);
  else ud('  Ingen filer med nøgler fundet; kopien indeholder ingen.');
  ud(`Skriver kopien til ${til} …`);

  const tid = new Date();
  const r = await skrivArkiv(til, l.filer.map((f) => ({ sti: f.sti, abs: f.abs })), {
    tid,
    manifest: { medNoegler, medVault: l.vault.status === 'med', vaultSti: l.vault.status === 'med' ? (l.vault.sti ?? null) : null },
  });
  ud(`Færdig: ${r.sti} (${mb(r.bytes)}, ${r.filer} filer).`);
  if (r.forsvundet) ud(`  ${r.forsvundet} filer var væk, da kopien nåede dem, og er ikke med.`);
  ud('Den er kun læsbar for dig. Gamle kopier ryddes ikke automatisk; slet dem selv, når du ikke bruger dem mere.');
}

async function sundhed(port) {
  try {
    const svar = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const j = await svar.json();
    return typeof j?.sha === 'string' ? j.sha : 'ukendt';
  } catch { return null; }
}

async function restore(args, env) {
  const { flag, pos } = laesArgs(args, ['data-mappe', 'vault-mappe', 'port'], ['erstat']);
  if (pos.length !== 1) { process.stderr.write(`restore skal have én fil.\n${BRUG}\n`); process.exitCode = 2; return; }
  const fil = path.resolve(pos[0]);
  const data = path.resolve(flag['data-mappe'] || env.KC_DATA_DIR || './data');
  const eksplicitVault = flag['vault-mappe'] || vaultRodAf({ KC_VAULT_DIR: env.KC_VAULT_DIR, KC_VAULT_INBOX: env.KC_VAULT_INBOX }, '');
  const maal = { data, vault: eksplicitVault ? path.resolve(eksplicitVault) : `${data}-vault`, miljoe: `${data}-miljoe` };

  const o = await valider(fil);
  ud(`Sikkerhedskopien har ${o.filer} filer, ca. ${mb(o.bytes)}${o.manifest?.oprettet ? `, taget ${o.manifest.oprettet.slice(0, 16).replace('T', ' ')}` : ''}.`);
  const r = await gendan(fil, maal, { erstat: flag.erstat === true });
  ud(`Gendannet: ${r.rum} rum og ${r.noter} noter (${r.filer} filer) i ${r.steder.data}.`);
  if (r.steder.vault) ud(`  Noter-mappen er gendannet i ${r.steder.vault}. Peg Clawco på den, hvis den skal et andet sted hen.`);
  if (r.steder.miljoe) ud(`  Indstillingsfilen med nøgler er lagt i ${r.steder.miljoe}; flyt den selv på plads. Den er en hemmelighed.`);
  for (const [rod, til] of Object.entries(r.flyttet)) ud(`  Den gamle ${rod}-mappe er flyttet til ${til} (den er ikke slettet).`);
  const port = flag.port || env.KC_PORT?.trim() || '8750';
  const sha = await sundhed(port);
  if (sha) ud(`Clawco kører på port ${port} (sha ${sha}). Genstart den, så den læser den gendannede mappe.`);
  else ud(`Ingen Clawco svarer på port ${port}: start den, så bruger den den gendannede mappe.`);
}

const [kommando, ...rest] = process.argv.slice(2);
const env = { ...process.env };
try {
  indlaesInstallMiljoe(env);
  if (kommando === 'backup') await backup(rest, env);
  else if (kommando === 'restore') await restore(rest, env);
  else { process.stderr.write(`${BRUG}\n`); process.exitCode = 2; }
} catch (e) {
  process.stderr.write(`${e instanceof ArkivFejl ? e.message : `uventet fejl: ${e?.message ?? e}`}\n`);
  process.exitCode = e instanceof ArkivFejl && /^--|^ukendt flag/.test(e.message) ? 2 : 1;
}
