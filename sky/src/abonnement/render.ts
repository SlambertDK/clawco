// The subscription pages (KC-0191): pure functions, state in, HTML out. Danish, dark, every value
// through html`` (sky/src/delt/html.ts); strings in tekster.ts; the shared skeleton in delt/side.ts.
import { html, type Markup } from '../delt/html.ts';
import { side } from '../delt/side.ts';
import type { Priser } from './priser.ts';
import type { IntervalNavn } from './opsaet.ts';
import type { Rettighed } from './rettigheder.ts';
import { LANDE } from './lande.ts';
import { T } from './tekster.ts';

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
<form method="post" action="/api/abonnement/checkout">
${csrfFelt(a.csrf)}
<fieldset><legend>${T.planTitel}</legend>${planValg}</fieldset>
<fieldset><legend>${T.intervalTitel}</legend>${intervalValg}</fieldset>
<label for="land">${T.landFelt}</label>
<select id="land" name="land" required>${lande}</select>
<button type="submit" class="primaer">${a.proeve ? T.startProeve : T.tilBetaling}</button>
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
export function kontoResume(r: Rettighed, priser: Priser): { plan: string; tekst: string } {
  const navn = priser.planer[r.plan]?.navn;
  if (!navn) return { plan: T.status.ingen, tekst: T.kontoResumeIngen };
  return { plan: r.kilde === 'gave' ? `${navn} · ${T.gave}` : navn, tekst: [statusLinje(r), r.opsiges ? T.opsiges(r.opsiges) : null].filter(Boolean).join(' · ') };
}

export function statusSide(a: { csrf: string; rettighed: Rettighed; priser: Priser; overGraense: { antal: number; max: number; plan: string; forslag: string | null } | null; portal: boolean }): string {
  const r = a.rettighed;
  const { plan, tekst } = kontoResume(r, a.priser);
  const o = a.overGraense;
  return side(T.abonnementTitel, html`<h1>${T.abonnementTitel}</h1>
<section>
<h2>${plan}</h2>
<p>${tekst}</p>
</section>
${o ? html`<div class="kort"><p>${T.overGraense(o.antal, o.max, o.plan, o.forslag)}</p></div>` : ''}
${a.portal ? html`<form method="post" action="/api/abonnement/portal">${csrfFelt(a.csrf)}<button type="submit">${T.portalKnap}</button></form>` : ''}
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
