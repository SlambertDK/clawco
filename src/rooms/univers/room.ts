// The Univers rooms, wired. Two module factories: `universOversigt` (room
// `univers`: the list, "Nyt univers", "Nye møder") and `universRoom(slug)`
// (room `univers-<slug>`: one univers). Hermes writes elements through one
// fenced JSON block; Henrik's buttons are local runs (no Hermes). Every change
// is logged with a local fortryd (`lokal:<json>`, as in Skrive).

import type { LogEntry } from '../../store/types.ts';
import type { DoneResult, RunRecord } from '../../runs.ts';
import { html, type Markup } from '../../shell/html.ts';
import { synligFor } from '../../identitet/zoner.ts';
import type { Person } from '../../identitet/husstand.ts';
import { ActionError, type RoomDeps, type RoomModule, type RoomView } from '../module.ts';
import { kraevJson } from '../dagen/schema.ts';
import {
  UNIVERS, anvendElementer, anvendForberedelse, arkiverUnivers, endreIndeks, endreUnivers, findUnivers, fortrydElementer, laesIndeks, laesUnivers,
  nytMoedeFraInput, opretUnivers, parseFortryd, placerMoedeIUnivers, saetOpgaveStatus, skjulMoede, tilfoejMoede, universRum, universStat,
  type Beroert, type ElementType, type Fortryd, type UniversStat,
} from './lager.ts';
import { KORSEL, isOpgaveStatus, parseForberedelse, parseNytUnivers, parseUniversSvar, standardId, type ForberedelseSvar, type Moede, type UniversInfo, type UniversState } from './schema.ts';
import { buildForberedRun, buildOversigtChatRun, buildUniversChatRun } from './prompt.ts';
import { renderOversigt, renderUnivers, venterUnivers } from './render.ts';
import { koebenhavnTilIso } from './tid.ts';

const JSON_BLOCK = /```(?:json)?\s*[\s\S]*?```/i;
const TZ = 'Europe/Copenhagen';
const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lokalFortryd = (f: Fortryd): string => `lokal:${JSON.stringify(f)}`;

function klokke(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('da-DK', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(':', '.');
}
const dagNoegle = (d: Date): string => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const TYPE_NAVN: Record<ElementType, [string, string]> = { dokument: ['dokument', 'dokumenter'], note: ['note', 'noter'], opgave: ['opgave', 'opgaver'] };

/** "Hermes lavede 1 note og 1 opgave og opdaterede 1 dokument: A, B." */
export function beskrivAendring(beroert: Beroert[]): string {
  const optael = (ny: boolean): string => {
    const dele: string[] = [];
    for (const t of ['dokument', 'note', 'opgave'] as const) {
      const n = beroert.filter((b) => b.type === t && b.ny === ny).length;
      if (n) dele.push(`${n} ${TYPE_NAVN[t][n === 1 ? 0 : 1]}`);
    }
    return dele.join(' og ');
  };
  const nye = optael(true);
  const gamle = optael(false);
  const titler = beroert.slice(0, 3).map((b) => `"${b.titel}"`).join(', ') + (beroert.length > 3 ? ` og ${beroert.length - 3} til` : '');
  return `Hermes ${[nye ? `lavede ${nye}` : '', gamle ? `opdaterede ${gamle}` : ''].filter(Boolean).join(' og ')}: ${titler}.`;
}

// ---------- Who may see what (KC-0117) ----------

/** What `person` may see of one univers: documents and notes `synligFor` denies are dropped. Opgaver and møder are untouched. */
export function synligUnivers(state: UniversState, person: Person): UniversState {
  return { ...state, dokumenter: state.dokumenter.filter((d) => synligFor(person, d)), noter: state.noter.filter((n) => synligFor(person, n)) };
}

export const synligUniversLog = (log: LogEntry[], person: Person): LogEntry[] => log.filter((e) => synligFor(person, e));

/** The univers as `deps.person` may see it. Writes keep going through `endreUnivers`, which reads the whole file. */
const laesSynlig = async (deps: RoomDeps, slugNavn: string): Promise<UniversState> => synligUnivers(await laesUnivers(deps.store, slugNavn), deps.person);

// ---------- The overview (room `univers`) ----------

async function oversigtView(deps: RoomDeps): Promise<RoomView> {
  const indeks = await laesIndeks(deps.store);
  const stats: Record<string, UniversStat> = {};
  for (const u of indeks.univers.filter((x) => !x.arkiveret)) stats[u.id] = universStat(await laesSynlig(deps, u.id), deps.now());
  return { main: renderOversigt(indeks, stats, deps.now(), deps.runs.igang(UNIVERS), { husstand: (await deps.husstand?.synlig()) ?? false }), hermesStatus: 'Klar' };
}

async function oversigtRendered(deps: RoomDeps, extra: Partial<DoneResult> = {}): Promise<DoneResult> {
  deps.live.notify(UNIVERS);
  const [v, indeks] = await Promise.all([oversigtView(deps), laesIndeks(deps.store)]);
  const n = indeks.nyeMoeder.length;
  return { html: String(v.main), venter: n ? { [UNIVERS]: n } : {}, hermesStatus: v.hermesStatus, ...extra };
}

async function opretFraInput(deps: RoomDeps, navn: string, om: string, kilde: 'henrik' | 'hermes'): Promise<UniversInfo> {
  const info = await opretUnivers(deps.store, { navn, om }, deps.now());
  await deps.store.appendLog(UNIVERS, { kilde, tekst: `Oprettede universet "${info.navn}".` });
  return info;
}

async function oversigtAction(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null> {
  switch (name) {
    case 'nytUnivers': {
      const navn = typeof body['navn'] === 'string' ? body['navn'].trim() : '';
      const om = typeof body['om'] === 'string' ? body['om'].trim() : '';
      if (!navn) throw new ActionError('Giv universet et navn');
      if (navn.length > 60) throw new ActionError('Navnet må højst være 60 tegn');
      if (om.length > 300) throw new ActionError('Beskrivelsen må højst være 300 tegn');
      return deps.runs.local('nytUnivers', async () => {
        const info = await opretFraInput(deps, navn, om, 'henrik');
        return oversigtRendered(deps, { text: `Universet "${info.navn}" er oprettet.`, url: `/rum/${universRum(info.id)}` });
      });
    }
    case 'placerMoede': {
      const eventId = str(body['eventId'], 200);
      const slugNavn = str(body['slug'], 40);
      const indeks = await laesIndeks(deps.store);
      const kandidat = indeks.nyeMoeder.find((k) => k.eventId === eventId);
      if (!kandidat) throw new ActionError('Mødet er ikke blandt de nye møder (længere)');
      const info = findUnivers(indeks, slugNavn);
      if (!info || info.arkiveret) throw new ActionError('Universet findes ikke');
      return deps.runs.local('placerMoede', async () => {
        const moede = await placerMoedeIUnivers(deps.store, eventId, slugNavn);
        if (!moede) throw new Error('Mødet kunne ikke lægges i universet (er det flyttet allerede?)');
        await deps.store.appendLog(UNIVERS, { kilde: 'henrik', tekst: `Lagde mødet "${moede.titel}" i universet "${info.navn}".` });
        deps.live.notify(universRum(slugNavn));
        return oversigtRendered(deps, { text: `Mødet ligger nu i "${info.navn}".` });
      });
    }
    case 'skjulMoede': {
      const eventId = str(body['eventId'], 200);
      const indeks = await laesIndeks(deps.store);
      const kandidat = indeks.nyeMoeder.find((k) => k.eventId === eventId);
      if (!kandidat) throw new ActionError('Mødet er ikke blandt de nye møder (længere)');
      return deps.runs.local('skjulMoede', async () => {
        await endreIndeks(deps.store, (i) => skjulMoede(i, eventId));
        await deps.store.appendLog(UNIVERS, { kilde: 'henrik', tekst: `Skjulte mødet "${kandidat.titel}" (ikke et møde for Henrik).` });
        return oversigtRendered(deps);
      });
    }
    default:
      return null;
  }
}

async function oversigtChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const indeks = await laesIndeks(deps.store);
  await deps.store.appendChat(UNIVERS, kontekst ? { fra: 'henrik', tekst: besked, kontekst } : { fra: 'henrik', tekst: besked });
  return deps.runs.start({
    kind: 'univers',
    spec: buildOversigtChatRun(indeks, besked, kontekst, deps.now()),
    onDone: async (output) => {
      // Validated before anything is written, so an unusable answer can go back to Hermes (KC-0050).
      const ny = JSON_BLOCK.test(output) ? parseNytUnivers(kraevJson(output)) : null;
      const text = output.replace(JSON_BLOCK, '').trim() || '(intet svar)';
      await deps.store.appendChat(UNIVERS, { fra: 'hermes', tekst: text });
      if (!ny) return { text };
      await opretFraInput(deps, ny.navn, ny.om, 'hermes');
      return oversigtRendered(deps, { text });
    },
  });
}

export const universOversigt: RoomModule = {
  id: UNIVERS,
  korsel: KORSEL,
  aktionVerber: { nytUnivers: 'bogfoer', placerMoede: 'sorter', skjulMoede: 'sorter' },
  view: oversigtView,
  startOpdater: async () => null,
  startHandling: async () => null,
  startFortryd: async () => null,
  startChat: oversigtChat,
  startAction: oversigtAction,
  venter: async (deps) => (await laesIndeks(deps.store)).nyeMoeder.length,
  hjemVenter: async (deps) => {
    const n = (await laesIndeks(deps.store)).nyeMoeder.length;
    return n ? [{ roomId: UNIVERS, tekst: n === 1 ? '1 nyt møde venter på et univers' : `${n} nye møder venter på et univers` }] : [];
  },
};

// ---------- One univers (room `univers-<slug>`) ----------

/** Under the bands of the univers page: the archive button. */
function bund(info: UniversInfo): Markup {
  return html`
  ${info.arkiveret ? html`<p class="muted">Universet er arkiveret: det er skjult i menuen, og alt er bevaret.</p>` : html`<div class="actions"><button type="button" class="btn btn-ghost" data-aktion="arkiver" data-confirm="Arkivér universet? Det skjules i menuen, men alt beholdes." data-status="arkiverer">Arkivér universet</button></div>`}`;
}

function ikkeFundet(): Markup {
  return html`<header class="room-head"><div><a class="muted" href="/rum/univers">Alle universer</a><h1>Universet findes ikke</h1><p class="muted">Det er enten arkiveret for længe siden eller aldrig oprettet. Se alle universer for at finde det, du leder efter.</p></div></header>`;
}

function moedeFraKontekst(state: UniversState, kontekst: string | undefined): Moede | null {
  const k = (kontekst ?? '').trim();
  if (!k) return null;
  const hits = state.moeder.filter((m) => [`Møde: ${m.titel}`, `Mødet: ${m.titel}`].some((c) => c.slice(0, 200) === k));
  return hits.length === 1 ? (hits[0] as Moede) : null;
}

export function universRoom(slugNavn: string): RoomModule {
  const RUM = universRum(slugNavn);

  async function kraev(deps: RoomDeps): Promise<UniversInfo> {
    const info = findUnivers(await laesIndeks(deps.store), slugNavn);
    if (!info) throw new ActionError('Universet findes ikke');
    return info;
  }

  async function view(deps: RoomDeps): Promise<RoomView> {
    const info = findUnivers(await laesIndeks(deps.store), slugNavn);
    if (!info) return { main: ikkeFundet(), hermesStatus: 'Klar', titel: 'Universet findes ikke', status: 404 };
    const [state, log] = await Promise.all([laesSynlig(deps, slugNavn), deps.store.readLog(RUM, 20).then((l) => synligUniversLog(l, deps.person))]);
    return { main: html`${renderUnivers(info, state, deps.now(), { log, igang: deps.runs.igang(RUM) })}${bund(info)}`, hermesStatus: state.hermesStatus ?? 'Klar', titel: info.navn };
  }

  async function rendered(deps: RoomDeps, extra: Partial<DoneResult> = {}): Promise<DoneResult> {
    deps.live.notify(RUM);
    const [v, state] = await Promise.all([view(deps), laesSynlig(deps, slugNavn)]);
    const n = venterUnivers(state, deps.now());
    return { html: String(v.main), venter: n ? { [RUM]: n } : {}, hermesStatus: v.hermesStatus, ...extra };
  }

  async function logAendring(deps: RoomDeps, tekst: string, fortryd: Fortryd, kilde: 'hermes' | 'henrik', handlingId?: string): Promise<void> {
    await deps.store.appendLog(RUM, { kilde, zone: KORSEL, tekst, ...(handlingId ? { handlingId } : {}), fortryd: lokalFortryd(fortryd) });
  }

  async function startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
    const info = await kraev(deps);
    const state = await laesSynlig(deps, slugNavn);
    await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst } : { fra: 'henrik', tekst: besked });
    return deps.runs.start({
      kind: 'univers',
      spec: buildUniversChatRun(info, state, besked, kontekst, deps.now()),
      onDone: async (output) => {
        // Validated before anything is written, so an unusable answer can go back to Hermes (KC-0050).
        const raw = JSON_BLOCK.test(output) ? kraevJson(output) : null;
        const forberedelse = typeof raw === 'object' && raw !== null && 'forberedelse' in raw ? parseForberedelse(raw) : null;
        const elementer = raw !== null && !forberedelse ? parseUniversSvar(raw) : null;
        const text = output.replace(JSON_BLOCK, '').trim() || '(intet svar)';
        await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text });
        if (forberedelse) {
          const moede = moedeFraKontekst(await laesUnivers(deps.store, slugNavn), kontekst);
          if (!moede) throw new Error('Hermes svarede med en forberedelse, men det er ikke klart, hvilket møde den gælder (peg på et møde først)');
          return gemForberedelse(deps, moede.id, moede.titel, forberedelse, text);
        }
        if (!elementer) return { text };
        const now = deps.now();
        let resultat: ReturnType<typeof anvendElementer> | undefined;
        await endreUnivers(deps.store, RUM, (s) => { resultat = anvendElementer(s, elementer, now, standardId); return resultat.state; });
        if (resultat) await logAendring(deps, beskrivAendring(resultat.beroert), resultat.fortryd, 'hermes');
        return rendered(deps, { text });
      },
    });
  }

  async function gemForberedelse(deps: RoomDeps, moedeId: string, titel: string, svar: ForberedelseSvar, text?: string): Promise<DoneResult> {
    const now = deps.now();
    let fortryd: Fortryd = [];
    await endreUnivers(deps.store, RUM, (s) => {
      const r = anvendForberedelse(s, moedeId, svar, now, standardId);
      fortryd = r.fortryd;
      return { ...r.state, hermesStatus: `Forberedte "${titel.slice(0, 40)}"` };
    });
    const dele = [`${svar.talepunkter.length} talepunkter`, svar.opgaver.length ? `${svar.opgaver.length} opgaver` : '', svar.praesentation ? 'en præsentation' : ''].filter(Boolean).join(', ');
    await logAendring(deps, `Hermes forberedte mødet "${titel}": ${dele}.`, fortryd, 'hermes', `forbered-${moedeId}`);
    return rendered(deps, { text: text ?? `Mødet "${titel}" er forberedt.` });
  }

  async function startAction(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null> {
    switch (name) {
      case 'forbered': {
        const info = await kraev(deps);
        const state = await laesSynlig(deps, slugNavn);
        const moede = state.moeder.find((m) => m.id === str(body['moedeId'], 40));
        if (!moede) throw new ActionError('Mødet findes ikke');
        const onske = str(body['onske'], 400);
        return deps.runs.start({
          kind: 'forbered',
          spec: buildForberedRun(info, state, moede, onske, deps.now()),
          onDone: async (output) => {
            return gemForberedelse(deps, moede.id, moede.titel, parseForberedelse(kraevJson(output)));
          },
        });
      }
      case 'opgaveStatus': {
        await kraev(deps);
        const opgaveId = str(body['opgaveId'], 40);
        const status = body['status'];
        if (!isOpgaveStatus(status)) throw new ActionError('Ukendt status');
        if (!(await laesUnivers(deps.store, slugNavn)).opgaver.some((o) => o.id === opgaveId)) throw new ActionError('Opgaven findes ikke');
        return deps.runs.local('opgaveStatus', async () => {
          await endreUnivers(deps.store, RUM, (s) => saetOpgaveStatus(s, opgaveId, status));
          return rendered(deps);
        });
      }
      case 'nytMoede': {
        await kraev(deps);
        const titel = str(body['titel'], 200);
        if (!titel) throw new ActionError('Giv mødet en titel');
        const start = koebenhavnTilIso(str(body['start'], 40));
        if (!start) throw new ActionError('Starttidspunktet kan ikke læses');
        const v = typeof body['varighed'] === 'string' || typeof body['varighed'] === 'number' ? Number(body['varighed']) : NaN;
        const varighedMinutter = Number.isFinite(v) && String(body['varighed']).trim() !== '' ? Math.min(Math.max(Math.round(v), 5), 600) : 60;
        const moede = nytMoedeFraInput({ titel, start, varighedMinutter, deltagere: str(body['deltagere'], 500) }, standardId);
        return deps.runs.local('nytMoede', async () => {
          await endreUnivers(deps.store, RUM, (s) => tilfoejMoede(s, moede));
          await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: `Tilføjede mødet "${moede.titel}" (${klokke(moede.start)}).` });
          return rendered(deps, { text: `Mødet "${moede.titel}" er tilføjet.` });
        });
      }
      case 'arkiver': {
        const info = await kraev(deps);
        return deps.runs.local('arkiver', async () => {
          const ny = await arkiverUnivers(deps.store, slugNavn, deps.now());
          if (!ny) throw new Error('Universet findes ikke længere');
          await deps.store.appendLog(UNIVERS, { kilde: 'henrik', tekst: `Arkiverede universet "${info.navn}".` });
          deps.live.notify(UNIVERS);
          return rendered(deps, { text: `Universet "${info.navn}" er arkiveret.`, url: `/rum/${UNIVERS}` });
        });
      }
      default:
        return null;
    }
  }

  async function startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null> {
    if (!findUnivers(await laesIndeks(deps.store), slugNavn)) return null;
    const entry = synligUniversLog(await deps.store.readLog(RUM, 200), deps.person).find((e) => e.id === logId);
    if (!entry || !entry.fortryd || entry.fortrudt || !entry.fortryd.startsWith('lokal:')) return null;
    let trin: Fortryd;
    try { trin = parseFortryd(JSON.parse(entry.fortryd.slice(6))); } catch { return null; }
    return deps.runs.local('fortryd', async () => {
      await endreUnivers(deps.store, RUM, (s) => fortrydElementer(s, trin));
      await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
      await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: `Fortrudt: ${entry.tekst}` });
      return rendered(deps, { text: 'Fortrudt.' });
    });
  }

  return {
    id: RUM,
    korsel: KORSEL,
    aktionVerber: { forbered: 'forbered', opgaveStatus: 'sorter', nytMoede: 'bogfoer', arkiver: 'sorter' },
    view,
    startOpdater: async () => null,
    startHandling: async () => null,
    startFortryd,
    startChat,
    startAction,
    venter: async (deps) => venterUnivers(await laesSynlig(deps, slugNavn), deps.now()),
    hjemVenter: async (deps) => {
      const info = findUnivers(await laesIndeks(deps.store), slugNavn);
      if (!info || info.arkiveret) return [];
      const nu = deps.now();
      const i_dag = dagNoegle(nu);
      const naeste = (await laesSynlig(deps, slugNavn)).moeder
        .filter((m) => m.forberedelse && dagNoegle(new Date(m.start)) === i_dag && Date.parse(m.slut) > nu.getTime())
        .sort((a, b) => a.start.localeCompare(b.start))[0];
      return naeste ? [{ roomId: RUM, tekst: `Mødet "${naeste.titel}" kl. ${klokke(naeste.start)} er forberedt (${info.navn})` }] : [];
    },
    fil: async (deps, name) => {
      const m = /^(dok-[a-z0-9]+)\.html$/.exec(name);
      if (!m) return null;
      const dok = (await laesSynlig(deps, slugNavn)).dokumenter.find((d) => d.id === m[1]);
      if (!dok) return null;
      return { content: dok.html, contentType: 'text/html; charset=utf-8', filename: `${dok.titel}.html` };
    },
  };
}
