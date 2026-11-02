// "Omkostninger" in the Kø panel (KC-0212, spec D18): the owner's cost card. What Clawco Sky costs per
// month now, each paid line that is on (covered or not) and each paid line whose revenue trigger is
// near or reached; the free services in one line. Lines far from their trigger are not on screen
// (KC-0052). Pure: the ledger's cover in, one bunke block out; every text escaped (AGENTS §4 r9).

import { html, type Markup } from './html.ts';
import { tilstandChip, type Tilstand } from './sprog.ts';
import type { Daekning, LinjeTilstand, Samlet } from '../omkostninger/regnskab.ts';

/** The card's three colours (the testtilstand coverage derives from this list). */
export const OMKOSTNING_SAMLET: readonly Samlet[] = ['groen', 'gul', 'roed'];

/** One colour per meaning (KC-0064): covered is ordnet, near is kraever, paid without cover is graense. */
const CHIP: Partial<Record<LinjeTilstand, [Tilstand, string]>> = {
  daekket: ['ordnet', 'Dækket'],
  udaekket: ['graense', 'Ikke dækket'],
  naer: ['kraever', 'Snart dækket'],
  klar: ['ordnet', 'Kan tændes'],
};

/** Øre as Danish kroner: "56 kr", "1,40 kr", "1.290 kr". */
export function kr(oere: number): string {
  const brok = oere % 100 !== 0;
  return `${new Intl.NumberFormat('da-DK', { minimumFractionDigits: brok ? 2 : 0, maximumFractionDigits: 2 }).format(oere / 100)} kr`;
}

function hoved(samlet: Samlet, hoejre: Markup | string): Markup {
  return html`<div class="card card-list omkostninger" data-blok="bunke" data-gruppe="Omkostninger" data-omkostninger-samlet="${samlet}"><div class="card-head"><h3 class="eyebrow">Omkostninger</h3><span class="muted mono">${hoejre}</span></div>`;
}

export function renderOmkostninger(d: Daekning | 'fejl'): Markup {
  if (d === 'fejl') {
    return html`${hoved('roed', '')}<div class="row omkostning-row" data-omkostning-tilstand="fejl"><span class="row-main"><span class="row-title">Omkostningslisten kunne ikke læses</span><span class="row-note">Intet betalt må tændes, før config/omkostninger.json er rettet.</span></span>${tilstandChip('graense', 'Fejl')}</div></div>`;
  }
  const vist = d.linjer.filter((l) => CHIP[l.tilstand]);
  const gratis = d.linjer.filter((l) => l.tilstand === 'gratis');
  const note = (l: (typeof vist)[number]): string => {
    const kraever = l.kraevetMrr === null ? '' : `kræver ${kr(l.kraevetMrr)}/md i betalte abonnementer`;
    return [`${kr(l.maanedlig)}/md`, l.aktiv ? (l.tilstand === 'udaekket' ? `tændt uden dækning, ${kraever}` : kraever) : `slukket, ${kraever}`].filter(Boolean).join(' · ');
  };
  return html`${hoved(d.samlet, `${kr(d.nu)}/md`)}${vist.map((l) => {
    const [farve, tekst] = CHIP[l.tilstand]!;
    return html`<div class="row omkostning-row" data-omkostning="${l.id}" data-omkostning-tilstand="${l.tilstand}"><span class="row-main"><span class="row-title">${l.navn}</span><span class="row-note">${note(l)}</span></span>${tilstandChip(farve, tekst)}</div>`;
  })}${gratis.length ? html`<div class="row omkostning-row" data-omkostning-tilstand="gratis"><span class="row-main"><span class="row-title">${gratis.length === 1 ? '1 tjeneste kører gratis' : `${gratis.length} tjenester kører gratis`}</span><span class="row-note">${gratis.map((l) => l.navn).join(' · ')}</span></span>${tilstandChip('ordnet', '0 kr')}</div>` : ''}</div>`;
}
