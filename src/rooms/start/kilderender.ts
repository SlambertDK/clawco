// KC-0128: what steps 3–4 show inside their step card. The connect cards are
// the registry's data (KildeKortSyn): title, one sentence, the fields to fill
// and the button's label — Start adds only the zone choice ("Det her er
// privat", one tap to change) and Spring over in step 4. The button posts
// straight to /api/kilder/:id/forbind (public/app.js); Start never sees a
// secret. A connected source shows its preview, or its own error.

import { html, type Markup } from '../../shell/html.ts';
import { tilstandChip } from '../../shell/sprog.ts';
import type { KildeKortSyn } from '../module.ts';
import { DATAZONER, type DataZone } from '../../identitet/zoner.ts';
import { renderForhaandsvisning, type Forhaandsvisning } from './forhaandsvisning.ts';
import { FOERSTE_SLAGS, erPakkeKilde } from './trin.ts';
import type { TrinStatus } from './schema.ts';

export type KildeVisning = {
  kort: KildeKortSyn[];
  /** Previews shown now (not yet replaced). */
  forhaandsvisninger: Forhaandsvisning[];
  /** Step 4's pile in order (connector ids); Start shows the first. */
  flere: string[];
  /** Only the owner connects (the routes answer 403 to anyone else). */
  kanForbinde: boolean;
  /** KC-0160: laptop mode — one person: the zone choice leaves out the household's. */
  laptop?: boolean;
};

const ZONE_TEKST: Record<DataZone, string> = { privat: 'privat', arbejde: 'arbejde', husstand: 'husstandens' };

function felt(f: KildeKortSyn['kort']['felter'][number], formId: string): Markup {
  const krav = f.paakraevet ? html` required` : '';
  const maks = f.maks ? html` maxlength="${String(f.maks)}"` : '';
  if (f.muligheder?.length) {
    return html`<label class="field"><span class="row-note">${f.etiket}</span><select name="${f.navn}"${krav}>${f.muligheder.map((m) => html`<option value="${m.vaerdi}">${m.etiket}</option>`)}</select></label>`;
  }
  // KC-0137: several values, one per line; and a file whose text app.js sends (an OPML export).
  if (f.flere) return html`<label class="field"><span class="row-note">${f.etiket}</span><textarea name="${f.navn}" rows="3"${krav}${maks}></textarea></label>`;
  if (f.type === 'fil') return html`<label class="field"><span class="row-note">${f.etiket}</span><input name="${f.navn}" type="file" accept=".opml,.xml,text/xml,application/xml,text/x-opml"${krav}${f.maks ? html` data-maks="${String(f.maks)}"` : ''}></label>`;
  if (f.type === 'hemmelig') return html`<label class="field"><span class="row-note">${f.etiket}</span><input name="${f.navn}" type="password" autocomplete="new-password"${krav}${maks}></label>`;
  const liste = f.forslag?.length ? `${formId}-${f.navn}-forslag` : '';
  return html`<label class="field"><span class="row-note">${f.etiket}</span><input name="${f.navn}" type="text"${krav}${maks}${liste ? html` list="${liste}"` : ''}></label>${liste ? html`<datalist id="${liste}">${(f.forslag ?? []).map((v) => html`<option value="${v}"></option>`)}</datalist>` : ''}`;
}

/**
 * KC-0133: a card's setup steps (e.g. making one's own Google app), one at a time — an exclusive accordion (details
 * sharing a name), the first open, no script; a value to copy (the redirect address) gets the app's Kopiér button.
 */
function opsaetTrin(k: KildeKortSyn): Markup {
  const trin = k.kort.trin ?? [];
  if (!trin.length) return html``;
  const navn = `kilde-trin-${k.id}`;
  return html`<div class="stack kilde-trin" data-kilde-trin="${k.id}">${trin.map((t, i) => html`<details class="kilde-trin-et" name="${navn}"${i === 0 ? html` open` : ''}><summary class="row-note">Trin ${String(i + 1)} af ${String(trin.length)}</summary><p>${t.tekst}</p>${t.kopier ? html`<p class="mono row-note">${t.kopier}</p><div class="actions"><button type="button" class="btn btn-ghost" data-kopier="${t.kopier}">Kopiér adressen</button></div>` : ''}</details>`)}</div>`;
}

/** One source's connect card. `efter`: where the browser goes once connected (step 3 → Nu, where the first value stands). */
export function forbindKort(k: KildeKortSyn, o: { spring: boolean; efter?: string; igen?: boolean; laptop?: boolean; ikkeNu?: string }): Markup {
  const form = forbindForm(k, o);
  return html`<div class="kilde-kort" data-kilde-kort="${k.id}" data-kilde-slags="${k.slags}" data-element="Kilde: ${k.kort.titel}">
    <p class="row-title">${k.kort.titel}</p><p class="row-note">${k.kort.tekst}</p>${opsaetTrin(k)}${form}
  </div>`;
}

/** The card's form: its fields, the zone choice and the button (Spring over in step 4). */
function forbindForm(k: KildeKortSyn, o: { spring: boolean; efter?: string; igen?: boolean; laptop?: boolean; ikkeNu?: string }): Markup {
  const formId = `kilde-form-${k.id}`;
  const zone = html`<label class="field kilde-zone"><span class="row-note">Det her er</span><select name="zone">${DATAZONER.filter((z) => !(o.laptop && z === 'husstand')).map((z) => html`<option value="${z}"${z === k.zone ? html` selected` : ''}>${ZONE_TEKST[z]}</option>`)}</select></label>`;
  const spring = o.spring ? html`<button type="button" class="btn btn-ghost" data-aktion="kilde-spring-over" data-arg="${JSON.stringify({ kildeId: k.id })}" data-status="springer over">Spring over</button>` : '';
  // KC-0236: a pack card is put away for a while, not skipped for good (the handling named here; Start's own state is not touched).
  const ikkeNu = o.ikkeNu ? html`<button type="button" class="btn btn-ghost" data-aktion="${o.ikkeNu}" data-status="lægger væk">Ikke nu</button>` : '';
  return html`<form id="${formId}" class="nyt-form" onsubmit="return false" autocomplete="off">
      ${k.kort.felter.filter((f) => !f.skjult).map((f) => felt(f, formId))}${zone}
      <div class="actions"><button type="button" class="btn btn-primary" data-kilde-forbind="${k.id}" data-form="${formId}"${o.efter ? html` data-efter="${o.efter}"` : ''} data-status="forbinder">${o.igen ? 'Prøv igen' : k.kort.handling}</button>${spring}${ikkeNu}</div>
    </form>`;
}

/** A connected source: its preview, else its own error (KC-0139's health words), else that the first read is pending. */
function forbundetKort(k: KildeKortSyn, v: KildeVisning, now: Date, spring: boolean): Markup {
  const f = v.forhaandsvisninger.find((x) => x.kildeId === k.id);
  if (f) return renderForhaandsvisning(f, now);
  const fejl = k.helbred && k.helbred.status !== 'ok' && k.helbred.status !== 'snart-udloebet';
  if (fejl) {
    return html`<div class="kilde-kort" data-kilde-fejl="${k.id}" data-element="Kilde: ${k.kort.titel}"><div class="kort-head">${tilstandChip('kraever', 'Virker ikke')}<span class="row-title">${k.kort.titel}</span></div><p class="row-note">${k.helbred?.tekst ?? 'Kilden virker ikke lige nu.'}</p>${v.kanForbinde ? forbindForm(k, { spring, igen: true, ...(v.laptop ? { laptop: true } : {}) }) : ''}</div>`;
  }
  return html`<p class="row-note" data-kilde-forbundet="${k.id}">${k.kort.titel} er forbundet.</p>`;
}

/** The content of step 3 (foerste-kilde) or step 4 (flere-kilder) for its status. */
export function kildeIndhold(trinId: string, status: TrinStatus, v: KildeVisning, now: Date): Markup {
  if (trinId === 'foerste-kilde') {
    // KC-0236: a source of the Danmark-pakke has its own place (the pack's group) and is not a first source.
    const kort = v.kort.filter((k) => FOERSTE_SLAGS.includes(k.slags) && !erPakkeKilde(k.id));
    if (status === 'klaret') {
      return html`${kort.filter((k) => k.forbundet).map((k) => forbundetKort(k, v, now, false))}<p class="row-note"><a href="/rum/hjem">Se det i Nu</a></p>`;
    }
    if (!v.kanForbinde) return html`<p class="row-note">Ejeren forbinder den første kilde.</p>`;
    return html`<div class="stack kilde-valg">${kort.map((k) => (k.forbundet ? forbundetKort(k, v, now, false) : forbindKort(k, { spring: false, efter: '/rum/hjem', ...(v.laptop ? { laptop: true } : {}) })))}</div>`;
  }
  // Step 4: the previews of the further kinds (a second calendar/mail shows under step 3), then the next source on offer.
  const vist = v.forhaandsvisninger.filter((f) => !FOERSTE_SLAGS.includes(f.slags) && !erPakkeKilde(f.kildeId));
  const naeste = v.kort.find((k) => k.id === v.flere.filter((id) => !erPakkeKilde(id))[0]);
  const tilbud = naeste && v.kanForbinde ? forbindKort(naeste, { spring: true, ...(v.laptop ? { laptop: true } : {}) }) : '';
  return html`${vist.map((f) => renderForhaandsvisning(f, now))}${tilbud}`;
}
