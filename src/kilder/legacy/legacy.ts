// Henrik's existing sources as connectors of the new kind (KC-0132), so his
// install runs on unchanged: kira-kalender (the calendar script Dagen reads —
// KC_KALENDER_SCRIPT or the bundled scripts/kalender_uge.py, derived once in
// main(), KC-0120), kira-morgenavis (the morning paper JSON at
// KC_DAGEN_SOURCE_GLOB), kira-mail (himalaya via KC_HIMALAYA) and kira-noter
// (the NAS vault: KC_VAULT_DIR or the parent of KC_VAULT_INBOX, KC-0136). Each is
// registered only when its source is set, and counts as connected by the
// host (standard). Read-only: no declared verbs. The room functions they need
// are injected by the composition root (src/kilder imports nothing from
// src/rooms); test/kilder/legacy.test.ts proves the rooms' input is unchanged.

import { access } from 'node:fs/promises';
import path from 'node:path';
import { kiraNoter } from '../noter/noter.ts';
import { vaultRodAf } from '../noter/stier.ts';
import { STRUKTUR } from '../noter/vault.ts';
import { KildeFejl, type Kilde, type KildeKort, type Kuvert, type Nyhed, type NyhedsStatus } from '../types.ts';

export type Runner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
export type LaesNyheder = (pattern: string, now: Date) => Promise<{ nyheder: Nyhed[]; kilder: NyhedsStatus } | null>;
export type ParseMail = (json: unknown) => Kuvert[];

/** The Mail room's cap on the Handling list (MAX_HANDLING in src/rooms/mail/source.ts). */
const MAX_HANDLING = 20;

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const kort = (titel: string, tekst: string): KildeKort => ({ titel, tekst, felter: [], handling: 'Forbind' });

export function kiraKalender(o: { script: string; run: Runner }): Kilde {
  const navn = 'Kalender gennem Hermes';
  return {
    id: 'kira-kalender', navn, slags: 'kalender', zone: 'privat', auth: 'local', tillid: 'uklar', standard: 'forbundet',
    async read(ctx) {
      let raw: unknown;
      try {
        const r = await o.run('python3', [o.script]);
        if (r.code !== 0 || !r.stdout.trim()) throw new Error('script');
        raw = JSON.parse(r.stdout);
      } catch { throw new KildeFejl(502, 'Kalenderen kunne ikke hentes.'); }
      const root = erObj(raw) ? raw : {};
      return {
        slags: 'kalender', hentet: ctx.nu.toISOString(), uklar: true,
        data: {
          generated: typeof root['generated'] === 'string' ? root['generated'] : '',
          days: (Array.isArray(root['days']) ? root['days'] : []).filter(erObj).map((d) => ({
            date: typeof d['date'] === 'string' ? d['date'] : '',
            events: (Array.isArray(d['events']) ? d['events'] : []).filter(erObj),
          })),
          errors: (Array.isArray(root['errors']) ? root['errors'] : []).filter((x): x is string => typeof x === 'string'),
        },
      };
    },
    kort: async () => kort(navn, 'Ugens aftaler fra den kalender, Hermes allerede læser.'),
    helbred: async () => {
      try { await access(o.script); return { status: 'ok' }; } catch { return { status: 'nede', tekst: 'Kalender-scriptet findes ikke.' }; }
    },
  };
}

export function kiraMorgenavis(o: { glob: string; laes: LaesNyheder }): Kilde {
  const navn = 'Morgenavisen';
  return {
    id: 'kira-morgenavis', navn, slags: 'nyheder', zone: 'privat', auth: 'local', tillid: 'uklar', standard: 'forbundet',
    async read(ctx) {
      let t;
      try { t = await o.laes(o.glob, ctx.nu); } catch { throw new KildeFejl(502, 'Morgenavisen kunne ikke læses.'); }
      if (!t) throw new KildeFejl(502, 'Morgenavisen er ikke hentet endnu i dag.');
      return { slags: 'nyheder', hentet: ctx.nu.toISOString(), uklar: true, data: { nyheder: t.nyheder, status: t.kilder } };
    },
    kort: async () => kort(navn, 'Nyhederne fra morgenavisen, som Hermes henter hver morgen.'),
    helbred: async () => ({ status: 'ok' }),
  };
}

export function kiraMail(o: { himalaya: string; run: Runner; parse: ParseMail }): Kilde {
  const navn = 'Mail gennem Hermes';
  return {
    id: 'kira-mail', navn, slags: 'mail', zone: 'privat', auth: 'bridge', tillid: 'uklar', standard: 'forbundet',
    async read(ctx) {
      let data: Kuvert[];
      try {
        const r = await o.run(o.himalaya, ['envelope', 'list', '-m', 'Folders/Handling', '-s', '120', '-p', '1', '--json']);
        if (r.code !== 0) throw new Error('himalaya');
        data = o.parse(JSON.parse(r.stdout)).slice(0, MAX_HANDLING);
      } catch { throw new KildeFejl(502, 'Mailen kunne ikke hentes.'); }
      return { slags: 'mail', hentet: ctx.nu.toISOString(), uklar: true, data };
    },
    kort: async () => kort(navn, 'Brevene i Handling-mappen, læst uden indhold.'),
    helbred: async () => ({ status: 'ok' }),
  };
}

/**
 * The legacy adapters whose source is set, in this order: the calendar script Dagen reads (`kalenderScript`, the
 * value main() hands Dagen too — empty = no calendar), KC_DAGEN_SOURCE_GLOB, KC_HIMALAYA, the vault (KC_VAULT_DIR or
 * KC_VAULT_INBOX; KC_PEOPLE_DIR overrides its people register).
 */
export function legacyKilder(env: Record<string, string | undefined>, deps: { run: Runner; laesNyheder: LaesNyheder; parseMail: ParseMail; kalenderScript: string }): Kilde[] {
  const v = (n: string): string => (env[n] ?? '').trim();
  const ud: Kilde[] = [];
  if (deps.kalenderScript.trim()) ud.push(kiraKalender({ script: deps.kalenderScript.trim(), run: deps.run }));
  if (v('KC_DAGEN_SOURCE_GLOB')) ud.push(kiraMorgenavis({ glob: v('KC_DAGEN_SOURCE_GLOB'), laes: deps.laesNyheder }));
  if (v('KC_HIMALAYA')) ud.push(kiraMail({ himalaya: v('KC_HIMALAYA'), run: deps.run, parse: deps.parseMail }));
  const rod = vaultRodAf({ KC_VAULT_DIR: v('KC_VAULT_DIR'), KC_VAULT_INBOX: v('KC_VAULT_INBOX') }, '');
  if (rod) ud.push(kiraNoter({ rod, personer: v('KC_PEOPLE_DIR') || path.join(rod, ...STRUKTUR.personer.split('/')) }));
  return ud;
}
