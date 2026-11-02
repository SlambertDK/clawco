// The account pages (KC-0177): pure functions, state in, HTML out. Danish, dark by default, every
// piece of user text through html`` (sky/src/delt/html.ts); strings live in tekster.ts.
import { html, type Markup } from '../delt/html.ts';
import { side } from '../delt/side.ts';
import type { Besked } from '../delt/post.ts';
import { T } from './tekster.ts';
import type { SessionVisning } from './session.ts';
import type { PasskeyVisning } from './passkey.ts';
import type { SletOversigt } from './slet.ts';
import { svartid, type HjaelpMail } from './hjaelp.ts';

export { CSS } from '../delt/side.ts';

const tid = (d: Date): string => d.toLocaleString('da-DK', { timeZone: 'Europe/Copenhagen', dateStyle: 'medium', timeStyle: 'short' });

const csrfFelt = (csrf: string): Markup => html`<input type="hidden" name="csrf" value="${csrf}">`;

export function logIndSide(a: { til?: string }): string {
  return side(T.logIndTitel, html`<h1>${T.logIndTitel}</h1>
<p>${T.logIndIntro}</p>
<button type="button" class="primaer" data-passkey-login data-til="${a.til ?? '/konto'}" data-fejl="${T.passkeyFejl}" data-ikke-understoettet="${T.passkeyIkkeUnderstoettet}">${T.logIndPasskey}</button>
<p class="status" data-status aria-live="polite"></p>
<section>
<h2>${T.logIndEllerMail}</h2>
<form method="post" action="/log-ind/link">
${a.til && a.til !== '/konto' ? html`<input type="hidden" name="til" value="${a.til}">` : ''}
<label for="email">${T.emailFelt}</label>
<input id="email" type="email" name="email" autocomplete="username webauthn" required maxlength="254">
<button type="submit">${T.sendLink}</button>
</form>
<p><small>${T.nyKontoNote}</small></p>
</section>`, { script: true });
}

export function tjekMailSide(): string {
  return side(T.tjekMailTitel, html`<h1>${T.tjekMailTitel}</h1>
<p>${T.tjekMailTekst}</p>
<p><a href="/log-ind">${T.tilbage}</a></p>`);
}

/** GET of the mail link: shows a button; only its POST uses the link up (mail scanners only GET). */
export function linkSide(a: { token: string; gyldig: boolean; afvist?: boolean; nytLink?: string }): string {
  if (!a.gyldig) {
    return side(T.linkDoedTitel, html`<h1>${T.linkDoedTitel}</h1>
<p>${a.afvist ? T.linkAfvistTekst : T.linkDoedTekst}</p>
<p><a href="${a.nytLink ?? '/log-ind'}">${T.bedOmNyt}</a></p>`);
  }
  return side(T.linkTitel, html`<h1>${T.linkTitel}</h1>
<p>${T.linkTekst}</p>
<form method="post" action="/log-ind/link/bekraeft">
<input type="hidden" name="t" value="${a.token}">
<button type="submit" class="primaer">${T.linkKnap}</button>
</form>`);
}

/** Where the account's own Clawco is (KC-0182): its address once klar, a waiting line while it is made. */
export type ClawcoVisning = { url: string } | { venter: true } | null;

/** KC-0201: "Få hjælp" on the account page: the mailto (built by hjaelp.ts) and where its text can be read first. */
export type HjaelpLink = { mailto: string };

export function kontoSide(a: { email: string; csrf: string; passkeyAntal: number; sessioner: SessionVisning[]; nuvaerendeId: number; abonnement?: { plan: string; tekst: string }; clawco?: ClawcoVisning; hjaelp?: HjaelpLink }): string {
  const sessioner = a.sessioner.map((s) => html`<li><span>${s.enhed || '?'} <small>· ${s.metode === 'passkey' ? T.metodePasskey : T.metodeLink} · ${T.sidstSet} ${tid(s.sidstSet)}</small></span>${s.id === a.nuvaerendeId
    ? html`<small>${T.denneEnhed}</small>`
    : html`<form method="post" action="/konto/sessioner/${s.id}/afslut" class="inline">${csrfFelt(a.csrf)}<button type="submit" class="lille">${T.logUdHer}</button></form>`}</li>`);
  return side(T.kontoTitel, html`<h1>${T.kontoTitel}</h1>
<p>${a.email}</p>
${a.clawco ? ('url' in a.clawco ? html`<p class="besked">${T.clawcoKlar} <a href="${a.clawco.url}">${a.clawco.url}</a></p>` : html`<p class="besked">${T.clawcoVenter}</p>`) : ''}
${a.passkeyAntal === 0 ? html`<div class="kort"><p>${T.tilfoejPasskeyTilbud}</p><a href="/konto/passkeys">${T.tilfoejPasskey}</a></div>` : ''}
${a.abonnement ? html`<section>
<h2>${T.abonnementTitel}</h2>
<p>${a.abonnement.plan} <small>· ${a.abonnement.tekst}</small></p>
<p><a href="/konto/abonnement">${T.abonnementLink}</a></p>
</section>` : ''}
<section>
<h2>${T.passkeysTitel}</h2>
<p>${T.passkeysAntal(a.passkeyAntal)} · <a href="/konto/passkeys">${T.seOgFjern}</a></p>
</section>
<section>
<h2>${T.sessionerTitel}</h2>
<ul class="liste">${sessioner}</ul>
</section>
<section>
<h2>${T.dataTitel}</h2>
<p><a href="/konto/hent-alt">${T.dataLink}</a></p>
</section>
${a.hjaelp ? html`<section>
<h2>${T.hjaelpTitel}</h2>
<p><a href="${a.hjaelp.mailto}">${T.hjaelpKnap}</a> · <a href="/konto/hjaelp">${T.hjaelpSe}</a></p>
<p class="daempet">${svartid('da')}</p>
</section>` : ''}
<form method="post" action="/log-ud">${csrfFelt(a.csrf)}<button type="submit">${T.logUd}</button></form>
<h2>${T.sletTitel}</h2>
<p><a href="/konto/slet">${T.sletLink}</a></p>`, { csrf: a.csrf });
}

function ikkeFrisk(til: string): Markup {
  return html`<div class="kort"><p>${T.ikkeFrisk}</p><a href="/log-ind?til=${til}">${T.logIndIgen}</a></div>`;
}

export function passkeySide(a: { csrf: string; frisk: boolean; passkeys: PasskeyVisning[]; besked?: string }): string {
  const liste = a.passkeys.map((p) => html`<li><span>${p.navn} <small>· ${T.oprettet} ${tid(p.oprettet)} · ${p.sidstBrugt ? html`${T.sidstBrugt} ${tid(p.sidstBrugt)}` : T.aldrigBrugt}</small></span>${a.frisk
    ? html`<form method="post" action="/konto/passkeys/${p.id}/fjern" class="inline">${csrfFelt(a.csrf)}<button type="submit" class="lille fare">${T.fjern}</button></form>`
    : ''}</li>`);
  return side(T.passkeysTitel, html`<h1>${T.passkeysTitel}</h1>
<p class="daempet">${T.passkeysIntro}</p>
${a.besked ? html`<p class="besked">${a.besked}</p>` : ''}
<section>${a.passkeys.length ? html`<ul class="liste">${liste}</ul>` : html`<p>${T.ingenPasskeys}</p>`}</section>
${a.frisk ? html`<section>
<label for="navn">${T.navnFelt}</label>
<input id="navn" type="text" maxlength="60" data-passkey-navn>
<button type="button" class="primaer" data-passkey-ny data-fejl="${T.passkeyFejl}" data-ikke-understoettet="${T.passkeyIkkeUnderstoettet}">${T.tilfoejPasskey}</button>
<p class="status" data-status aria-live="polite"></p>
</section>` : ikkeFrisk('/konto/passkeys')}
<p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf, script: true });
}

export function sletSide(a: { csrf: string; frisk: boolean; oversigt: SletOversigt; fejl?: string }): string {
  const o = a.oversigt;
  const ender = o.rolle === 'ejer' ? html`<li>${T.sletEjer}</li><li>${T.sletEjerInviterede}</li>`
    : o.rolle === 'medlem' ? html`<li>${T.sletMedlem}</li>` : html`<li>${T.sletAlene}</li>`;
  return side(T.sletTitel, html`<h1>${T.sletTitel}</h1>
<p>${T.sletIntro}</p>
<ul>${ender}</ul>
${o.medlemmer.length ? html`<div class="kort"><p>${T.sletMedlemmer}</p><ul>${o.medlemmer.map((m) => html`<li>${m}</li>`)}</ul></div>` : ''}
<p><a href="/konto/hent-alt">${T.hentAlt}</a></p>
${a.fejl ? html`<p class="status">${a.fejl}</p>` : ''}
${a.frisk ? html`<form method="post" action="/konto/slet">
${csrfFelt(a.csrf)}
<label for="email">${T.sletBekraeftFelt}</label>
<input id="email" type="email" name="email" required autocomplete="off" placeholder="${o.email}">
<button type="submit" class="fare">${T.sletKnap}</button>
</form>` : ikkeFrisk('/konto/slet')}
<p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf });
}

/** KC-0201: the text the "Få hjælp" mail will carry, shown before anything is sent (the button is a plain mailto:). */
export function hjaelpVisning(a: { mail: HjaelpMail; hjaelpSide?: string }): string {
  return side(T.hjaelpKnap, html`<h1>${T.hjaelpKnap}</h1>
<p>${T.hjaelpIntro}</p>
<h2>${T.hjaelpTekstTitel}</h2>
<pre class="kort">${a.mail.tekst.replace(/\r\n/g, '\n')}</pre>
<p><a class="knap primaer" href="${a.mail.mailto}">${T.hjaelpSend}</a></p>
<p class="daempet">${svartid('da')}</p>
${a.hjaelpSide ? html`<p><a href="${a.hjaelpSide}">${T.hjaelpSide}</a></p>` : ''}
<p><a href="/konto">${T.tilbage}</a></p>`);
}

export function slettetSide(): string {
  return side(T.slettetTitel, html`<h1>${T.slettetTitel}</h1>
<p>${T.slettetTekst}</p>`);
}

// --- KC-0206: Hent alt -------------------------------------------------------------------------------
export function hentAltSide(a: { csrf: string; frisk: boolean }): string {
  return side(T.hentAltTitel, html`<h1>${T.hentAltTitel}</h1>
<p>${T.hentAltIntro}</p>
<p class="daempet">${T.hentAltNoegler}</p>
${a.frisk ? html`<form method="post" action="/konto/hent-alt">${csrfFelt(a.csrf)}<button type="submit" class="primaer">${T.hentAltKnap}</button></form>` : ikkeFrisk('/konto/hent-alt')}
<p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf });
}

export function hentAltKlarSide(a: { csrf: string; link: string; udloeber: Date }): string {
  return side(T.hentAltKlarTitel, html`<h1>${T.hentAltKlarTitel}</h1>
<p>${T.hentAltKlarTekst}</p>
<p><a class="knap primaer" href="${a.link}" download>${T.hentAltHent}</a></p>
<p class="daempet">${T.hentAltVirkerTil} ${tid(a.udloeber)}</p>
<p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf });
}

export function hentAltDoedSide(): string {
  return side(T.hentAltDoedTitel, html`<h1>${T.hentAltDoedTitel}</h1>
<p>${T.hentAltDoedTekst}</p>
<p><a href="/konto/hent-alt">${T.hentAltNyt}</a></p>`);
}

export function hentAltFejlSide(): string {
  return side(T.hentAltFejlTitel, html`<h1>${T.hentAltFejlTitel}</h1>
<p>${T.hentAltFejlTekst}</p>
<p><a href="/konto/hent-alt">${T.tilbage}</a></p>`);
}

/** One screen of the dev gallery (konto/eksempler.ts): the export view and the delete confirmation in each state. */
export type KontoEksempel =
  | { side: 'hent-alt'; a: Parameters<typeof hentAltSide>[0] }
  | { side: 'hent-alt-klar'; a: Parameters<typeof hentAltKlarSide>[0] }
  | { side: 'hent-alt-doed' }
  | { side: 'hent-alt-fejl' }
  | { side: 'slet'; a: Parameters<typeof sletSide>[0] }
  | { side: 'slettet' };

export function renderEksempel(e: KontoEksempel): string {
  switch (e.side) {
    case 'hent-alt': return hentAltSide(e.a);
    case 'hent-alt-klar': return hentAltKlarSide(e.a);
    case 'hent-alt-doed': return hentAltDoedSide();
    case 'hent-alt-fejl': return hentAltFejlSide();
    case 'slet': return sletSide(e.a);
    case 'slettet': return slettetSide();
  }
}

export function galleriSide(navne: string[]): string {
  return side('Kontoens skærme (kun udvikling)', html`<h1>Kontoens skærme (kun udvikling)</h1>
<ul class="liste">${navne.map((n) => html`<li><a href="/dev/konto/${n}">${n}</a></li>`)}</ul>`);
}

export function udbakkeSide(beskeder: Besked[]): string {
  const liste = [...beskeder].reverse().map((b) => html`<li><span>${b.til} <small>· ${b.skabelon}</small></span>${b.data['link'] ? html`<a href="${b.data['link']}" data-link>${b.data['link']}</a>` : ''}</li>`);
  return side(T.udbakkeTitel, html`<h1>${T.udbakkeTitel}</h1>
<section>${beskeder.length ? html`<ul class="liste">${liste}</ul>` : html`<p>${T.udbakkeTom}</p>`}</section>`);
}
