// HTML for the room Mail. Same data-attributes as Dagen (see dagen/render.ts).

import { html, type Markup } from '../../shell/html.ts';
import type { LogEntry } from '../../store/types.ts';
import { kunFaerdig, type MailState, type Beslutning, type Ordnet } from './schema.ts';
import { dagensLog, resultatBoks, senesteResultater } from '../../shell/log.ts';
import { friskhedEfter, kildeFriskhedEfter, type KildeFriskhed } from '../../shell/friskhed.ts';
import { zoneChip, zoneData } from '../../shell/zone.ts';
import { sigBeslutning } from './stemme.ts';
import { billede, ikon, mere, visHoved, type IkonNavn } from '../../shell/visuel.ts';
import { afvistLinje, baand, handlinger, igangGruppe, knap, spoerg, tilstandChip, type IgangRaekke, type Knap } from '../../shell/sprog.ts';
import { kraeverJa } from '../../graenser/verber.ts';
import { aldrigTilladt } from '../../graenser/afgoer.ts';
import { handlingensVerb } from '../dagen/schema.ts';

const FORTRYD_TIMER = 24;

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}
function dato(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}
function mappe(til: string): string { return til.replace(/^Folders\//, ''); }

const TYPE_LABEL: Record<Beslutning['type'], string> = { svar: 'Skal besvares', aktion: 'Du skal gøre noget', info: 'Til orientering', nyhedsbrev: 'Nyhedsbrev', regning: 'Regning', kvittering: 'Kvittering' };

// KC-0059: the pictogram a decision gets when Hermes sent no visuel of its own.
const TYPE_IKON: Record<Beslutning['type'], IkonNavn> = { svar: 'message-circle', aktion: 'target', info: 'info', nyhedsbrev: 'mail-x', regning: 'receipt', kvittering: 'circle-check' };

/**
 * `kanSende`: false when the room was built from the mail connector (KC-0214) — IMAP cannot send, so no Send button.
 * `laeseKun` (KC-0223): the connection can only read — the card is the question and what it means, nothing that moves or writes.
 */
function beslutning(b: Beslutning, resultater: Map<string, LogEntry>, kanSende = true, laeseKun = false): Markup {
  const label = `Mailen: ${b.emne}`;
  const arg = (o: Record<string, unknown>): string => JSON.stringify(o);
  const spoergKnap = spoerg(label);
  if (b.afgjort) {
    const sendt = b.afgjort.mulighedId === 'sendt';
    const r = resultater.get(b.afgjort.mulighedId) ?? resultater.get(`faerdig-${b.mailId}`);
    const sendRes = sendt ? resultater.get(`send-${b.mailId}`) : undefined;
    return html`<article class="card mail is-done" data-blok="beslutning" data-element="${label}"${zoneData(b)}>
      <div class="mail-faerdig">${zoneChip(b)}${tilstandChip('ordnet', 'Ordnet')}<span class="row-main"><span class="row-title">${b.emne}</span><span class="row-note">${sendt ? 'Sendt' : 'Færdig'} → ${mappe(b.arkivmappe)}${r ? html` · ${r.tekst}` : ''}</span></span>${spoergKnap}</div>
      ${sendRes ? resultatBoks(sendRes) : ''}
    </article>`;
  }
  const resultatKort = b.muligheder.map((m) => resultater.get(m.id)).filter((x): x is LogEntry => Boolean(x));
  const kladdeRes = resultater.get(`kladde-${b.mailId}`);
  const v = b.visuel ?? { ikon: TYPE_IKON[b.type] };
  const hvorfor = html`<p class="betydning">${b.betydning}</p>
    ${b.resume ? html`<p class="row-note">${b.resume}</p>` : ''}
    ${b.frist ? html`<p class="row-note">${tilstandChip('kraever', `Frist ${b.frist}`)}</p>` : ''}
    <p class="row-note">${dato(b.modtaget)}</p>`;
  // KC-0064: at most one primary — the first option of a nyhedsbrev/aktion. Send (mail to someone else) is the graense button, never primary;
  // KC-0066: so is an option Hermes marked tilAndre, and then no other option takes the primary place.
  const arg1 = arg({ mailId: b.mailId });
  if (laeseKun) {
    const v = b.visuel ?? { ikon: TYPE_IKON[b.type] };
    return html`<article class="card mail" data-blok="beslutning" data-element="${label}"${zoneData(b)} data-sig="${sigBeslutning(b, true)}">
    ${zoneChip(b)}${visHoved(v, b.visuel?.overskrift ?? b.emne, `${TYPE_LABEL[b.type]} · ${b.fra}`)}
    ${b.visuel?.billede ? billede(b.visuel.billede) : ''}
    ${handlinger(undefined, [html`<span class="vis-smaa">${spoergKnap}</span>`])}
    ${mere(hvorfor)}
  </article>`;
  }
  const aabneM = b.muligheder.filter((m) => !resultater.has(m.id) && !aldrigTilladt(handlingensVerb(m)));
  // KC-0122: what Hermes proposed that Clawco never does (pay, cross-zone) is a line, not a button.
  const afviste = b.muligheder.filter((m) => !resultater.has(m.id)).flatMap((m) => { const h = aldrigTilladt(handlingensVerb(m)); return h ? [afvistLinje(m.label, h)] : []; });
  const medPrimaer = (b.type === 'nyhedsbrev' || b.type === 'aktion') && aabneM.length > 0 && !kraeverJa(handlingensVerb(aabneM[0]!));
  const aabne = aabneM.map((m, i) => knap({ label: m.label, slags: kraeverJa(handlingensVerb(m)) ? 'graense' : i === 0 && medPrimaer ? 'primaer' : 'normal', attrs: { 'data-handling': m.id } }));
  const primaer = medPrimaer ? aabne[0] : undefined;
  const andre: Knap[] = [
    ...(b.type === 'svar' ? [
      ...(kanSende ? [knap({ label: 'Send', slags: 'graense', attrs: { 'data-aktion': 'send', 'data-form': `kladde-${b.mailId}`, 'data-arg': arg1, 'data-confirm': `Send svaret til ${b.fra} nu?`, 'data-status': 'sender' } })] : []),
      knap({ label: 'Gem som kladde', attrs: { 'data-aktion': 'kladde', 'data-form': `kladde-${b.mailId}`, 'data-arg': arg1, 'data-status': 'gemmer kladden' } }),
      // KC-0091: the draft on the clipboard in one tap — what the textarea holds now (Henrik's edits), else Hermes' text.
      ...(b.udkast ? [knap({ label: 'Kopiér', attrs: { 'data-kopier': b.udkast, 'data-kopier-fra': `udkast-${b.mailId}` } })] : []),
    ] : []),
    ...(primaer ? aabne.slice(1) : aabne),
    knap({ label: 'Færdig', attrs: { 'data-aktion': 'faerdig', 'data-arg': arg1, 'data-status': 'rydder op' } }),
    html`<span class="vis-smaa">${spoergKnap}</span>`,
  ];
  return html`<article class="card mail" data-blok="beslutning" data-element="${label}"${zoneData(b)} data-sig="${sigBeslutning(b)}">
    ${zoneChip(b)}${visHoved(v, b.visuel?.overskrift ?? b.emne, `${TYPE_LABEL[b.type]} · ${b.fra}`)}
    ${b.visuel?.billede ? billede(b.visuel.billede) : ''}
    ${handlinger(primaer, andre)}${afviste}
    ${resultatKort.map(resultatBoks)}${kladdeRes ? resultatBoks(kladdeRes) : ''}
    ${b.type === 'svar' ? mere(html`<form id="kladde-${b.mailId}" class="kladde" onsubmit="return false"><label class="field"><span class="row-note">Dit svar (Hermes' udkast, ret som du vil)</span><textarea name="tekst" id="udkast-${b.mailId}" rows="5" maxlength="4000">${b.udkast ?? ''}</textarea></label></form>`, 'Se udkastet') : ''}
    ${mere(hvorfor)}
  </article>`;
}

function ordnetRow(o: Ordnet, i: number): Markup {
  return html`<div class="row${i >= 8 ? ' ordnet-more' : ''}" data-element="Mailen: ${o.emne || o.mailId}"${zoneData(o)}${i >= 8 ? html` hidden` : ''}>
    <span class="mono time">${klokke(o.tid)}</span>
    <span class="row-main"><span class="row-title">${o.emne || o.hvorfor || `Mail ${o.mailId}`}${zoneChip(o)}</span><span class="row-note">${o.fra ? html`${o.fra} · ` : ''}→ ${mappe(o.til)}${o.emne && o.hvorfor ? html` · ${o.hvorfor}` : ''}</span></span>
    <button type="button" class="btn btn-ghost" data-handling="${o.handling.id}">Fortryd</button>
  </div>`;
}

function logRow(e: LogEntry, now: Date): Markup {
  const fortrudt = Boolean(e.fortrudt);
  const kan = Boolean(e.fortryd) && !fortrudt && now.getTime() - new Date(e.tid).getTime() <= FORTRYD_TIMER * 3600_000;
  return html`<div class="row log-row${fortrudt ? ' log-undone' : ''}" data-log="${e.id}"${zoneData(e)}>
    <span class="mono time">${klokke(e.tid)}</span>
    <span class="row-main"><span class="row-title">${e.tekst}</span>${fortrudt ? html`<span class="row-note">Fortrudt kl. ${klokke(e.fortrudt ?? '')}</span>` : ''}</span>
    ${kan ? html`<button type="button" class="btn btn-ghost" data-fortryd="${e.id}">Fortryd</button>` : ''}
  </div>`;
}

// KC-0097: one button for the group when two or more waiting mails have no step but Færdig.
function faerdigAlle(venter: Beslutning[]): Markup | undefined {
  const kun = venter.filter(kunFaerdig);
  if (kun.length < 2) return undefined;
  const label = kun.every((b) => b.type === 'info') ? `Færdig med de ${kun.length} til orientering` : `Færdig med de ${kun.length}, der kun er til orientering`;
  return html`<div class="gruppe-alle">${knap({ label, attrs: { 'data-aktion': 'faerdig-alle', 'data-arg': JSON.stringify({ mailIds: kun.map((b) => b.mailId) }), 'data-status': 'rydder op' } })}</div>`;
}

export function renderMail(state: MailState, log: LogEntry[], now: Date, igang: IgangRaekke[] = [], kilde?: KildeFriskhed | null): Markup {
  const venter = state.beslutninger.filter((b) => !b.afgjort);
  const afgjort = state.beslutninger.filter((b) => b.afgjort);
  const resultater = senesteResultater(log);
  const laeseKun = state.laeseKun === true;
  const alle = laeseKun ? undefined : faerdigAlle(venter);
  const kanSende = !state.forbindelse;
  // The count line says what waits, so the tiles carry only the other three numbers.
  // KC-0214: from the mail connector there are no Hermes folders, so the inbox is the one count.
  const tal = laeseKun ? html`<section class="tiles tiles-stats kun-stor" data-element="Tal: ${state.tal.handling} ulæste eller markerede">
    <div class="tile"><span class="tile-ikon">${ikon('mail')}</span><span class="stat">${state.tal.handling}</span><span class="row-note">ulæste eller markerede</span></div>
  </section>` : state.forbindelse ? html`<section class="tiles tiles-stats kun-stor" data-element="Tal: ${state.tal.handling} i indbakken">
    <div class="tile"><span class="tile-ikon">${ikon('mail')}</span><span class="stat">${state.tal.handling}</span><span class="row-note">i indbakken</span></div>
  </section>` : html`<section class="tiles tiles-stats kun-stor" data-element="Tal: ${state.tal.handling} i Handling">
    <div class="tile"><span class="tile-ikon">${ikon('mail')}</span><span class="stat">${state.tal.handling}</span><span class="row-note">i Handling</span></div>
    <div class="tile"><span class="tile-ikon">${ikon('clock')}</span><span class="stat">${state.tal.afventer}</span><span class="row-note">i Afventer</span></div>
    <div class="tile"><span class="tile-ikon">${ikon('receipt')}</span><span class="stat">${state.tal.regninger}</span><span class="row-note">i Regninger</span></div>
  </section>`;
  return html`
  <header class="room-head">
    ${laeseKun
      ? html`<div data-mail-kilde="laes-kun"><h1>Mail</h1><p class="muted">Ulæste og markerede mails i ${state.forbindelse}. Clawco kan kun læse den, så du flytter og svarer i din egen mailapp.${friskhedEfter(state.genereret, now)}${kildeFriskhedEfter(kilde, now)}</p></div>
    <button type="button" class="btn btn-ghost" data-opdater="opdater" title="Bed Hermes læse indbakken igen">Opdatér</button>`
      : state.forbindelse
      ? html`<div data-mail-kilde="forbindelse"><h1>Mail</h1><p class="muted">Indbakken i ${state.forbindelse}. Færdig flytter mailen til arkivet.${friskhedEfter(state.genereret, now)}${kildeFriskhedEfter(kilde, now)}</p></div>
    <button type="button" class="btn btn-ghost" data-opdater="opdater" title="Bed Hermes læse indbakken igen">Opdatér</button>`
      : html`<div><h1>Mail</h1><p class="muted">Handling er din indbakke. Hermes sorterer resten.${friskhedEfter(state.genereret, now)}${kildeFriskhedEfter(kilde, now)}</p></div>
    <button type="button" class="btn btn-ghost" data-opdater="opdater" title="Bed Hermes læse Handling igen">Opdatér</button>`}
  </header>

  ${baand({
    kraever: [{ titel: 'Venter på din beslutning', form: 'kort', elementer: venter.map((b) => ({ id: `mail:${b.mailId}`, html: beslutning(b, resultater, kanSende, laeseKun) })), ...(alle ? { note: alle } : {}) }],
    indhold: tal,
    igang: [igangGruppe(igang)],
    ordnet: [
      { titel: 'Afgjort', form: 'kort', elementer: afgjort.map((b) => ({ id: `mail:${b.mailId}`, html: beslutning(b, resultater, kanSende, laeseKun) })) },
      { titel: 'Ordnet af Hermes i dag', form: 'raekker', elementer: state.ordnet.map((o, i) => ({ id: `mail-ordnet:${o.mailId}`, html: ordnetRow(o, i) })), ...(state.ordnet.length > 8 ? { efter: html`<div class="row"><button type="button" class="btn btn-ghost" data-vis-alle="ordnet-more">Vis alle ${state.ordnet.length}</button></div>` } : {}) },
      { titel: 'Hermes\' arbejde i rummet', form: 'raekker', elementer: dagensLog(log, now).map((e) => ({ id: `log:${e.id}`, html: logRow(e, now) })) },
    ],
  })}`;
}

export function renderMailEmpty(grund: string): Markup {
  return html`
  <header class="room-head"><div><h1>Mail</h1><p class="muted">Ikke hentet endnu</p></div></header>
  <section class="card">
    <h2>Rummet er tomt</h2>
    <p class="muted">${grund}</p>
    <p class="muted">Hermes læser mappen Handling i Proton og foreslår, hvad der skal ske med hver mail. Det tager et par minutter.</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-opdater="opdater">Bed Hermes læse Handling</button></div>
  </section>`;
}
