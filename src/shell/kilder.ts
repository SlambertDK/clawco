// "Kilder" in the Kø panel (KC-0120): every connected source with its zone,
// its state in plain Danish, when this app last read it, and Frakobl for the
// owner (POST /api/kilder/:id/frakobl, KC-0132); a source with a list of its own (KC-0222) shows it there too. Unconnected sources are not
// listed (KC-0052: Start offers them when worth it). Pure: the registry's
// overview in, one bunke block out; every text escaped (AGENTS §4 r9).

import { html, type Markup } from './html.ts';
import { tilstandChip, type Tilstand } from './sprog.ts';
import { hvornaar } from './revision.ts';
import { tekst } from './tekster.ts';
import { virker, type Helbred } from '../kilder/types.ts';
import { kortTekst } from '../kilder/helbred-tekst.ts';
import type { KildeOversigt } from '../kilder/register.ts';

/** The four states a connected source can be in on screen (the testtilstand coverage derives from this list). */
export const KILDE_TILSTANDE = ['forbundet', 'log-ind-igen', 'nede', 'langsom'] as const;
export type KildeTilstand = (typeof KILDE_TILSTANDE)[number];

/** One colour per meaning (KC-0064): working is ordnet, Henrik must act is kraever, broken is graense, slow is rolig. */
const FARVE: Record<KildeTilstand, Tilstand> = { forbundet: 'ordnet', 'log-ind-igen': 'kraever', nede: 'graense', langsom: 'rolig' };

/** A health check onto the screen state; what the registry reads (virker) is exactly what shows as Forbundet. */
export function kildeTilstand(h: Helbred | null): KildeTilstand {
  if (virker(h)) return 'forbundet';
  if (h?.status === 'log-ind-igen') return 'log-ind-igen';
  if (h?.status === 'langsomt') return 'langsom';
  return 'nede';
}

/** KC-0222: `feeder` = a source that keeps a list of its own (the news feeds): id and name of each, shown to the owner with Fjern and an add field. */
export type KildeVisning = Pick<KildeOversigt, 'id' | 'navn' | 'slags' | 'auth' | 'zone' | 'forbundet' | 'helbred' | 'sidstLaest'> & { feeder?: readonly { id: string; navn: string }[] };

/** KC-0139: what is wrong, from the fixed table — never the connector's own words (they can echo a provider). */
function hvadErGalt(k: KildeVisning, t: KildeTilstand): string {
  if (t === 'log-ind-igen' || t === 'nede') return kortTekst(t, k.auth, k.slags).titel;
  return t === 'langsom' ? tekst().svarerLangsomt : '';
}

/** KC-0222: the source's own list: each entry by name with Fjern (not on the last one), and the field that adds one by its address (public/app.js posts it). */
function egneKilder(k: KildeVisning & { feeder: NonNullable<KildeVisning['feeder']> }): Markup {
  const T = tekst();
  const sidste = k.feeder.length <= 1;
  return html`<details class="kilde-feeds" data-kilde-feeds="${k.id}"><summary class="row-note">${T.egneKilder(k.feeder.length)}</summary>${k.feeder.map((f) => html`<div class="row kilde-feed" data-kilde-feed="${f.id}"><span class="row-main"><span class="row-title">${f.navn}</span></span>${sidste ? '' : html`<button type="button" class="btn kilde-feed-fjern" data-kilde-feed-fjern="${f.id}">${T.fjernKilde}</button>`}</div>`)}<form class="nyt-form kilde-feed-tilfoej" data-kilde-feed-tilfoej="${k.id}" onsubmit="return false" autocomplete="off"><label class="field"><span class="row-note">${T.tilfoejKildeEtiket}</span><input name="adresse" type="text" inputmode="url" maxlength="2000" data-kilde-feed-adresse></label><button type="submit" class="btn" data-kilde-feed-ny="${k.id}">${T.tilfoejKilde}</button></form><p class="row-note" data-kilde-feed-fejl hidden></p></details>`;
}

export function renderKilder(liste: readonly KildeVisning[], o: { nu: Date; maaFrakoble: boolean }): Markup {
  const forbundne = liste.filter((k) => k.forbundet);
  if (!forbundne.length) return html``;
  const T = tekst();
  return html`<div class="card card-list kilder" data-blok="bunke" data-gruppe="Kilder"><div class="card-head"><h3 class="eyebrow">${T.kilder}</h3><span class="muted mono">${forbundne.length}</span></div>${forbundne.map((k) => {
    const t = kildeTilstand(k.helbred);
    const note = [T.zone[k.zone], hvadErGalt(k, t), k.sidstLaest ? T.sidstLaest(hvornaar(k.sidstLaest, o.nu)) : ''].filter(Boolean).join(' · ');
    return html`<div class="row kilde-row" data-kilde="${k.id}" data-kilde-tilstand="${t}"><span class="row-main"><span class="row-title">${k.navn}</span><span class="row-note">${note}</span></span>${tilstandChip(FARVE[t], T.kildeTilstand[t])}${o.maaFrakoble ? html`<button type="button" class="btn kilde-frakobl" data-kilde-frakobl="${k.id}">${T.frakobl}</button>` : ''}</div>${o.maaFrakoble && k.feeder ? egneKilder({ ...k, feeder: k.feeder }) : ''}`;
  })}</div>`;
}
