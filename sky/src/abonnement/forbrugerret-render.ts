// The consumer-rights pages (KC-0209): the statement before the pay button, "Opsig" and "Fortryd aftale" with their
// confirmation steps and results. Pure: state in, HTML out, Danish or English, dark (delt/side.ts), every value
// through html``. The words are in forbrugerret-tekster.ts; the amounts, dates and price lines from forbrugerret.ts,
// built from the one price file.
import { html, type Markup } from '../delt/html.ts';
import { side } from '../delt/side.ts';
import type { IntervalNavn } from './opsaet.ts';
import type { Valuta } from './valuta.ts';
import { F } from './forbrugerret-tekster.ts';
import { FELT, FRIST_DAGE, beloeb, dato, foerstePeriode, hverPeriode, prisLinjeAf, tidspunkt, type Sprog } from './forbrugerret.ts';

const csrfFelt = (csrf: string): Markup => html`<input type="hidden" name="csrf" value="${csrf}">`;

export type Bekraeft = {
  sprog: Sprog;
  csrf: string;
  plan: { id: string; navn: string; medlemmer: number };
  interval: IntervalNavn;
  land: string;
  /** In øre or cent, from config/priser.json, in the currency of the account's country (KC-0194). */
  prisOere: number;
  valuta: Valuta;
  /** KC-0194 (G6): config moms.aktiv; while false the page never mentions VAT. */
  moms: boolean;
  proeve: boolean;
  proeveDage: number;
  vilkaar: { version: string; url: string };
  retur: 'konto' | 'tilmelding';
  /** Where "change my choice" leads. */
  tilbage: string;
  fejl?: 'mangler' | 'aendret';
};

/** The statement before the pay button: what is bought, the full price in the account's currency, period, renewal, the right of withdrawal,
 *  the two unticked boxes and a button that says what it does. */
export function bekraeftSide(a: Bekraeft): string {
  const t = F[a.sprog];
  const b = beloeb(a.prisOere, a.sprog, a.valuta);
  const knap = a.proeve ? t.knapProeve(a.proeveDage) : t.knapBetal(b);
  return side(a.proeve ? t.bekraeftTitelProeve : t.bekraeftTitel, html`<h1>${a.proeve ? t.bekraeftTitelProeve : t.bekraeftTitel}</h1>
${a.fejl ? html`<p class="status">${a.fejl === 'mangler' ? t.mangler : t.aendret}</p>` : ''}
<section><h2>${t.ydelseTitel}</h2><p>${t.ydelse(a.plan.navn, t.medlemmer(a.plan.medlemmer))}</p></section>
<section><h2>${t.prisTitel}</h2><p>${t.pris(prisLinjeAf(a.prisOere, a.interval, a.sprog, a.valuta), a.moms)}</p></section>
<section><h2>${t.periodeTitel}</h2><p>${a.proeve ? t.periodeProeve(a.proeveDage) : t.periodeBetaling(b, foerstePeriode(a.interval, a.sprog))}</p></section>
<section><h2>${t.fornyelseTitel}</h2><p>${t.fornyelse(b, hverPeriode(a.interval, a.sprog))}</p></section>
<section><h2>${t.fortrydTitel}</h2><p>${t.fortryd(FRIST_DAGE)}</p><p><a href="${a.vilkaar.url}" target="_blank" rel="noopener">${t.vilkaarSe}</a></p></section>
<form method="post" action="/api/abonnement/checkout">
${csrfFelt(a.csrf)}
<input type="hidden" name="plan" value="${a.plan.id}">
<input type="hidden" name="interval" value="${a.interval}">
<input type="hidden" name="land" value="${a.land}">
<input type="hidden" name="retur" value="${a.retur}">
<input type="hidden" name="pris" value="${a.prisOere}">
<input type="hidden" name="proeve" value="${a.proeve ? '1' : '0'}">
<fieldset><legend>${t.samtykkeTitel}</legend>
<label class="flueben"><input type="checkbox" name="${FELT.vilkaar}" value="${a.vilkaar.version}" required><span>${t.vilkaarFoer}<a href="${a.vilkaar.url}" target="_blank" rel="noopener">${t.vilkaarLink}</a>${t.vilkaarVersion(a.vilkaar.version)}</span></label>
<label class="flueben"><input type="checkbox" name="${FELT.straks}" value="ja" required><span>${t.straks}<br><small>${t.straksNote}</small></span></label>
</fieldset>
<button type="submit" class="primaer">${knap}</button>
</form>
<p><a href="${a.tilbage}">${t.retValg}</a></p>`, { csrf: a.csrf, sprog: a.sprog });
}

/** A one-message page in the person's language, with a way back to the account. */
export function besked(sprog: Sprog, titel: string, tekst: string, o: { fejl?: boolean } = {}): string {
  const t = F[sprog];
  return side(titel, html`<h1>${titel}</h1>
<p class="${o.fejl ? 'status' : ''}">${tekst}</p>
<p><a href="/konto">${t.tilKonto}</a></p>`, { sprog });
}

export function opsigSide(a: { sprog: Sprog; csrf: string; slutter: Date }): string {
  const t = F[a.sprog];
  return side(t.opsigTitel, html`<h1>${t.opsigTitel}</h1>
<p>${t.opsigIntro(dato(a.slutter, a.sprog))}</p>
<form method="post" action="/api/abonnement/opsig">${csrfFelt(a.csrf)}<button type="submit" class="fare">${t.opsigKnap}</button></form>
<p><a href="/konto">${t.opsigBehold}</a></p>`, { csrf: a.csrf, sprog: a.sprog });
}

export const opsagtSide = (sprog: Sprog, slutter: Date, mail: boolean): string =>
  besked(sprog, F[sprog].opsagtTitel, mail ? F[sprog].opsagtTekst(dato(slutter, sprog)) : F[sprog].opsagtMailFejl(dato(slutter, sprog)));

export const opsagtAlleredeSide = (sprog: Sprog, slutter: Date): string =>
  besked(sprog, F[sprog].opsagtAlleredeTitel, F[sprog].opsagtAlleredeTekst(dato(slutter, sprog)));

export const intetAtOpsigeSide = (sprog: Sprog): string => besked(sprog, F[sprog].intetAtOpsigeTitel, F[sprog].intetAtOpsigeTekst);

export type FortrydVisning = {
  sprog: Sprog;
  csrf: string;
  frist: Date;
  proeve: boolean;
  brugteDage: number;
  periodeDage: number;
  beholdOere: number;
  tilbageOere: number;
  /** The currency the order was paid in (KC-0194). */
  valuta: Valuta;
};

/** The "Fortryd aftale" confirmation: the last day, what is paid for the days used and what comes back, the promise
 *  to refund within 14 days, and one button. */
export function fortrydSide(a: FortrydVisning): string {
  const t = F[a.sprog];
  return side(t.fortrydSideTitel, html`<h1>${t.fortrydSideTitel}</h1>
<p>${t.fortrydIntro(dato(a.frist, a.sprog))}</p>
<p>${a.proeve ? t.fortrydProeve : t.fortrydBeloeb(beloeb(a.beholdOere, a.sprog, a.valuta), a.brugteDage, a.periodeDage, beloeb(a.tilbageOere, a.sprog, a.valuta))}</p>
${a.proeve ? '' : html`<p><strong>${t.fortrydTilbage}</strong></p>`}
<form method="post" action="/api/abonnement/fortryd">${csrfFelt(a.csrf)}<button type="submit" class="fare">${t.fortrydKnap}</button></form>
<p><a href="/konto">${t.fortrydBehold}</a></p>`, { csrf: a.csrf, sprog: a.sprog });
}

export function fortrudtSide(a: { sprog: Sprog; tid: Date; tilbageOere: number; mail: boolean }): string {
  const t = F[a.sprog];
  const tid = tidspunkt(a.tid, a.sprog);
  return side(t.fortrudtTitel, html`<h1>${t.fortrudtTitel}</h1>
<p>${a.mail ? t.fortrudtTekst(tid) : t.fortrudtMailFejl(tid)}</p>
${a.tilbageOere > 0 ? html`<p><strong>${t.fortrydTilbage}</strong></p>` : ''}
<p><a href="/konto">${t.tilKonto}</a></p>`, { sprog: a.sprog });
}

export const fortrudtAlleredeSide = (sprog: Sprog, tid: Date): string => besked(sprog, F[sprog].fortrudtAlleredeTitel, F[sprog].fortrudtAlleredeTekst(tidspunkt(tid, sprog)));
export const fortrydUdloebetSide = (sprog: Sprog, frist: Date): string => besked(sprog, F[sprog].fortrydUdloebetTitel, F[sprog].fortrydUdloebetTekst(dato(frist, sprog)));
export const fortrydIntetSide = (sprog: Sprog): string => besked(sprog, F[sprog].fortrydIntetTitel, F[sprog].fortrydIntetTekst);
