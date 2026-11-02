// KC-0129: the handlings of Start's step 5. Paste or upload → one Hermes run (tier taenker, material wrapped as
// untrusted) → a pile in Start's state → Gem writes through the notes writers behind `RoomDeps.importSkriver` → the log
// line carries the receipts, and Fortryd removes only the files that still hold exactly what was written.
// Invariants (§0 r2): additive and reversible; no existing note is overwritten (a collision stays a proposal with
// the diff); raw uploads live only in the temp folder and are removed when the run ends, however it ends.

import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RoomDeps } from '../../module.ts';
import { ActionError } from '../../module.ts';
import { kan } from '../../../identitet/roller.ts';
import type { DataZone } from '../../../identitet/zoner.ts';
import type { DoneResult, RunRecord } from '../../../runs.ts';
import type { LogEntry } from '../../../store/types.ts';
import { dagStr } from '../../../shell/friskhed.ts';
import type { ImportDiff, ImportForslag, StartImport, StartState } from '../schema.ts';
import { byggImportRun, parseImportOutput } from './foreslaa.ts';
import { parseCsv } from './parse-csv.ts';
import { parseNoter } from './parse-noter.ts';
import { parseVcard } from './parse-vcard.ts';
import type { Kontakt } from './typer.ts';
import { ASSISTENTER, slagsNavn } from './typer.ts';
import type { Kvittering, ImportSkriver, Opdateret } from './skriver.ts';
import { fjernUpload, modtagUpload, rydTmp, TMP_LEVETID_MS, type Upload } from './upload.ts';

export const IMPORT_RUM = 'start';
/** The label of the proposal run: the view tells "Hermes læser" from it. */
export const IMPORT_LABEL = 'Start: læser importen';
const TEKST_MAKS = 100_000;

/** What the room hands the import (its own state helpers; this file imports nothing from room.ts). */
export type Hjaelp = {
  laesState(deps: RoomDeps): Promise<StartState | null>;
  ny(nu: Date): StartState;
  enAdGangen<T>(deps: RoomDeps, fn: () => Promise<T>): Promise<T>;
  faerdigt(deps: RoomDeps, text: string): Promise<DoneResult>;
  korsel: DataZone;
};

export const IMPORT_AKTIONER = ['import-laes', 'import-gem', 'import-gem-alle', 'import-opdater', 'import-spring', 'import-annuller', 'import-spring-over', 'import-lav-mappe'] as const;

export const tmpBase = (deps: RoomDeps): string => deps.importTmp ?? path.join(tmpdir(), 'clawco-import');
/** Empties upload folders older than an hour (called by the room's clock and on every import). */
export const rydGamleUploads = (deps: RoomDeps): Promise<number> => rydTmp(tmpBase(deps), { foer: new Date(deps.now().getTime() - TMP_LEVETID_MS) });

const str = (v: unknown, maks: number): string => (typeof v === 'string' ? v.trim().slice(0, maks) : '');

function ejerOgSkriver(deps: RoomDeps, hvad: string): ImportSkriver {
  if (!kan(deps.person.rolle, 'aendre-indstillinger')) throw new ActionError(`Kun ejeren kan ${hvad}.`);
  if (!deps.importSkriver) throw new ActionError('Clawco har ingen notemappe, så importen kan ikke gemme noget.');
  return deps.importSkriver;
}

const MAPPE_TOM = 'Vælg først en mappe til dine noter. Importen gemmer sine filer dér.';

/** The pieces of one upload by kind: contacts (vcf, csv) and notes (md, txt, html). */
function laesFiler(filer: { navn: string; tekst: string }[]): { kontakter: Kontakt[]; noter: ReturnType<typeof parseNoter>; typer: Set<'kontakter' | 'noter'> } {
  const kontakter: Kontakt[] = [];
  const noteFiler: { navn: string; tekst: string }[] = [];
  const typer = new Set<'kontakter' | 'noter'>();
  for (const f of filer) {
    if (/\.vcf$/i.test(f.navn)) { kontakter.push(...parseVcard(f.tekst)); typer.add('kontakter'); }
    else if (/\.csv$/i.test(f.navn)) { kontakter.push(...parseCsv(f.tekst)); typer.add('kontakter'); }
    else { noteFiler.push(f); typer.add('noter'); }
  }
  return { kontakter, noter: parseNoter(noteFiler), typer };
}

function filerAf(raa: unknown): unknown {
  if (typeof raa !== 'string') return raa;
  if (!raa.trim()) return undefined;
  try { return JSON.parse(raa) as unknown; } catch { throw new ActionError('Filerne kunne ikke læses.'); }
}

async function laes(deps: RoomDeps, body: Record<string, unknown>, h: Hjaelp): Promise<RunRecord> {
  const skriver = ejerOgSkriver(deps, 'tage noget med');
  if (!(await skriver.klar())) throw new ActionError(MAPPE_TOM);
  const tekst = str(body['tekst'], TEKST_MAKS);
  const assistent = (ASSISTENTER as readonly unknown[]).includes(body['assistent']) ? String(body['assistent']) : 'andet';
  const raaFiler = filerAf(body['filer']);
  const harFiler = Array.isArray(raaFiler) ? raaFiler.length > 0 : raaFiler !== undefined && raaFiler !== null;
  if (!tekst && !harFiler) throw new ActionError('Indsæt en tekst, eller vælg mindst én fil.');
  await rydGamleUploads(deps).catch(() => 0);
  const upload: Upload | undefined = harFiler ? await modtagUpload(tmpBase(deps), deps.now(), raaFiler) : undefined;
  try {
    const l = laesFiler(upload?.filer ?? []);
    if (!tekst && !l.kontakter.length && !l.noter.length) throw new ActionError('Der stod ingen kontakter eller noter i filerne.');
    const slags = tekst && !harFiler ? assistent : tekst || l.typer.size > 1 ? 'flere' : [...l.typer][0] ?? 'noter';
    const [eksisterende, profil] = await Promise.all([skriver.personer().catch(() => []), skriver.profil().catch(() => null)]);
    const run = deps.runs.start({
      kind: 'forslag', room: IMPORT_RUM, label: IMPORT_LABEL,
      spec: byggImportRun({ slags, ...(tekst ? { tekst } : {}), ...(l.kontakter.length ? { kontakter: l.kontakter } : {}), ...(l.noter.length ? { noter: l.noter } : {}) }),
      onDone: async (output) => {
        try {
          const bunke = parseImportOutput(output, { slags, eksisterende, profil, nu: deps.now() });
          await h.enAdGangen(deps, async () => {
            const s = (await h.laesState(deps)) ?? h.ny(deps.now());
            await deps.store.writeState(IMPORT_RUM, { ...s, import: { ...s.import, bunke } });
            await deps.store.appendLog(IMPORT_RUM, { kilde: 'hermes', zone: h.korsel, ejer: deps.person.id, tekst: `Læste ${slagsNavn(slags)} og lavede ${bunke.forslag.length} forslag. Intet er gemt, før du trykker Gem.` });
          });
        } finally { if (upload) await fjernUpload(upload.dir); }
        return h.faerdigt(deps, 'Her er forslagene. Intet er gemt endnu.');
      },
    });
    if (upload) void run.finished.then(() => fjernUpload(upload.dir));
    return run;
  } catch (err) {
    if (upload) await fjernUpload(upload.dir);
    throw err;
  }
}

// ---------- Gem ----------

/** A person's body: the short facts as a list under "Vigtige fakta" (the register's own heading). */
const krop = (t: string | undefined): string | undefined => {
  const linjer = (t ?? '').split('\n').map((l) => l.trim().replace(/^[-*]\s+/, '')).filter(Boolean);
  return linjer.length ? `## Vigtige fakta\n${linjer.map((l) => `- ${l}`).join('\n')}` : undefined;
};

const profilFil = (tekst: string, slags: string, dato: string): string => `# Om mig\n\n_Taget med fra ${slagsNavn(slags)}, ${dato}. Ret eller slet frit: det er din fil._\n\n${tekst.trim()}\n`;

/** The writer's diff as the pile shows it: only the fields a person may differ in; the import's own bookkeeping fields never count. */
const visDiff = (diff: ImportDiff[], art: 'person' | 'profil'): ImportDiff[] => diff.filter((d) => (art === 'profil' ? d.felt === 'tekst' : ['relation', 'org', 'foedselsdag'].includes(d.felt)));

type Kvit = { art: 'person' | 'profil'; navn: string } & Kvittering;

async function gem(deps: RoomDeps, alle: boolean, forslagId: string, h: Hjaelp): Promise<RunRecord> {
  const skriver = ejerOgSkriver(deps, 'gemme importen');
  const bunke0 = (await h.laesState(deps))?.import?.bunke;
  if (alle) { if (!bunke0?.forslag.some((f) => f.status === 'nyt')) throw new ActionError('Der er intet at gemme.', 404); }
  else {
    const f = bunke0?.forslag.find((x) => x.id === forslagId);
    if (!f) throw new ActionError('Forslaget findes ikke i rummet', 404);
    if (f.status !== 'nyt') throw new ActionError('Den findes allerede i din mappe, og Clawco ændrer ikke en fil, du har.');
  }
  return deps.runs.local('gem', async () => h.faerdigt(deps, await h.enAdGangen(deps, async () => {
    const s = (await h.laesState(deps)) ?? h.ny(deps.now());
    const bunke = s.import?.bunke;
    const naa = bunke?.forslag.filter((f) => f.status === 'nyt' && (alle || f.id === forslagId)) ?? [];
    if (!bunke || !naa.length) return 'Allerede gemt.'; // a second tap that raced the first writes nothing
    const kilde = `import-${bunke.slags}`;
    const dato = dagStr(deps.now());
    const kvit: Kvit[] = [];
    const fejl: string[] = [];
    const gemte = new Set<string>();
    const kollision = new Map<string, ImportDiff[]>();
    for (const f of naa) {
      try {
        const r = f.art === 'profil'
          ? await skriver.skrivProfil(profilFil(f.tekst ?? '', bunke.slags, dato))
          : await skriver.skrivPerson({ navn: f.navn, relation: f.relation ?? 'kontakt', zone: f.zone ?? 'privat', ...(f.org ? { org: f.org } : {}), ...(f.foedselsdag ? { foedselsdag: f.foedselsdag } : {}), kilde, importeret: dato, ...(krop(f.tekst) ? { tekst: krop(f.tekst) as string } : {}) }, f.mappe ?? 'andre');
        if (r.udfald === 'oprettet') { kvit.push({ art: f.art, navn: f.navn, ...r.kvittering }); gemte.add(f.id); }
        else if (r.udfald === 'uaendret') gemte.add(f.id);
        else {
          const diff = visDiff(r.diff, f.art);
          if (diff.length) kollision.set(f.id, diff); else gemte.add(f.id);
        }
      } catch (err) { fejl.push(`${f.navn}: ${err instanceof Error ? err.message : 'kunne ikke gemmes'}`); }
    }
    const rest: ImportForslag[] = bunke.forslag.filter((f) => !gemte.has(f.id)).map((f) => (kollision.has(f.id) ? { ...f, status: 'findes' as const, diff: kollision.get(f.id) as ImportDiff[] } : f));
    let gemt = s.import?.gemt ?? [];
    if (kvit.length) {
      const stier = kvit.map((k) => k.sti);
      const vist = stier.length > 8 ? `${stier.slice(0, 8).join(', ')} og ${stier.length - 8} flere` : stier.join(', ');
      const post = await deps.store.appendLog(IMPORT_RUM, {
        kilde: 'henrik', zone: h.korsel, ejer: deps.person.id, handlingId: 'import-gem',
        fortryd: `lokal:${JSON.stringify({ import: { personer: kvit.filter((k) => k.art === 'person').map(({ sti, sha256, forrige }) => ({ sti, sha256, ...(forrige !== undefined ? { forrige } : {}) })), ...(kvit.find((k) => k.art === 'profil') ? { profil: (({ sti, sha256, forrige }) => ({ sti, sha256, ...(forrige !== undefined ? { forrige } : {}) }))(kvit.find((k) => k.art === 'profil') as Kvit) } : {}) } })}`,
        tekst: `Gemte ${kvit.length} ${kvit.length === 1 ? 'fil' : 'filer'} fra ${slagsNavn(bunke.slags)} (kilde: ${kilde}): ${vist}.`,
      });
      gemt = [...gemt, { logId: post.id, tid: deps.now().toISOString(), slags: bunke.slags, antal: kvit.length }];
    }
    const imp: StartImport = { ...(rest.length ? { bunke: { ...bunke, forslag: rest } } : {}), ...(gemt.length ? { gemt } : {}) };
    const { import: _gammel, ...udenImport } = s;
    await deps.store.writeState(IMPORT_RUM, {
      ...udenImport, ...(imp.bunke || imp.gemt ? { import: imp } : {}),
      trin: kvit.length ? { ...s.trin, import: { status: 'klaret' as const, tid: deps.now().toISOString() } } : s.trin,
    });
    const tekst = kvit.length ? `Gemte ${kvit.length} ${kvit.length === 1 ? 'fil' : 'filer'}.` : 'Intet nyt at gemme.';
    return [tekst, kollision.size ? `${kollision.size} findes allerede og er ikke ændret.` : '', ...fejl.map((f) => `Kunne ikke gemme ${f}.`)].filter(Boolean).join(' ');
  })), { room: IMPORT_RUM, label: 'Start: gemmer importen' });
}

// ---------- Opdater (KC-0219) ----------

/**
 * Opdater: the new from the import written into a person who already stands in the register. Only the fields the pile
 * showed (relation, org, fødselsdag) and only while the file still says what the diff said; everything the user wrote
 * stays byte for byte. The previous file travels in the log line's Fortryd (small by the writer's cap), so Fortryd can
 * put it back exactly (§4 r5, r10). A person Hermes only hears about in the import is never created here.
 */
async function opdater(deps: RoomDeps, forslagId: string, h: Hjaelp): Promise<RunRecord> {
  const skriver = ejerOgSkriver(deps, 'opdatere en fil');
  const f0 = (await h.laesState(deps))?.import?.bunke?.forslag.find((x) => x.id === forslagId);
  if (!f0) throw new ActionError('Forslaget findes ikke i rummet', 404);
  if (f0.art !== 'person' || f0.status !== 'findes') throw new ActionError('Kun en person, der allerede findes i din mappe, kan opdateres.');
  return deps.runs.local('gem', async () => h.faerdigt(deps, await h.enAdGangen(deps, async () => {
    const s = (await h.laesState(deps)) ?? h.ny(deps.now());
    const bunke = s.import?.bunke;
    const f = bunke?.forslag.find((x) => x.id === forslagId && x.art === 'person' && x.status === 'findes');
    if (!bunke || !f) return 'Allerede opdateret.'; // a second tap that raced the first writes nothing
    const diff = visDiff(f.diff ?? [], 'person');
    let r: Opdateret;
    try { r = await skriver.opdaterPerson({ navn: f.navn, diff }); } catch (err) { return `Kunne ikke opdatere ${f.navn}: ${err instanceof Error ? err.message : 'kunne ikke gemmes'}`; }
    if (r.udfald === 'forandret') return `${f.navn} er ændret, siden forslaget blev lavet, så Clawco har ikke rørt filen. Behold din fil, eller læs importen igen.`;
    const rest = bunke.forslag.filter((x) => x.id !== f.id);
    let gemt = s.import?.gemt ?? [];
    let trin = s.trin;
    let tekst = `${f.navn} står allerede, som importen siger.`;
    if (r.udfald === 'opdateret') {
      const kilde = `import-${bunke.slags}`;
      const hvad = diff.filter((d) => r.felter.includes(d.felt)).map((d) => `${d.felt} ${d.nu ? `»${d.nu}«` : 'stod ikke i filen'} → »${d.ny}«`);
      const post = await deps.store.appendLog(IMPORT_RUM, {
        kilde: 'henrik', zone: h.korsel, ejer: deps.person.id, handlingId: 'import-opdater',
        fortryd: `lokal:${JSON.stringify({ import: { personer: [], opdateret: [r.kvittering] } })}`,
        tekst: `Opdaterede ${f.navn} (${r.sti}) med det nye fra ${slagsNavn(bunke.slags)} (kilde: ${kilde}): ${hvad.join('; ')}.${r.sprunget.length ? ` ${r.sprunget.join(', ')} er ikke ændret, fordi du har rettet ${r.sprunget.length === 1 ? 'den' : 'dem'} siden.` : ''}`,
      });
      gemt = [...gemt, { logId: post.id, tid: deps.now().toISOString(), slags: bunke.slags, antal: 1 }];
      trin = { ...s.trin, import: { status: 'klaret' as const, tid: deps.now().toISOString() } };
      tekst = `Opdaterede ${f.navn}.`;
    }
    const { import: _gammel, ...udenImport } = s;
    await deps.store.writeState(IMPORT_RUM, { ...udenImport, ...(rest.length || gemt.length ? { import: { ...(rest.length ? { bunke: { ...bunke, forslag: rest } } : {}), ...(gemt.length ? { gemt } : {}) } } : {}), trin });
    return tekst;
  })), { room: IMPORT_RUM, label: 'Start: opdaterer en person' });
}

// ---------- Spring over, Annuller, mappe ----------

async function springForslag(deps: RoomDeps, forslagId: string, h: Hjaelp): Promise<RunRecord> {
  if (!kan(deps.person.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren kan vælge, hvad der tages med.');
  const f = (await h.laesState(deps))?.import?.bunke?.forslag.find((x) => x.id === forslagId);
  if (!f) throw new ActionError('Forslaget findes ikke i rummet', 404);
  return deps.runs.local('afvis', async () => h.faerdigt(deps, await h.enAdGangen(deps, async () => {
    const s = (await h.laesState(deps)) ?? h.ny(deps.now());
    const bunke = s.import?.bunke;
    if (!bunke?.forslag.some((x) => x.id === forslagId)) return 'Allerede væk.';
    const rest = bunke.forslag.filter((x) => x.id !== forslagId);
    const { import: _gammel, ...udenImport } = s;
    const gemt = s.import?.gemt;
    await deps.store.writeState(IMPORT_RUM, { ...udenImport, ...(rest.length || gemt?.length ? { import: { ...(rest.length ? { bunke: { ...bunke, forslag: rest } } : {}), ...(gemt?.length ? { gemt } : {}) } } : {}) });
    await deps.store.appendLog(IMPORT_RUM, { kilde: 'henrik', zone: h.korsel, ejer: deps.person.id, tekst: f.status === 'findes' ? `Beholdt din fil for ${f.navn}.` : `Sprang ${f.navn} over: det bliver ikke gemt.` });
    return 'Sprunget over.';
  })), { room: IMPORT_RUM, label: 'Start: springer et forslag over' });
}

async function annuller(deps: RoomDeps, h: Hjaelp): Promise<RunRecord> {
  if (!kan(deps.person.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren kan vælge, hvad der tages med.');
  return deps.runs.local('afvis', async () => h.faerdigt(deps, await h.enAdGangen(deps, async () => {
    const s = (await h.laesState(deps)) ?? h.ny(deps.now());
    await rydTmp(tmpBase(deps), { alle: true });
    if (!s.import?.bunke) return 'Der var intet at smide væk.';
    const { import: _gammel, ...udenImport } = s;
    const gemt = s.import.gemt;
    await deps.store.writeState(IMPORT_RUM, { ...udenImport, ...(gemt?.length ? { import: { gemt } } : {}) });
    await deps.store.appendLog(IMPORT_RUM, { kilde: 'henrik', zone: h.korsel, ejer: deps.person.id, tekst: 'Smed forslagene væk. Intet blev gemt, og det du uploadede er slettet.' });
    return 'Forslagene er væk.';
  })), { room: IMPORT_RUM, label: 'Start: smider forslagene væk' });
}

async function springTrinOver(deps: RoomDeps, trinStatus: string | undefined, titel: string, h: Hjaelp): Promise<RunRecord> {
  if (!kan(deps.person.rolle, 'aendre-indstillinger')) throw new ActionError('Kun ejeren kan springe trinnet over.');
  if (trinStatus === 'klaret') throw new ActionError('Trinnet er allerede klaret.');
  if (trinStatus === 'sprunget-over') throw new ActionError('Trinnet er allerede sprunget over.');
  return deps.runs.local('afvis', async () => {
    const s = (await h.laesState(deps)) ?? h.ny(deps.now());
    await deps.store.writeState(IMPORT_RUM, { ...s, trin: { ...s.trin, import: { status: 'sprunget-over', tid: deps.now().toISOString() } } });
    await deps.store.appendLog(IMPORT_RUM, { kilde: 'henrik', zone: h.korsel, ejer: deps.person.id, tekst: `Sprang »${titel}« over.` });
    return h.faerdigt(deps, 'Sprunget over.');
  }, { room: IMPORT_RUM, label: 'Start: springer et trin over' });
}

async function lavMappe(deps: RoomDeps, h: Hjaelp): Promise<RunRecord> {
  const skriver = ejerOgSkriver(deps, 'lave notemappen');
  if (!skriver.lavMappe) throw new ActionError('Forbind Noter under Kilder først; så ligger importen dér.');
  if (await skriver.klar()) throw new ActionError('Der er allerede en notemappe.');
  const lav = skriver.lavMappe;
  return deps.runs.local('gem', async () => {
    await lav();
    await deps.store.appendLog(IMPORT_RUM, { kilde: 'henrik', zone: h.korsel, ejer: deps.person.id, tekst: 'Lavede en mappe til dine noter.' });
    return h.faerdigt(deps, 'Mappen er lavet.');
  }, { room: IMPORT_RUM, label: 'Start: laver notemappen' });
}

/** The import's actions; null when `name` is not one of them. `trin`: step 5's status and title, for Spring over. */
export async function importAktion(deps: RoomDeps, name: string, body: Record<string, unknown>, h: Hjaelp, trin: { status: string | undefined; titel: string }): Promise<RunRecord | null> {
  switch (name) {
    case 'import-laes': return laes(deps, body, h);
    case 'import-gem': return gem(deps, false, str(body['forslagId'], 10), h);
    case 'import-gem-alle': return gem(deps, true, '', h);
    case 'import-opdater': return opdater(deps, str(body['forslagId'], 10), h);
    case 'import-spring': return springForslag(deps, str(body['forslagId'], 10), h);
    case 'import-annuller': return annuller(deps, h);
    case 'import-spring-over': return springTrinOver(deps, trin.status, trin.titel, h);
    case 'import-lav-mappe': return lavMappe(deps, h);
    default: return null;
  }
}

// ---------- Fortryd ----------

const erKvit = (v: unknown): v is Kvittering => typeof v === 'object' && v !== null && typeof (v as Kvittering).sti === 'string' && /^[0-9a-f]{64}$/.test((v as Kvittering).sha256) && ((v as Kvittering).forrige === undefined || typeof (v as Kvittering).forrige === 'string');

/** KC-0219: the receipt of an update also carries the file as it was. */
const erOpdKvit = (v: unknown): v is Kvittering & { forrige: string } => erKvit(v) && typeof (v as Kvittering).forrige === 'string';

export type ImportKvitteringer = { personer: Kvittering[]; profil?: Kvittering; opdateret?: Kvittering[] };

/** The receipts a log line carries, or null when the line is not an import's. */
export function importKvitteringer(fortryd: string | undefined): ImportKvitteringer | null {
  if (!fortryd?.startsWith('lokal:')) return null;
  let o: unknown;
  try { o = (JSON.parse(fortryd.slice(6)) as { import?: unknown }).import; } catch { return null; }
  if (typeof o !== 'object' || o === null) return null;
  const { personer, profil, opdateret } = o as { personer?: unknown; profil?: unknown; opdateret?: unknown };
  const opd = Array.isArray(opdateret) ? opdateret.filter(erOpdKvit) : [];
  return { personer: Array.isArray(personer) ? personer.filter(erKvit) : [], ...(erKvit(profil) ? { profil } : {}), ...(opd.length ? { opdateret: opd } : {}) };
}

/** Fortryd of one saved import: removes exactly the files written and puts back the files updated (those still holding what was written), nothing else. */
export function importFortryd(deps: RoomDeps, entry: LogEntry, k: ImportKvitteringer, h: Hjaelp): RunRecord | null {
  const skriver = deps.importSkriver;
  if (!skriver || entry.fortrudt || !kan(deps.person.rolle, 'aendre-indstillinger')) return null;
  return deps.runs.local('fortryd', async () => {
    const fjernet: string[] = [];
    const beholdt: string[] = [];
    for (const kv of k.personer) { const ok = await skriver.fjernPerson(kv).catch(() => false); (ok ? fjernet : beholdt).push(kv.sti); }
    if (k.profil) { const ok = await skriver.fjernProfil(k.profil).catch(() => false); (ok ? fjernet : beholdt).push(k.profil.sti); }
    const gendannet: string[] = [];
    for (const kv of k.opdateret ?? []) { const ok = await skriver.gendanPerson(kv).catch(() => false); (ok ? gendannet : beholdt).push(kv.sti); }
    await h.enAdGangen(deps, async () => {
      await deps.store.updateLog(IMPORT_RUM, entry.id, { fortrudt: deps.now().toISOString() });
      const s = (await h.laesState(deps)) ?? h.ny(deps.now());
      const gemt = (s.import?.gemt ?? []).filter((g) => g.logId !== entry.id);
      const { import: _gammel, ...udenImport } = s;
      const bunke = s.import?.bunke;
      await deps.store.writeState(IMPORT_RUM, { ...udenImport, ...(bunke || gemt.length ? { import: { ...(bunke ? { bunke } : {}), ...(gemt.length ? { gemt } : {}) } } : {}) });
    });
    await deps.store.appendLog(IMPORT_RUM, {
      kilde: 'henrik', zone: h.korsel, ejer: deps.person.id,
      tekst: `Fortrød importen: ${[...(!k.opdateret?.length || k.personer.length || k.profil ? [`fjernede ${fjernet.length} ${fjernet.length === 1 ? 'fil' : 'filer'}`] : []), ...(k.opdateret?.length ? [`satte ${gendannet.length} ${gendannet.length === 1 ? 'fil' : 'filer'} tilbage`] : [])].join(' og ')}${beholdt.length ? `; beholdt ${beholdt.join(', ')}, fordi du har rettet ${beholdt.length === 1 ? 'den' : 'dem'}` : ''}.`,
    });
    return h.faerdigt(deps, 'Fortrudt.');
  }, { room: IMPORT_RUM, label: 'Start: fortryder importen' });
}
