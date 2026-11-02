// "Kilder" in the Kø panel (KC-0120): every connected source with its zone,
// its state in plain Danish, when this app last read it, and Frakobl for the
// owner (POST /api/kilder/:id/frakobl, KC-0132). Unconnected sources are not
// listed (KC-0052: Start offers them when worth it). Pure: the registry's
// overview in, one bunke block out; every text escaped (AGENTS §4 r9).

import { html, type Markup } from './html.ts';
import { tilstandChip, type Tilstand } from './sprog.ts';
import { hvornaar } from './revision.ts';
import { ZONE_NAVN } from '../identitet/zoner.ts';
import { virker, type Helbred } from '../kilder/types.ts';
import { kortTekst } from '../kilder/helbred-tekst.ts';
import type { KildeOversigt } from '../kilder/register.ts';

/** The four states a connected source can be in on screen (the testtilstand coverage derives from this list). */
export const KILDE_TILSTANDE = ['forbundet', 'log-ind-igen', 'nede', 'langsom'] as const;
export type KildeTilstand = (typeof KILDE_TILSTANDE)[number];

const TEKST: Record<KildeTilstand, string> = { forbundet: 'Forbundet', 'log-ind-igen': 'Log ind igen', nede: 'Nede', langsom: 'Langsom' };
/** One colour per meaning (KC-0064): working is ordnet, Henrik must act is kraever, broken is graense, slow is rolig. */
const FARVE: Record<KildeTilstand, Tilstand> = { forbundet: 'ordnet', 'log-ind-igen': 'kraever', nede: 'graense', langsom: 'rolig' };

/** A health check onto the screen state; what the registry reads (virker) is exactly what shows as Forbundet. */
export function kildeTilstand(h: Helbred | null): KildeTilstand {
  if (virker(h)) return 'forbundet';
  if (h?.status === 'log-ind-igen') return 'log-ind-igen';
  if (h?.status === 'langsomt') return 'langsom';
  return 'nede';
}

export type KildeVisning = Pick<KildeOversigt, 'id' | 'navn' | 'slags' | 'auth' | 'zone' | 'forbundet' | 'helbred' | 'sidstLaest'>;

/** KC-0139: what is wrong, from the fixed table — never the connector's own words (they can echo a provider). */
function hvadErGalt(k: KildeVisning, t: KildeTilstand): string {
  if (t === 'log-ind-igen' || t === 'nede') return kortTekst(t, k.auth, k.slags).titel;
  return t === 'langsom' ? 'Svarer langsomt' : '';
}

export function renderKilder(liste: readonly KildeVisning[], o: { nu: Date; maaFrakoble: boolean }): Markup {
  const forbundne = liste.filter((k) => k.forbundet);
  if (!forbundne.length) return html``;
  return html`<div class="card card-list kilder" data-blok="bunke" data-gruppe="Kilder"><div class="card-head"><h3 class="eyebrow">Kilder</h3><span class="muted mono">${forbundne.length}</span></div>${forbundne.map((k) => {
    const t = kildeTilstand(k.helbred);
    const note = [ZONE_NAVN[k.zone], hvadErGalt(k, t), k.sidstLaest ? `Sidst læst ${hvornaar(k.sidstLaest, o.nu)}` : ''].filter(Boolean).join(' · ');
    return html`<div class="row kilde-row" data-kilde="${k.id}" data-kilde-tilstand="${t}"><span class="row-main"><span class="row-title">${k.navn}</span><span class="row-note">${note}</span></span>${tilstandChip(FARVE[t], TEKST[t])}${o.maaFrakoble ? html`<button type="button" class="btn kilde-frakobl" data-kilde-frakobl="${k.id}">Frakobl</button>` : ''}</div>`;
  })}</div>`;
}
