// The fixed skeleton from the canvas: nav (rooms) · header (where you are,
// what Hermes does) · main (the room) · aside (ask Hermes, with a context
// chip). One function, markup in, document out.

import { html, raw, type Markup } from './html.ts';
import { ROOMS } from '../rooms/registry.ts';
import { klientTekst, tekst } from './tekster.ts';
import type { ChatEntry } from '../store/types.ts';
import { PROJEKTER } from '../udvikling/projekter.ts';
import { EGET_ARBEJDE, HUSSTAND, antalVenter } from './synlig.ts';
import { forslagTil } from './forslag.ts';
import { hvadKanJegSige } from './aabn.ts';
import type { Person } from '../identitet/husstand.ts';
import { kan } from '../identitet/roller.ts';
import type { PauseTilstand } from '../graenser/nodstop.ts';
import { klokkeKbh } from './revision.ts';
import { PRODUKT } from './navn.ts';

export type ShellOpts = {
  roomId: string;
  hermesStatus: string;
  /** Pending counts per room id, shown in the nav. */
  venter: Record<string, number>;
  main: Markup;
  /** The element the chat is about ("Om: …"), if any. */
  kontekst?: string;
  chat: ChatEntry[];
  /** KC-0015: 'samtale' = mic, Lyt and the agent; 'lyt' = mic and Lyt only (fake client); absent = no voice. */
  stemme?: 'samtale' | 'lyt' | undefined;
  /** KC-0018: the room has a live stream (/api/rum/:id/live) — built rooms and (KC-0028) Hjem. */
  live?: boolean;
  /** Active universes, listed indented under the Univers nav entry. */
  univers?: { id: string; navn: string }[];
  /** Page title and crumb when it is not the room's name (one univers). */
  titel?: string;
  /** KC-0052: the room ids that are relevant now (shell/synlig.ts); the others are in the nav but hidden. Absent = all shown. */
  synlige?: ReadonlySet<string>;
  /** Extra `data-*` attributes on <body> (key without the `data-` prefix, lower-case); values are escaped. */
  bodyData?: Record<string, string>;
  /** KC-0116: who is looking (data-person / data-rolle on <body>). */
  person?: Person;
  /** KC-0116: the household; listed in the Kø panel when it has two or more persons. */
  husstand?: Person[];
  /** KC-0124: the kill switch's state; a band above the room while paused. Absent = not paused. */
  pause?: PauseTilstand;
  /** KC-0201: under Clawco Sky (KC_SKY=ja) the address of the account app's help page; shown as "Få hjælp" in the Kø panel. Absent = no link. */
  hjaelp?: { href: string };
  /**
   * KC-0188: "Lad support se med". `adgang` = the grant that is on now (from the tenant's own record), null = off;
   * `slaaTil`/`slaaFra` = where the owner's card and the band's Slå fra post. Absent = no switch: no band, no card.
   */
  stoette?: { adgang: { udloeber: string; grund: string } | null; slaaTil: string; slaaFra: string };
};

export const ELEVENLABS_SDK = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.32.0/dist/lib.iife.js';

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}

/** KC-0124: who may do what with the kill switch. No person (a test of the bare shell) = the single-user owner. */
const maa = (o: ShellOpts, ret: 'nodstop' | 'genoptag' | 'laese'): boolean => !o.person || kan(o.person.rolle, ret);

/** KC-0124: the calm band while Clawco is paused — who stopped it and when, and Start igen for the owner. */
function pauseBaand(o: ShellOpts): Markup {
  const p = o.pause;
  if (!p?.pause) return html``;
  const T = tekst();
  const hvem = p.person === o.person?.id ? T.du : o.husstand?.find((x) => x.id === p.person)?.navn;
  const naar = Number.isNaN(Date.parse(p.tid)) ? '' : T.kl(klokkeKbh(new Date(p.tid)));
  const hvad = hvem ? T.stoppedeAlt(hvem, naar) : T.altStoppet(naar);
  return html`<div class="pause-baand" data-nodstop="pause" role="status"><span class="pause-tekst"><strong>${T.paaPause}</strong><span class="row-note">${hvad} ${T.intetKoerer}${maa(o, 'genoptag') ? '' : T.kunEjerenStarter}</span></span>${maa(o, 'genoptag') ? html`<button type="button" class="btn btn-primary" data-nodstop="genoptag">${T.startIgen}</button>` : ''}</div>`;
}

/** KC-0188: the owner of the household (no person = the single-user owner of a bare shell test). */
const erEjer = (o: ShellOpts): boolean => !o.person || o.person.rolle === 'ejer';

/** KC-0188: the fixed red band while support looks along — above the skeleton, so no room can leave it out. */
function stoetteBaand(o: ShellOpts): Markup {
  const a = o.stoette?.adgang;
  if (!o.stoette || !a) return html``;
  const til = Number.isNaN(Date.parse(a.udloeber)) ? '' : klokkeKbh(new Date(a.udloeber));
  const T = tekst();
  return html`<div class="stoette-baand" data-stoette="baand" role="status"><span class="stoette-tekst"><strong>${T.supportTil(til)}</strong><span class="row-note">${T.supportKanSe}${a.grund ? html`${T.grund}${a.grund}` : ''}</span></span>${erEjer(o) ? html`<form method="post" action="${o.stoette.slaaFra}"><button type="submit" class="btn btn-primary" data-stoette="slaa-fra">${T.slaaFra}</button></form>` : ''}</div>`;
}

/** KC-0188: the owner's switch in the settings area (the Kø panel): off by default; 1, 4 or 24 hours; one optional line. */
function stoetteKort(o: ShellOpts): Markup {
  if (!o.stoette || !erEjer(o)) return html``;
  const a = o.stoette.adgang;
  const T = tekst();
  if (a) return html`<div class="stoette-kort" data-stoette="til"><span class="eyebrow">${T.ladSupport}</span><p class="row-note">${T.supportTilKort(Number.isNaN(Date.parse(a.udloeber)) ? '' : klokkeKbh(new Date(a.udloeber)))}</p></div>`;
  return html`<form class="stoette-kort" data-stoette="fra" method="post" action="${o.stoette.slaaTil}">
        <span class="eyebrow">${T.ladSupport}</span>
        <p class="row-note">${T.supportFra}</p>
        <fieldset class="stoette-tid"><legend class="row-note">${T.hvorLaenge}</legend>${[1, 4, 24].map((t, i) => html`<label class="stoette-valg"><input type="radio" name="timer" value="${t}"${i === 0 ? html` checked` : ''}> ${T.timer(t)}</label>`)}</fieldset>
        <label class="field"><span class="row-note">${T.hvadKigge}</span><input name="grund" type="text" maxlength="120" autocomplete="off"></label>
        <div class="actions"><button type="submit" class="btn">${T.ladSupport}</button></div>
      </form>`;
}

export function shell(o: ShellOpts): Markup {
  const room = ROOMS.find((r) => r.id === o.roomId);
  const T = tekst();
  const rumNavn = (id: string, navn: string): string => T.rum[id] ?? navn;
  const navn = o.titel ?? (room ? rumNavn(room.id, room.navn) : o.roomId);
  // A hidden room shows up when something new waits there (app.js), except own unfinished work (data-eget).
  // KC-0079: own unfinished work is marked whether shown or not — it neither reveals a room nor counts in the title.
  const skjult = (id: string): Markup => html`${o.synlige && !o.synlige.has(id) ? html` hidden` : ''}${EGET_ARBEJDE(id) ? html` data-eget` : ''}`;
  const titel = `${navn} · ${PRODUKT}`;
  const venterIalt = antalVenter(o.venter);
  return html`<!doctype html>
<html lang="${T.lang}">
<head>
<meta charset="utf-8">
${raw(klientTekst())}
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0E1210">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${PRODUKT}">
<meta name="application-name" content="${PRODUKT}">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-180.png">
<title>${venterIalt > 0 ? `(${venterIalt}) ` : ''}${titel}</title>
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/app.css">
</head>
<body data-room="${o.roomId}" data-titel="${titel}"${o.live ? html` data-live="1"` : ''}${o.stemme ? html` data-stemme="${o.stemme}"` : ''}${o.person ? html` data-person="${o.person.id}" data-rolle="${o.person.rolle}"` : ''}${Object.entries(o.bodyData ?? {}).filter(([k]) => /^[a-z][a-z0-9-]*$/.test(k)).map(([k, v]) => html` data-${k}="${v}"`)}>
${stoetteBaand(o)}
<div class="frame">
  <nav aria-label="${T.rumEtiket}">
    <div class="brand"><span class="dot"></span>${PRODUKT}</div>
    <ul class="rooms">${ROOMS.filter((r) => r.id !== HUSSTAND).map((r) => {
      // KC-0093: Hjem's number is everything that waits (its own + every room's), as on the Hjem page and in the title.
      const n = r.id === 'hjem' ? venterIalt : o.venter[r.id] ?? 0;
      // KC-0148: Husstanden is the first line under Univers, and only there when it exists for this person (not hidden: gone).
      const husstand = o.synlige?.has(HUSSTAND) ? ROOMS.find((x) => x.id === HUSSTAND) : undefined;
      const under = r.id === 'univers' && ((o.univers && o.univers.length) || husstand) ? html`<ul class="rooms-sub">${husstand ? html`<li><a href="/rum/${HUSSTAND}"${HUSSTAND === o.roomId ? html` aria-current="page"` : ''}><span>${rumNavn(husstand.id, husstand.navn)}</span></a></li>` : ''}${(o.univers ?? []).map((u) => {
        const k = o.venter[`univers-${u.id}`] ?? 0;
        return html`<li${skjult(`univers-${u.id}`)}><a href="/rum/univers-${u.id}"${`univers-${u.id}` === o.roomId ? html` aria-current="page"` : ''}><span>${u.navn}</span>${k > 0 ? html`<span class="count">${k}</span>` : ''}</a></li>`;
      })}</ul>` : '';
      return html`<li${skjult(r.id)}><a href="/rum/${r.id}"${r.id === o.roomId ? html` aria-current="page"` : ''} class="${r.built ? '' : 'unbuilt'}"><span>${rumNavn(r.id, r.navn)}</span>${n > 0 ? html`<span class="count">${n}</span>` : ''}</a>${under}</li>`;
    })}</ul>
    <div class="nav-foot mono"><span class="dot dot-ok"></span>kira-home</div>
  </nav>
  <main>
    <header class="top">
      <span class="crumb"><span class="muted">${T.rumEtiket}</span> · <strong>${navn}</strong></span>
      <span class="hermes"><span class="dot dot-ok" id="hermes-dot"></span><span class="muted">${T.hermes}</span> <span id="hermes-status">${o.hermesStatus}</span></span>
      <span class="top-btns">${o.stemme ? html`<button type="button" class="btn btn-ghost samtale-btn" id="samtale-toggle" aria-controls="samtale-panel" aria-expanded="false" title="${T.samtaleTitel}">${T.samtale}</button>` : ''}<button type="button" class="btn btn-ghost koe-btn" id="koe-toggle" aria-controls="koe-panel" aria-expanded="false">${T.koe}<span class="count" id="koe-count" hidden></span></button></span>
    </header>
    ${o.stemme ? html`<div class="samtale-panel" id="samtale-panel" hidden>
      <div class="card-head"><h2 class="eyebrow">${T.samtale}</h2><span class="samtale-state"><span class="dot dot-ok" id="samtale-dot"></span><span id="samtale-status">${T.samtaleKlar}</span></span><span><button type="button" class="btn btn-ghost" id="samtale-lyd" aria-pressed="false">${T.lydFra}</button><button type="button" class="btn" id="samtale-stop">${T.stop}</button></span></div>
      <div class="chat samtale-log" id="samtale-log"><p class="muted row">${T.samtaleIntro}</p></div>
    </div>` : ''}
    <div class="koe-panel" id="koe-panel" hidden>
      <div class="card-head"><h2 class="eyebrow">${T.hermesKoe}</h2><span><button type="button" class="btn btn-ghost" id="notif-btn" hidden>${T.beskedPaaSkaermen}</button><button type="button" class="btn btn-ghost" id="koe-close">${T.luk}</button></span></div>
      ${!o.pause?.pause && maa(o, 'nodstop') ? html`<div class="nodstop"><button type="button" class="btn btn-nodstop" data-nodstop="stop">${T.stopAlt}</button><span class="row-note">${T.stopAltTekst}</span></div>` : ''}
      <div id="koe-list" class="card-list"><p class="muted row">${T.intetIGang}</p></div>
      ${o.person?.rolle === 'gaest' ? '' : html`<div class="revision"><div class="revision-head"><h3 class="eyebrow">${T.hvadGjort}</h3><button type="button" class="btn btn-ghost" data-revision-filter aria-pressed="false">${T.sagdeNej}</button></div><div class="revision-indhold" data-revision="liste"><p class="muted row">${T.henter}</p></div></div>`}
      <div class="kilder-panel" data-kilder="panel" hidden></div>
      ${!o.person || o.person.rolle === 'ejer' ? html`<div class="omkostninger-panel" data-omkostninger="panel" hidden></div>` : ''}
      ${!o.person || o.person.rolle === 'ejer' ? html`<div class="viden-link"><a class="btn btn-ghost" href="/viden">${T.hvadVed}</a></div>` : ''}
      ${o.hjaelp ? html`<div class="viden-link"><a class="btn btn-ghost" href="${o.hjaelp.href}" data-hjaelp>${T.faaHjaelp}</a></div>` : ''}
      ${stoetteKort(o)}
      <form id="indstillinger" class="indstillinger" onsubmit="return false">
        <span class="eyebrow">${T.taenkeniveau}</span>
        <label class="field"><span class="row-note">${T.smaating}</span><input name="lille" type="text" placeholder="${T.hermesStandard}" maxlength="80"><span class="row-note model-navn" data-model-navn="lille"></span></label>
        <label class="field"><span class="row-note">${T.analyse}</span><input name="taenker" type="text" placeholder="${T.hermesStandard}" maxlength="80"><span class="row-note model-navn" data-model-navn="taenker"></span></label>
        ${o.stemme ? html`<span class="eyebrow">${T.hermesStemme}</span>
        <label class="field"><span class="row-note">${T.stemme}</span><input name="voiceId" type="text" placeholder="${T.stemmeAuto}" maxlength="80"><span class="row-note">${T.stemmeTom}</span></label>` : ''}
        <div class="actions"><button type="button" class="btn" id="indstillinger-gem">${T.gem}</button>${o.stemme ? html`<button type="button" class="btn btn-ghost" id="stemme-proev" data-sig="${T.stemmeProeve}">${T.proevStemmen}</button>` : ''}<span class="row-note" id="indstillinger-status"></span></div>
      </form>
      ${o.husstand && o.husstand.length > 1 ? html`<div class="husstand-liste"><span class="eyebrow">${T.husstanden}</span><ul class="husstand">${o.husstand.map((p) => html`<li data-person="${p.id}" data-rolle="${p.rolle}">${p.navn} <span class="row-note">${T.rolle[p.rolle]}</span></li>`)}</ul></div>` : ''}
      <div class="test-skift"><span class="eyebrow">${T.testtilstand}</span><div class="actions"><button type="button" class="btn" id="test-knap">${T.testtilstand}</button><span class="row-note" id="test-hint">${T.testHint}</span><span class="row-note" id="test-fejl" role="status"></span></div></div>
    </div>
    ${pauseBaand(o)}
    <div class="room" id="room">${o.main}</div>
  </main>
  <aside aria-label="${T.spoergHermes}" id="aside" data-blok="samtale">
    <div class="aside-head"><h2>${T.spoergHermes}</h2><span class="aside-knapper"><button type="button" class="btn btn-ghost" id="cc-chat" title="${T.tilClaudeTitel}">Claude Code</button><button type="button" class="btn btn-ghost aside-close" id="chat-close" aria-label="${T.lukChatten}">${T.luk}</button></span><span class="kontekst-wrap"${o.kontekst ? '' : html` hidden`} id="kontekst-wrap"><span class="chip chip-accent" id="kontekst">${T.om}${o.kontekst ?? ''}</span><button type="button" class="chip-x" id="kontekst-ryd" aria-label="${T.fjernMarkering}">×</button></span></div>
    <p class="row-note" id="kontekst-hint"><span class="kun-touch">${T.tryk}</span><span class="kun-mus">${T.klik}</span>${T.kontekstHint}</p>
    <div class="chat" id="chat">${o.chat.map((c) => html`<div class="msg msg-${c.fra}"${c.fra === 'hermes' && o.stemme ? html` data-sig="${c.tekst}"` : ''}><span class="mono msg-time">${klokke(c.tid)}</span><span class="msg-text">${c.tekst}</span></div>`)}</div>
    ${T.chatSaetninger && forslagTil(o.roomId).length > 0 ? html`<div class="forslag" id="chat-forslag" role="group" aria-label="${T.forslag}">${forslagTil(o.roomId).map((f) => html`<button type="button" class="btn btn-forslag" data-forslag="${f}">${f}</button>`)}</div>` : ''}
    <details class="rum-liste" data-rum-liste>
      <summary class="btn btn-ghost">${T.rumEtiket}</summary>
      <ul>${ROOMS.filter((r) => r.built && (!o.synlige || o.synlige.has(r.id))).map((r) => html`<li><a href="/rum/${r.id}"${r.id === o.roomId ? html` aria-current="page"` : ''}>${rumNavn(r.id, r.navn)}</a></li>`)}</ul>
    </details>
    <form id="chat-form" data-room="${o.roomId}" autocomplete="off">
      <input id="chat-input" name="besked" type="text" placeholder="${o.kontekst ? T.skrivOm(o.kontekst) : T.skrivTil}" maxlength="2000" required>
      ${o.stemme ? html`<button type="button" class="btn mic" id="chat-mic" data-mic="chat" aria-label="${T.talTil}" title="${T.talTilTitel}"><span class="mic-icon" aria-hidden="true"></span></button>` : ''}
      <button type="submit" class="btn btn-primary">${T.send}</button>
    </form>
  </aside>
</div>
<dialog id="genveje-dialog" class="cc-dialog genveje" aria-labelledby="genveje-titel">
  <form method="dialog">
    <h2 class="eyebrow" id="genveje-titel">${T.genveje}</h2>
    <dl class="genveje-liste">
      <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>${T.gaaTilRum}</dd>
      <dt><kbd>/</kbd></dt><dd>${T.skrivTilHermes}</dd>
      <dt><kbd>Esc</kbd></dt><dd>${T.lukVindue}</dd>
      <dt><kbd>?</kbd></dt><dd>${T.visGenveje}</dd>
    </dl>
    ${T.chatSaetninger ? html`<h3 class="eyebrow">${T.iChattenKan}</h3>
    <ul class="genveje-sige">${hvadKanJegSige(o.univers ?? [], { husstand: o.synlige?.has(HUSSTAND) === true }).map((e) => html`<li>${e.saet}</li>`)}<li>${T.hvadKanJegSige}</li></ul>
    ` : ''}<p class="row-note">${T.altAndet}</p>
    <button class="btn" type="submit">${T.luk}</button>
  </form>
</dialog>
<dialog id="cc-dialog" class="cc-dialog" aria-labelledby="cc-dialog-titel">
  <form id="cc-form" autocomplete="off">
    <h2 class="eyebrow" id="cc-dialog-titel">${T.tilClaude}</h2>
    <fieldset class="cc-projekter"><legend class="row-note">${T.projekt}</legend>${PROJEKTER.map((p, i) => html`<label class="cc-projekt"><input type="radio" name="projekt" value="${p.id}"${i === 0 ? html` checked` : ''}><span>${p.navn}</span></label>`)}</fieldset>
    <label class="field"><span class="row-note">${T.claudeSaetning}</span><textarea name="saetning" rows="3" maxlength="500" required></textarea></label>
    <p class="row-note" id="cc-grundlag" hidden></p>
    <div class="actions"><button type="submit" class="btn btn-primary">${T.send}</button><button type="button" class="btn btn-ghost" id="cc-annuller">${T.annuller}</button></div>
  </form>
</dialog>
<button type="button" id="chat-toggle" aria-controls="aside" aria-expanded="false">${T.spoergHermes}<span class="count" id="chat-toggle-count" hidden></span></button>
${o.stemme === 'samtale' ? html`<script src="${ELEVENLABS_SDK}" defer></script>` : ''}
${o.stemme ? html`<script src="/lyt.js" defer></script>` : ''}
<script src="/ark.js" defer></script>
<script src="/frisk.js" defer></script>
<script src="/forbindelse.js" defer></script>
<script src="/fab.js" defer></script>
<script src="/titel.js" defer></script>
<script src="/koe.js" defer></script>
<script src="/kilde.js" defer></script>
<script src="/naeste.js" defer></script>
<script src="/genveje.js" defer></script>
<script src="/nu.js" defer></script>
<script src="/foelg.js" defer></script>
<script src="/fortryd.js" defer></script>
<script src="/kladde.js" defer></script>
<script src="/plads.js" defer></script>
<script src="/esc.js" defer></script>
<script src="/morph.js" defer></script>
<script src="/app.js" defer></script>
<script src="/sw-start.js" defer></script>
</body>
</html>`;
}
