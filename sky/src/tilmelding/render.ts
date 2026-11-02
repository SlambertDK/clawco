// The sign-up pages (KC-0198): pure functions, state in, HTML out. One screen per step, one primary button,
// Danish or English, dark (the shared skeleton in delt/side.ts), every value through html``. The step itself is
// decided by trin.ts; these only draw it.
import { html, type Markup } from '../delt/html.ts';
import { side } from '../delt/side.ts';
import type { Samtykke } from './samtykke.ts';
import { TEKSTER, type Tekster } from './tekster.ts';
import { FASER, visningsNoegle, type Visning } from './trin.ts';

export type Sprog = 'da' | 'en';
export type Interval = 'maaned' | 'aar';
/** A plan as the plan step shows it; the server builds these from config/priser.json (amounts in øre and cent). */
export type PlanVisning = { id: string; navn: string; medlemmer: number; maaned: { dkk: number; eur: number }; aar: { dkk: number; eur: number } };

/** What every screen needs: language, the session's CSRF token (null before login), and the mode. */
export type Faelles = { sprog: Sprog; csrf: string | null; tilstand: 'invitation' | 'open'; /** false: a still picture (the dev gallery), no polling */ poll?: boolean;
  /** The public site the legal texts live on (https://clawco.work); the account host serves none (KC-0204). */ sideUrl?: string };

export const STANDARD_SIDE = 'https://clawco.work';

export type SideInput =
  | { visning: { trin: 'konto' }; til: string }
  | { visning: { trin: 'profil' }; lande: readonly string[]; land: string | null; valgtSprog: Sprog | null; samtykke: Samtykke; mangler: boolean; behold: { plan: string | null; interval: Interval | null } }
  | { visning: { trin: 'samtykke' }; samtykke: Samtykke; mangler: boolean }
  | { visning: { trin: 'invitation' }; svar: 'ikke-endnu' | 'ukendt' | null }
  | { visning: { trin: 'plan' }; planer: readonly PlanVisning[]; proeveDage: number; valg: { plan: string | null; interval: Interval | null }; land: string;
      /** KC-0194: the currency of the account's country, and whether prices include VAT (config moms.aktiv). */
      valuta: 'dkk' | 'eur'; moms: boolean; proeve: boolean; afbrudt: boolean }
  | { visning: { trin: 'betaling' }; proeve: boolean; session: string }
  | { visning: Extract<Visning, { trin: 'klargoering' }> }
  | { visning: { trin: 'aabn' }; aabnUrl: string }
  | { visning: { trin: 'abonnement' } }
  | { visning: { trin: 'slettes' } };

const csrfFelt = (csrf: string | null): Markup => html`<input type="hidden" name="csrf" value="${csrf ?? ''}">`;

/** The address of a legal text on the public site, in the page language (/vilkaar, /en/vilkaar). */
const tekstUrl = (f: Faelles, sti: string): string => `${f.sideUrl ?? STANDARD_SIDE}${f.sprog === 'en' ? '/en' : ''}${sti}`;

/** "Trin 2 af 5 · Plan": konto → plan (or invitation) → betaling → klargøring → åbn. */
function trinLinje(t: Tekster, v: Visning, tilstand: Faelles['tilstand']): Markup {
  const plan = tilstand === 'invitation' ? 'invitation' : 'plan';
  const raekke = ['konto', plan, 'betaling', 'klargoering', 'aabn'] as const;
  const hvor: Record<Visning['trin'], (typeof raekke)[number] | null> = {
    konto: 'konto', profil: 'konto', samtykke: 'konto', invitation: 'invitation', plan: 'plan', abonnement: plan, betaling: 'betaling', klargoering: 'klargoering', aabn: 'aabn', slettes: null,
  };
  const h = hvor[v.trin];
  if (!h) return html``;
  return html`<p class="trin">${t.trin(raekke.indexOf(h) + 1, raekke.length, t.trinNavn[h])}</p>`;
}

/** The status endpoint the page polls, and the key it reloads on when the screen should change. */
function poll(f: Faelles, v: Visning, session: string | null = null): Markup {
  if (f.poll === false) return html``;
  const url = session ? `/api/tilmelding/status?session=${encodeURIComponent(session)}` : '/api/tilmelding/status';
  return html`<div data-poll="${url}" data-noegle="${visningsNoegle(v)}"></div>`;
}

function landNavn(kode: string, sprog: Sprog): string {
  return new Intl.DisplayNames([sprog], { type: 'region' }).of(kode) ?? kode;
}

function indhold(t: Tekster, f: Faelles, s: SideInput): { titel: string; krop: Markup; skript: boolean } {
  const v = s.visning;
  switch (s.visning.trin) {
    case 'konto': {
      const a = s as Extract<SideInput, { visning: { trin: 'konto' } }>;
      const andet = f.sprog === 'da' ? 'en' : 'da';
      const sep = a.til.includes('?') ? '&' : '?';
      return { titel: t.kontoTitel, skript: false, krop: html`<a class="sprogvalg" href="${a.til}${sep}sprog=${andet}" hreflang="${andet}">${t.andetSprog}</a>
<h1>${t.kontoTitel}</h1>
<p>${t.kontoIntro}</p>
<form method="post" action="/log-ind/link">
<input type="hidden" name="til" value="${a.til}">
<label for="email">${t.emailFelt}</label>
<input id="email" type="email" name="email" autocomplete="email" required maxlength="254">
<button type="submit" class="primaer">${t.sendLink}</button>
</form>
<p><small>${t.harKonto}</small> <a href="/log-ind?til=${encodeURIComponent(a.til)}">${t.logIndPasskey}</a></p>` };
    }
    case 'profil': {
      const a = s as Extract<SideInput, { visning: { trin: 'profil' } }>;
      const valgtSprog = a.valgtSprog ?? f.sprog;
      const valgtLand = a.land ?? (f.sprog === 'da' ? 'DK' : '');
      const koder = a.lande;
      const sorteret = f.sprog === 'da' ? koder : [...koder].sort((x, y) => landNavn(x, 'en').localeCompare(landNavn(y, 'en'), 'en'));
      const lande = sorteret.map((k) => html`<option value="${k}"${k === valgtLand ? html` selected` : ''}>${landNavn(k, f.sprog)}</option>`);
      const sprogValg = (['da', 'en'] as const).map((k) => html`<label class="valg"><input type="radio" name="sprog" value="${k}"${k === valgtSprog ? html` checked` : ''} required><span lang="${k}">${k === 'da' ? t.sprogDa : t.sprogEn}</span></label>`);
      return { titel: t.profilTitel, skript: false, krop: html`<h1>${t.profilTitel}</h1>
<p>${t.profilIntro}</p>
${a.mangler ? html`<p class="status">${t.profilMangler}</p>` : ''}
<form method="post" action="/tilmeld/profil">
${csrfFelt(f.csrf)}
${a.behold.plan ? html`<input type="hidden" name="plan" value="${a.behold.plan}">` : ''}
${a.behold.interval ? html`<input type="hidden" name="interval" value="${a.behold.interval}">` : ''}
<label for="land">${t.landFelt}</label>
<select id="land" name="land" required>${valgtLand ? '' : html`<option value="" selected>${t.vaelgLand}</option>`}${lande}</select>
<fieldset><legend>${t.sprogFelt}</legend>${sprogValg}</fieldset>
<fieldset><legend>${t.samtykkeTitel}</legend>
<label class="flueben"><input type="checkbox" name="vilkaar" value="${a.samtykke.vilkaar.version}" required><span>${t.vilkaarFoer}<a href="${tekstUrl(f, a.samtykke.vilkaar.sti)}" target="_blank" rel="noopener">${t.vilkaarLink}</a></span></label>
<label class="flueben"><input type="checkbox" name="privatliv" value="${a.samtykke.privatliv.version}" required><span>${t.privatlivFoer}<a href="${tekstUrl(f, a.samtykke.privatliv.sti)}" target="_blank" rel="noopener">${t.privatlivLink}</a></span></label>
</fieldset>
<button type="submit" class="primaer">${t.fortsaet}</button>
</form>` };
    }
    case 'samtykke': {
      const a = s as Extract<SideInput, { visning: { trin: 'samtykke' } }>;
      return { titel: t.samtykkeNytTitel, skript: false, krop: html`<h1>${t.samtykkeNytTitel}</h1>
<p>${t.samtykkeNytIntro}</p>
${a.mangler ? html`<p class="status">${t.samtykkeNytMangler}</p>` : ''}
<form method="post" action="/tilmeld/samtykke">
${csrfFelt(f.csrf)}
<fieldset><legend>${t.samtykkeTitel}</legend>
<label class="flueben"><input type="checkbox" name="vilkaar" value="${a.samtykke.vilkaar.version}" required><span>${t.vilkaarFoer}<a href="${tekstUrl(f, a.samtykke.vilkaar.sti)}" target="_blank" rel="noopener">${t.vilkaarLink}</a> ${t.versionNr(a.samtykke.vilkaar.version)}</span></label>
<label class="flueben"><input type="checkbox" name="privatliv" value="${a.samtykke.privatliv.version}" required><span>${t.privatlivFoer}<a href="${tekstUrl(f, a.samtykke.privatliv.sti)}" target="_blank" rel="noopener">${t.privatlivLink}</a> ${t.versionNr(a.samtykke.privatliv.version)}</span></label>
</fieldset>
<button type="submit" class="primaer">${t.fortsaet}</button>
</form>
<p><small>${t.samtykkeNytHellere}</small></p>
<p><a href="/konto">${t.samtykkeNytKonto}</a> · <a href="/konto/slet">${t.samtykkeNytSlet}</a></p>` };
    }
    case 'invitation': {
      const a = s as Extract<SideInput, { visning: { trin: 'invitation' } }>;
      return { titel: t.invitationTitel, skript: false, krop: html`<h1>${t.invitationTitel}</h1>
<p>${t.invitationIntro}</p>
<p class="besked">${t.betaKort}</p>
${a.svar ? html`<p class="status">${a.svar === 'ukendt' ? t.kodeUkendt : t.kodeIkkeEndnu}</p>` : ''}
<form method="post" action="/tilmeld/invitation">
${csrfFelt(f.csrf)}
<label for="kode">${t.kodeFelt}</label>
<input id="kode" type="text" name="kode" required maxlength="64" autocomplete="off">
<label class="flueben"><input type="checkbox" name="betaSamtykke" value="ja"><span>${t.betaSamtykke}</span></label>
<p><small>${t.betaListe}</small></p>
<button type="submit" class="primaer">${t.brugKode}</button>
</form>` };
    }
    case 'plan': {
      const a = s as Extract<SideInput, { visning: { trin: 'plan' } }>;
      const valgtPlan = a.planer.some((p) => p.id === a.valg.plan) ? a.valg.plan : a.planer[0]?.id;
      const planValg = a.planer.map((p) => html`<label class="valg"><input type="radio" name="plan" value="${p.id}"${p.id === valgtPlan ? html` checked` : ''} required>
<span><strong>${p.navn}</strong><br><small>${t.medlemmer(p.medlemmer)} · ${t.pris(p.maaned[a.valuta], p.aar[a.valuta], a.valuta)}</small></span></label>`);
      const proeve = a.proeve && a.proeveDage > 0;
      const interval = a.valg.interval ?? 'maaned';
      const intervalValg = ([['maaned', t.maanedlig], ['aar', t.aarlig]] as const).map(([id, tekst]) =>
        html`<label class="valg"><input type="radio" name="interval" value="${id}"${id === interval ? html` checked` : ''} required><span>${tekst}</span></label>`);
      return { titel: t.planTitel, skript: false, krop: html`<h1>${t.planTitel}</h1>
<p>${proeve ? t.planIntro(a.proeveDage) : t.planIntroUdenProeve}</p>
${a.afbrudt ? html`<p class="besked">${t.afbrudt}</p>` : ''}
<form method="get" action="/konto/abonnement/bekraeft">
<input type="hidden" name="land" value="${a.land}">
<input type="hidden" name="retur" value="tilmelding">
<fieldset><legend>${t.planTitel}</legend>${planValg}</fieldset>
<fieldset><legend>${t.intervalFelt}</legend>${intervalValg}</fieldset>
<button type="submit" class="primaer">${t.videre}</button>
</form>
<p><small>${a.moms ? t.fuldPrisMoms : t.fuldPris}</small></p>` };
    }
    case 'betaling': {
      const a = s as Extract<SideInput, { visning: { trin: 'betaling' } }>;
      const titel = a.proeve ? t.betalingProeveTitel : t.betalingTitel;
      return { titel, skript: true, krop: html`<h1>${titel}</h1>
<p>${t.betalingTekst}</p>
<p class="besked" data-efter-30s hidden>${t.betalingVenter}</p>
${poll(f, v, a.session)}` };
    }
    case 'klargoering': {
      const k = s.visning;
      const naaet = FASER.indexOf(k.fase); // 0 = bestilles: no stage done yet
      const faser = (['bestilt', 'startet', 'sund', 'i-gateway'] as const).map((fase, i) => {
        const tilstand = i < naaet ? 'faerdig' : i === naaet ? 'i-gang' : 'venter';
        const ord = tilstand === 'faerdig' ? t.faseFaerdig : tilstand === 'i-gang' ? t.faseIGang : t.faseVenter;
        return html`<li data-tilstand="${tilstand}"><span>${t.fase[fase]}</span><small>${ord}</small></li>`;
      });
      return { titel: t.klargoeringTitel, skript: true, krop: html`<h1>${t.klargoeringTitel}</h1>
<p>${t.klargoeringIntro}</p>
<section><ol class="faser">${faser}</ol></section>
${k.status === 'langsom' ? html`<p class="besked">${t.langsom}</p>` : ''}
${k.status === 'fejlet' ? html`<p class="status">${t.fejlet}</p>
<form method="post" action="/api/tilmelding/igen">${csrfFelt(f.csrf)}<button type="submit" class="primaer">${t.proevIgen}</button></form>` : ''}
${poll(f, v)}` };
    }
    case 'aabn': {
      const a = s as Extract<SideInput, { visning: { trin: 'aabn' } }>;
      return { titel: t.aabnTitel, skript: false, krop: html`<h1>${t.aabnTitel}</h1>
<p>${t.aabnTekst}</p>
<a class="knap primaer" href="${a.aabnUrl}">${t.aabnKnap}</a>` };
    }
    case 'abonnement':
      return { titel: t.abonnementTitel, skript: false, krop: html`<h1>${t.abonnementTitel}</h1>
<p>${t.abonnementTekst}</p>
<a class="knap primaer" href="/konto/abonnement">${t.abonnementLink}</a>` };
    case 'slettes':
      return { titel: t.slettesTitel, skript: false, krop: html`<h1>${t.slettesTitel}</h1>
<p>${t.slettesTekst}</p>
<p><a href="/konto">${t.tilKonto}</a></p>` };
  }
}

export function tilmeldingSide(f: Faelles, s: SideInput): string {
  const t = TEKSTER[f.sprog];
  const { titel, krop, skript } = indhold(t, f, s);
  return side(titel, html`${trinLinje(t, s.visning, f.tilstand)}
${krop}`, { sprog: f.sprog, ...(f.csrf ? { csrf: f.csrf } : {}), ...(skript ? { skript: '/tilmeld.js' } : {}) });
}

/** Development only (SKY_DEV): links to every state's test data, in both languages. */
export function galleriSide(navne: readonly string[]): string {
  const liste = navne.map((n) => html`<li><span>${n}</span><span><a href="/dev/tilmelding/${n}">da</a> · <a href="/dev/tilmelding/${n}?sprog=en">en</a></span></li>`);
  return side('Tilmelding: alle tilstande (kun udvikling)', html`<h1>Tilmelding: alle tilstande (kun udvikling)</h1>
<section><ul class="liste">${liste}</ul></section>`);
}
