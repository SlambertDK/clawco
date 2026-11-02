// The forespørgsel block (KC-0149, anatomy KC-0064): lead (who asks whom, and
// what), a state chip whose tone follows the state, one recommendation line,
// the buttons. Pure: data in, Markup out; every name and text through html``
// (§4 r9). The one blue button is only for whoever decides now (the recipient's
// Ja, the asker's Tag imod on an alternative); anything that goes to another
// person (asking, asking again) is a red graense button (KC-0067), never blue.

import { html, type Markup } from '../shell/html.ts';
import { handlinger, knap, tilstandChip, type Knap, type Tilstand as Farve } from '../shell/sprog.ts';
import { idagKbh } from '../shell/tid.ts';
import { beslutter, erPaamindet, erPart, kanFortrydes, ubesvaret, type Forespoergsel, type PersonId, type Tidsrum } from './foresp.ts';
import type { LogEntry } from '../store/types.ts';
import { datoVis, klokkeVis, tidsrumVis } from './render.ts';
import { husstandTekst } from './tekster.ts';
import { tekst as skalTekst } from '../shell/tekster.ts';
import type { Medlem } from './schema.ts';
import { KANAL_NAVN, vurderSend, type SendSlags } from './kanal.ts';

/**
 * `alle` (KC-0153): every request of the household, for the go-between's one-open-request rule; absent = only this one.
 * `kanSvare` (KC-0154, rettigheder.ts): false = a guest, who reads the request and answers on her channel (no buttons).
 */
export type ForespBlokVisning = { f: Forespoergsel; person: PersonId; medlemmer: readonly Medlem[]; now: Date; alle?: readonly Forespoergsel[]; kanSvare?: boolean };

const navnAf = (v: ForespBlokVisning, id: string): string => (id === v.person ? husstandTekst().du(true) : v.medlemmer.find((m) => m.id === id)?.navn ?? husstandTekst().ukendtMedlem);
const dagAf = (iso: string): string => idagKbh(new Date(iso));
const tidTekst = (t: Tidsrum, now: Date): string => tidsrumVis(dagAf(t.start), t.start, t.slut, now);
const naar = (iso: string, now: Date): string => { const T = husstandTekst(); return `${T.midt(datoVis(dagAf(iso), now))} ${T.kl(klokkeVis(iso))}`; };

function chip(f: Forespoergsel, person: PersonId): [Farve, string] {
  const T = husstandTekst();
  const min = beslutter(f) === person;
  switch (f.tilstand) {
    case 'spurgt': return min ? ['kraever', T.chipVenterPaaDig] : ['rolig', T.chipSpurgt];
    case 'alternativ': return min ? ['kraever', T.chipNytForslag] : ['rolig', T.chipForslagSendt];
    case 'accepteret': return ['ordnet', T.chipAftalt];
    case 'afvist': return ['rolig', T.chipAfvist];
    case 'udloebet': return f.aarsag ? ['rolig', T.chipTrukketTilbage] : f.fra === person && ubesvaret(f) ? ['kraever', T.chipIngenSvar] : ['rolig', T.chipUdloebet];
  }
}

function anbefaling(v: ForespBlokVisning): string {
  const T = husstandTekst();
  const { f, person, now } = v;
  const fra = navnAf(v, f.fra), til = navnAf(v, f.til);
  const udloeb = T.udloeber(naar(f.udloeber, now));
  const paamindet = erPaamindet(f) && beslutter(f) === person;
  switch (f.tilstand) {
    case 'spurgt':
      if (person === f.til) return paamindet ? `${T.paamindelseVenter(fra)} ${udloeb}` : `${f.forslag?.anbefaling ?? T.svarFra(fra)} ${udloeb}`;
      return `${T.harIkkeSvaretEndnu(til)} ${udloeb}`;
    case 'alternativ':
      if (person === f.fra) {
        const alt = f.alternativ ? `${naar(f.alternativ.start, now)}–${klokkeVis(f.alternativ.slut)} (${f.alternativ.tekst})` : T.etAndetTidspunkt;
        return `${paamindet ? `${T.paamindelseVenter(til)} ` : ''}${T.foreslaar(til, alt)}`;
      }
      return `${T.harIkkeSvaretPaaForslag(fra)} ${udloeb}`;
    case 'accepteret':
      return `${T.aftaltIKalender}${(f.iKalender ?? []).includes(person) ? '' : T.laegOgsaaIKalender}`;
    case 'afvist':
      return T.sagdeNej(navnAf(v, f.historik.at(-1)?.af ?? f.til));
    case 'udloebet':
      if (f.aarsag === 'trukket') return T.trakTilbage(fra);
      return person === f.fra && ubesvaret(f) ? T.ingenSvarFra(til) : T.udloebUdenSvar;
  }
}

const aktion = (label: string, navn: string, arg: Record<string, string>, slags: 'primaer' | 'graense' | 'ghost' | 'normal' = 'normal', ekstra: Record<string, string> = {}): Knap =>
  knap({ label, slags, attrs: { 'data-aktion': navn, 'data-arg': JSON.stringify(arg), ...ekstra } });

/** The buttons of one block, as the person looking may press them. */
function knapper(v: ForespBlokVisning): Markup {
  const T = husstandTekst();
  const { f, person } = v;
  const id = f.id;
  if (f.tilstand === 'spurgt' && person === f.til) {
    const alt = f.tid ? (f.forslag?.alternativer ?? []).map((a) => aktion(a.tekst, 'svar', { id, svar: 'alternativ', kl: a.kl })) : [];
    const andet = f.tid ? [aktion(T.andetTidspunkt, 'svar', { id, svar: 'alternativ' }, 'ghost', { 'data-prompt': T.klSpoergsmaal })] : [];
    return handlinger(aktion(T.ja, 'svar', { id, svar: 'ja' }, 'primaer'), [aktion(T.nej, 'svar', { id, svar: 'nej' }), ...alt, ...andet]);
  }
  if (f.tilstand === 'spurgt' && person === f.fra) return handlinger(undefined, [aktion(T.traekTilbage, 'traek', { id }, 'ghost')]);
  if (f.tilstand === 'alternativ' && person === f.fra) {
    return handlinger(aktion(T.tagImod, 'svar', { id, svar: 'tag-imod' }, 'primaer'), [aktion(T.nejTak, 'svar', { id, svar: 'afslaa' }), aktion(T.traekTilbage, 'traek', { id }, 'ghost')]);
  }
  if (person === f.fra && ubesvaret(f)) {
    // Asking again for a time already gone makes no sense: then only Drop.
    const forbi = f.tid !== undefined && Date.parse(f.tid.start) <= v.now.getTime();
    return handlinger(undefined, [...(forbi ? [] : [aktion(T.spoergIgen, 'spoerg-igen', { id }, 'graense')]), aktion(T.drop, 'drop', { id }, 'ghost')]);
  }
  if (f.tilstand === 'accepteret' && !(f.iKalender ?? []).includes(person)) {
    return handlinger(undefined, [knap({ label: T.laegIKalender, href: `/rum/husstand/dok/aftale-${id}.ics`, attrs: { 'data-i-kalender': id, download: `aftale-${id}.ics` } })]);
  }
  return html``;
}

/**
 * KC-0153, the go-between on the asker's card: the exact message and a red Send while it may go (kanal.ts vurderSend,
 * the same rule the route checks); after it went, when, and a red "Send en påmindelse" once; why not, when she has not
 * said ja or said stop. Her answers on the channel are marked, and her other words are text lines — escaped, never acting.
 */
function kanalBlok(v: ForespBlokVisning): Markup {
  const T = husstandTekst();
  const { f, person, medlemmer } = v;
  const m = medlemmer.find((x) => x.id === f.til);
  const linjer = (f.kanal?.beskeder ?? []).map((b) => html`<p class="row-note kanal-fritekst" data-kanal-fritekst>${T.skrev(m?.navn ?? T.hun, b.tekst)}</p>`);
  const svar = f.historik.some((h) => h.via === 'kanal') ? html`<p class="row-note" data-kanal-svar>${T.svaretKomSomBesked(m?.kanal ? KANAL_NAVN[m.kanal.kanal] : T.kanalen)}</p>` : html``;
  if (person !== f.fra || !m?.kanal || f.tilstand !== 'spurgt') return html`${svar}${linjer}`;
  const s = { forespoergsler: v.alle ?? [f], medlemmer };
  const kanalNavn = KANAL_NAVN[m.kanal.kanal];
  const sendt = f.kanal?.sendt.find((x) => x.slags === 'foresp');
  const knapFor = (slags: SendSlags, label: string): Markup => {
    const u = vurderSend(s, f.id, slags, person);
    if (!u.ok) return html``;
    return html`<p class="row-note">${slags === 'foresp' ? T.detFaar(m.navn, kanalNavn) : T.paamindelsenLyder}</p>
      <p class="row-note kanal-tekst" data-kanal-tekst="${f.id}">${u.tekst}</p>
      ${handlinger(undefined, [knap({ label, slags: 'graense', attrs: { 'data-kanal-send': f.id, 'data-kanal-slags': slags, 'data-kanal-ja': u.jaId, 'data-status': T.statusSender } })])}`;
  };
  if (!sendt) {
    const u = vurderSend(s, f.id, 'foresp', person);
    return html`${svar}${linjer}${u.ok ? knapFor('foresp', T.sendTil(m.navn, kanalNavn)) : html`<p class="row-note" data-kanal-ikke>${u.hvorfor}</p>`}`;
  }
  return html`${svar}<p class="row-note" data-kanal-sendt>${T.sendtTil(m.navn, kanalNavn, klokkeVis(sendt.tid))}</p>${linjer}${knapFor('paamindelse', T.sendPaamindelse)}`;
}

export function forespBlok(v: ForespBlokVisning): Markup {
  const T = husstandTekst();
  const { f, person, now } = v;
  const [farve, tekst] = chip(f, person);
  const lead = person === f.til ? T.leadSpoergerDig(navnAf(v, f.fra)) : T.leadDuSpurgte(navnAf(v, f.til));
  const paamindelse = erPaamindet(f) && beslutter(f) === person;
  const tid = f.tilstand === 'accepteret' && f.alternativ ? f.alternativ : f.tid;
  return html`<article class="card kort foresp" data-blok="forespoergsel" data-foresp="${f.id}" data-foresp-tilstand="${f.tilstand}" data-element="${T.forespElement(f.titel)}" data-datazone="husstand">
    <div class="kort-head">${tilstandChip(farve, tekst)}<span class="row-note">${lead}</span></div>
    <span class="row-title">${f.titel}</span>
    ${tid ? html`<p class="row-note mono">${tidTekst(tid, now)}</p>` : ''}
    <p class="row-note foresp-anbefaling" data-foresp-anbefaling${paamindelse ? html` data-foresp-paamindelse` : ''}>${anbefaling(v)}</p>
    ${kanalBlok(v)}
    ${v.kanSvare === false ? '' : knapper(v)}
  </article>`;
}

/** The form to ask someone: every other member, a guest too (KC-0154: she sees what is addressed to her). The Spørg button is red — it goes to another person. */
function nyForm(medlemmer: readonly Medlem[], person: PersonId): Markup {
  const andre = medlemmer.filter((m) => m.id !== person);
  if (!andre.length) return html``;
  const T = husstandTekst();
  return html`<section class="card foresp-ny" data-foresp-ny>
    <h2 class="eyebrow">${T.spoergEnIHusstanden}</h2>
    <form id="foresp-ny" class="stack nyt-form" method="post" autocomplete="off">
      <label class="field"><span class="row-note">${T.hvem}</span><select name="til">${andre.map((m) => html`<option value="${m.id}">${m.navn}</option>`)}</select></label>
      <label class="field"><span class="row-note">${T.hvad}</span><input name="titel" type="text" maxlength="200" required placeholder="${T.titelEksempel}"></label>
      <label class="field"><span class="row-note">${T.dagValgfri}</span><input name="dag" type="date"></label>
      <label class="field"><span class="row-note">${T.fra}</span><input name="start" type="time"></label>
      <label class="field"><span class="row-note">${T.til}</span><input name="slut" type="time"></label>
    </form>
    ${handlinger(undefined, [knap({ label: T.spoerg, slags: 'graense', attrs: { 'data-aktion': 'opret', 'data-form': 'foresp-ny', 'data-status': T.statusSpoerger } })])}
  </section>`;
}

/** The person's own requests (a third person sees none — only an accepted one, in the shared week), grouped, and the form. */
export function forespSektion(v: { forespoergsler: readonly Forespoergsel[]; person: PersonId; medlemmer: readonly Medlem[]; now: Date; kanSpoerge?: boolean; kanSvare?: boolean }): Markup {
  const T = husstandTekst();
  const egne = v.forespoergsler.filter((f) => erPart(f, v.person));
  const blok = (f: Forespoergsel): Markup => forespBlok({ f, person: v.person, medlemmer: v.medlemmer, now: v.now, alle: v.forespoergsler, ...(v.kanSvare === false ? { kanSvare: false } : {}) });
  const kraever = egne.filter((f) => beslutter(f) === v.person || (f.fra === v.person && ubesvaret(f)));
  const venter = egne.filter((f) => !kraever.includes(f) && beslutter(f) !== null);
  const afgjort = egne.filter((f) => !kraever.includes(f) && beslutter(f) === null);
  const gruppe = (titel: string, fs: Forespoergsel[]): Markup => (fs.length ? html`<div class="stack gruppe" data-gruppe="${titel}"><div class="card-head"><h2 class="eyebrow">${titel}</h2><span class="muted mono">${fs.length}</span></div>${fs.map(blok)}</div>` : html``);
  return html`<div class="stack foresp-sektion" data-foresp-sektion>
    ${gruppe(skalTekst().kraeverDig, kraever)}
    ${gruppe(T.gruppeVenterPaaSvar, venter)}
    ${gruppe(T.gruppeAftaltOgAfgjort, afgjort)}
    ${v.kanSpoerge === false ? '' : nyForm(v.medlemmer, v.person)}
  </div>`;
}

/** The `fortryd` marker of a request's log line: `foresp:<id>:<history length after the step>`; null for anything else. */
export function forespMarkoer(fortryd: string | undefined): { id: string; n: number } | null {
  const m = /^foresp:([a-z0-9][a-z0-9-]{0,39}):(\d{1,3})$/.exec(fortryd ?? '');
  return m ? { id: m[1]!, n: Number(m[2]) } : null;
}

/** Whether a log line's step can be undone now by the person looking (its request is still where the step left it). */
export function linjeKanFortrydes(e: LogEntry, forespoergsler: readonly Forespoergsel[], person: PersonId, now: Date): boolean {
  const m = forespMarkoer(e.fortryd);
  if (!m || e.fortrudt || e.ejer !== person) return false;
  const f = forespoergsler.find((x) => x.id === m.id);
  return f !== undefined && kanFortrydes(f, m.n, person, now);
}

/**
 * The person's own lines (each party has their own, zone privat), newest first, with Fortryd where it still applies.
 * `ekstraFortryd` (KC-0150): another kind of line that can be undone now — a booking that is still in the calendar.
 */
export function forespLog(v: { log: readonly LogEntry[]; forespoergsler: readonly Forespoergsel[]; person: PersonId; now: Date; ekstraFortryd?: (e: LogEntry) => boolean }): Markup {
  const T = husstandTekst();
  const egne = v.log.filter((e) => e.ejer === v.person).slice(0, 8);
  if (!egne.length) return html``;
  return html`<section class="card card-list gruppe" data-gruppe="${T.senesteForesp}">
    <div class="card-head"><h2 class="eyebrow">${T.seneste}</h2></div>
    ${egne.map((e) => html`<div class="row log-row${e.fortrudt ? ' log-undone' : ''}" data-log="${e.id}">
      <span class="mono time">${klokkeVis(e.tid)}</span>
      <span class="row-main"><span class="row-title">${e.tekst}</span>${e.fortrudt ? html`<span class="row-note">${T.fortrudtKl(klokkeVis(e.fortrudt))}</span>` : ''}</span>
      ${linjeKanFortrydes(e, v.forespoergsler, v.person, v.now) || v.ekstraFortryd?.(e) ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">${T.fortryd}</button>` : ''}
    </div>`)}
  </section>`;
}
