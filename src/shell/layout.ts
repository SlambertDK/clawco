// The fixed skeleton from the canvas: nav (rooms) · header (where you are,
// what Hermes does) · main (the room) · aside (ask Hermes, with a context
// chip). One function, markup in, document out.

import { html, type Markup } from './html.ts';
import { ROOMS } from '../rooms/registry.ts';
import type { ChatEntry } from '../store/types.ts';
import { PROJEKTER } from '../udvikling/projekter.ts';
import { EGET_ARBEJDE, HUSSTAND, antalVenter } from './synlig.ts';
import { forslagTil } from './forslag.ts';
import { hvadKanJegSige } from './aabn.ts';
import type { Person } from '../identitet/husstand.ts';
import { kan, ROLLE_NAVN } from '../identitet/roller.ts';
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
  const hvem = p.person === o.person?.id ? 'Du' : o.husstand?.find((x) => x.id === p.person)?.navn;
  const naar = Number.isNaN(Date.parse(p.tid)) ? '' : ` kl. ${klokkeKbh(new Date(p.tid))}`;
  const hvad = hvem ? `${hvem} stoppede alt${naar}.` : `Alt blev stoppet${naar}.`;
  return html`<div class="pause-baand" data-nodstop="pause" role="status"><span class="pause-tekst"><strong>${PRODUKT} er sat på pause</strong><span class="row-note">${hvad} Intet kører, og intet nyt starter. ${maa(o, 'genoptag') ? '' : `Kun ejeren kan starte ${PRODUKT} igen.`}</span></span>${maa(o, 'genoptag') ? html`<button type="button" class="btn btn-primary" data-nodstop="genoptag">Start igen</button>` : ''}</div>`;
}

/** KC-0188: the owner of the household (no person = the single-user owner of a bare shell test). */
const erEjer = (o: ShellOpts): boolean => !o.person || o.person.rolle === 'ejer';

/** KC-0188: the fixed red band while support looks along — above the skeleton, so no room can leave it out. */
function stoetteBaand(o: ShellOpts): Markup {
  const a = o.stoette?.adgang;
  if (!o.stoette || !a) return html``;
  const til = Number.isNaN(Date.parse(a.udloeber)) ? '' : klokkeKbh(new Date(a.udloeber));
  return html`<div class="stoette-baand" data-stoette="baand" role="status"><span class="stoette-tekst"><strong>Support kigger med til ${til}</strong><span class="row-note">Support kan se det samme som ejeren, men ikke ændre noget. Alt, hvad der bliver åbnet, står i loggen.${a.grund ? html` Grund: ${a.grund}` : ''}</span></span>${erEjer(o) ? html`<form method="post" action="${o.stoette.slaaFra}"><button type="submit" class="btn btn-primary" data-stoette="slaa-fra">Slå fra</button></form>` : ''}</div>`;
}

/** KC-0188: the owner's switch in the settings area (the Kø panel): off by default; 1, 4 or 24 hours; one optional line. */
function stoetteKort(o: ShellOpts): Markup {
  if (!o.stoette || !erEjer(o)) return html``;
  const a = o.stoette.adgang;
  if (a) return html`<div class="stoette-kort" data-stoette="til"><span class="eyebrow">Lad support se med</span><p class="row-note">Support kigger med til ${Number.isNaN(Date.parse(a.udloeber)) ? '' : klokkeKbh(new Date(a.udloeber))}. Du kan slå det fra i det røde bånd.</p></div>`;
  return html`<form class="stoette-kort" data-stoette="fra" method="post" action="${o.stoette.slaaTil}">
        <span class="eyebrow">Lad support se med</span>
        <p class="row-note">Slået fra. Slår du det til, kan én hos ${PRODUKT}s support se det samme som dig, også din mail og din kalender, men ikke ændre noget. Alt, hvad de åbner, står i loggen, og det slukker af sig selv.</p>
        <fieldset class="stoette-tid"><legend class="row-note">Hvor længe</legend>${[1, 4, 24].map((t, i) => html`<label class="stoette-valg"><input type="radio" name="timer" value="${t}"${i === 0 ? html` checked` : ''}> ${t === 1 ? '1 time' : `${t} timer`}</label>`)}</fieldset>
        <label class="field"><span class="row-note">Hvad skal de kigge på? (valgfrit, én linje)</span><input name="grund" type="text" maxlength="120" autocomplete="off"></label>
        <div class="actions"><button type="submit" class="btn">Lad support se med</button></div>
      </form>`;
}

export function shell(o: ShellOpts): Markup {
  const room = ROOMS.find((r) => r.id === o.roomId);
  const navn = o.titel ?? room?.navn ?? o.roomId;
  // A hidden room shows up when something new waits there (app.js), except own unfinished work (data-eget).
  // KC-0079: own unfinished work is marked whether shown or not — it neither reveals a room nor counts in the title.
  const skjult = (id: string): Markup => html`${o.synlige && !o.synlige.has(id) ? html` hidden` : ''}${EGET_ARBEJDE(id) ? html` data-eget` : ''}`;
  const titel = `${navn} · ${PRODUKT}`;
  const venterIalt = antalVenter(o.venter);
  return html`<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css">
</head>
<body data-room="${o.roomId}" data-titel="${titel}"${o.live ? html` data-live="1"` : ''}${o.stemme ? html` data-stemme="${o.stemme}"` : ''}${o.person ? html` data-person="${o.person.id}" data-rolle="${o.person.rolle}"` : ''}${Object.entries(o.bodyData ?? {}).filter(([k]) => /^[a-z][a-z0-9-]*$/.test(k)).map(([k, v]) => html` data-${k}="${v}"`)}>
${stoetteBaand(o)}
<div class="frame">
  <nav aria-label="Rum">
    <div class="brand"><span class="dot"></span>${PRODUKT}</div>
    <ul class="rooms">${ROOMS.filter((r) => r.id !== HUSSTAND).map((r) => {
      // KC-0093: Hjem's number is everything that waits (its own + every room's), as on the Hjem page and in the title.
      const n = r.id === 'hjem' ? venterIalt : o.venter[r.id] ?? 0;
      // KC-0148: Husstanden is the first line under Univers, and only there when it exists for this person (not hidden: gone).
      const husstand = o.synlige?.has(HUSSTAND) ? ROOMS.find((x) => x.id === HUSSTAND) : undefined;
      const under = r.id === 'univers' && ((o.univers && o.univers.length) || husstand) ? html`<ul class="rooms-sub">${husstand ? html`<li><a href="/rum/${HUSSTAND}"${HUSSTAND === o.roomId ? html` aria-current="page"` : ''}><span>${husstand.navn}</span></a></li>` : ''}${(o.univers ?? []).map((u) => {
        const k = o.venter[`univers-${u.id}`] ?? 0;
        return html`<li${skjult(`univers-${u.id}`)}><a href="/rum/univers-${u.id}"${`univers-${u.id}` === o.roomId ? html` aria-current="page"` : ''}><span>${u.navn}</span>${k > 0 ? html`<span class="count">${k}</span>` : ''}</a></li>`;
      })}</ul>` : '';
      return html`<li${skjult(r.id)}><a href="/rum/${r.id}"${r.id === o.roomId ? html` aria-current="page"` : ''} class="${r.built ? '' : 'unbuilt'}"><span>${r.navn}</span>${n > 0 ? html`<span class="count">${n}</span>` : ''}</a>${under}</li>`;
    })}</ul>
    <div class="nav-foot mono"><span class="dot dot-ok"></span>kira-home</div>
  </nav>
  <main>
    <header class="top">
      <span class="crumb"><span class="muted">Rum</span> · <strong>${navn}</strong></span>
      <span class="hermes"><span class="dot dot-ok" id="hermes-dot"></span><span class="muted">Hermes:</span> <span id="hermes-status">${o.hermesStatus}</span></span>
      <span class="top-btns">${o.stemme ? html`<button type="button" class="btn btn-ghost samtale-btn" id="samtale-toggle" aria-controls="samtale-panel" aria-expanded="false" title="Tal med Hermes — hænderfrit, svaret læses op">Samtale</button>` : ''}<button type="button" class="btn btn-ghost koe-btn" id="koe-toggle" aria-controls="koe-panel" aria-expanded="false">Kø<span class="count" id="koe-count" hidden></span></button></span>
    </header>
    ${o.stemme ? html`<div class="samtale-panel" id="samtale-panel" hidden>
      <div class="card-head"><h2 class="eyebrow">Samtale</h2><span class="samtale-state"><span class="dot dot-ok" id="samtale-dot"></span><span id="samtale-status">klar</span></span><span><button type="button" class="btn btn-ghost" id="samtale-lyd" aria-pressed="false">Lyd fra</button><button type="button" class="btn" id="samtale-stop">Stop</button></span></div>
      <div class="chat samtale-log" id="samtale-log"><p class="muted row">Tryk Samtale, så fortæller jeg hvad der venter, og du svarer med stemmen.</p></div>
    </div>` : ''}
    <div class="koe-panel" id="koe-panel" hidden>
      <div class="card-head"><h2 class="eyebrow">Hermes' kø</h2><span><button type="button" class="btn btn-ghost" id="notif-btn" hidden>Få besked på skærmen</button><button type="button" class="btn btn-ghost" id="koe-close">Luk</button></span></div>
      ${!o.pause?.pause && maa(o, 'nodstop') ? html`<div class="nodstop"><button type="button" class="btn btn-nodstop" data-nodstop="stop">Stop alt</button><span class="row-note">Standser alt, ${PRODUKT} er i gang med, og holder det på pause, til ejeren starter igen.</span></div>` : ''}
      <div id="koe-list" class="card-list"><p class="muted row">Intet i gang.</p></div>
      ${o.person?.rolle === 'gaest' ? '' : html`<div class="revision"><div class="revision-head"><h3 class="eyebrow">Hvad ${PRODUKT} har gjort</h3><button type="button" class="btn btn-ghost" data-revision-filter aria-pressed="false">Det ${PRODUKT} sagde nej til</button></div><div class="revision-indhold" data-revision="liste"><p class="muted row">Henter …</p></div></div>`}
      <div class="kilder-panel" data-kilder="panel" hidden></div>
      ${!o.person || o.person.rolle === 'ejer' ? html`<div class="omkostninger-panel" data-omkostninger="panel" hidden></div>` : ''}
      ${!o.person || o.person.rolle === 'ejer' ? html`<div class="viden-link"><a class="btn btn-ghost" href="/viden">Hvad ${PRODUKT} ved om dig</a></div>` : ''}
      ${o.hjaelp ? html`<div class="viden-link"><a class="btn btn-ghost" href="${o.hjaelp.href}" data-hjaelp>Få hjælp</a></div>` : ''}
      ${stoetteKort(o)}
      <form id="indstillinger" class="indstillinger" onsubmit="return false">
        <span class="eyebrow">Tænkeniveau</span>
        <label class="field"><span class="row-note">Småting (chat, handlinger, kladder)</span><input name="lille" type="text" placeholder="Hermes' standard" maxlength="80"><span class="row-note model-navn" data-model-navn="lille"></span></label>
        <label class="field"><span class="row-note">Analyse og forslag (bygge rum, udkast, forslag)</span><input name="taenker" type="text" placeholder="Hermes' standard" maxlength="80"><span class="row-note model-navn" data-model-navn="taenker"></span></label>
        ${o.stemme ? html`<span class="eyebrow">Hermes' stemme</span>
        <label class="field"><span class="row-note">Stemme</span><input name="voiceId" type="text" placeholder="vælges automatisk" maxlength="80"><span class="row-note">Tom = jeg vælger selv en dansk stemme.</span></label>` : ''}
        <div class="actions"><button type="button" class="btn" id="indstillinger-gem">Gem</button>${o.stemme ? html`<button type="button" class="btn btn-ghost" id="stemme-proev" data-sig="Hej Henrik. Sådan lyder jeg. Skal vi tage det, der venter?">Prøv stemmen</button>` : ''}<span class="row-note" id="indstillinger-status"></span></div>
      </form>
      ${o.husstand && o.husstand.length > 1 ? html`<div class="husstand-liste"><span class="eyebrow">Husstanden</span><ul class="husstand">${o.husstand.map((p) => html`<li data-person="${p.id}" data-rolle="${p.rolle}">${p.navn} <span class="row-note">${ROLLE_NAVN[p.rolle]}</span></li>`)}</ul></div>` : ''}
      <div class="test-skift"><span class="eyebrow">Testtilstand</span><div class="actions"><button type="button" class="btn" id="test-knap">Testtilstand</button><span class="row-note" id="test-hint">Prøv alle funktioner med opdigtede data</span><span class="row-note" id="test-fejl" role="status"></span></div></div>
    </div>
    ${pauseBaand(o)}
    <div class="room" id="room">${o.main}</div>
  </main>
  <aside aria-label="Spørg Hermes" id="aside" data-blok="samtale">
    <div class="aside-head"><h2>Spørg Hermes</h2><span class="aside-knapper"><button type="button" class="btn btn-ghost" id="cc-chat" title="Send det, du skriver, til Claude Code">Claude Code</button><button type="button" class="btn btn-ghost aside-close" id="chat-close" aria-label="Luk chatten">Luk</button></span><span class="kontekst-wrap"${o.kontekst ? '' : html` hidden`} id="kontekst-wrap"><span class="chip chip-accent" id="kontekst">Om: ${o.kontekst ?? ''}</span><button type="button" class="chip-x" id="kontekst-ryd" aria-label="Fjern markeringen">×</button></span></div>
    <p class="row-note" id="kontekst-hint"><span class="kun-touch">Tryk</span><span class="kun-mus">Klik</span> på en kasse eller en linje i rummet, så handler chatten om den.</p>
    <div class="chat" id="chat">${o.chat.map((c) => html`<div class="msg msg-${c.fra}"${c.fra === 'hermes' && o.stemme ? html` data-sig="${c.tekst}"` : ''}><span class="mono msg-time">${klokke(c.tid)}</span><span class="msg-text">${c.tekst}</span></div>`)}</div>
    ${forslagTil(o.roomId).length > 0 ? html`<div class="forslag" id="chat-forslag" role="group" aria-label="Forslag">${forslagTil(o.roomId).map((f) => html`<button type="button" class="btn btn-forslag" data-forslag="${f}">${f}</button>`)}</div>` : ''}
    <details class="rum-liste" data-rum-liste>
      <summary class="btn btn-ghost">Rum</summary>
      <ul>${ROOMS.filter((r) => r.built && (!o.synlige || o.synlige.has(r.id))).map((r) => html`<li><a href="/rum/${r.id}"${r.id === o.roomId ? html` aria-current="page"` : ''}>${r.navn}</a></li>`)}</ul>
    </details>
    <form id="chat-form" data-room="${o.roomId}" autocomplete="off">
      <input id="chat-input" name="besked" type="text" placeholder="${o.kontekst ? `Skriv om: ${o.kontekst}` : 'Skriv til Hermes …'}" maxlength="2000" required>
      ${o.stemme ? html`<button type="button" class="btn mic" id="chat-mic" data-mic="chat" aria-label="Tal til Hermes" title="Tal til Hermes (tryk, tal, tryk igen)"><span class="mic-icon" aria-hidden="true"></span></button>` : ''}
      <button type="submit" class="btn btn-primary">Send</button>
    </form>
  </aside>
</div>
<dialog id="genveje-dialog" class="cc-dialog genveje" aria-labelledby="genveje-titel">
  <form method="dialog">
    <h2 class="eyebrow" id="genveje-titel">Genveje</h2>
    <dl class="genveje-liste">
      <dt><kbd>1</kbd>–<kbd>9</kbd></dt><dd>Gå til rummet med det nummer i menuen</dd>
      <dt><kbd>/</kbd></dt><dd>Skriv til Hermes</dd>
      <dt><kbd>Esc</kbd></dt><dd>Luk chatten eller et vindue</dd>
      <dt><kbd>?</kbd></dt><dd>Vis genvejene</dd>
    </dl>
    <h3 class="eyebrow">I chatten kan du sige</h3>
    <ul class="genveje-sige">${hvadKanJegSige(o.univers ?? [], { husstand: o.synlige?.has(HUSSTAND) === true }).map((e) => html`<li>${e.saet}</li>`)}<li>Hvad kan jeg sige?</li></ul>
    <p class="row-note">Alt andet svarer Hermes på.</p>
    <button class="btn" type="submit">Luk</button>
  </form>
</dialog>
<dialog id="cc-dialog" class="cc-dialog" aria-labelledby="cc-dialog-titel">
  <form id="cc-form" autocomplete="off">
    <h2 class="eyebrow" id="cc-dialog-titel">Send til Claude Code</h2>
    <fieldset class="cc-projekter"><legend class="row-note">Projekt</legend>${PROJEKTER.map((p, i) => html`<label class="cc-projekt"><input type="radio" name="projekt" value="${p.id}"${i === 0 ? html` checked` : ''}><span>${p.navn}</span></label>`)}</fieldset>
    <label class="field"><span class="row-note">Hvad skal Claude Code gøre? Én sætning.</span><textarea name="saetning" rows="3" maxlength="500" required></textarea></label>
    <p class="row-note" id="cc-grundlag" hidden></p>
    <div class="actions"><button type="submit" class="btn btn-primary">Send</button><button type="button" class="btn btn-ghost" id="cc-annuller">Annuller</button></div>
  </form>
</dialog>
<button type="button" id="chat-toggle" aria-controls="aside" aria-expanded="false">Spørg Hermes<span class="count" id="chat-toggle-count" hidden></span></button>
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
