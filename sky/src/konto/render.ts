// The account pages (KC-0177): pure functions, state in, HTML out. Danish, dark by default, every
// piece of user text through html`` (sky/src/delt/html.ts); strings live in tekster.ts.
import { html, type Markup } from '../delt/html.ts';
import { side } from '../delt/side.ts';
import type { Besked } from '../delt/post.ts';
import { T, AFMELD } from './tekster.ts';
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

export function kontoSide(a: { email: string; csrf: string; passkeyAntal: number; sessioner: SessionVisning[]; nuvaerendeId: number; abonnement?: { plan: string; tekst: string; handlinger?: { href: string; tekst: string }[] }; clawco?: ClawcoVisning; hjaelp?: HjaelpLink; husstand?: boolean }): string {
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
${a.abonnement.handlinger?.length ? html`<ul class="liste">${a.abonnement.handlinger.map((h) => html`<li><a href="${h.href}">${h.tekst}</a></li>`)}</ul>` : ''}
</section>` : ''}
${a.husstand ? html`<section>
<h2>${T.husstandTitel}</h2>
<p><a href="/konto/husstand" data-husstand>${T.husstandLink}</a></p>
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
<section>
<h2>${T.mailsTitel}</h2>
<p><a href="/konto/mails">${T.mailsLink}</a></p>
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

// --- KC-0200: which mails the account gets, and the tips mail's unsubscribe link ---------------------------------
export function mailsSide(a: { csrf: string; tips: boolean; gemt: boolean }): string {
  const valg = (v: 'ja' | 'nej', tekst: string, valgt: boolean): Markup =>
    valgt ? html`<label><input type="radio" name="tips" value="${v}" checked> ${tekst}</label>` : html`<label><input type="radio" name="tips" value="${v}"> ${tekst}</label>`;
  return side(T.mailsTitel, html`<h1>${T.mailsTitel}</h1>
<p>${T.mailsIntro}</p>
${a.gemt ? html`<p class="besked">${T.mailsGemt}</p>` : ''}
<form method="post" action="/konto/mails">${csrfFelt(a.csrf)}
<fieldset><legend>${T.mailsTips}</legend>
<p>${valg('ja', T.mailsJa, a.tips)}</p>
<p>${valg('nej', T.mailsNej, !a.tips)}</p>
</fieldset>
<button type="submit" class="primaer">${T.mailsGem}</button>
</form>
<p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf });
}

export type AfmeldTilstand = 'spoerg' | 'faerdig' | 'ugyldig';

/** `handling`: this page's own path and query (the token stays in the form's target, never in a field). */
export function afmeldSide(a: { sprog: 'da' | 'en'; tilstand: AfmeldTilstand; handling?: string }): string {
  const t = AFMELD[a.sprog];
  const konto = html`<p><a href="/konto/mails">${t.fortrydLink}</a></p>`;
  if (a.tilstand === 'ugyldig') return side(t.ugyldigTitel, html`<h1>${t.ugyldigTitel}</h1><p>${t.ugyldig}</p>${konto}`, { sprog: a.sprog });
  if (a.tilstand === 'faerdig') return side(t.faerdigTitel, html`<h1>${t.faerdigTitel}</h1><p>${t.faerdig}</p>${konto}`, { sprog: a.sprog });
  return side(t.titel, html`<h1>${t.titel}</h1>
<p>${t.tekst}</p>
<form method="post" action="${a.handling ?? ''}"><button type="submit" class="primaer">${t.knap}</button></form>`, { sprog: a.sprog });
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

// --- KC-0184: the household ------------------------------------------------------------------------
export type HusstandFelter = { email?: string; navn?: string; rolle?: string; inviterer?: string };
export type HusstandVisning =
  | { art: 'ejer'; url: string; medlemmer: { kontoId: number; email: string; navn: string; rolle: string }[]; invitationer: { id: number; email: string; navn: string; rolle: string; udloeber: Date }[]; pladser: { brugt: number; max: number }; felter: HusstandFelter }
  | { art: 'medlem'; url: string | null; rolle: string; navn: string }
  | { art: 'ingen' };

const ROLLER = ['medlem', 'barn', 'gaest'] as const;
const rolleNavn = (r: string): string => T.rolle[r] ?? r;

function rolleValg(navn: string, valgt: string | undefined, id?: string): Markup {
  return html`<select name="${navn}"${id ? html` id="${id}"` : ''}>${ROLLER.map((r) => html`<option value="${r}"${r === (valgt ?? 'medlem') ? html` selected` : ''}>${rolleNavn(r)}</option>`)}</select>`;
}

export function husstandSide(a: { csrf: string; visning: HusstandVisning; besked?: string; fejl?: string }): string {
  const v = a.visning;
  const top = html`<h1>${T.husstandTitel}</h1>
${a.besked ? html`<p class="besked" data-besked>${a.besked}</p>` : ''}
${a.fejl ? html`<p class="status" data-fejl>${a.fejl}</p>` : ''}`;
  if (v.art === 'ingen') return side(T.husstandTitel, html`${top}<p>${T.husstandIngen}</p><p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf });
  if (v.art === 'medlem') {
    return side(T.husstandTitel, html`${top}
${v.url ? html`<p class="besked">${T.husstandDinClawco} <a href="${v.url}" data-clawco>${v.url}</a></p>` : ''}
<p>${T.husstandDinRolle} <strong data-rolle>${rolleNavn(v.rolle)}</strong></p>
<section>
<h2>${T.husstandForlad}</h2>
<p class="daempet">${T.husstandForladTekst}</p>
<form method="post" action="/konto/husstand/forlad">${csrfFelt(a.csrf)}<button type="submit" class="fare">${T.husstandForlad}</button></form>
</section>
<p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf });
  }
  const fuld = v.pladser.brugt >= v.pladser.max;
  const medlemmer = v.medlemmer.map((m) => html`<li data-medlem="${m.email}"><span>${m.navn} <small>· ${m.email} · ${rolleNavn(m.rolle)}</small></span>
<form method="post" action="/konto/husstand/medlemmer/${String(m.kontoId)}/rolle" class="inline">${csrfFelt(a.csrf)}${rolleValg('rolle', m.rolle)}<button type="submit" class="lille">${T.husstandGemRolle}</button></form>
<form method="post" action="/konto/husstand/medlemmer/${String(m.kontoId)}/fjern" class="inline">${csrfFelt(a.csrf)}<button type="submit" class="lille fare" data-fjern>${T.husstandFjern}</button></form></li>`);
  const ventende = v.invitationer.map((i) => html`<li data-invitation="${i.email}"><span>${i.navn} <small>· ${i.email} · ${rolleNavn(i.rolle)} · ${T.husstandUdloeber} ${tid(i.udloeber)}</small></span>
<form method="post" action="/konto/husstand/invitationer/${String(i.id)}/igen" class="inline">${csrfFelt(a.csrf)}<button type="submit" class="lille">${T.husstandSendIgen}</button></form>
<form method="post" action="/konto/husstand/invitationer/${String(i.id)}/annuller" class="inline">${csrfFelt(a.csrf)}<button type="submit" class="lille fare">${T.husstandAnnuller}</button></form></li>`);
  return side(T.husstandTitel, html`${top}
<p class="besked">${T.husstandDinClawco} <a href="${v.url}" data-clawco>${v.url}</a></p>
<section>
<h2>${T.husstandMedlemmerTitel}</h2>
<ul class="liste"><li><span>${T.husstandDu}</span></li>${medlemmer}</ul>
${v.medlemmer.length === 0 ? html`<p class="daempet">${T.husstandKunDig}</p>` : ''}
</section>
${ventende.length ? html`<section><h2>${T.husstandVentendeTitel}</h2><ul class="liste">${ventende}</ul></section>` : ''}
<section>
<h2>${T.husstandInviterTitel}</h2>
<p class="daempet" data-pladser>${T.husstandPladser(v.pladser.brugt, v.pladser.max)}</p>
${fuld ? html`<p class="status" data-fuld>${T.husstandFuld(v.pladser.max)}</p>` : html`<p>${T.husstandInviterIntro}</p>
<form method="post" action="/konto/husstand/inviter" data-inviter>
${csrfFelt(a.csrf)}
<label for="email">${T.husstandEmailFelt}</label>
<input id="email" type="email" name="email" required maxlength="254" autocomplete="off" value="${v.felter.email ?? ''}">
<label for="navn">${T.husstandNavnFelt}</label>
<input id="navn" type="text" name="navn" required maxlength="80" autocomplete="off" value="${v.felter.navn ?? ''}">
<label for="rolle">${T.husstandRolleFelt}</label>
${rolleValg('rolle', v.felter.rolle, 'rolle')}
<label for="inviterer">${T.husstandInvitererFelt}</label>
<input id="inviterer" type="text" name="inviterer" required maxlength="60" value="${v.felter.inviterer ?? ''}">
<p class="daempet" data-boern>${T.husstandBoernNote}</p>
<button type="submit" class="primaer">${T.husstandSeMailen}</button>
</form>`}
</section>
<p><a href="/konto">${T.tilbage}</a></p>`, { csrf: a.csrf });
}

/** The exact mail before it is sent (the same render as the send). Send is the owner's own click. */
export function invitationPreviewSide(a: { csrf: string; id: number; token: string; til: string; emne: string; tekst: string }): string {
  return side(T.previewTitel, html`<h1>${T.previewTitel}</h1>
<p>${T.previewIntro}</p>
<div class="kort">
<p><small>${T.previewTil}</small> <span data-til>${a.til}</span></p>
<p><small>${T.previewEmne}</small> <span data-emne>${a.emne}</span></p>
<pre class="kort" data-mail>${a.tekst.replace(/\r\n/g, '\n')}</pre>
</div>
<form method="post" action="/konto/husstand/inviter/send">
${csrfFelt(a.csrf)}
<input type="hidden" name="id" value="${String(a.id)}">
<input type="hidden" name="t" value="${a.token}">
<button type="submit" class="primaer" data-send>${T.previewSend}</button>
</form>
<p><a href="/konto/husstand">${T.previewRet}</a></p>`, { csrf: a.csrf });
}

export type InvitationTilstand =
  | { art: 'log-ind'; til: string }
  | { art: 'aaben'; csrf: string; token: string; inviterer: string; rolle: string }
  | { art: 'med'; url: string | null }
  | { art: 'nej'; tekst: string };

/** The invited person's page (/invitation?t=…): reading it never spends the link; only its POST accepts. */
export function invitationSide(a: InvitationTilstand): string {
  const krop = a.art === 'log-ind' ? html`<p>${T.invitationLogInd}</p><p><a class="knap primaer" href="/log-ind?til=${encodeURIComponent(a.til)}" data-log-ind>${T.invitationLogIndKnap}</a></p>`
    : a.art === 'aaben' ? html`<p>${T.invitationTekst(a.inviterer, rolleNavn(a.rolle))}</p>
<form method="post" action="/invitation">${csrfFelt(a.csrf)}<input type="hidden" name="t" value="${a.token}"><button type="submit" class="primaer" data-tag-imod>${T.invitationTagImod}</button></form>`
      : a.art === 'med' ? html`<p class="besked" data-med>${T.invitationMed}</p>${a.url ? html`<p><a class="knap primaer" href="${a.url}" data-clawco>${T.invitationAabn}</a></p>` : ''}`
        : html`<p class="status" data-nej>${a.tekst}</p><p><a href="/konto">${T.tilbage}</a></p>`;
  return side(T.invitationTitel, html`<h1>${T.invitationTitel}</h1>${krop}`, a.art === 'aaben' ? { csrf: a.csrf } : {});
}
