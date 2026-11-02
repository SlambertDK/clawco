// KC-0129: the composition root's adapter between Start's import seam (rooms/start/import/skriver.ts) and the notes
// connector's writers (kilder/noter/personer.ts, profil.ts). It lives beside server.ts because rooms import nothing from
// src/kilder and src/kilder imports no room: only the root may know both. It adds no rule of its own — every path
// check, collision answer and Fortryd hash check is KC-0136's.

import { stat } from 'node:fs/promises';
import { fjernPerson, laesPersoner, skrivPerson } from './kilder/noter/personer.ts';
import { fjernProfil, laesProfil, skrivProfil } from './kilder/noter/profil.ts';
import { PROFIL_SKABELON } from './kilder/noter/vault.ts';
import type { VaultStier } from './kilder/noter/stier.ts';
import { KildeFejl } from './kilder/types.ts';
import type { ImportSkriver } from './rooms/start/import/skriver.ts';

const erMappe = async (p: string): Promise<boolean> => (p ? (await stat(p).catch(() => null))?.isDirectory() ?? false : false);

export function lavImportSkriver(o: { stier: () => VaultStier; lavMappe?: () => Promise<void> }): ImportSkriver {
  const personer = (): string => o.stier().personer;
  const rod = (): string => {
    const r = o.stier().rod;
    if (!r) throw new KildeFejl(409, 'Der er ingen notemappe til profilen.');
    return r;
  };
  return {
    klar: () => erMappe(personer()),
    ...(o.lavMappe ? { lavMappe: o.lavMappe } : {}),
    async personer() {
      return (await laesPersoner(personer(), { zone: 'privat' })).map((p) => ({ navn: p.navn, relation: p.relation, ...(p.org ? { org: p.org } : {}), ...(p.foedselsdag ? { foedselsdag: p.foedselsdag } : {}) }));
    },
    async profil() {
      const r = o.stier().rod;
      if (!r || !(await erMappe(r))) return null;
      const t = await laesProfil(r);
      return t === null || t === PROFIL_SKABELON || !t.trim() ? null : t;
    },
    skrivPerson: (p, mappe) => {
      const { zone, ...felter } = p;
      return skrivPerson(personer(), { ...felter, zone }, { mappe, zone: 'privat' });
    },
    skrivProfil: (tekst) => skrivProfil(rod(), tekst),
    fjernPerson: (k) => fjernPerson(personer(), k),
    fjernProfil: (k) => fjernProfil(rod(), k),
  };
}
