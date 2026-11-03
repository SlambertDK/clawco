// KC-0129: step 5's card and the pile of proposals. Pure: data in, Markup out; every text through html`` (the
// escaper) — names, relations and the profile text come from an assistant's answer or a file and are never trusted.
// Buttons follow the client contract in public/app.js (data-aktion + data-arg, data-form).

import { html, type Markup } from '../../../shell/html.ts';
import { mere } from '../../../shell/visuel.ts';
import { zoneChip, zoneData } from '../../../shell/zone.ts';
import { spoerg } from '../../../shell/sprog.ts';
import type { ImportBunke, ImportForslag, ImportGemt, TrinStatus } from '../schema.ts';
import { forskelTekst, PROFIL_NAVN } from './foreslaa.ts';
import { ASSISTENTER, slagsNavn } from './typer.ts';
import { startTekst } from '../tekster.ts';

/** What the room knows for step 5's card. */
export type ImportVisning = {
  /** A vault with a people register to write into exists. */
  klar: boolean;
  /** Start can set up a new notes folder itself. */
  kanLavMappe: boolean;
  /** Who reads the text: the chosen provider by name (`lokal`: on the user's own machine), or null = the model Hermes is set up with. */
  udbyder: { navn: string; lokal: boolean; /** KC-0265: Clawco's AI of a Sky plan. */ inkluderet?: true } | null;
  bunke?: ImportBunke;
  gemt: ImportGemt[];
  /** Hermes is reading an import right now. */
  laeser: boolean;
  /** Only the owner imports. */
  kanGemme: boolean;
};

const knap = (aktion: string, arg: Record<string, string> | null, tekst: string, status: string, primaer = false): Markup =>
  html`<button type="button" class="btn ${primaer ? 'btn-primary' : 'btn-ghost'}" data-aktion="${aktion}"${arg ? html` data-arg="${JSON.stringify(arg)}"` : ''} data-status="${status}">${tekst}</button>`;

/** Who sees the text, said before the first send. */
function udbyderLinje(u: ImportVisning['udbyder']): Markup {
  const T = startTekst().imp;
  const tekst = u === null ? T.udbyderIngen : u.inkluderet ? T.udbyderInkluderet : u.lokal ? T.udbyderLokal(u.navn) : T.udbyderValgt(u.navn);
  return html`<p class="row-note" data-import-udbyder>${tekst}</p>`;
}

/** A stored profile line shows in the language being rendered (its name is stored once, in PROFIL_NAVN's words). */
const visNavn = (f: ImportForslag): string => (f.art === 'profil' && f.navn === PROFIL_NAVN ? startTekst().imp.dinProfil : f.navn);

function importForm(): Markup {
  const T = startTekst().imp;
  return html`<form id="import-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <label class="field"><span class="row-note">${T.hvorFra}</span><select name="assistent">${ASSISTENTER.map((a) => html`<option value="${a}">${slagsNavn(a)}</option>`)}</select></label>
    <label class="field"><span class="row-note">${T.indsaetSvar}</span><textarea name="tekst" rows="6" maxlength="100000" spellcheck="false"></textarea></label>
    <label class="field"><span class="row-note">${T.vaelgFiler}</span><input type="file" multiple data-import-filer accept=".vcf,.csv,.md,.txt,.html,.htm"></label>
    <input type="hidden" name="filer" value="">
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="import-laes" data-form="import-form" data-status="${T.laeserDet}">${T.findForslag}</button></div>
  </form>`;
}

function forslagRaekke(f: ImportForslag): Markup {
  const T = startTekst();
  const I = T.imp;
  const navn = visNavn(f);
  const findes = f.status === 'findes';
  const linjer = [f.relation, f.org && I.arbejderHos(f.org), f.foedselsdag && I.foedt(f.foedselsdag)].filter(Boolean).join(' · ');
  const tekst = f.tekst ? (f.tekst.length > 280 ? `${f.tekst.slice(0, 280)}…` : f.tekst) : '';
  const hoved = f.art === 'person' && !findes ? html`<span class="row-title">${navn}</span>` : f.art === 'profil' ? html`<span class="row-title">${navn}</span>` : html`<span class="row-title">${I.opdaterSpoergsmaal(navn)}</span>`;
  const noter = findes
    ? html`<span class="row-note">${f.art === 'profil'
      ? I.profilFindes
      : I.personFindes(navn)}</span>${(f.diff ? forskelTekst(f.diff) : []).map((d) => html`<span class="row-note" data-import-diff>${d}</span>`)}`
    : html`${linjer ? html`<span class="row-note">${linjer}</span>` : ''}${tekst ? html`<span class="row-note import-tekst">${tekst}</span>` : ''}`;
  return html`<div class="row" data-import-forslag="${f.id}" data-import-status="${f.status}"${f.art === 'person' ? zoneData({ zone: f.zone ?? 'privat' }) : ''} data-element="${I.importElement(navn)}">
    <span class="row-main">${hoved}${noter}</span>
    <span class="vis-smaa">${f.art === 'person' ? zoneChip({ zone: f.zone ?? 'privat' }) : ''}${findes ? '' : knap('import-gem', { forslagId: f.id }, T.gem, T.gemmer, true)}${findes && f.art === 'person' ? knap('import-opdater', { forslagId: f.id }, I.opdater, I.opdaterer, true) : ''}${knap('import-spring', { forslagId: f.id }, findes ? I.beholdMinFil : T.springOver, T.laeggerDetVaek)}${spoerg(I.importElement(navn))}</span>
  </div>`;
}

/** The pile (one line per proposal, Gem / Spring over, Gem alle) — a `bunke` block. */
export function importBunke(b: ImportBunke, kanGemme: boolean): Markup {
  const T = startTekst();
  const I = T.imp;
  const nye = b.forslag.filter((f) => f.status === 'nyt').length;
  return html`<div class="card card-list gruppe" data-blok="bunke" data-import-bunke data-gruppe="${I.fraGruppe(slagsNavn(b.slags))}">
    <div class="card-head"><h3 class="eyebrow">${I.fraOverskrift(slagsNavn(b.slags))}</h3><span class="muted mono">${b.forslag.length}</span></div>
    ${b.forslag.map((f) => (kanGemme ? forslagRaekke(f) : html`<div class="row" data-import-forslag="${f.id}" data-import-status="${f.status}"><span class="row-main"><span class="row-title">${visNavn(f)}</span></span></div>`))}
    ${b.uaendret ? html`<p class="row-note">${I.uaendret(b.uaendret)}</p>` : ''}
    ${kanGemme ? html`<div class="actions">${nye > 1 ? knap('import-gem-alle', null, I.gemAlle, T.gemmer, true) : ''}${knap('import-annuller', null, I.smidVaek, I.smiderVaek)}</div>` : ''}
  </div>`;
}

/** Step 5's card content: the form (or what is missing), what was taken with, and the pile when there is one. */
export function importIndhold(status: TrinStatus, v: ImportVisning): Markup {
  const T = startTekst();
  const I = T.imp;
  if (!v.kanGemme) return html`<p class="row-note">${I.ejerenVaelger}</p>`;
  const gemt = v.gemt.reduce((n, g) => n + g.antal, 0);
  const oversigt = gemt
    ? html`<p class="row-note" data-import-gemt>${I.gemtOversigt(gemt)}</p>`
    : html``;
  if (!v.klar) {
    return html`<p class="row-note" data-import-mappe="mangler">${I.mappeMangler}${v.kanLavMappe ? '' : I.forbindNoter}</p>
    ${v.kanLavMappe ? html`<div class="actions">${knap('import-lav-mappe', null, I.lavMappe, I.laverMappen, true)}</div>` : ''}
    ${status === 'klaret' || status === 'sprunget-over' ? '' : html`<div class="actions">${knap('import-spring-over', null, T.springOver, T.springerOver)}</div>`}`;
  }
  const spring = status === 'klaret' || status === 'sprunget-over' ? html`` : html`<div class="actions">${knap('import-spring-over', null, T.springOver, T.springerOver)}</div>`;
  const bunke = v.bunke ? importBunke(v.bunke, v.kanGemme) : html``;
  const laeser = v.laeser ? html`<p class="row-note" data-import-laeser>${I.laeserNu}</p>` : html``;
  const form = html`${udbyderLinje(v.udbyder)}<p class="row-note">${I.graenser}</p>${importForm()}`;
  return html`${oversigt}${laeser}${bunke}${status === 'klaret' ? mere(form, I.tagMere) : html`${form}${spring}`}`;
}
