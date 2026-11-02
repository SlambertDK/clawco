// The ressource block and the clash card (KC-0150, anatomy KC-0064). Pure: data
// in, Markup out; every name and title through html`` (§4 r9).
//
// The block: name, kind, owner circle, the next bookings, a seven-day strip,
// and the booking form — an owner books with the one blue button; anyone else
// asks the first owner, a red graense button (it goes to another person).
//
// The clash card is the existing beslutning block, for exactly the two bookers,
// from a neutral sender ("Fra Husstanden"): the same options in the same order
// for both (Hermes' suggestion first), worded from the viewer's side. An option
// that is the viewer's own is a direct action — blue only when it comes first;
// an option that is the other person's is "Spørg <navn> …", red.
//
// KC-0215: "Ret" (name, kind, owners) and "Fjern" (a confirmation, one red button) on the block of an owner of the thing;
// "Tilføj ting" (was "Tilføj bil") has a kind.
//
// KC-0151: the booking card (a draft from a sentence in the chat: one blue "Book …" for an owner, one red
// "Spørg <ejer> om at låne …" for anyone else — nothing is booked until that tap) and "Tilføj bil".

import { html, type Markup } from '../shell/html.ts';
import { handlinger, knap, tilstandChip, type Knap } from '../shell/sprog.ts';
import { idagKbh, koebenhavnTilIso } from '../shell/tid.ts';
import { beslutter, type Forespoergsel } from './foresp.ts';
import { datoVis, klokkeVis, opremsning, tidsrumVis } from './render.ts';
import { husstandTekst } from './tekster.ts';
import { ugeDage } from './uge.ts';
import { aabenSammenfald, andenPart, erEjer, erPartI, maaRetteRessource, OPRET_SLAGS, ordnedeValg, overlapper, type Booking, type PersonId, type Ressource, type Sammenfald, type Slags, type Valg } from './ressource.ts';
import type { Medlem } from './schema.ts';
import { udkastAabent, type BookingUdkast } from './bil.ts';

const MAX_NAESTE = 3;

type Hvem = { person: PersonId; medlemmer: readonly Medlem[] };
const navnAf = (v: Hvem, id: string): string => (id === v.person ? husstandTekst().du(true) : v.medlemmer.find((m) => m.id === id)?.navn ?? husstandTekst().ukendtMedlem);
const dagAf = (iso: string): string => idagKbh(new Date(iso));
const tidTekst = (t: { start: string; slut: string }, now: Date): string => tidsrumVis(dagAf(t.start), t.start, t.slut, now);
/** "Maja og Du" (English: "Maja and you"): a list of owners or parties, the reader herself marked. */
const liste = (v: Hvem, ider: readonly string[]): string => opremsning(ider.map((id) => ({ navn: navnAf(v, id), du: id === v.person })));

/** The owner a non-owner asks: the first in the circle who is a member, not a guest, and not the asker. */
export function ejerAtSpoerge(r: Pick<Ressource, 'ejere'>, person: PersonId, medlemmer: readonly Medlem[]): Medlem | undefined {
  for (const id of r.ejere) {
    const m = medlemmer.find((x) => x.id === id);
    if (m && m.id !== person && m.rolle !== 'gaest') return m;
  }
  return undefined;
}

/** Whether any booking touches the Copenhagen day `dato` (midnight to midnight). */
function optagetDag(r: Ressource, dato: string): boolean {
  const fra = koebenhavnTilIso(`${dato}T00:00`);
  const d = new Date(`${dato}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
  const til = koebenhavnTilIso(`${d.toISOString().slice(0, 10)}T00:00`);
  return fra !== null && til !== null && r.kalender.some((x) => overlapper({ start: fra, slut: til }, x));
}

function strip(r: Ressource, now: Date): Markup {
  const T = husstandTekst();
  return html`<ol class="uge-strip" data-uge-strip aria-label="${T.deNaesteSyvDage}">${ugeDage(now).map((dato) => {
    const optaget = optagetDag(r, dato);
    return html`<li class="strip-dag${optaget ? ' optaget' : ''}" data-strip-dag="${dato}"${optaget ? html` data-strip-optaget` : ''} title="${datoVis(dato, now)}${optaget ? T.optaget : ''}">${T.ugeBogstaver[new Date(`${dato}T12:00:00Z`).getUTCDay()]}</li>`;
  })}</ol>`;
}

function naesteLinje(b: Booking, v: Hvem & { now: Date }): Markup {
  return html`<div class="row booking" data-booking="${b.id}"><span class="row-note mono">${tidTekst(b, v.now)} · ${navnAf(v, b.af)} · ${b.titel}</span></div>`;
}

/** KC-0215: the owners of a thing as checkboxes `ejer-<id>` (guests are never owners), `valgt` ticked. */
function ejerBokse(medlemmer: readonly Medlem[], valgt: (m: Medlem) => boolean): Markup {
  return html`<fieldset class="field"><legend class="row-note">${husstandTekst().hvemEjerDen}</legend>${medlemmer.filter((m) => m.rolle !== 'gaest').map((m) => html`<label class="field-check"><input type="checkbox" name="ejer-${m.id}"${valgt(m) ? html` checked` : ''}> <span>${m.navn}</span></label>`)}</fieldset>`;
}

/** The kinds a person can pick; `valgt` is the one shown (bil when adding). */
function slagsValg(valgt: Slags): Markup {
  const T = husstandTekst();
  return html`<select name="slags" aria-label="${T.hvadErDet}">${OPRET_SLAGS.map((k) => html`<option value="${k}"${k === valgt ? html` selected` : ''}>${T.slagsNavn[k]}</option>`)}</select>`;
}

/** "Ret" and "Fjern" for an owner of the thing (or the household's owner); nothing for anyone else. */
function retBlok(v: { r: Ressource; person: PersonId; medlemmer: readonly Medlem[] }): Markup {
  const T = husstandTekst();
  const { r } = v;
  const mig = v.medlemmer.find((m) => m.id === v.person);
  if (!mig || !maaRetteRessource(r, mig)) return html``;
  const arg = JSON.stringify({ ressourceId: r.id });
  const form = `ret-${r.id}`;
  const bookinger = r.kalender.length ? html`${T.overstaaede}` : html``;
  return html`<details class="ressource-ret" data-ressource-ret="${r.id}">
    <summary class="row-note">${T.ret}</summary>
    <form id="${form}" class="stack nyt-form" method="post" autocomplete="off">
      <label class="field"><span class="row-note">${T.navn}</span><input name="navn" type="text" maxlength="80" required value="${r.navn}"></label>
      ${r.slags === 'person' ? html`` : html`<label class="field"><span class="row-note">${T.hvadErDet}</span>${slagsValg(r.slags)}</label>`}
      ${ejerBokse(v.medlemmer, (m) => r.ejere.includes(m.id))}
    </form>
    ${handlinger(undefined, [knap({ label: T.gem, slags: 'normal', attrs: { 'data-aktion': 'ret-ressource', 'data-arg': arg, 'data-form': form, 'data-status': T.statusGemmer } })])}
    <details class="ressource-fjern" data-ressource-fjern>
      <summary class="row-note">${T.fjernRessource(T.iSaet(r.navn))}</summary>
      <p class="row-note">${T.kanIkkeFortrydes}${bookinger}</p>
      ${handlinger(undefined, [knap({ label: T.jaFjern(T.iSaet(r.navn)), slags: 'graense', attrs: { 'data-aktion': 'fjern-ressource', 'data-arg': arg, 'data-status': T.statusFjerner } })])}
    </details>
  </details>`;
}

export function ressourceBlok(v: { r: Ressource; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const T = husstandTekst();
  const { r, now } = v;
  const naeste = r.kalender.filter((b) => Date.parse(b.slut) > now.getTime()).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, MAX_NAESTE);
  const ejere = liste(v, r.ejere);
  const form = `book-${r.id}`;
  const arg = JSON.stringify({ ressourceId: r.id });
  const ejer = erEjer(r, v.person);
  const spoerg = ejer ? undefined : ejerAtSpoerge(r, v.person, v.medlemmer);
  const knapper = ejer
    ? handlinger(knap({ label: T.book, slags: 'primaer', attrs: { 'data-aktion': 'book', 'data-arg': arg, 'data-form': form, 'data-status': T.statusBooker } }))
    : spoerg ? handlinger(undefined, [knap({ label: T.spoergNavn(spoerg.navn), slags: 'graense', attrs: { 'data-aktion': 'book-spoerg', 'data-arg': arg, 'data-form': form, 'data-status': T.statusSpoerger } })]) : html``;
  return html`<article class="card kort ressource" data-blok="ressource" data-ressource="${r.id}" data-ressource-slags="${r.slags}" data-element="${T.ressourceElement(r.navn)}" data-datazone="husstand">
    <div class="kort-head">${tilstandChip('rolig', T.slagsNavn[r.slags])}<span class="row-note">${T.ejere}<span data-ressource-ejere>${ejere}</span></span></div>
    <span class="row-title">${r.navn}</span>
    ${strip(r, now)}
    ${naeste.length ? html`<div class="stack naeste-bookinger">${naeste.map((b) => naesteLinje(b, { ...v, now }))}</div>` : html`<p class="row-note">${T.ingenBookinger}</p>`}
    ${ejer || spoerg ? html`<form id="${form}" class="stack nyt-form" method="post" autocomplete="off">
      <label class="field"><span class="row-note">${T.dag}</span><input name="dag" type="date" required></label>
      <label class="field"><span class="row-note">${T.fra}</span><input name="start" type="time" required></label>
      <label class="field"><span class="row-note">${T.til}</span><input name="slut" type="time" required></label>
      <label class="field"><span class="row-note">${T.hvad}</span><input name="titel" type="text" maxlength="200" required placeholder="${T.bookingTitelEksempel}"></label>
    </form>` : ''}
    ${knapper}
    ${retBlok(v)}
  </article>`;
}

/** An option's words from the viewer's side, and whether it is the viewer's own (a direct action) or the other's (an ask). */
export function valgTekst(s: Sammenfald, valg: Valg, v: Hvem, ressourcer: readonly Ressource[]): { egen: boolean; label: string } {
  const T = husstandTekst();
  const egen = valg.hvem === v.person;
  const anden = v.medlemmer.find((m) => m.id === andenPart(s, v.person))?.navn ?? T.denAnden;
  const holder = valg.hvem === s.mod.af;
  if (valg.slags === 'anden') {
    const navn = T.iSaet(ressourcer.find((x) => x.id === valg.ressourceId)?.navn ?? T.enAnden);
    return egen ? { egen, label: T.tagTing(navn) } : { egen, label: T.spoergOmAtTage(anden, navn) };
  }
  if (egen) return { egen, label: holder ? T.ladAndenFaa(anden) : T.dropDetAndenBeholder(anden) };
  return { egen, label: holder ? T.spoergOmAtBytte(anden) : T.spoergOmAtDroppe(anden) };
}

/** The linked request is still waiting on someone. */
const venterPaaSvar = (s: Sammenfald, forespoergsler: readonly Forespoergsel[]): Forespoergsel | undefined => {
  const f = s.forespId ? forespoergsler.find((x) => x.id === s.forespId) : undefined;
  return f && beslutter(f) !== null ? f : undefined;
};

export function sammenfaldKort(v: { s: Sammenfald; ressourcer: readonly Ressource[]; forespoergsler: readonly Forespoergsel[]; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const T = husstandTekst();
  const { s, now } = v;
  const r = v.ressourcer.find((x) => x.id === s.ressourceId);
  const rNavn = r?.navn ?? T.ukendtTing;
  const holder = navnAf(v, s.mod.af), wisher = navnAf(v, s.ny.af);
  const nyTid = dagAf(s.ny.start) === dagAf(s.mod.start) ? T.kl(`${klokkeVis(s.ny.start)}–${klokkeVis(s.ny.slut)}`) : T.paa(T.midt(tidTekst(s.ny, now)));
  const resume = T.sammenfaldResume(holder, s.mod.af === v.person, T.iSaet(rNavn), T.paa(T.midt(tidTekst(s.mod, now))), s.mod.titel, wisher, nyTid, s.ny.titel);
  const venter = venterPaaSvar(s, v.forespoergsler);
  const arg = (valg: string): string => JSON.stringify({ id: s.id, valg });
  const knapper: { primaer: boolean; k: Knap }[] = ordnedeValg(s).flatMap((valg, i) => {
    const t = valgTekst(s, valg, v, v.ressourcer);
    if (t.egen) return [{ primaer: i === 0, k: knap({ label: t.label, slags: i === 0 ? 'primaer' : 'normal', attrs: { 'data-aktion': 'sammenfald-valg', 'data-arg': arg(valg.id), 'data-sammenfald-valg': valg.id } }) }];
    if (venter) return [];
    return [{ primaer: false, k: knap({ label: t.label, slags: 'graense', attrs: { 'data-aktion': 'sammenfald-spoerg', 'data-arg': arg(valg.id), 'data-sammenfald-valg': valg.id } }) }];
  });
  const primaer = knapper.find((x) => x.primaer)?.k;
  const venterTekst = venter ? (venter.fra === v.person ? T.duHarSpurgt(navnAf(v, venter.til)) : T.harSpurgtDig(navnAf(v, venter.fra))) : '';
  return html`<article class="card kort sammenfald" data-blok="beslutning" data-sammenfald="${s.id}" data-element="${T.sammenfaldElement(rNavn)}" data-datazone="husstand">
    <div class="kort-head">${tilstandChip('kraever', T.dobbeltbooket)}<span class="row-note">${T.fraHusstanden}</span></div>
    <span class="row-title">${T.erBooketToGange(rNavn)}</span>
    <p class="row-note">${resume}</p>
    ${s.forslag?.anbefaling ? html`<p class="row-note sammenfald-anbefaling" data-sammenfald-anbefaling>${s.forslag.anbefaling}</p>` : ''}
    ${venter ? html`<p class="row-note" data-sammenfald-venter>${venterTekst}</p>` : ''}
    ${handlinger(primaer, knapper.filter((x) => !x.primaer).map((x) => x.k))}
  </article>`;
}

/** A draft's card: an owner books with one blue button; anyone else can only ask the first owner (red). Drop throws it away. */
export function udkastKort(v: { u: BookingUdkast; r: Ressource; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const T = husstandTekst();
  const { u, r, now } = v;
  const tid = T.midt(tidTekst(u, now));
  const arg = JSON.stringify({ id: u.id });
  const ejer = erEjer(r, v.person);
  const spoerg = ejer ? undefined : ejerAtSpoerge(r, v.person, v.medlemmer);
  const primaer = ejer ? knap({ label: T.bookTing(T.iSaet(r.navn), tid), slags: 'primaer', attrs: { 'data-aktion': 'udkast-book', 'data-arg': arg, 'data-status': T.statusBooker } }) : undefined;
  const andre = [
    ...(spoerg ? [knap({ label: T.spoergOmAtLaane(spoerg.navn, T.iSaet(r.navn)), slags: 'graense', attrs: { 'data-aktion': 'udkast-spoerg', 'data-arg': arg, 'data-status': T.statusSpoerger } })] : []),
    knap({ label: T.drop, slags: 'normal', attrs: { 'data-aktion': 'udkast-drop', 'data-arg': arg, 'data-status': T.statusDropper } }),
  ];
  return html`<article class="card kort udkast" data-blok="beslutning" data-udkast="${u.id}" data-element="${T.bookingElement(r.navn)}" data-datazone="husstand">
    <div class="kort-head">${tilstandChip('kraever', ejer ? T.bekraeftBooking : T.spoergEnEjer)}<span class="row-note">${T.fraHusstanden}</span></div>
    <span class="row-title">${r.navn} ${tid}</span>
    <p class="row-note">${u.titel}</p>
    ${ejer ? '' : spoerg ? html`<p class="row-note">${T.ejerIkkeSaaJa(T.iSaet(r.navn), spoerg.navn)}</p>` : html`<p class="row-note">${T.ingenEjer}</p>`}
    ${handlinger(primaer, andre)}
  </article>`;
}

/** "Tilføj ting": a name, a kind (bil by default) and the owners (checkboxes `ejer-<id>`, since the form posts one value per name). Members and owners only. */
export function ressourceForm(v: { person: PersonId; medlemmer: readonly Medlem[] }): Markup {
  const T = husstandTekst();
  const mig = v.medlemmer.find((m) => m.id === v.person);
  if (!mig || (mig.rolle !== 'ejer' && mig.rolle !== 'medlem')) return html``;
  return html`<details class="card kort bil-form" data-ressource-form>
    <summary class="row-title">${T.tilfoejTing}</summary>
    <form id="tilfoej-ressource-form" class="stack nyt-form" method="post" autocomplete="off">
      <label class="field"><span class="row-note">${T.navn}</span><input name="navn" type="text" maxlength="80" required placeholder="${T.tingEksempel}"></label>
      <label class="field"><span class="row-note">${T.hvadErDet}</span>${slagsValg('bil')}</label>
      ${ejerBokse(v.medlemmer, (m) => m.id === v.person)}
    </form>
    ${handlinger(knap({ label: T.tilfoej, slags: 'primaer', attrs: { 'data-aktion': 'tilfoej-ressource', 'data-form': 'tilfoej-ressource-form', 'data-status': T.statusTilfoejer } }))}
  </details>`;
}

/** Drafts of the person (their own only), open clashes the person is a party to (nobody else sees them), then every resource of the household. */
export function ressourceSektion(v: { ressourcer: readonly Ressource[]; sammenfald: readonly Sammenfald[]; forespoergsler: readonly Forespoergsel[]; udkast?: readonly BookingUdkast[]; person: PersonId; medlemmer: readonly Medlem[]; now: Date }): Markup {
  const T = husstandTekst();
  const egne = v.sammenfald.filter((s) => erPartI(s, v.person) && aabenSammenfald(s, v.now));
  const udkast = (v.udkast ?? []).filter((u) => u.af === v.person && udkastAabent(u, v.now) && v.ressourcer.some((r) => r.id === u.ressourceId));
  const form = ressourceForm({ person: v.person, medlemmer: v.medlemmer });
  if (!egne.length && !udkast.length && !v.ressourcer.length && !form.s) return html``;
  return html`<div class="stack ressource-sektion" data-ressource-sektion>
    ${udkast.length ? html`<div class="stack gruppe" data-gruppe="${T.bekraeftBooking}"><div class="card-head"><h2 class="eyebrow">${T.bekraeftBooking}</h2><span class="muted mono">${udkast.length}</span></div>${udkast.map((u) => udkastKort({ u, r: v.ressourcer.find((r) => r.id === u.ressourceId)!, person: v.person, medlemmer: v.medlemmer, now: v.now }))}</div>` : ''}
    ${egne.length ? html`<div class="stack gruppe" data-gruppe="${T.dobbeltbooket}"><div class="card-head"><h2 class="eyebrow">${T.dobbeltbooket}</h2><span class="muted mono">${egne.length}</span></div>${egne.map((s) => sammenfaldKort({ ...v, s }))}</div>` : ''}
    ${v.ressourcer.length || form.s ? html`<div class="stack gruppe" data-gruppe="${T.tingIHuset}"><div class="card-head"><h2 class="eyebrow">${T.tingIHuset}</h2><span class="muted mono">${v.ressourcer.length}</span></div>${v.ressourcer.map((r) => ressourceBlok({ r, person: v.person, medlemmer: v.medlemmer, now: v.now }))}${form}</div>` : ''}
  </div>`;
}
