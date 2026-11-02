// KC-0088: the next appointment today as one quiet line at the top of Hjem:
// "Næste: Havvind Nord kl. 14.00 · om 3 t 50 min" ("nu" while it runs). Pure:
// `now` is injected (the test world has its own clock). public/naeste.js keeps
// the "om …" text fresh between page loads with the same wording; its test
// compares the two.

import { html, type Markup } from './html.ts';
import { klokke } from './friskhed.ts';

/** One appointment as instants (ISO); `slut` is absent when the calendar gave no end. */
export type Naeste = { titel: string; start: string; slut?: string };

/** The countdown: "om 25 min", "om 3 t 50 min", "nu" while it runs, null once it is over. */
export function omTekst(start: number, slut: number | undefined, nu: number): string | null {
  if (nu >= start) return slut !== undefined && nu < slut ? 'nu' : null;
  const min = Math.ceil((start - nu) / 60_000); // seconds left still count as the minute they are part of
  if (min < 60) return `om ${min} min`;
  const t = Math.floor(min / 60);
  const m = min % 60;
  return m ? `om ${t} t ${m} min` : `om ${t} t`;
}

/** Hjem shows people by name, never by address: drop address-like words from a title. */
export function udenMail(tekst: string): string {
  return tekst.replace(/\s*[(<[]?[^\s@()<>[\]]+@[^\s@()<>[\]]+[)>\]]?/g, '').trim();
}

/** The line, or empty markup when there is nothing left to show (over, or an unreadable time). */
export function naesteLinje(n: Naeste, now: Date): Markup {
  const start = Date.parse(n.start);
  const slut = n.slut ? Date.parse(n.slut) : NaN;
  if (Number.isNaN(start)) return html``;
  const om = omTekst(start, Number.isNaN(slut) ? undefined : slut, now.getTime());
  const titel = udenMail(n.titel);
  if (om === null || !titel) return html``;
  return html`<p class="naeste" data-naeste data-start="${start}"${Number.isNaN(slut) ? '' : html` data-slut="${slut}"`}>Næste: <span class="naeste-titel">${titel}</span> kl. ${klokke(new Date(start))} · <span class="naeste-om">${om}</span></p>`;
}
