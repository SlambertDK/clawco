// The beta report (KC-0203): the three measures, the feedback and the draft end criteria (a)-(d) from the ticket, from
// the numbers Sky holds. A pure function (`lavRapport`) over what `laesHusstande` reads, so the criteria can be checked
// on fixtures. Nothing in the report names an account, an address or a tenant: it is read by Henrik through the session.
//
// Definitions (the ticket's, so they cannot drift): ran 14 days = the tenant has been klar for 14 days or more;
// retained = fastholdtDag14 (maal.ts); "første værdi" after a source is connected = foerste_vaerdi_ms (KC-0128's budget);
// the total from sign-up = tilmelding_ms + kilde_forbundet_ms + foerste_vaerdi_ms; "ting der krævede dig" is compared on
// day 3 and day 14 (day 1 = the UTC day the tenant was klar); the rating is each household's latest answer.
// (e) and (f) cannot be computed (incidents, a real restore, betaling:tjek, reviewed legal drafts): marked manuelt.
import type { Database } from '../db/pool.ts';
import { dagNr, fastholdtDag14 } from './maal.ts';

const DAG_MS = 86_400_000;

export type HusstandData = {
  kontoId: number;
  samtykke: boolean;
  bestilt: Date | null;
  klar: Date | null;
  tilmeldingMs: number | null;
  kildeForbundetMs: number | null;
  foersteVaerdiMs: number | null;
  /** The UTC days the gateway saw the household ('YYYY-MM-DD'). */
  sete: string[];
  dagtal: { dag: string; kraever: number }[];
  feedback: { dag: number; vurdering: number; tekst: string | null; betale: 'ja' | 'maaske' | 'nej' | null }[];
};

export type Kriterium = { id: 'a' | 'b' | 'c' | 'd' | 'e' | 'f'; /** null = manuelt */ opfyldt: boolean | null; tekst: string };
export type Rapport = {
  husstande: number;
  klare: number;
  koert14: number;
  fastholdt14: { n: number; af: number };
  provisionering: { n: number; medianMs: number | null; p95Ms: number | null };
  foersteVaerdi: { n: number; medianEfterKildeMs: number | null; medianFraTilmeldingMs: number | null };
  kraever: { delte: number; sammenlignet: number; lavere: number };
  vurdering: { n: number; gennemsnit: number | null };
  betale: { ja: number; maaske: number; nej: number };
  tekster: { dag: number; vurdering: number; tekst: string }[];
  kriterier: Kriterium[];
};

export function median(v: readonly number[]): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Nearest-rank percentile (p in 1..100). */
export function percentil(v: readonly number[], p: number): number | null {
  if (v.length === 0) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

const sek = (ms: number | null): string => (ms === null ? 'ukendt' : `${Math.round(ms / 1000)} s`);
const tal1 = (n: number): string => n.toFixed(1).replace('.', ',');

export function lavRapport(hs: readonly HusstandData[], nu: Date): Rapport {
  const klare = hs.filter((x) => x.klar !== null);
  const koert = klare.filter((x) => nu.getTime() - x.klar!.getTime() >= 14 * DAG_MS);
  const fastholdt = koert.filter((x) => fastholdtDag14(x.sete, x.klar!)).length;

  const opretMs = klare.filter((x) => x.bestilt !== null).map((x) => x.klar!.getTime() - x.bestilt!.getTime());
  const provisionering = { n: opretMs.length, medianMs: median(opretMs), p95Ms: percentil(opretMs, 95) };

  const delere = hs.filter((x) => x.samtykke);
  const efterKilde = delere.flatMap((x) => (x.foersteVaerdiMs === null ? [] : [x.foersteVaerdiMs]));
  const fraTilmelding = delere.flatMap((x) => (x.tilmeldingMs !== null && x.kildeForbundetMs !== null && x.foersteVaerdiMs !== null ? [x.tilmeldingMs + x.kildeForbundetMs + x.foersteVaerdiMs] : []));
  const foersteVaerdi = { n: efterKilde.length, medianEfterKildeMs: median(efterKilde), medianFraTilmeldingMs: median(fraTilmelding) };

  let sammenlignet = 0;
  let lavere = 0;
  for (const x of delere) {
    if (!x.klar) continue;
    const pr = (nr: number): number | undefined => x.dagtal.find((d) => dagNr(d.dag, x.klar!) === nr)?.kraever;
    const tre = pr(3);
    const fjorten = pr(14);
    if (tre === undefined || fjorten === undefined) continue;
    sammenlignet++;
    if (fjorten < tre) lavere++;
  }
  const kraever = { delte: delere.length, sammenlignet, lavere };

  const seneste = hs.flatMap((x) => [...x.feedback].sort((a, b) => b.dag - a.dag).slice(0, 1));
  const vurdering = { n: seneste.length, gennemsnit: seneste.length ? seneste.reduce((s, f) => s + f.vurdering, 0) / seneste.length : null };
  const betale = { ja: 0, maaske: 0, nej: 0 };
  for (const x of hs) {
    const b = [...x.feedback].sort((p, q) => q.dag - p.dag).find((f) => f.betale !== null)?.betale;
    if (b) betale[b]++;
  }
  const tekster = hs.flatMap((x) => x.feedback.flatMap((f) => (f.tekst ? [{ dag: f.dag, vurdering: f.vurdering, tekst: f.tekst }] : [])))
    .sort((a, b) => a.dag - b.dag || a.vurdering - b.vurdering || a.tekst.localeCompare(b.tekst, 'da'));

  const kriterier: Kriterium[] = [];
  {
    const ok = koert.length >= 10 && fastholdt >= 7;
    kriterier.push({ id: 'a', opfyldt: ok, tekst: koert.length < 10
      ? `kun ${koert.length} af 10 husstande har kørt 14 dage; fastholdt dag 14: ${fastholdt} af ${koert.length} (kravet er mindst 7 af 10)`
      : `fastholdt dag 14: ${fastholdt} af ${koert.length} (kravet er mindst 7 af 10)` });
  }
  {
    const vaerdiOk = foersteVaerdi.medianEfterKildeMs !== null && foersteVaerdi.medianEfterKildeMs <= 120_000;
    const opretOk = provisionering.p95Ms !== null && provisionering.p95Ms <= 120_000;
    kriterier.push({ id: 'b', opfyldt: vaerdiOk && opretOk,
      tekst: `første værdi efter en kilde: median ${sek(foersteVaerdi.medianEfterKildeMs)} (${foersteVaerdi.n} husstande, kravet er højst 120 s); oprettelse: p95 ${sek(provisionering.p95Ms)} (${provisionering.n} husstande, kravet er højst 120 s)` });
  }
  kriterier.push({ id: 'c', opfyldt: lavere >= 6,
    tekst: `lavere på dag 14 end på dag 3 hos ${lavere} af ${sammenlignet} husstande, der deler tal og har begge dage (${kraever.delte} deler tal; kravet er mindst 6)` });
  {
    const betaler = betale.ja + betale.maaske;
    const gns = vurdering.gennemsnit;
    kriterier.push({ id: 'd', opfyldt: gns !== null && gns >= 4 && betaler >= 6,
      tekst: `gennemsnitlig vurdering ${gns === null ? 'ukendt' : tal1(gns)} af 5 (${vurdering.n} svar, kravet er mindst 4); ${betaler} svarer ja eller måske til at betale (kravet er mindst 6)` });
  }
  kriterier.push({ id: 'e', opfyldt: null, tekst: 'ingen datatab, ingen adgang på tværs af kunder, ingen uløst alvorlig fejl, og én rigtig gendannelse af en betatenant med ejerens ja: vurderes af Claude og Henrik' });
  kriterier.push({ id: 'f', opfyldt: null, tekst: 'betaling:tjek grøn på den nuværende udgave og de juridiske udkast gennemgået: vurderes af Claude og Henrik' });

  return { husstande: hs.length, klare: klare.length, koert14: koert.length, fastholdt14: { n: fastholdt, af: koert.length }, provisionering, foersteVaerdi, kraever, vurdering, betale, tekster, kriterier };
}

/** The report as plain Danish, one fact per line. */
export function rapportTekst(r: Rapport): string[] {
  const l: string[] = [];
  l.push(`Betaen: ${r.husstande} husstande har indløst en kode, ${r.klare} har en klar Clawco, ${r.koert14} har kørt mindst 14 dage.`);
  l.push(`Fastholdelse dag 14: ${r.fastholdt14.n} af ${r.fastholdt14.af} husstande, der har kørt 14 dage (mindst tre dage i dag 8-14 og én i dag 13-15).`);
  l.push(`Oprettelse (bestilt til klar): median ${sek(r.provisionering.medianMs)}, p95 ${sek(r.provisionering.p95Ms)} (${r.provisionering.n} husstande).`);
  l.push(`Første værdi efter en forbundet kilde: median ${sek(r.foersteVaerdi.medianEfterKildeMs)} (${r.foersteVaerdi.n} husstande, der deler tal).`);
  l.push(`Fra tilmelding til første værdi: median ${sek(r.foersteVaerdi.medianFraTilmeldingMs)}.`);
  l.push(`Ting der krævede dig: lavere på dag 14 end på dag 3 hos ${r.kraever.lavere} af ${r.kraever.sammenlignet} husstande med begge dage (${r.kraever.delte} husstande deler tal).`);
  l.push(`Vurdering: ${r.vurdering.gennemsnit === null ? 'ingen svar endnu' : `gennemsnit ${tal1(r.vurdering.gennemsnit)} af 5`} (${r.vurdering.n} svar, hver husstands seneste).`);
  l.push(`Ville betale: ${r.betale.ja} ja, ${r.betale.maaske} måske, ${r.betale.nej} nej.`);
  if (r.tekster.length) {
    l.push(`Hvad drillede (${r.tekster.length} linjer, kun teksterne):`);
    for (const t of r.tekster) l.push(`  dag ${t.dag}, ${t.vurdering} af 5: ${t.tekst}`);
  } else l.push('Hvad drillede: ingen skrevne linjer endnu.');
  l.push('Slutkriterier:');
  for (const k of r.kriterier) l.push(`${k.id}) ${k.opfyldt === null ? 'manuelt' : k.opfyldt ? 'ja' : 'nej'}: ${k.tekst}`);
  return l;
}

/** Everything the report needs, one row per beta household (a redeemed invitation whose account still exists). */
export async function laesHusstande(db: Database): Promise<HusstandData[]> {
  const iso = (d: unknown): string => new Date(d as string).toISOString().slice(0, 10);
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const rader = await db.query<Record<string, unknown>>(
    `SELECT i.brugt_af AS konto_id, COALESCE(m.samtykke, false) AS samtykke, m.tilmelding_ms, m.kilde_forbundet_ms, m.foerste_vaerdi_ms, t.bestilt, t.klar
       FROM beta.invitation i
       LEFT JOIN beta.maal m ON m.konto_id = i.brugt_af
       LEFT JOIN LATERAL (SELECT bestilt, klar FROM flaade.tenant WHERE ejer_konto_id = i.brugt_af AND tilstand <> 'slettet' ORDER BY id DESC LIMIT 1) t ON true
      WHERE i.brugt_af IS NOT NULL ORDER BY i.brugt_af`);
  const sete = await db.query<{ konto_id: unknown; dag: unknown }>('SELECT konto_id, dag FROM beta.set ORDER BY konto_id, dag');
  const dagtal = await db.query<{ konto_id: unknown; dag: unknown; kraever: unknown }>('SELECT konto_id, dag, kraever FROM beta.dagtal ORDER BY konto_id, dag');
  const fb = await db.query<{ konto_id: unknown; dag: unknown; vurdering: unknown; tekst: string | null; betale: 'ja' | 'maaske' | 'nej' | null }>('SELECT konto_id, dag, vurdering, tekst, betale FROM beta.feedback ORDER BY konto_id, dag');
  return rader.map((r) => {
    const id = Number(r['konto_id']);
    return {
      kontoId: id, samtykke: r['samtykke'] === true,
      bestilt: r['bestilt'] ? new Date(r['bestilt'] as string) : null, klar: r['klar'] ? new Date(r['klar'] as string) : null,
      tilmeldingMs: num(r['tilmelding_ms']), kildeForbundetMs: num(r['kilde_forbundet_ms']), foersteVaerdiMs: num(r['foerste_vaerdi_ms']),
      sete: sete.filter((x) => Number(x.konto_id) === id).map((x) => iso(x.dag)),
      dagtal: dagtal.filter((x) => Number(x.konto_id) === id).map((x) => ({ dag: iso(x.dag), kraever: Number(x.kraever) })),
      feedback: fb.filter((x) => Number(x.konto_id) === id).map((x) => ({ dag: Number(x.dag), vurdering: Number(x.vurdering), tekst: x.tekst, betale: x.betale })),
    };
  });
}
