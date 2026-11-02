// KC-0129: step 5's card and the pile of proposals. Pure: data in, Markup out; every text through html`` (the
// escaper) — names, relations and the profile text come from an assistant's answer or a file and are never trusted.
// Buttons follow the client contract in public/app.js (data-aktion + data-arg, data-form).

import { html, type Markup } from '../../../shell/html.ts';
import { mere } from '../../../shell/visuel.ts';
import { zoneChip, zoneData } from '../../../shell/zone.ts';
import { spoerg } from '../../../shell/sprog.ts';
import type { ImportBunke, ImportForslag, ImportGemt, TrinStatus } from '../schema.ts';
import { forskelTekst } from './foreslaa.ts';
import { ASSISTENTER, SLAGS_NAVN, slagsNavn } from './typer.ts';

/** What the room knows for step 5's card. */
export type ImportVisning = {
  /** A vault with a people register to write into exists. */
  klar: boolean;
  /** Start can set up a new notes folder itself. */
  kanLavMappe: boolean;
  /** Who reads the text: the chosen provider by name (`lokal`: on the user's own machine), or null = the model Hermes is set up with. */
  udbyder: { navn: string; lokal: boolean } | null;
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
  const tekst = u === null
    ? 'Teksten sendes kun til den model, Hermes er sat op med. Clawco sender den ingen andre steder hen.'
    : u.lokal ? `Teksten går kun til din egen model (${u.navn}): ingen forlader maskinen.` : `Teksten sendes til ${u.navn}, den udbyder du valgte, så modellen kan læse den. Clawco sender den ingen andre steder hen.`;
  return html`<p class="row-note" data-import-udbyder>${tekst}</p>`;
}

const GRAENSER = 'Clawco læser tekst, kontaktfiler (.vcf, .csv) og noter (.md, .txt, .html), højst 10 MB. Zip-filer læses ikke endnu, og Clawco går aldrig i samtalehistorikken eller i Apple Noters egen database. Det, du uploader, ligger kun midlertidigt og slettes igen, når forslagene er gemt eller smidt væk, og senest efter en time.';

function importForm(): Markup {
  return html`<form id="import-form" class="nyt-form" onsubmit="return false" autocomplete="off">
    <label class="field"><span class="row-note">Hvor kommer teksten fra?</span><select name="assistent">${ASSISTENTER.map((a) => html`<option value="${a}">${SLAGS_NAVN[a]}</option>`)}</select></label>
    <label class="field"><span class="row-note">Indsæt svaret på »hvad ved du om mig?«</span><textarea name="tekst" rows="6" maxlength="100000" spellcheck="false"></textarea></label>
    <label class="field"><span class="row-note">Eller vælg filer: kontakter eller noter</span><input type="file" multiple data-import-filer accept=".vcf,.csv,.md,.txt,.html,.htm"></label>
    <input type="hidden" name="filer" value="">
    <div class="actions"><button type="button" class="btn btn-primary" data-aktion="import-laes" data-form="import-form" data-status="Hermes læser det">Find forslag</button></div>
  </form>`;
}

function forslagRaekke(f: ImportForslag): Markup {
  const findes = f.status === 'findes';
  const linjer = [f.relation, f.org && `arbejder hos ${f.org}`, f.foedselsdag && `født ${f.foedselsdag}`].filter(Boolean).join(' · ');
  const tekst = f.tekst ? (f.tekst.length > 280 ? `${f.tekst.slice(0, 280)}…` : f.tekst) : '';
  const hoved = f.art === 'person' && !findes ? html`<span class="row-title">${f.navn}</span>` : f.art === 'profil' ? html`<span class="row-title">${f.navn}</span>` : html`<span class="row-title">Opdater ${f.navn}?</span>`;
  const noter = findes
    ? html`<span class="row-note">${f.art === 'profil'
      ? 'Din profil findes allerede, og Clawco ændrer ikke en fil, du har. Ret den selv i Obsidian, hvis du vil have det med.'
      : `${f.navn} findes allerede. Det, importen siger anderledes, står her. Tryk Opdater for at skrive det ind: resten af din fil rører Clawco ikke, og du kan fortryde.`}</span>${(f.diff ? forskelTekst(f.diff) : []).map((d) => html`<span class="row-note" data-import-diff>${d}</span>`)}`
    : html`${linjer ? html`<span class="row-note">${linjer}</span>` : ''}${tekst ? html`<span class="row-note import-tekst">${tekst}</span>` : ''}`;
  return html`<div class="row" data-import-forslag="${f.id}" data-import-status="${f.status}"${f.art === 'person' ? zoneData({ zone: f.zone ?? 'privat' }) : ''} data-element="Importforslag: ${f.navn}">
    <span class="row-main">${hoved}${noter}</span>
    <span class="vis-smaa">${f.art === 'person' ? zoneChip({ zone: f.zone ?? 'privat' }) : ''}${findes ? '' : knap('import-gem', { forslagId: f.id }, 'Gem', 'gemmer', true)}${findes && f.art === 'person' ? knap('import-opdater', { forslagId: f.id }, 'Opdater', 'opdaterer', true) : ''}${knap('import-spring', { forslagId: f.id }, findes ? 'Behold min fil' : 'Spring over', 'lægger det væk')}${spoerg(`Importforslag: ${f.navn}`)}</span>
  </div>`;
}

/** The pile (one line per proposal, Gem / Spring over, Gem alle) — a `bunke` block. */
export function importBunke(b: ImportBunke, kanGemme: boolean): Markup {
  const nye = b.forslag.filter((f) => f.status === 'nyt').length;
  return html`<div class="card card-list gruppe" data-blok="bunke" data-import-bunke data-gruppe="Fra ${slagsNavn(b.slags)}">
    <div class="card-head"><h3 class="eyebrow">Fra ${slagsNavn(b.slags)}: intet er gemt endnu</h3><span class="muted mono">${b.forslag.length}</span></div>
    ${b.forslag.map((f) => (kanGemme ? forslagRaekke(f) : html`<div class="row" data-import-forslag="${f.id}" data-import-status="${f.status}"><span class="row-main"><span class="row-title">${f.navn}</span></span></div>`))}
    ${b.uaendret ? html`<p class="row-note">${b.uaendret} fandtes allerede i din mappe uden forskel og er ikke med her.</p>` : ''}
    ${kanGemme ? html`<div class="actions">${nye > 1 ? knap('import-gem-alle', null, 'Gem alle', 'gemmer', true) : ''}${knap('import-annuller', null, 'Smid forslagene væk', 'smider væk')}</div>` : ''}
  </div>`;
}

/** Step 5's card content: the form (or what is missing), what was taken with, and the pile when there is one. */
export function importIndhold(status: TrinStatus, v: ImportVisning): Markup {
  if (!v.kanGemme) return html`<p class="row-note">Ejeren vælger, hvad der tages med.</p>`;
  const gemt = v.gemt.reduce((n, g) => n + g.antal, 0);
  const oversigt = gemt
    ? html`<p class="row-note" data-import-gemt>Du har taget ${gemt} ${gemt === 1 ? 'fil' : 'filer'} med. De ligger som almindelige tekstfiler i din notemappe, og du kan læse og rette dem i Obsidian eller en teksteditor. Fortryd står i loggen nedenfor.</p>`
    : html``;
  if (!v.klar) {
    return html`<p class="row-note" data-import-mappe="mangler">Det, du tager med, gemmes som tekstfiler i din notemappe, og du har ikke valgt en endnu.${v.kanLavMappe ? '' : ' Forbind Noter under Kilder, så er den klar.'}</p>
    ${v.kanLavMappe ? html`<div class="actions">${knap('import-lav-mappe', null, 'Lav en mappe til mig', 'laver mappen', true)}</div>` : ''}
    ${status === 'klaret' || status === 'sprunget-over' ? '' : html`<div class="actions">${knap('import-spring-over', null, 'Spring over', 'springer over')}</div>`}`;
  }
  const spring = status === 'klaret' || status === 'sprunget-over' ? html`` : html`<div class="actions">${knap('import-spring-over', null, 'Spring over', 'springer over')}</div>`;
  const bunke = v.bunke ? importBunke(v.bunke, v.kanGemme) : html``;
  const laeser = v.laeser ? html`<p class="row-note" data-import-laeser>Hermes læser det nu. Det kan tage et minut.</p>` : html``;
  const form = html`${udbyderLinje(v.udbyder)}<p class="row-note">${GRAENSER}</p>${importForm()}`;
  return html`${oversigt}${laeser}${bunke}${status === 'klaret' ? mere(form, 'Tag mere med') : html`${form}${spring}`}`;
}
