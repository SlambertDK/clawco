import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Regnskabslinje } from '../rooms/hjem/kort.ts';
import { PRODUKT } from '../shell/navn.ts';

type Hvor = Regnskabslinje['hvor'];

/** Markers in a Hjem log entry's `fortryd` for ledger rows: the app undoes them itself (no Hermes run). */
export const FORTRYD_FJERN = 'fjern-raekke';
export const FORTRYD_FLYT = 'flyt-tilbage';

const TITEL: Record<Hvor, string> = { shelfatlas: 'ShelfAtlas', privat: 'Abonnementer (privat)' };
const HEADER = '| Dato | Leverandør | Beløb | Valuta | Periode | Art | Mail (emne) |\n| --- | --- | --- | --- | --- | --- | --- |\n';

export function regnskabsfil(vaultRod: string, hvor: Hvor): string {
  return hvor === 'shelfatlas'
    ? join(vaultRod, '30-Projekter', 'ShelfAtlas', 'Regnskab.md')
    : join(vaultRod, '10-Privat', 'Økonomi', 'abonnementer.md');
}

const markoer = (id: string): string => `<!-- kc:${id} -->`;

/** Values come from mail text via Hermes: keep each one inside a single cell and unable to forge a marker. */
function celle(v: string | undefined): string {
  return (v ?? '').replace(/[|<>\r\n\t]/g, ' ').trim();
}

export function regnskabsRaekke(id: string, l: Regnskabslinje): string {
  const art = l.art === 'koeb' ? 'køb' : 'abonnement';
  const celler = [l.dato, l.leverandoer, l.beloeb, l.valuta, l.periode, art, l.emne].map(celle);
  return `| ${celler.join(' | ')} | ${markoer(id)}`;
}

// Read-modify-write per file must not interleave: serialise through a chain per path.
const koer = new Map<string, Promise<unknown>>();
function serielt<T>(fil: string, fn: () => Promise<T>): Promise<T> {
  const forrige = koer.get(fil) ?? Promise.resolve();
  const naeste = forrige.then(fn, fn);
  const hale = naeste.catch(() => undefined);
  koer.set(fil, hale);
  void hale.then(() => {
    if (koer.get(fil) === hale) koer.delete(fil);
  });
  return naeste;
}

async function laes(fil: string): Promise<string | null> {
  try {
    return await readFile(fil, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function skriv(fil: string, indhold: string): Promise<void> {
  await mkdir(dirname(fil), { recursive: true });
  const tmp = `${fil}.tmp-${process.pid}`;
  await writeFile(tmp, indhold, 'utf8');
  await rename(tmp, fil);
}

// trimEnd: an editor (Obsidian, a Windows checkout) may leave trailing spaces or a \r after the marker.
const erRaekke = (r: string, id: string): boolean => r.trimEnd().endsWith(markoer(id));
const harMarkoer = (tekst: string, id: string): boolean => tekst.split('\n').some((r) => erRaekke(r, id));

/** Whether the ledger file holds the row of this card id (read inside the file's chain, so it sees every queued write). */
export function harRegnskab(fil: string, id: string): Promise<boolean> {
  return serielt(fil, async () => {
    const nu = await laes(fil);
    return nu !== null && harMarkoer(nu, id);
  });
}

/** Appends the row unless a row with this card id already exists ('findes'). */
export function skrivRegnskab(fil: string, id: string, l: Regnskabslinje): Promise<'skrevet' | 'findes'> {
  return serielt(fil, async () => {
    const nu = await laes(fil);
    if (nu !== null && harMarkoer(nu, id)) return 'findes';
    const raekke = regnskabsRaekke(id, l);
    const indhold =
      nu === null
        ? `# Regnskab — ${TITEL[l.hvor]}\n\nSkrevet af Kuratoren i ${PRODUKT}. Hver linje kan fortrydes i Nu.\n\n${HEADER}${raekke}\n`
        : `${nu}${nu.endsWith('\n') || nu === '' ? '' : '\n'}${raekke}\n`;
    await skriv(fil, indhold);
    return 'skrevet';
  });
}

/** Removes exactly the row carrying this card id's marker; false when there is none. */
export function fjernRegnskab(fil: string, id: string): Promise<boolean> {
  return serielt(fil, async () => {
    const nu = await laes(fil);
    if (nu === null || !harMarkoer(nu, id)) return false;
    const rest = nu.split('\n').filter((r) => !erRaekke(r, id));
    await skriv(fil, rest.join('\n'));
    return true;
  });
}
