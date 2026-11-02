// KC-0145 in the test world: the Sunday sample. "Søndag aften" — the week's 212 hidden items as the app records them
// (Kuratoren's intet lines, a share of them under R-0001 "Nyhedsbreve sorteres i mapper", and Mail's Ordnet), five drawn
// by the app's own function, one already answered "Skulle have vist mig det" (its rule's pause proposal waits in Nu).
// "Søndag: stop tjekket?" — the third clean week in a row has just been answered: the stop question. All invented.

import type { Skjult } from '../../tillid/skjulte.ts';
import { besvar, traekStikproeve, type Stikbog, type Stikuge } from '../../tillid/stikproeve.ts';
import { parseRegler } from '../../tillid/regler.ts';
import { pauseForslag, type Regelforslag } from '../../tillid/forslag.ts';
import { skjultKort } from '../../kurator/stikproeve.ts';
import { isoDato, kortDato, plusDag } from './fakta.ts';

export const SOENDAG = 'soendag';
export const SOENDAG_STOP = 'soendag-stop';
export const ANTAL_SKJULTE = 212;

const AFSENDERE = ['Havvindsforum', 'Løbeklubben Nordvest', 'Byens Boghandel', 'Cykelværkstedet', 'Grundejerforeningen', 'Biblioteket', 'Svømmeklubben', 'Haveselskabet', 'Kulturhuset', 'Købmanden på hjørnet', 'Vinklubben', 'Fotoforeningen'];
const NYHEDSBREV = ['ugebrev', 'nyhedsbrev', 'månedsbrev', 'program for november'];
const ANDET = ['tilbud på vinterdæk', 'kvittering for kontingent', 'påmindelse om generalforsamling', 'ny app-version', 'spørgeskema om tilfredshed'];
const MAPPER = ['Nyhedsbreve', 'Kvitteringer', 'Tilbud'];

const id = (prefiks: string, n: number): string => `${prefiks}:${String(n).padStart(16, '0')}`;

/** The week's hidden items, Monday 07:00 to Sunday 17:00 (the draw is at 18:00). Deterministic for the week. */
export function skjulteFroe(mandag: string): Skjult[] {
  const ud: Skjult[] = [];
  for (let n = 0; n < ANTAL_SKJULTE; n++) {
    const dag = plusDag(mandag, n % 7);
    const [hh, mm] = [String(7 + (n % 11)).padStart(2, '0'), String((n * 7) % 60).padStart(2, '0')];
    const tid = isoDato(dag, `${hh}:${mm}`);
    const afsender = AFSENDERE[n % AFSENDERE.length] ?? 'Foreningen';
    // The day and time it arrived keep the titles apart.
    const hvornaar = `${kortDato(dag)} kl. ${hh}.${mm}`;
    if (n % 3 === 0) ud.push({ id: id('intet', n), tid, titel: `${afsender}: ${NYHEDSBREV[n % NYHEDSBREV.length]}, ${hvornaar}`, kilde: 'kuratoren', regelId: 'R-0001' });
    else if (n % 3 === 1) ud.push({ id: id('intet', n), tid, titel: `${afsender}: ${ANDET[n % ANDET.length]}, ${hvornaar}`, kilde: 'kuratoren' });
    else ud.push({ id: `mail:${1000 + n}:${tid}`, tid, titel: `${afsender}: ${ANDET[(n + 2) % ANDET.length]}, ${hvornaar} (lagt i ${MAPPER[n % MAPPER.length]})`, kilde: 'mail' });
  }
  return ud;
}

/** The week drawn as the Sunday job draws it. */
const uge = (mandag: string, skjulte: Skjult[]): Stikuge => ({ uge: mandag, skjulte: skjulte.length, traek: traekStikproeve(skjulte, mandag), forkerte: 0 });

/** The first drawn line a rule hid: the one answered "Skulle have vist mig det" at "Søndag aften". */
export const forkertPost = (mandag: string): Skjult | undefined => uge(mandag, skjulteFroe(mandag)).traek.find((t) => t.regelId);

/** The ledger at the moment (`mandag` = this week's Monday, `nu` = the moment's instant); undefined for other moments. */
export function stikbogFroe(momentId: string, mandag: string, nu: Date): Stikbog | undefined {
  if (momentId === SOENDAG) {
    const u = uge(mandag, skjulteFroe(mandag));
    const p = forkertPost(mandag);
    return p ? besvar({ uger: [u] }, mandag, p.id, 'forkert', new Date(nu.getTime() - 5 * 60_000)).bog : { uger: [u] };
  }
  if (momentId === SOENDAG_STOP) {
    // Three clean weeks: the two before (answered on their Sundays) and this one, answered a minute ago.
    let bog: Stikbog = { uger: [] };
    for (const [k, m] of [[2, plusDag(mandag, -14)], [1, plusDag(mandag, -7)], [0, mandag]] as const) {
      const u = uge(m, skjulteFroe(m));
      bog = { ...bog, uger: [...bog.uger, u] };
      const svaret = new Date(nu.getTime() - k * 7 * 86_400_000 - 60_000);
      for (const t of u.traek) bog = besvar(bog, m, t.id, 'rigtigt', svaret).bog;
    }
    return { ...bog, stop: { uge: mandag, tid: new Date(nu.getTime() - 60_000).toISOString() } };
  }
  return undefined;
}

/** "Søndag aften": the pending proposal to pause R-0001, from the line answered wrong. */
export function soendagForslag(momentId: string, mandag: string, nu: Date, reglerTekst: string | undefined): Regelforslag[] {
  if (momentId !== SOENDAG || !reglerTekst) return [];
  const p = forkertPost(mandag);
  const regel = parseRegler(reglerTekst).regler.find((r) => r.id === p?.regelId);
  return p && regel ? [pauseForslag(regel, { kort: skjultKort(p), nu: new Date(nu.getTime() - 4 * 60_000) })] : [];
}
