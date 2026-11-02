// KC-0139: the one card a failing connection gets in Nu ("Kræver dig", group
// Forbindelser). One element per source, stable id kilde-helbred-<id>, gone (not
// greyed) when the source works. The words come from the fixed table in
// src/kilder/helbred-tekst.ts — never from the provider — and every other text is
// escaped. The primary handling restarts the connect flow (public/app.js posts the
// form to /api/kilder/:id/forbind, as Start's connect cards do); the secondary
// disconnects. Pure: data in, markup out.

import { html, type Markup } from './html.ts';
import { handlinger, knap, type Element } from './sprog.ts';
import { visHoved } from './visuel.ts';
import { zoneChip, zoneData } from './zone.ts';
import { dagStr, klokke, kildeFriskhed } from './friskhed.ts';
import { kortTekst, type GenforbindFelt, type KortTilstand } from '../kilder/helbred-tekst.ts';
import type { Auth, Slags } from '../kilder/types.ts';
import type { DataZone } from '../identitet/zoner.ts';

/** What the card needs of one source (built by the composition root from the registry and helbred.json). */
export type KildeHelbredKort = {
  id: string; navn: string; slags: Slags; auth: Auth; vist: KortTilstand;
  zone: DataZone; ejer?: string;
  /** Last successful read (ISO). */
  sidstLaest?: string;
  /** A known expiry (ISO), for snart-udloebet. */
  udloeber?: string;
  felter: GenforbindFelt[];
  /** Only the owner connects (the routes answer 403 to anyone else). */
  kanForbinde: boolean;
};

const dagNr = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/** "i dag 21.00", "i morgen 21.00", else the weekday or date. */
function udloebTekst(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dage = Math.round(dagNr(dagStr(d)) - dagNr(dagStr(now)));
  const naar = dage <= 0 ? 'i dag' : dage === 1 ? 'i morgen' : new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', weekday: 'long' }).format(d);
  return `${naar} ${klokke(d)}`;
}

function felt(f: GenforbindFelt): Markup {
  if (f.skjult) return html`<input type="hidden" name="${f.navn}" value="${f.vaerdi ?? ''}">`;
  const krav = f.paakraevet ? html` required` : '';
  const maks = f.maks ? html` maxlength="${String(f.maks)}"` : '';
  if (f.muligheder?.length) return html`<label class="field"><span class="row-note">${f.etiket}</span><select name="${f.navn}"${krav}>${f.muligheder.map((m) => html`<option value="${m.vaerdi}">${m.etiket}</option>`)}</select></label>`;
  if (f.type === 'hemmelig') return html`<label class="field"><span class="row-note">${f.etiket}</span><input name="${f.navn}" type="password" autocomplete="new-password"${krav}${maks}></label>`;
  return html`<label class="field"><span class="row-note">${f.etiket}</span><input name="${f.navn}" type="text"${f.vaerdi ? html` value="${f.vaerdi}"` : ''}${krav}${maks}></label>`;
}

function kortFor(k: KildeHelbredKort, now: Date): Markup {
  const t = kortTekst(k.vist, k.auth, k.slags);
  const formId = `kilde-helbred-form-${k.id}`;
  const harForm = k.kanForbinde && k.felter.length > 0;
  const form = harForm ? html`<form id="${formId}" class="nyt-form" onsubmit="return false" autocomplete="off">${k.felter.map(felt)}</form>` : '';
  const primaer = k.kanForbinde ? knap({ label: t.knap, slags: 'primaer', attrs: { 'data-kilde-forbind': k.id, ...(harForm ? { 'data-form': formId } : {}), 'data-status': 'forbinder' } }) : undefined;
  const fjern = k.kanForbinde ? knap({ label: 'Fjern forbindelsen', slags: 'ghost', attrs: { 'data-kilde-fjern': k.id } }) : undefined;
  const udloeber = k.vist === 'snart-udloebet' && k.udloeber ? udloebTekst(k.udloeber, now) : '';
  return html`<article class="card kort kilde-helbred" data-blok="kort" data-kilde-helbred="${k.vist}" data-kilde-helbred-id="${k.id}"${zoneData(k)} data-element="Forbindelsen: ${k.navn}">
    ${visHoved({ ikon: 'triangle-alert', tone: 'adv' }, t.titel, 'Forbindelse')}${zoneChip(k)}
    <p class="betydning">${t.tekst}</p>
    ${udloeber ? html`<p class="row-note">Udløber ${udloeber}</p>` : ''}
    <p class="row-note">Fra ${k.navn} · ${kildeFriskhed({ slags: k.slags, ...(k.sidstLaest ? { sidstLaest: k.sidstLaest } : {}), ok: k.vist === 'snart-udloebet' }, now)}</p>
    ${k.kanForbinde ? '' : html`<p class="row-note">Ejeren kan løse det.</p>`}
    ${form}
    ${handlinger(primaer, fjern ? [fjern] : [])}
  </article>`;
}

/** One element per source, in the order given; a source named twice is one card. */
export function kildeHelbredElementer(kort: readonly KildeHelbredKort[], now: Date): Element[] {
  const set = new Set<string>();
  const ud: Element[] = [];
  for (const k of kort) {
    if (set.has(k.id)) continue;
    set.add(k.id);
    ud.push({ id: `kilde-helbred-${k.id}`, html: kortFor(k, now) });
  }
  return ud;
}
