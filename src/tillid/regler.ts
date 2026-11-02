// The trust ladder's rules as Henrik's own text (KC-0142, spec §4/§5): one
// markdown file in his vault, one rule per "## R-0004 · Titel" section with
// bullet lines trin / gaelder / oprindelse / status and then free text. Pure:
// text in, rules out. Invariants: ids are monotonic and never reused (the
// header's naeste-id remembers deleted ones); a rule with an unknown trin, a
// duplicate id or a missing field is ignored and listed as invalid, never
// half-applied; a file that is not a rules file at all throws ReglerFejl (the
// caller fails closed to trin 0).

import { ULAESELIG, tillidTekst } from './tekster.ts';
import { erTrin, trinNavn, TRIN, type Trin } from './trin.ts';

/** 0 see · 1 sort · 2 book-keep · 3 prepare · 4 execute with undo (the ladder lives in trin.ts, KC-0143). */
export type { Trin };
export const OPRINDELSER = ['ret', 'ikke-relevant', 'haand', 'import'] as const;
export type Oprindelse = (typeof OPRINDELSER)[number];
export const STATUSSER = ['aktiv', 'pause'] as const;

export type Regel = {
  id: string;
  titel: string;
  tekst: string;
  trin: Trin;
  gaelder: { kilde: string; slags?: string };
  oprindelse: { art: Oprindelse; dato: string; kortId?: string };
  status: (typeof STATUSSER)[number];
};

/** A section that is not followed: its id (when it has one), its heading, why, and its text exactly as written. */
export type UgyldigRegel = { id?: string; overskrift: string; hvorfor: string; raa: string };

export type Regelsaet = { naesteId: number; regler: Regel[]; ugyldige: UgyldigRegel[] };

/** The file as a whole is not a rules file. */
export class ReglerFejl extends Error {
  constructor(hvorfor: string) { super(hvorfor); this.name = 'ReglerFejl'; }
}

const ID = /^R-(\d{4,})$/;
const DATO = /^\d{4}-\d{2}-\d{2}$/;
const OVERSKRIFT = /^##(?!#)\s*(.*?)\s*$/;
const MED_ID = /^(R-\d{4,})\s*[·:–—-]\s*(.*)$/;
const NAESTE = /^\s*n(?:ae|æ)ste-id\s*:\s*(.*?)\s*$/i;
const NOEGLE = /^\s*(?:[-*]\s+)?([a-zæøå-]+)\s*:\s*(.*?)\s*$/i;
const NOEGLER: Record<string, 'trin' | 'gaelder' | 'oprindelse' | 'status'> = { trin: 'trin', gaelder: 'gaelder', 'gælder': 'gaelder', oprindelse: 'oprindelse', status: 'status' };
const FELT_NAVN = { trin: 'trin', gaelder: 'gælder', oprindelse: 'oprindelse', status: 'status' } as const;
const OPRINDELSE = /^(ret|ikke-relevant|haand|hånd|import)\s+(\d{4}-\d{2}-\d{2})(?:\s*\(\s*kort\s+([^\s)]+)\s*\))?$/i;

export const regelId = (n: number): string => `R-${String(n).padStart(4, '0')}`;
const idNr = (id: string): number => Number(ID.exec(id)?.[1] ?? 0);

const tekstLinje = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !/[\r\n]/.test(v);

/** The one check of a whole rule (parsed from the file or proposed by the app). Returns a fresh rule or the first fault. */
export function validerRegel(v: unknown): Regel | { fejl: string } {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || !ID.test(o['id'])) return { fejl: 'ugyldigt id (skal være R- og fire cifre, fx R-0004)' };
  if (!tekstLinje(o['titel'])) return { fejl: 'mangler titel' };
  if (typeof o['tekst'] !== 'string') return { fejl: 'mangler tekst' };
  if (o['tekst'].split('\n').some((l) => OVERSKRIFT.test(l) || NAESTE.test(l))) return { fejl: 'teksten må ikke have en linje, der starter med ## eller naeste-id' };
  if (!erTrin(o['trin'])) return { fejl: 'ukendt trin (skal være 0, 1, 2, 3 eller 4)' };
  const g = (typeof o['gaelder'] === 'object' && o['gaelder'] !== null ? o['gaelder'] : {}) as Record<string, unknown>;
  if (!tekstLinje(g['kilde']) || g['kilde'].includes('/')) return { fejl: 'mangler gælder (fx "mail / regning")' };
  if (g['slags'] !== undefined && (!tekstLinje(g['slags']) || g['slags'].includes('/'))) return { fejl: 'ugyldig gælder' };
  const op = (typeof o['oprindelse'] === 'object' && o['oprindelse'] !== null ? o['oprindelse'] : {}) as Record<string, unknown>;
  if (!OPRINDELSER.includes(op['art'] as Oprindelse) || typeof op['dato'] !== 'string' || !DATO.test(op['dato'])) return { fejl: 'ugyldig oprindelse (fx "ret 2026-11-02 (kort k_x)")' };
  if (op['kortId'] !== undefined && (typeof op['kortId'] !== 'string' || !/^[^\s)]+$/.test(op['kortId']))) return { fejl: 'ugyldig oprindelse (kort-id)' };
  if (!STATUSSER.includes(o['status'] as Regel['status'])) return { fejl: 'ukendt status (skal være aktiv eller pause)' };
  return {
    id: o['id'], titel: o['titel'].trim(), tekst: o['tekst'].trim(), trin: o['trin'] as Trin,
    gaelder: { kilde: g['kilde'].trim(), ...(g['slags'] !== undefined ? { slags: (g['slags'] as string).trim() } : {}) },
    oprindelse: { art: op['art'] as Oprindelse, dato: op['dato'], ...(op['kortId'] !== undefined ? { kortId: op['kortId'] as string } : {}) },
    status: o['status'] as Regel['status'],
  };
}

type Afsnit = { overskrift: string; linjer: string[]; raa: string };

/** One section → a rule, or why not. Fields as strings first; the shape check is validerRegel. */
function laesAfsnit(a: Afsnit): Regel | { id?: string; fejl: string } {
  const m = MED_ID.exec(a.overskrift);
  if (!m) return { fejl: 'overskriften mangler et id (fx "## R-0004 · Titel")' };
  const id = m[1] as string;
  const felter: Partial<Record<'trin' | 'gaelder' | 'oprindelse' | 'status', string>> = {};
  let i = 0;
  for (; i < a.linjer.length; i++) {
    const l = a.linjer[i] as string;
    if (l.trim() === '') { if (Object.keys(felter).length > 0) break; continue; }
    const k = NOEGLE.exec(l);
    const navn = k ? NOEGLER[(k[1] as string).toLowerCase()] : undefined;
    if (!k || !navn) break;
    if (felter[navn] !== undefined) return { id, fejl: `${FELT_NAVN[navn]} står to gange` };
    felter[navn] = k[2] as string;
  }
  for (const navn of ['trin', 'gaelder', 'oprindelse', 'status'] as const) if (felter[navn] === undefined) return { id, fejl: `mangler ${FELT_NAVN[navn]}` };
  const trin = felter.trin as string;
  if (!/^[0-4]$/.test(trin)) return { id, fejl: `ukendt trin "${trin}" (skal være 0, 1, 2, 3 eller 4)` };
  const [kilde = '', slags, ...over] = (felter.gaelder as string).split('/').map((s) => s.trim());
  if (!kilde || over.length > 0 || slags === '') return { id, fejl: 'ugyldig gælder (fx "mail / regning")' };
  const op = OPRINDELSE.exec(felter.oprindelse as string);
  if (!op) return { id, fejl: 'ugyldig oprindelse (fx "ret 2026-11-02 (kort k_x)")' };
  const art = (op[1] as string).toLowerCase() === 'hånd' ? 'haand' : (op[1] as string).toLowerCase();
  const r = validerRegel({
    id, titel: m[2], tekst: a.linjer.slice(i).join('\n'), trin: Number(trin),
    gaelder: { kilde: kilde.toLowerCase(), ...(slags !== undefined ? { slags: slags.toLowerCase() } : {}) },
    oprindelse: { art, dato: op[2], ...(op[3] ? { kortId: op[3] } : {}) },
    status: (felter.status as string).toLowerCase(),
  });
  return 'fejl' in r ? { id, fejl: r.fejl } : r;
}

/** The whole file. Throws ReglerFejl when it has no (or more than one, or a malformed) naeste-id line before the first rule. */
export function parseRegler(md: string): Regelsaet {
  const linjer = md.replace(/\r\n?/g, '\n').split('\n');
  const foerste = linjer.findIndex((l) => OVERSKRIFT.test(l));
  const hoved = foerste === -1 ? linjer : linjer.slice(0, foerste);
  const naeste = hoved.map((l) => NAESTE.exec(l)).filter((m) => m !== null);
  if (naeste.length !== 1) throw new ReglerFejl(naeste.length === 0 ? ULAESELIG.naesteMangler : ULAESELIG.naesteFlere);
  const nr = ID.exec(naeste[0]?.[1] ?? '');
  if (!nr) throw new ReglerFejl(ULAESELIG.naesteForm);

  const afsnit: Afsnit[] = [];
  if (foerste !== -1) {
    for (const l of linjer.slice(foerste)) {
      const o = OVERSKRIFT.exec(l);
      if (o) afsnit.push({ overskrift: o[1] as string, linjer: [], raa: '' });
      else afsnit[afsnit.length - 1]?.linjer.push(l);
    }
    for (const a of afsnit) a.raa = [`## ${a.overskrift}`, ...a.linjer].join('\n').trim();
  }
  const laest = afsnit.map((a) => ({ a, r: laesAfsnit(a) }));
  const ider = laest.map(({ r }) => r.id).filter((id): id is string => id !== undefined);
  const dobbelt = new Set(ider.filter((id, i) => ider.indexOf(id) !== i));
  const regler: Regel[] = [];
  const ugyldige: UgyldigRegel[] = [];
  for (const { a, r } of laest) {
    const fejl = 'fejl' in r ? r.fejl : r.id && dobbelt.has(r.id) ? `${r.id} står to gange i filen` : undefined;
    if (fejl === undefined) { regler.push(r as Regel); continue; }
    ugyldige.push({ ...(r.id ? { id: r.id } : {}), overskrift: a.overskrift, hvorfor: r.id && dobbelt.has(r.id) ? `${r.id} står to gange i filen` : fejl, raa: a.raa });
  }
  return { naesteId: Math.max(Number(nr[1]), ...ider.map((id) => idNr(id) + 1)), regler, ugyldige };
}

/** The file's introduction, in the language of the request; the step names are the ladder's (trin.ts), named in that language. */
const indledning = (): string => tillidTekst().indledning(TRIN.map((t) => `${t.trin} ${trinNavn(t.trin)}`).join(', '));

function regelTekst(r: Regel): string {
  const g = r.gaelder.slags ? `${r.gaelder.kilde} / ${r.gaelder.slags}` : r.gaelder.kilde;
  const op = `${r.oprindelse.art} ${r.oprindelse.dato}${r.oprindelse.kortId ? ` (kort ${r.oprindelse.kortId})` : ''}`;
  return `## ${r.id} · ${r.titel}\n- trin: ${r.trin}\n- gaelder: ${g}\n- oprindelse: ${op}\n- status: ${r.status}${r.tekst ? `\n\n${r.tekst}` : ''}`;
}

/** The file for `s`: valid rules first, then every invalid section exactly as Henrik wrote it (the app never drops his text). */
export function serialiserRegler(s: Regelsaet): string {
  const dele = [tillidTekst().reglerTitel, `naeste-id: ${regelId(s.naesteId)}`, indledning(), ...s.regler.map(regelTekst), ...s.ugyldige.map((u) => u.raa)];
  return `${dele.join('\n\n')}\n`;
}

/** Adds a rule under the next id; the id is taken for good. Throws when the rule is not valid. */
export function nyRegel(s: Regelsaet, felter: Omit<Regel, 'id'>): { saet: Regelsaet; regel: Regel } {
  const r = validerRegel({ ...felter, id: regelId(s.naesteId) });
  if ('fejl' in r) throw new Error(`reglen er ikke gyldig: ${r.fejl}`);
  return { saet: { ...s, naesteId: s.naesteId + 1, regler: [...s.regler, r] }, regel: r };
}
