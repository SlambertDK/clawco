// The room Skrive, wired. Hermes writes drafts and proposals; Henrik's
// Brug/Afvis/Gem are local runs (no Hermes) so the client flow stays one.

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LogEntry } from '../../store/types.ts';
import type { RunRecord, DoneResult } from '../../runs.ts';
import { ActionError, type RoomDeps, type RoomModule, type RoomView } from '../module.ts';
import { extractJson, kraevJson } from '../dagen/schema.ts';
import { brugForslag, dokumentTilMarkdown, KORSEL, parseForslag, parseNytDokument, tomtState, venterSkrive, type Dokument, type SkriveState } from './schema.ts';
import { buildForslagRun, buildNytRun, buildSkriveChatRun } from './prompt.ts';
import { renderSkrive } from './render.ts';
import { stemmeSkrive } from './stemme.ts';
import { skriveTekst } from './tekster.ts';

export const RUM = 'skrive';
const JSON_BLOCK = /```(?:json)?\s*[\s\S]*?```/i;
const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function load(deps: RoomDeps): Promise<SkriveState> {
  return (await deps.store.readState<SkriveState>(RUM)) ?? tomtState();
}
async function save(deps: RoomDeps, s: SkriveState): Promise<void> { await deps.store.writeState(RUM, s); }

async function rendered(deps: RoomDeps, extra: Partial<DoneResult> = {}): Promise<DoneResult> {
  deps.live.notify(RUM);
  const [state, log] = await Promise.all([load(deps), deps.store.readLog(RUM)]);
  const n = venterSkrive(state);
  return { html: String(renderSkrive(state, log, deps.now(), deps.runs.igang(RUM))), venter: n ? { [RUM]: n } : {}, hermesStatus: state.hermesStatus, ...extra };
}

function aktivt(s: SkriveState): Dokument | null {
  return s.dokumenter.find((d) => d.id === s.aktivt) ?? s.dokumenter[0] ?? null;
}
function dokOrThrow(s: SkriveState, id: string): Dokument {
  const d = s.dokumenter.find((x) => x.id === id);
  if (!d) throw new ActionError('Udkastet findes ikke');
  return d;
}

async function view(deps: RoomDeps): Promise<RoomView> {
  const [state, log] = await Promise.all([load(deps), deps.store.readLog(RUM)]);
  return { main: renderSkrive(state, log, deps.now(), deps.runs.igang(RUM)), hermesStatus: state.hermesStatus };
}

function startNyt(deps: RoomDeps, titel: string, brief: string): RunRecord {
  return deps.runs.start({
    kind: 'nyt',
    spec: buildNytRun(titel, brief),
    onDone: async (output) => {
      const raw = kraevJson(output);
      const dok = parseNytDokument(raw, titel ? { brief, titel } : { brief }, deps.now());
      const s = await load(deps);
      s.dokumenter.unshift(dok);
      s.aktivt = dok.id;
      s.hermesStatus = `Skriver med på "${dok.titel.slice(0, 40)}"`;
      await save(deps, s);
      await deps.store.appendLog(RUM, { kilde: 'hermes', tekst: `Skrev udkastet "${dok.titel}" (${dok.afsnit.length} afsnit).` });
      return rendered(deps);
    },
  });
}

function startForslag(deps: RoomDeps, dok: Dokument, afsnitId: string | null, type: string): RunRecord {
  return deps.runs.start({
    kind: 'forslag',
    spec: buildForslagRun(dok, afsnitId, type),
    onDone: async (output) => gemForslag(deps, dok.id, output, undefined),
  });
}

async function gemForslag(deps: RoomDeps, dokId: string, output: string, text: string | undefined): Promise<DoneResult> {
  const s = await load(deps);
  const dok = s.dokumenter.find((d) => d.id === dokId);
  if (!dok) throw new Error('Udkastet findes ikke længere');
  const raw = text === undefined ? kraevJson(output) : extractJson(output);
  if (raw === null) return { text: text ?? '' };
  const nye = parseForslag(raw, dok, deps.now());
  s.forslag = [...s.forslag.filter((f) => !(f.dokId === dokId && nye.some((n) => n.afsnitId !== null && n.afsnitId === f.afsnitId))), ...nye];
  await save(deps, s);
  return rendered(deps, text !== undefined ? { text } : {});
}

async function startAction(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null> {
  switch (name) {
    case 'nyt': {
      const brief = str(body['brief']);
      if (!brief) throw new ActionError('Skriv hvad Hermes skal skrive (brief mangler)');
      return startNyt(deps, str(body['titel'], 120), brief);
    }
    case 'forslag': {
      const s = await load(deps);
      const dok = dokOrThrow(s, str(body['dokId'], 40));
      const afsnitId = str(body['afsnitId'], 20) || null;
      if (afsnitId && !dok.afsnit.some((a) => a.id === afsnitId)) throw new ActionError('Afsnittet findes ikke');
      const type = str(body['type'], 20) || 'stram';
      return startForslag(deps, dok, afsnitId, type);
    }
    case 'brug': {
      const forslagId = str(body['forslagId'], 40);
      return deps.runs.local('brug', async () => {
        const s = await load(deps);
        const f = s.forslag.find((x) => x.id === forslagId);
        if (!f) throw new ActionError('Forslaget findes ikke længere');
        const dok = dokOrThrow(s, f.dokId);
        const { gammel } = brugForslag(dok, f, deps.now());
        s.forslag = s.forslag.filter((x) => x.id !== forslagId);
        await save(deps, s);
        const hvor = f.afsnitId === null ? 'nyt afsnit' : `afsnit ${dok.afsnit.findIndex((a) => a.id === f.afsnitId) + 1}`;
        const fortryd = JSON.stringify(gammel === null ? { dokId: dok.id, fjern: f.ny } : { dokId: dok.id, afsnitId: f.afsnitId, tekst: gammel });
        await deps.store.appendLog(RUM, { kilde: 'henrik', tekst: `Brugte Hermes' forslag til ${hvor} i "${dok.titel}".`, handlingId: `brug-${forslagId}`, fortryd: `lokal:${fortryd}` });
        return rendered(deps, { text: 'Forslaget er brugt.' });
      });
    }
    case 'afvis': {
      const forslagId = str(body['forslagId'], 40);
      return deps.runs.local('afvis', async () => {
        const s = await load(deps);
        s.forslag = s.forslag.filter((x) => x.id !== forslagId);
        await save(deps, s);
        return rendered(deps);
      });
    }
    case 'vaelg': {
      const dokId = str(body['dokId'], 40);
      return deps.runs.local('vaelg', async () => {
        const s = await load(deps);
        dokOrThrow(s, dokId);
        s.aktivt = dokId;
        await save(deps, s);
        return rendered(deps);
      });
    }
    case 'gem': {
      const dokId = str(body['dokId'], 40);
      return deps.runs.local('gem', async () => {
        if (!deps.vaultInbox) throw new ActionError('Ingen Obsidian-mappe sat op (KC_VAULT_INBOX)');
        const s = await load(deps);
        const dok = dokOrThrow(s, dokId);
        await mkdir(deps.vaultInbox, { recursive: true });
        const dato = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(deps.now());
        const navn = `${dato} ${dok.titel.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.md`;
        const fil = path.join(deps.vaultInbox, navn);
        const md = dokumentTilMarkdown(dok);
        await writeFile(fil, md, 'utf8');
        dok.gemtSom = fil;
        await save(deps, s);
        await deps.store.appendLog(RUM, { kilde: 'system', tekst: `Gemte "${dok.titel}" i Obsidian-indbakken (${navn}).`, fortryd: `lokal:${JSON.stringify({ slet: fil, hvis: md.length })}` });
        return rendered(deps, { text: `Gemt som ${navn}` });
      });
    }
    default:
      return null;
  }
}

async function startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null> {
  const log = await deps.store.readLog(RUM);
  const entry = log.find((e) => e.id === logId);
  if (!entry || !entry.fortryd || entry.fortrudt) return null;
  const spec = entry.fortryd.startsWith('lokal:') ? (JSON.parse(entry.fortryd.slice(6)) as Record<string, unknown>) : null;
  if (!spec) return null;
  return deps.runs.local('fortryd', async () => {
    const s = await load(deps);
    let tekst = 'Fortrudt.';
    if (typeof spec['slet'] === 'string') {
      const fil = spec['slet'];
      const nu = await readFile(fil, 'utf8').catch(() => null);
      if (nu !== null && nu.length === spec['hvis']) { await unlink(fil); tekst = 'Fjernede noten fra Obsidian-indbakken igen.'; }
      else tekst = 'Noten er ændret eller væk; lod den være.';
      for (const d of s.dokumenter) if (d.gemtSom === fil) delete d.gemtSom;
    } else {
      const dok = s.dokumenter.find((d) => d.id === spec['dokId']);
      if (!dok) throw new Error('Udkastet findes ikke længere');
      if (typeof spec['fjern'] === 'string') {
        dok.afsnit = dok.afsnit.filter((a) => a.tekst !== spec['fjern']);
        tekst = 'Fjernede det indsatte afsnit igen.';
      } else {
        const a = dok.afsnit.find((x) => x.id === spec['afsnitId']);
        if (a) { a.tekst = String(spec['tekst'] ?? a.tekst); tekst = 'Satte afsnittet tilbage.'; }
      }
      dok.aendret = deps.now().toISOString();
    }
    await save(deps, s);
    await deps.store.updateLog(RUM, logId, { fortrudt: deps.now().toISOString() });
    await deps.store.appendLog(RUM, { kilde: 'henrik', tekst });
    return rendered(deps, { text: tekst });
  });
}

async function startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord> {
  const s = await load(deps);
  const dok = aktivt(s);
  await deps.store.appendChat(RUM, kontekst ? { fra: 'henrik', tekst: besked, kontekst } : { fra: 'henrik', tekst: besked });
  return deps.runs.start({
    kind: 'chat',
    spec: buildSkriveChatRun(besked, kontekst, dok),
    onDone: async (output) => {
      // Validated before anything is written, so an unusable answer can go back to Hermes (KC-0050).
      if (dok && JSON_BLOCK.test(output)) parseForslag(kraevJson(output), dok, deps.now());
      const text = output.replace(JSON_BLOCK, '').trim() || '(intet svar)';
      await deps.store.appendChat(RUM, { fra: 'hermes', tekst: text });
      if (dok && JSON_BLOCK.test(output)) return gemForslag(deps, dok.id, output, text);
      return { text };
    },
  });
}

export const skriveRoom: RoomModule = {
  id: RUM,
  korsel: KORSEL,
  aktionVerber: { nyt: 'forbered', forslag: 'forbered', brug: 'forbered', afvis: 'sorter', vaelg: 'sorter', gem: 'bogfoer' },
  view,
  startOpdater: async () => null,
  startHandling: async () => null,
  startFortryd,
  startChat,
  startAction,
  stemme: async (deps) => stemmeSkrive(await load(deps)),
  venter: async (deps) => venterSkrive(await load(deps)),
  hjemVenter: async (deps) => {
    const s = await load(deps);
    return s.forslag.map((f) => { const d = s.dokumenter.find((x) => x.id === f.dokId); return { roomId: RUM, tekst: skriveTekst().nuForslag(d?.titel ?? skriveTekst().udkast) }; });
  },
  fil: async (deps, name) => {
    const m = /^(dok-[a-z0-9]+)\.md$/.exec(name);
    if (!m) return null;
    const s = await load(deps);
    const dok = s.dokumenter.find((d) => d.id === m[1]);
    if (!dok) return null;
    return { content: dokumentTilMarkdown(dok), contentType: 'text/markdown; charset=utf-8', filename: `${dok.titel}.md` };
  },
};
