// KC-0205: the one data file (docs/legal/behandlinger.json) behind two documents: the public list of subprocessors
// (docs/legal/underdatabehandlere.da.md and .en.md, shown on the site by scripts/juridisk.ts) and the internal record of
// processing activities (docs/legal/fortegnelse-art30.md, GDPR art. 30, never published). Both are generated, so they
// can never disagree; test/behandlinger.test.ts fails when a file on disk differs from what the data renders.
//   node scripts/behandlinger.ts            says whether the three files are current (exit 1 if not)
//   node scripts/behandlinger.ts --skriv    writes them
// Claude's draft, not legal advice: the content (purposes, legal bases, retention) is the owner's to read and confirm.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Meta, Sprog, Status } from './juridisk.ts';

export type Tekst = { da: string; en: string };
export type Overfoersel = { tredjeland: false } | { tredjeland: true; grundlag: Tekst };
export type Rolle = 'dataansvarlig' | 'databehandler';

export type Behandling = {
  id: string; navn: Tekst; rolle: Rolle; formaal: Tekst; kategorier: Tekst; registrerede: Tekst; retsgrundlag: Tekst;
  opbevaring: Tekst; modtagere: string[]; overfoersel: Overfoersel; sikkerhed: Tekst; bemaerkning?: Tekst;
};

export type Underdatabehandler = {
  id: string; navn: string; hvad: Tekst; hvor: Tekst; land: string; eu: boolean;
  /** The basis for a transfer outside the EU/EEA. Required (non-empty in both languages) when `eu` is false. */
  grundlag: Tekst; dpa: string; ibrugtagning: string | null; kunHvisValgt: boolean;
  /** The hostnames Sky's code contacts; `*.x.y` covers x.y and everything under it. */
  vaerter: string[]; noteVaerter?: Tekst;
};

export type Behandlinger = {
  regel: string;
  ansvarlig: { navn: string; form: Tekst; adresse: Tekst; cvr: Tekst; kontakt: string };
  dato: string; tjekketDPF: string; udgave: { version: string; status: Status };
  behandlinger: Behandling[]; underdatabehandlere: Underdatabehandler[];
  efterTabel: Tekst;
  ikkeUnderdatabehandlere: { titel: Tekst; tekst: Tekst }[];
  loefte: { indledning: Tekst; punkter: Tekst[]; efter: Tekst[] };
  aendringslog: { dato: string; da: string; en: string }[];
};

// --- reading and validating -----------------------------------------------------------------------------------------

type Raa = Record<string, unknown>;
const sti = (p: string, k: string | number): string => (typeof k === 'number' ? `${p}[${k}]` : p ? `${p}.${k}` : k);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function obj(v: unknown, p: string): Raa {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${p || 'top level'}: must be an object`);
  return v as Raa;
}
function str(v: unknown, p: string, tom = false): string {
  if (typeof v !== 'string') throw new Error(`${p}: must be a text`);
  if (!tom && !v.trim()) throw new Error(`${p}: must not be empty`);
  return v;
}
function arr(v: unknown, p: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`${p}: must be a list`);
  return v;
}
function bool(v: unknown, p: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`${p}: must be true or false`);
  return v;
}
function dato(v: unknown, p: string): string {
  const s = str(v, p);
  if (!ISO.test(s)) throw new Error(`${p}: must be a date, YYYY-MM-DD`);
  return s;
}
function tekst(v: unknown, p: string, tom = false): Tekst {
  const o = obj(v, p);
  return { da: str(o['da'], sti(p, 'da'), tom), en: str(o['en'], sti(p, 'en'), tom) };
}

/** Plain schema check of the parsed JSON; throws with the path of the first bad field. */
export function valider(raa: unknown): Behandlinger {
  const o = obj(raa, '');
  const a = obj(o['ansvarlig'], 'ansvarlig');
  const udgave = obj(o['udgave'], 'udgave');
  const status = str(udgave['status'], 'udgave.status');
  if (status !== 'udkast' && status !== 'laest' && status !== 'udgivet') throw new Error('udgave.status: must be udkast, laest or udgivet');
  const version = str(udgave['version'], 'udgave.version');
  if (!/^\d+(\.\d+){1,2}$/.test(version)) throw new Error('udgave.version: must look like 1.1');
  const udbydere = arr(o['underdatabehandlere'], 'underdatabehandlere').map((v, i): Underdatabehandler => {
    const p = sti('underdatabehandlere', i);
    const u = obj(v, p);
    const ib = u['ibrugtagning'];
    const note = u['noteVaerter'];
    return {
      id: str(u['id'], sti(p, 'id')), navn: str(u['navn'], sti(p, 'navn')), hvad: tekst(u['hvad'], sti(p, 'hvad')), hvor: tekst(u['hvor'], sti(p, 'hvor')),
      land: str(u['land'], sti(p, 'land')), eu: bool(u['eu'], sti(p, 'eu')), grundlag: tekst(u['grundlag'], sti(p, 'grundlag'), true),
      dpa: str(u['dpa'], sti(p, 'dpa')), ibrugtagning: ib === null ? null : dato(ib, sti(p, 'ibrugtagning')), kunHvisValgt: bool(u['kunHvisValgt'], sti(p, 'kunHvisValgt')),
      vaerter: arr(u['vaerter'], sti(p, 'vaerter')).map((h, j) => str(h, sti(sti(p, 'vaerter'), j))),
      ...(note === undefined ? {} : { noteVaerter: tekst(note, sti(p, 'noteVaerter')) }),
    };
  });
  const behandlinger = arr(o['behandlinger'], 'behandlinger').map((v, i): Behandling => {
    const p = sti('behandlinger', i);
    const b = obj(v, p);
    const rolle = str(b['rolle'], sti(p, 'rolle'));
    if (rolle !== 'dataansvarlig' && rolle !== 'databehandler') throw new Error(`${sti(p, 'rolle')}: must be dataansvarlig or databehandler`);
    const of = obj(b['overfoersel'], sti(p, 'overfoersel'));
    const tredjeland = bool(of['tredjeland'], sti(p, 'overfoersel.tredjeland'));
    const overfoersel: Overfoersel = tredjeland ? { tredjeland: true, grundlag: tekst(of['grundlag'], sti(p, 'overfoersel.grundlag'), true) } : { tredjeland: false };
    const bem = b['bemaerkning'];
    return {
      id: str(b['id'], sti(p, 'id')), navn: tekst(b['navn'], sti(p, 'navn')), rolle, formaal: tekst(b['formaal'], sti(p, 'formaal')),
      kategorier: tekst(b['kategorier'], sti(p, 'kategorier')), registrerede: tekst(b['registrerede'], sti(p, 'registrerede')),
      retsgrundlag: tekst(b['retsgrundlag'], sti(p, 'retsgrundlag')), opbevaring: tekst(b['opbevaring'], sti(p, 'opbevaring')),
      modtagere: arr(b['modtagere'], sti(p, 'modtagere')).map((m, j) => str(m, sti(sti(p, 'modtagere'), j))),
      overfoersel, sikkerhed: tekst(b['sikkerhed'], sti(p, 'sikkerhed')), ...(bem === undefined ? {} : { bemaerkning: tekst(bem, sti(p, 'bemaerkning')) }),
    };
  });
  const l = obj(o['loefte'], 'loefte');
  return {
    regel: str(o['regel'], 'regel'),
    ansvarlig: { navn: str(a['navn'], 'ansvarlig.navn'), form: tekst(a['form'], 'ansvarlig.form'), adresse: tekst(a['adresse'], 'ansvarlig.adresse'), cvr: tekst(a['cvr'], 'ansvarlig.cvr'), kontakt: str(a['kontakt'], 'ansvarlig.kontakt') },
    dato: dato(o['dato'], 'dato'), tjekketDPF: dato(o['tjekketDPF'], 'tjekketDPF'), udgave: { version, status },
    behandlinger, underdatabehandlere: udbydere,
    efterTabel: tekst(o['efterTabel'], 'efterTabel'),
    ikkeUnderdatabehandlere: arr(o['ikkeUnderdatabehandlere'], 'ikkeUnderdatabehandlere').map((v, i) => {
      const p = sti('ikkeUnderdatabehandlere', i);
      const x = obj(v, p);
      return { titel: tekst(x['titel'], sti(p, 'titel')), tekst: tekst(x['tekst'], sti(p, 'tekst')) };
    }),
    loefte: {
      indledning: tekst(l['indledning'], 'loefte.indledning'),
      punkter: arr(l['punkter'], 'loefte.punkter').map((v, i) => tekst(v, sti('loefte.punkter', i))),
      efter: arr(l['efter'], 'loefte.efter').map((v, i) => tekst(v, sti('loefte.efter', i))),
    },
    aendringslog: arr(o['aendringslog'], 'aendringslog').map((v, i) => {
      const p = sti('aendringslog', i);
      const x = obj(v, p);
      return { dato: dato(x['dato'], sti(p, 'dato')), da: str(x['da'], sti(p, 'da')), en: str(x['en'], sti(p, 'en')) };
    }),
  };
}

export function laesBehandlinger(fil: string): Behandlinger {
  let json: unknown;
  try { json = JSON.parse(readFileSync(fil, 'utf8')); } catch (e) { throw new Error(`${path.basename(fil)}: ${(e as Error).message}`); }
  return valider(json);
}

// --- the invariants ---------------------------------------------------------------------------------------------------

const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const tom = (t: Tekst): boolean => !t.da.trim() || !t.en.trim();

function alleTekster(v: unknown, ud: string[] = []): string[] {
  if (typeof v === 'string') ud.push(v);
  else if (Array.isArray(v)) for (const x of v) alleTekster(x, ud);
  else if (typeof v === 'object' && v !== null) for (const x of Object.values(v)) alleTekster(x, ud);
  return ud;
}

/** What must hold across the file; each message names the entry. An empty list is a clean file. */
export function tjekBehandlinger(d: Behandlinger): string[] {
  const fejl: string[] = [];
  const dubletter = (ider: string[], hvor: string) => {
    ider.forEach((id, i) => { if (ider.indexOf(id) !== i) fejl.push(`${hvor}: id "${id}" is used twice (${hvor}[${ider.indexOf(id)}], ${hvor}[${i}])`); });
  };
  dubletter(d.behandlinger.map((b) => b.id), 'behandlinger');
  dubletter(d.underdatabehandlere.map((u) => u.id), 'underdatabehandlere');
  const udbyder = new Map(d.underdatabehandlere.map((u) => [u.id, u]));
  const brugt = new Set<string>();
  d.behandlinger.forEach((b, i) => {
    const hvem = `behandlinger[${i}] (${b.id})`;
    let ekstern = false;
    for (const m of b.modtagere) {
      const u = udbyder.get(m);
      if (!u) { fejl.push(`${hvem}: modtagere names unknown provider "${m}"`); continue; }
      brugt.add(m);
      if (!u.eu) ekstern = true;
    }
    if (ekstern && !b.overfoersel.tredjeland) fejl.push(`${hvem}: a recipient is outside the EU/EEA, so overfoersel.tredjeland must be true (third country, D13)`);
    if (b.overfoersel.tredjeland && tom(b.overfoersel.grundlag)) fejl.push(`${hvem}: a transfer to a third country needs a non-empty overfoersel.grundlag (basis) in da and en`);
  });
  d.underdatabehandlere.forEach((u, i) => {
    const hvem = `underdatabehandlere[${i}] (${u.id})`;
    if (!u.eu && tom(u.grundlag)) fejl.push(`${hvem}: eu is false, so grundlag (the basis for the transfer) must be non-empty in da and en (D13)`);
    if (!u.vaerter.length || u.vaerter.some((h) => !HOST.test(h))) fejl.push(`${hvem}: vaerter must be a non-empty list of hostnames (lower case, no scheme or path, "*." allowed first)`);
    if (!brugt.has(u.id)) fejl.push(`${hvem}: is not a recipient of any activity (no behandling names it in modtagere)`);
    for (const [felt, t] of [['hvad', u.hvad], ['hvor', u.hvor], ['grundlag', u.grundlag]] as const) {
      for (const s of [t.da, t.en]) if (/[|\n\r]/.test(s)) fejl.push(`${hvem}: ${felt} holds a pipe or a line break, which breaks the table`);
    }
    if (/[|\n\r]/.test(u.navn)) fejl.push(`${hvem}: navn holds a pipe or a line break, which breaks the table`);
  });
  for (const s of alleTekster({ ...d, regel: '' })) {
    for (const m of s.matchAll(/\{[^}]*\}/g)) if (m[0] !== '{dpf}') fejl.push(`unknown placeholder ${m[0]} (only {dpf} is filled in)`);
  }
  const log = d.aendringslog;
  if (!log.length) fejl.push('aendringslog: needs at least the first entry');
  else {
    if (log[log.length - 1]!.dato !== d.dato) fejl.push(`aendringslog: the last entry is dated ${log[log.length - 1]!.dato}, the list is dated ${d.dato}`);
    for (let i = 1; i < log.length; i++) if (log[i]!.dato < log[i - 1]!.dato) fejl.push(`aendringslog[${i}]: entries must be oldest first`);
  }
  for (const [i, l] of log.entries()) if (/[|\n\r]/.test(l.da + l.en)) fejl.push(`aendringslog[${i}]: holds a pipe or a line break, which breaks the table`);
  return fejl;
}

// --- rendering --------------------------------------------------------------------------------------------------------

const MAANEDER = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function langDato(iso: string, sprog: Sprog): string {
  const [aar, m, dag] = iso.split('-').map(Number) as [number, number, number];
  return sprog === 'da' ? `${dag}. ${MAANEDER[m - 1]} ${aar}` : `${dag} ${MONTHS[m - 1]} ${aar}`;
}

/** The text in one language, with {dpf} replaced by the date the Data Privacy Framework list was checked. */
const fyld = (d: Behandlinger, t: Tekst, sprog: Sprog): string => t[sprog].replace(/\{dpf\}/g, langDato(d.tjekketDPF, sprog));

const ORD = {
  da: {
    titel: 'Underdatabehandlere for Clawco Sky', opdateret: 'Sidst opdateret', oversaettelse: '',
    intro: (a: string, f: string) => `En underdatabehandler er en leverandør, som ${a} (${f}) bruger til at levere Clawco Sky, og som kommer i kontakt med personoplysninger. Her er den fulde liste. Den er offentlig, så du kan se, hvem der er med.`,
    hoerer: (dpf: string) => `Listen hører til Privatlivspolitik og Databehandleraftale. Overførselsgrundlagene er tjekket ${dpf} mod den officielle liste over Data Privacy Framework (dataprivacyframework.gov) og mod leverandørernes egne databehandleraftaler.`,
    liste: 'Listen', hoved: ['Navn', 'Hvad de gør', 'Hvor', 'Overførselsgrundlag'], kunValgt: 'kun hvis du vælger det',
    ikke: 'Hvad der ikke er en underdatabehandler', loefte: 'Vores løfte om besked', log: 'Ændringslog', logHoved: ['Dato', 'Ændring'],
    sp: 'Spørgsmål', skriv: (k: string, a: string, f: string, c: string, ad: string) => `Skriv til ${k}. Selskab: ${a} (${f}), CVR ${c}, ${ad}.`,
  },
  en: {
    titel: 'Subprocessors for Clawco Sky', opdateret: 'Last updated', oversaettelse: '> English translation of the Danish text. If the two versions differ, the Danish text applies.\n\n',
    intro: (a: string, f: string) => `A subprocessor is a supplier that ${a} (${f}) uses to provide Clawco Sky and that comes into contact with personal data. This is the full list. It is public, so you can see who is involved.`,
    hoerer: (dpf: string) => `The list belongs with the Privacy Policy and the Data Processing Agreement. The transfer bases were checked on ${dpf} against the official Data Privacy Framework list (dataprivacyframework.gov) and against the suppliers' own data processing agreements.`,
    liste: 'The list', hoved: ['Name', 'What they do', 'Where', 'Basis for transfer'], kunValgt: 'only if you choose it',
    ikke: 'What is not a subprocessor', loefte: 'Our promise to notify you', log: 'Change log', logHoved: ['Date', 'Change'],
    sp: 'Questions', skriv: (k: string, a: string, f: string, c: string, ad: string) => `Write to ${k}. Company: ${a} (${f}), company no. ${c}, ${ad}.`,
  },
} as const;

/** The public text docs/legal/underdatabehandlere.<sprog>.md, frontmatter and all, from the data. */
export function renderUnderdatabehandlere(d: Behandlinger, sprog: Sprog, meta: Pick<Meta, 'version' | 'dato' | 'status'> & { sprog?: Sprog }): string {
  const o = ORD[sprog];
  const f = (t: Tekst) => fyld(d, t, sprog);
  const a = d.ansvarlig;
  const raekker = d.underdatabehandlere.map((u) => `| ${u.navn}${u.kunHvisValgt ? ` (${o.kunValgt})` : ''} | ${f(u.hvad)} | ${f(u.hvor)} | ${f(u.grundlag)} |`);
  const ud: string[] = [
    '---', `version: ${meta.version}`, `dato: ${meta.dato}`, `status: ${meta.status}`, `sprog: ${sprog}`, '---',
    `Version ${meta.version} · ${meta.dato}`, '',
  ];
  if (o.oversaettelse) ud.push(o.oversaettelse.trimEnd(), '');
  ud.push(
    `# ${o.titel}`, '',
    `${o.opdateret}: ${meta.dato}`, '',
    o.intro(a.navn, f(a.form)), '',
    o.hoerer(langDato(d.tjekketDPF, sprog)), '',
    `## ${o.liste}`, '',
    `| ${o.hoved.join(' | ')} |`, `|${o.hoved.map(() => '---').join('|')}|`, ...raekker, '',
    f(d.efterTabel), '',
    `## ${o.ikke}`, '',
  );
  for (const x of d.ikkeUnderdatabehandlere) ud.push(`**${f(x.titel)}.** ${f(x.tekst)}`, '');
  ud.push(`## ${o.loefte}`, '', f(d.loefte.indledning), '', ...d.loefte.punkter.map((p) => `- ${f(p)}`), '');
  for (const x of d.loefte.efter) ud.push(f(x), '');
  ud.push(
    `## ${o.log}`, '', `| ${o.logHoved.join(' | ')} |`, `|${o.logHoved.map(() => '---').join('|')}|`,
    ...d.aendringslog.map((l) => `| ${l.dato} | ${l[sprog]} |`), '',
    `## ${o.sp}`, '', o.skriv(a.kontakt, a.navn, f(a.form), f(a.cvr), f(a.adresse)),
  );
  return `${ud.join('\n')}\n`;
}

/** The internal record of processing activities (GDPR art. 30), Danish only, from the same data. */
export function renderFortegnelse(d: Behandlinger): string {
  const f = (t: Tekst) => fyld(d, t, 'da');
  const navn = (id: string) => d.underdatabehandlere.find((u) => u.id === id)?.navn ?? id;
  const a = d.ansvarlig;
  const ud: string[] = [
    '# Fortegnelse over behandlinger (GDPR art. 30) for Clawco Sky', '',
    '> Genereret fra `docs/legal/behandlinger.json` af `scripts/behandlinger.ts`. Ret den ikke i hånden: ret datafilen og kør `node scripts/behandlinger.ts --skriv`.',
    '> Internt dokument, udgives ikke. Et udkast: formål, retsgrundlag og opbevaring er skrevet ud fra de udgivne tekster, er ikke juridisk rådgivning og er ikke endeligt bekræftet.', '',
    `Datafilens dato: ${d.dato} · Overførselsgrundlagene tjekket mod Data Privacy Framework-listen: ${d.tjekketDPF}`, '',
    '## Ansvarlig', '',
    `- **Navn:** ${a.navn} (${f(a.form)})`,
    `- **Adresse:** ${f(a.adresse)}`,
    `- **CVR:** ${f(a.cvr)}`,
    `- **Kontakt:** ${a.kontakt}`,
    '- **Databeskyttelsesrådgiver:** ikke udpeget', '',
    '## Behandlinger', '',
    'Rollen er dataansvarlig for kontooplysninger og betalingsstatus og databehandler for indholdet i kundens instans (databehandleraftalen, bilag A).', '',
  ];
  for (const b of d.behandlinger) {
    ud.push(
      `### ${b.id} · ${f(b.navn)}`, '',
      `- **Rolle:** ${b.rolle}`,
      `- **Formål:** ${f(b.formaal)}`,
      `- **Kategorier af personoplysninger:** ${f(b.kategorier)}`,
      `- **Kategorier af registrerede:** ${f(b.registrerede)}`,
      `- **Retsgrundlag:** ${f(b.retsgrundlag)}`,
      `- **Opbevaring og sletning:** ${f(b.opbevaring)}`,
      `- **Modtagere (underdatabehandlere):** ${b.modtagere.length ? b.modtagere.map(navn).join('; ') : 'ingen'}`,
      `- **Overførsel til tredjeland:** ${b.overfoersel.tredjeland ? `ja. Grundlag: ${f(b.overfoersel.grundlag)}` : 'nej'}`,
      `- **Sikkerhedsforanstaltninger:** ${f(b.sikkerhed)}`,
    );
    if (b.bemaerkning) ud.push(`- **Bemærkning:** ${f(b.bemaerkning)}`);
    ud.push('');
  }
  ud.push(
    '## Underdatabehandlere', '',
    '| Navn | Land | EU/EØS | Hvad de gør | Hvor | Overførselsgrundlag | Databehandleraftale | Ibrugtaget | Kun hvis valgt | Værter |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...d.underdatabehandlere.map((u) => `| ${u.navn} | ${u.land} | ${u.eu ? 'ja' : 'nej'} | ${f(u.hvad)} | ${f(u.hvor)} | ${f(u.grundlag) || 'ikke nødvendigt'} | ${u.dpa} | ${u.ibrugtagning ?? 'ikke angivet'} | ${u.kunHvisValgt ? 'ja' : 'nej'} | ${u.vaerter.map((h) => `\`${h}\``).join(', ')} |`),
    '',
  );
  const noter = d.underdatabehandlere.filter((u) => u.noteVaerter);
  if (noter.length) ud.push(...noter.map((u) => `${u.navn}, om værterne: ${f(u.noteVaerter!)}`), '');
  ud.push(f(d.efterTabel), '', '## Ikke underdatabehandlere', '');
  for (const x of d.ikkeUnderdatabehandlere) ud.push(`**${f(x.titel)}.** ${f(x.tekst)}`, '');
  ud.push('## Reglen for datafilen', '', d.regel);
  return `${ud.join('\n')}\n`;
}

// --- the three files on disk ------------------------------------------------------------------------------------------

const FIL = { data: 'docs/legal/behandlinger.json', da: 'docs/legal/underdatabehandlere.da.md', en: 'docs/legal/underdatabehandlere.en.md', art30: 'docs/legal/fortegnelse-art30.md' } as const;

function genererede(rod: string): { fil: string; indhold: string }[] {
  const d = laesBehandlinger(path.join(rod, FIL.data));
  const fejl = tjekBehandlinger(d);
  if (fejl.length) throw new Error(`behandlinger.json breaks its own rules:\n  ${fejl.join('\n  ')}`);
  const m = { version: d.udgave.version, dato: d.dato, status: d.udgave.status };
  return [
    { fil: FIL.da, indhold: renderUnderdatabehandlere(d, 'da', { ...m, sprog: 'da' }) },
    { fil: FIL.en, indhold: renderUnderdatabehandlere(d, 'en', { ...m, sprog: 'en' }) },
    { fil: FIL.art30, indhold: renderFortegnelse(d) },
  ];
}

/** The generated files that differ from what the data renders (missing counts as different). Empty = current. */
export function tjekFiler(rod: string): string[] {
  return genererede(rod).filter((g) => {
    const p = path.join(rod, g.fil);
    return !existsSync(p) || readFileSync(p, 'utf8') !== g.indhold;
  }).map((g) => g.fil);
}

export function skrivFiler(rod: string): string[] {
  const skrevet: string[] = [];
  for (const g of genererede(rod)) {
    const p = path.join(rod, g.fil);
    mkdirSync(path.dirname(p), { recursive: true });
    if (!existsSync(p) || readFileSync(p, 'utf8') !== g.indhold) { writeFileSync(p, g.indhold); skrevet.push(g.fil); }
  }
  return skrevet;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const rod = path.resolve(import.meta.dirname, '..');
  if (process.argv.includes('--skriv')) {
    const skrevet = skrivFiler(rod);
    console.log(skrevet.length ? `skrev: ${skrevet.join(', ')}` : 'ingen ændringer: de tre filer er allerede ajour');
  } else {
    const forskel = tjekFiler(rod);
    if (forskel.length) {
      console.error(`ikke ajour med ${FIL.data}: ${forskel.join(', ')}\nkør: node scripts/behandlinger.ts --skriv`);
      process.exitCode = 1;
    } else console.log('de tre genererede filer er ajour med docs/legal/behandlinger.json');
  }
}
