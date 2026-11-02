// KC-0064: the visual language's block catalog as code. Every colour means one
// of five states (kraever amber · handling blue · ordnet green · graense red ·
// rolig grey); rooms render chips, the ask control and button rows through the
// helpers here, so each meaning has one look and one primary button per element.
import { html, esc, raw, Markup } from './html.ts';
import { ikon, type Tone } from './visuel.ts';
import { fold } from './fold.ts';
import { tekst } from './tekster.ts';

export type Tilstand = 'kraever' | 'handling' | 'ordnet' | 'graense' | 'rolig';

/** Hermes' tone words onto the five states. */
export function tilstandFraTone(t?: Tone): Tilstand {
  return t === 'adv' ? 'kraever' : t === 'god' ? 'ordnet' : 'rolig';
}

/** A state chip; "ordnet" carries the check pictogram so it never relies on colour alone. */
export function tilstandChip(t: Tilstand, tekst: string): Markup {
  return html`<span class="chip tilstand-${t}">${t === 'ordnet' ? ikon('check') : ''}${tekst}</span>`;
}

/** The one ask control: opens the chat with this element as context. */
export function spoerg(element: string, label = tekst().spoerg): Markup {
  return html`<button type="button" class="btn btn-ghost spoerg" data-ask="${element}">${ikon('message-circle')}<span>${label}</span></button>`;
}

/** The one share control (KC-0102): shown only for a news item that has a link; app.js opens the share sheet or copies the link. */
export function delKnap(titel: string, url?: string): Markup {
  if (!url) return html``;
  return html`<button type="button" class="btn btn-ghost del" data-del-titel="${titel}" data-del-url="${url}">${tekst().del}</button>`;
}

export type Knap = Markup;

const KLASSE = { primaer: 'btn btn-primary', graense: 'btn btn-graense', ghost: 'btn btn-ghost', normal: 'btn' } as const;

/** A button (or link) whose class is decided here, never in a room. */
export function knap(o: { label: string; attrs: Record<string, string>; slags?: keyof typeof KLASSE; href?: string }): Markup {
  const klasse = KLASSE[o.slags ?? 'normal'];
  // KC-0122: a red button needs a human yes — the browser fetches a one-time token before it posts.
  const ja = o.slags === 'graense' && o.href === undefined ? ' data-kraever-ja data-graense="kraever-ja"' : '';
  const attrs = Object.entries(o.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('') + ja;
  return o.href !== undefined
    ? raw(`<a class="${klasse}" href="${esc(o.href)}"${attrs}>${esc(o.label)}</a>`)
    : raw(`<button type="button" class="${klasse}"${attrs}>${esc(o.label)}</button>`);
}

/** The button row of one element: at most one primary, and it comes first. */
export function handlinger(primaer: Knap | undefined, andre: Knap[] = []): Markup {
  if (andre.some((k) => /class="[^"]*\bbtn-primary\b/.test(k.s))) throw new Error('handlinger: at most one primary button per element');
  if (!primaer && andre.length === 0) return html``;
  return html`<div class="actions">${primaer ?? ''}${andre}</div>`;
}

// ---- Phase 2: the three bands and the count line ----------------------------
// Every room view reads count line · Kræver dig · room content · I gang · Ordnet.
// baand() owns that order and the count line counts the very arrays it renders.

/** One element of a band: its stable id (`<kind>:<natural key>`) and its markup. */
/** `noegle` (KC-0147): a steadier identity for counting when `id` is order-dependent (a waiting row); defaults to `id`. */
export type Element = { id: string; html: Markup; noegle?: string };

/** Stamps `data-id` on the root tag of `m`; the morph keys on it (phase 3). */
export function medId(id: string, m: Markup): Markup {
  const t = /^(\s*)<([A-Za-z][^\s/>]*)([^>]*)>/.exec(m.s);
  if (!t) throw new Error('medId: markup starts with no tag');
  if (/\sdata-id=/.test(t[3]!)) throw new Error('medId: tag already has a data-id');
  return raw(`${t[1]}<${t[2]} data-id="${esc(id)}"${m.s.slice(t[0].length - t[3]!.length - 1)}`);
}

/** Ids must be unique per rendered room: the first use keeps the id, repeats get "#2", "#3" … in render order. */
export function unikIder(): (id: string) => string {
  const set = new Map<string, number>();
  return (id) => {
    const n = (set.get(id) ?? 0) + 1;
    set.set(id, n);
    return n === 1 ? id : `${id}#${n}`;
  };
}

export type IgangRaekke = { id: string; label: string; status: 'queued' | 'running' };
export type Gruppe = { titel: string; form: 'kort' | 'raekker'; elementer: Element[]; note?: Markup; efter?: Markup; fold?: { efter: number; navn: string } };
export type OrdnetGruppe = Omit<Gruppe, 'fold'>; // no nested folds inside Ordnet
/** `venter` (KC-0093): the room's own count of what waits on Henrik, when it is more than the elements shown under Kræver dig (Dagen's calendar handlinger, Hjem's sum of every room) — the same number as the nav's. */
export type Baand = { kraever: Gruppe[]; igang: Gruppe[]; ordnet: OrdnetGruppe[]; venter?: number };
export type Antal = { kraever: number; igang: number; ordnet: number };

const sum = (gs: { elementer: Element[] }[]): number => gs.reduce((n, g) => n + g.elementer.length, 0);

/** One element = one entry in a group's `elementer`. */
export function antal(b: Baand): Antal {
  return { kraever: b.venter ?? sum(b.kraever), igang: sum(b.igang), ordnet: sum(b.ordnet) };
}

/** "2 venter på dig · 1 i gang · 38 ordnet"; zero parts are left out, only the venter part is amber. */
export function taellelinje(a: Antal): Markup {
  const T = tekst();
  const venter = a.kraever > 0
    ? html`<span class="tilstand-kraever">${T.venterPaaDig(a.kraever)}</span>`
    : html`<span>${T.intetVenter}</span>`;
  const dele = [venter, ...(a.igang > 0 ? [html`<span>${T.nIGang(a.igang)}</span>`] : []), ...(a.ordnet > 0 ? [html`<span>${T.nOrdnet(a.ordnet)}</span>`] : [])];
  return html`<p class="taellelinje">${dele.flatMap((d, i) => (i === 0 ? [d] : [' · ', d]))}</p>`;
}

/** The I gang rows: runs that are with Hermes right now. */
export function igangGruppe(igang: IgangRaekke[]): Gruppe {
  const T = tekst();
  return {
    titel: T.hermesArbejder,
    form: 'raekker',
    elementer: igang.map((r) => ({ id: `run:${r.id}`, html: html`<div class="row igang-row" data-run="${r.id}">${tilstandChip('rolig', r.status === 'queued' ? T.iKoe : T.iGang)}<span class="row-main"><span class="row-title">${r.label}</span></span></div>` })),
  };
}

function gruppe(g: Gruppe | OrdnetGruppe, iOrdnet = false): Markup {
  if (g.elementer.length === 0) return html``;
  const f = 'fold' in g ? g.fold : undefined;
  const alle = g.elementer.map((e) => medId(e.id, e.html));
  const synlige = f && alle.length > f.efter ? alle.slice(0, f.efter) : alle;
  const skjulte = f && alle.length > f.efter ? alle.slice(f.efter) : [];
  const hoved = html`<div class="card-head"><h3 class="eyebrow">${g.titel}</h3><span class="muted mono">${g.elementer.length}</span></div>`;
  const indre = html`${hoved}${g.note ?? ''}${synlige}${skjulte.length ? fold(f!.navn, html`${skjulte}`) : ''}${g.efter ?? ''}`;
  return g.form === 'kort'
    ? html`<div class="stack gruppe" data-gruppe="${g.titel}">${indre}</div>`
    : html`<div class="card card-list gruppe"${iOrdnet ? '' : html` data-blok="bunke"`} data-gruppe="${g.titel}">${indre}</div>`; // KC-0119: rows outside Ordnet are a bunke
}

/** The fixed skeleton of a room view. Empty bands render no markup at all. */
export function baand(b: Baand & { indhold?: Markup }): Markup {
  const k = b.kraever.filter((g) => g.elementer.length > 0);
  const i = b.igang.filter((g) => g.elementer.length > 0);
  const o = b.ordnet.filter((g) => g.elementer.length > 0);
  const n = antal(b);
  const T = tekst();
  return html`${taellelinje(n)}${k.length ? html`<section class="baand baand-kraever" data-baand="kraever"><h2 class="baand-titel">${T.kraeverDig}</h2>${k.map((g) => gruppe(g))}</section><!--/baand-->` : ''}${b.indhold ? html`<div class="baand-indhold" data-baand="indhold">${b.indhold}</div><!--/baand-->` : ''}${i.length ? html`<section class="baand baand-igang" data-baand="igang"><h2 class="baand-titel">${T.iGang}</h2>${i.map((g) => gruppe(g))}</section><!--/baand-->` : ''}${o.length ? html`<section class="baand baand-ordnet altid-foldet" data-blok="ordnet" data-baand="ordnet">${fold(T.ordnetFold(n.ordnet), html`${o.map((g) => gruppe(g, true))}`, 'baand-ordnet')}</section><!--/baand-->` : ''}`;
}

/** KC-0122: in place of a button the policy layer would always refuse — what Hermes proposed and why Clawco will not. */
export function afvistLinje(label: string, hvorfor: string): Markup {
  return raw(`<p class="row-note graense-afvist" data-graense="afvist">${esc(tekst().ikkeTilbudt)}${esc(label)}. ${esc(hvorfor)}</p>`);
}
