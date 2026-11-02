// "Omkostninger" in the Kø panel (KC-0212, spec D18): the owner's cost card. What Clawco Sky costs per
// month now, each paid line that is on (covered or not) and each paid line whose revenue trigger is
// near or reached; the free services in one line. Lines far from their trigger are not on screen
// (KC-0052). Pure: the ledger's cover in, one bunke block out; every text escaped (AGENTS §4 r9).

import { html, type Markup } from './html.ts';
import { tilstandChip, type Tilstand } from './sprog.ts';
import { tekst } from './tekster.ts';
import type { Daekning, LinjeTilstand, Samlet } from '../omkostninger/regnskab.ts';

/** The card's three colours (the testtilstand coverage derives from this list). */
export const OMKOSTNING_SAMLET: readonly Samlet[] = ['groen', 'gul', 'roed'];

/** One colour per meaning (KC-0064): covered is ordnet, near is kraever, paid without cover is graense; the word is the language's (tekst().omk.chip). */
const CHIP: Partial<Record<LinjeTilstand, [Tilstand, 'daekket' | 'udaekket' | 'naer' | 'klar']>> = {
  daekket: ['ordnet', 'daekket'],
  udaekket: ['graense', 'udaekket'],
  naer: ['kraever', 'naer'],
  klar: ['ordnet', 'klar'],
};

/** Øre as kroner in the language's number format: "56 kr", "1,40 kr", "1.290 kr" (English "1,290 kr"). */
export function kr(oere: number): string {
  const brok = oere % 100 !== 0;
  return `${new Intl.NumberFormat(tekst().lokale, { minimumFractionDigits: brok ? 2 : 0, maximumFractionDigits: 2 }).format(oere / 100)} kr`;
}

function hoved(samlet: Samlet, hoejre: Markup | string): Markup {
  const T = tekst().omk;
  return html`<div class="card card-list omkostninger" data-blok="bunke" data-gruppe="${T.titel}" data-omkostninger-samlet="${samlet}"><div class="card-head"><h3 class="eyebrow">${T.titel}</h3><span class="muted mono">${hoejre}</span></div>`;
}

export function renderOmkostninger(d: Daekning | 'fejl'): Markup {
  const T = tekst().omk;
  if (d === 'fejl') {
    return html`${hoved('roed', '')}<div class="row omkostning-row" data-omkostning-tilstand="fejl"><span class="row-main"><span class="row-title">${T.fejlTitel}</span><span class="row-note">${T.fejlNote}</span></span>${tilstandChip('graense', T.fejlChip)}</div></div>`;
  }
  const vist = d.linjer.filter((l) => CHIP[l.tilstand]);
  const gratis = d.linjer.filter((l) => l.tilstand === 'gratis');
  const note = (l: (typeof vist)[number]): string => {
    const kraever = l.kraevetMrr === null ? '' : T.kraever(kr(l.kraevetMrr));
    return [`${kr(l.maanedlig)}${T.md}`, l.aktiv ? (l.tilstand === 'udaekket' ? T.tandtUdenDaekning(kraever) : kraever) : T.slukket(kraever)].filter(Boolean).join(' · ');
  };
  return html`${hoved(d.samlet, `${kr(d.nu)}${T.md}`)}${vist.map((l) => {
    const [farve, ord] = CHIP[l.tilstand]!;
    return html`<div class="row omkostning-row" data-omkostning="${l.id}" data-omkostning-tilstand="${l.tilstand}"><span class="row-main"><span class="row-title">${l.navn}</span><span class="row-note">${note(l)}</span></span>${tilstandChip(farve, T.chip[ord])}</div>`;
  })}${gratis.length ? html`<div class="row omkostning-row" data-omkostning-tilstand="gratis"><span class="row-main"><span class="row-title">${gratis.length === 1 ? T.gratisEn : T.gratisN(gratis.length)}</span><span class="row-note">${gratis.map((l) => l.navn).join(' · ')}</span></span>${tilstandChip('ordnet', '0 kr')}</div>` : ''}</div>`;
}
