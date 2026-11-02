// The beta's three measures as pure functions (KC-0203): retention from the gateway's own sight, and the closed schema
// a tenant's GET /api/beta/maal answer must fit. The definitions live here so they cannot drift.
//
// Closed schema (invariant, AGENTS §0 r2): every object has exactly the fields below; an unknown field, a wrong type
// or an out-of-range number refuses the WHOLE pull (null) and nothing is stored. Without consent (samtykke:false) the
// answer carries nothing but feedback the person sent on purpose; numbers sent anyway refuse the pull. The only
// free text is the feedback line, at most 500 characters.
const DAG_MS = 86_400_000;
const INT_MAX = 2_147_483_647;
// Control, format (bidi marks) and line/paragraph separator characters: all become a space.
const KONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;

const dagStart = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** The day's number counted from the start's UTC day (day 1). `dag` is 'YYYY-MM-DD'. */
export function dagNr(dag: string, start: Date): number {
  const [y, m, d] = dag.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y, m - 1, d) - dagStart(start)) / DAG_MS) + 1;
}

/** Retained at day 14: at least 3 distinct days in days 8-14 and at least one in days 13-15 (day 1 = the UTC day of
 *  `start`, the moment the tenant was klar). `dage` are the UTC days the gateway saw the household ('YYYY-MM-DD'). */
export function fastholdtDag14(dage: readonly string[], start: Date): boolean {
  const nr = new Set(dage.map((d) => dagNr(d, start)));
  let uge2 = 0;
  for (const n of nr) if (n >= 8 && n <= 14) uge2++;
  return uge2 >= 3 && [13, 14, 15].some((n) => nr.has(n));
}

export type Foerstevaerdi = { kildeForbundetMs: number; foersteVaerdiMs: number };
export type DagTal = { dag: string; kraever: number };
export type Svar = { dag: 3 | 7 | 14; vurdering: number; tekst: string | null; betale: 'ja' | 'maaske' | 'nej' | null; tid: Date };
export type Maal = { samtykke: boolean; foersteVaerdi: Foerstevaerdi | null; dage: DagTal[]; feedback: Svar[] };

const erObjekt = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const kunNoegler = (o: Record<string, unknown>, tilladt: readonly string[]): boolean => Object.keys(o).every((k) => tilladt.includes(k));
const erMs = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= INT_MAX;

function gyldigDag(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === v;
}

function validerSvar(v: unknown): Svar | null {
  if (!erObjekt(v) || !kunNoegler(v, ['dag', 'vurdering', 'tekst', 'betale', 'tid'])) return null;
  const { dag, vurdering, tekst, betale, tid } = v;
  if (dag !== 3 && dag !== 7 && dag !== 14) return null;
  if (typeof vurdering !== 'number' || !Number.isInteger(vurdering) || vurdering < 1 || vurdering > 5) return null;
  let t: string | null = null;
  if (tekst !== undefined && tekst !== null) {
    if (typeof tekst !== 'string') return null;
    t = tekst.replace(KONTROL, ' ').trim();
    if (t.length > 500) return null;
    if (t === '') t = null;
  }
  if (betale !== undefined && betale !== null && betale !== 'ja' && betale !== 'maaske' && betale !== 'nej') return null;
  if (typeof tid !== 'string') return null;
  const tidspunkt = new Date(tid);
  if (Number.isNaN(tidspunkt.getTime())) return null;
  return { dag, vurdering, tekst: t, betale: betale ?? null, tid: tidspunkt };
}

/** The tenant's answer checked against the closed schema; null = refuse the whole pull. */
export function valider(raa: unknown): Maal | null {
  if (!erObjekt(raa) || !kunNoegler(raa, ['version', 'samtykke', 'foersteVaerdi', 'dage', 'feedback'])) return null;
  if (raa['version'] !== 1 || typeof raa['samtykke'] !== 'boolean') return null;
  const samtykke = raa['samtykke'];
  // Feedback first: it is allowed with and without consent.
  const fb = raa['feedback'];
  const feedback: Svar[] = [];
  if (fb !== undefined) {
    if (!Array.isArray(fb) || fb.length > 3) return null;
    for (const s of fb) { const r = validerSvar(s); if (!r) return null; feedback.push(r); }
    if (new Set(feedback.map((s) => s.dag)).size !== feedback.length) return null;
  }
  const fv = raa['foersteVaerdi'];
  const dg = raa['dage'];
  const tomtFv = fv === undefined || fv === null;
  const tomtDg = dg === undefined || (Array.isArray(dg) && dg.length === 0);
  if (!samtykke) {
    if (!tomtFv || !tomtDg) return null;
    return { samtykke: false, foersteVaerdi: null, dage: [], feedback };
  }
  let foersteVaerdi: Foerstevaerdi | null = null;
  if (!tomtFv) {
    if (!erObjekt(fv) || !kunNoegler(fv, ['kildeForbundetMs', 'foersteVaerdiMs']) || !erMs(fv['kildeForbundetMs']) || !erMs(fv['foersteVaerdiMs'])) return null;
    foersteVaerdi = { kildeForbundetMs: fv['kildeForbundetMs'], foersteVaerdiMs: fv['foersteVaerdiMs'] };
  }
  const dage: DagTal[] = [];
  if (dg !== undefined) {
    if (!Array.isArray(dg) || dg.length > 21) return null;
    for (const r of dg) {
      if (!erObjekt(r) || !kunNoegler(r, ['dag', 'kraever']) || !gyldigDag(r['dag']) || typeof r['kraever'] !== 'number' || !Number.isInteger(r['kraever']) || r['kraever'] < 0 || r['kraever'] > 100_000) return null;
      dage.push({ dag: r['dag'], kraever: r['kraever'] });
    }
    if (new Set(dage.map((r) => r.dag)).size !== dage.length) return null;
  }
  return { samtykke: true, foersteVaerdi, dage, feedback };
}
