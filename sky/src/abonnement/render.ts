// The subscription pages (KC-0191): pure functions, state in, HTML out. Danish, dark, every value
// through html`` (sky/src/delt/html.ts); strings in tekster.ts; the shared skeleton in delt/side.ts.
import { html, type Markup } from '../delt/html.ts';
import { side } from '../delt/side.ts';
import type { Priser } from './priser.ts';
import type { IntervalNavn } from './opsaet.ts';
import type { Rettighed } from './rettigheder.ts';
import type { Faktura } from './stripe-klient.ts';
import { LANDE } from './lande.ts';
import { T } from './tekster.ts';
import type { Handling } from './handlinger.ts';

const csrfFelt = (csrf: string): Markup => html`<input type="hidden" name="csrf" value="${csrf}">`;
const tilbage = (): Markup => html`<p><a href="/konto">${T.tilbage}</a></p>`;

export type Valg = { plan: string | null; interval: IntervalNavn | null; land: string | null };

export function planSide(a: { csrf: string; priser: Priser; valg: Valg; proeve: boolean; afbrudt: boolean; fejl?: string }): string {
  const planer = Object.entries(a.priser.planer);
  const valgtPlan = a.valg.plan ?? planer[0]?.[0];
  const planValg = planer.map(([id, p]) => html`<label class="valg"><input type="radio" name="plan" value="${id}"${id === valgtPlan ? html` checked` : ''} required>
<span><strong>${p.navn}</strong><br><small>${T.medlemmer(p.medlemmer)} · ${T.pris(p.maanedlig.dkk, p.aarlig.dkk)}</small></span></label>`);
  const interval = a.valg.interval ?? 'maaned';
  const intervalValg = ([['maaned', T.maanedlig], ['aar', T.aarlig]] as const).map(([id, tekst]) =>
    html`<label class="valg"><input type="radio" name="interval" value="${id}"${id === interval ? html` checked` : ''} required><span>${tekst}</span></label>`);
  const land = a.valg.land ?? 'DK';
  const lande = LANDE.map((l) => html`<option value="${l.kode}"${l.kode === land ? html` selected` : ''}>${l.navn}</option>`);
  return side(T.planTitel, html`<h1>${T.planTitel}</h1>
<p>${a.proeve ? T.planIntro : T.planIntroUdenProeve}</p>
${a.afbrudt ? html`<p class="besked">${T.afbrudt}</p>` : ''}
${a.fejl ? html`<p class="status">${a.fejl}</p>` : ''}
<form method="get" action="/konto/abonnement/bekraeft">
<fieldset><legend>${T.planTitel}</legend>${planValg}</fieldset>
<fieldset><legend>${T.intervalTitel}</legend>${intervalValg}</fieldset>
<label for="land">${T.landFelt}</label>
<select id="land" name="land" required>${lande}</select>
<button type="submit" class="primaer">${T.videre}</button>
</form>
<p><small>${T.ingenMoms}</small></p>
${tilbage()}`, { csrf: a.csrf });
}

/** One line for a status ("Gratis prøve til 14. nov. 2026"); also the account page's summary. */
export function statusLinje(r: Rettighed): string {
  switch (r.status) {
    case 'proeve': return T.status.proeve(r.proeveSlutter);
    case 'aktiv': return T.status.aktiv(r.kilde === 'gave' ? null : r.periodeSlutter);
    case 'forfalden': return T.status.forfalden(r.forfaldenSiden);
    case 'pause': return T.status.pause;
    case 'opsagt': return T.status.opsagt;
    case 'ingen': return T.status.ingen;
  }
}

/** The account page's subscription summary (konto renders it; abonnement owns the words). */
export function kontoResume(r: Rettighed, priser: Priser, handlinger: Handling[] = []): { plan: string; tekst: string; handlinger: Handling[] } {
  const navn = priser.planer[r.plan]?.navn;
  if (!navn) return { plan: T.status.ingen, tekst: T.kontoResumeIngen, handlinger };
  // A cancelled subscription has no next payment (KC-0195): only its end date.
  const linje = r.opsiges && r.status === 'aktiv' ? T.status.aktiv(null) : statusLinje(r);
  return { plan: r.kilde === 'gave' ? `${navn} · ${T.gave}` : navn, tekst: [linje, r.opsiges ? T.opsiges(r.opsiges) : null].filter(Boolean).join(' · '), handlinger };
}

/** The sentence under the status line (KC-0195): what happens next in this state. */
function forklaring(r: Rettighed): string | null {
  if (r.opsiges && (r.status === 'aktiv' || r.status === 'proeve')) return T.forklar.opsiges(r.opsiges);
  if (r.status === 'proeve') return T.forklar.proeve;
  if (r.status === 'forfalden') return T.forklar.forfalden;
  return null;
}

const VIST_FAKTURAER = 12;
/** Only https links to Stripe's hosted page; drafts were never sent to the customer. */
const sikkerUrl = (u: string | null): string | null => (u && /^https:\/\//.test(u) ? u : null);

function fakturaListe(f: Faktura[] | 'fejl'): Markup {
  if (f === 'fejl') return html`<section><h2>${T.fakturaTitel}</h2><p class="daempet">${T.fakturaFejl}</p></section>`;
  const vist = f.filter((x) => x.status !== 'draft').sort((x, y) => y.oprettet.getTime() - x.oprettet.getTime()).slice(0, VIST_FAKTURAER);
  if (!vist.length) return html`<section><h2>${T.fakturaTitel}</h2><p class="daempet">${T.fakturaIngen}</p></section>`;
  return html`<section><h2>${T.fakturaTitel}</h2><ul class="liste">${vist.map((x) => {
    const url = sikkerUrl(x.url);
    return html`<li><span>${T.dato(x.oprettet.toISOString())}${x.nummer ? html` · ${x.nummer}` : ''}<br><small>${T.fakturaBeloeb(x.beloeb, x.valuta)} · ${T.fakturaStatus(x.status)}</small></span>${url ? html`<a href="${url}">${T.fakturaSe}</a>` : ''}</li>`;
  })}</ul></section>`;
}

/** The Abonnement page (KC-0191, KC-0195): plan, state with its date, one button to Stripe's Portal, the owner's actions,
 *  and the last invoices. `laeser`: a household member's read-only view ("Spørg ejeren"); `fakturaer` is left out when
 *  the account has no Stripe customer. Shows the entitlement the webhook wrote, never anything from the query string. */
export function statusSide(a: { csrf: string; rettighed: Rettighed; priser: Priser; overGraense: { antal: number; max: number; plan: string; forslag: string | null } | null; portal: boolean; handlinger?: Handling[]; fakturaer?: Faktura[] | 'fejl'; laeser?: boolean }): string {
  const r = a.rettighed;
  const { plan, tekst } = kontoResume(r, a.priser);
  const o = a.overGraense;
  const mere = forklaring(r);
  const ejer = !a.laeser;
  return side(T.abonnementTitel, html`<h1>${T.abonnementTitel}</h1>
<section>
<h2>${plan}</h2>
<p>${tekst}</p>
${mere && ejer ? html`<p class="daempet">${mere}</p>` : ''}
${a.laeser ? html`<p class="daempet">${T.spoergEjeren}</p>` : ''}
</section>
${o ? html`<div class="kort"><p>${T.overGraense(o.antal, o.max, o.plan, o.forslag)}</p></div>` : ''}
${a.portal && ejer ? html`<form method="post" action="/api/abonnement/portal">${csrfFelt(a.csrf)}<button type="submit" class="primaer">${T.portalKnap}</button></form>
<p><small>${T.portalHint}</small></p>` : ''}
${ejer && a.handlinger?.length ? html`<section><ul class="liste">${a.handlinger.map((h) => html`<li><a href="${h.href}">${h.tekst}</a></li>`)}</ul></section>` : ''}
${ejer && a.fakturaer !== undefined ? fakturaListe(a.fakturaer) : ''}
${tilbage()}`, { csrf: a.csrf });
}

export function beskedSide(titel: string, tekst: string, link: { href: string; tekst: string } = { href: '/konto', tekst: T.tilbage }): string {
  return side(titel, html`<h1>${titel}</h1>
<p>${tekst}</p>
<p><a href="${link.href}">${link.tekst}</a></p>`);
}

export function ejerSide(): string {
  return beskedSide(T.ejerTitel, T.ejerTekst);
}

/** Development only: stands in for Stripe's hosted page (KC-0191 browser check without a key). */
export function devCheckoutSide(a: { id: string; plan: string; proeveDage: number | null; afbrydUrl: string }): string {
  return side(T.devTitel, html`<h1>${T.devTitel}</h1>
<p>${T.devTekst}</p>
<section><h2>${a.plan}</h2><p>${a.proeveDage ? T.status.proeve(null) : T.tilBetaling}</p></section>
<form method="post" action="/dev/stripe/checkout/${a.id}">
<button type="submit" class="primaer" data-dev-start>${T.devKnap}</button>
</form>
<p><a href="${a.afbrydUrl}">${T.devAfbryd}</a></p>`);
}
