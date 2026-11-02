// KC-0203: the one answer a beta household sends on purpose: a 1–5 rating, one optional plain line ("Hvad drillede?"),
// and on day 14 the pay question. The only free text in the whole beta, written by the person. Validation is pure.

import { betaFeedbackTekst } from './tekster.ts';
import { BETALE, FEEDBACK_DAGE, TEKST_MAKS, type Betale, type FeedbackDag } from './tilstand.ts';

export type FeedbackSvar = { dag: FeedbackDag; vurdering: 1 | 2 | 3 | 4 | 5; tekst: string | null; betale: Betale | null };
export type FeedbackUdfald = { ok: true; svar: FeedbackSvar } | { ok: false; status: 400 | 409; fejl: string };

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nej = (status: 400 | 409, fejl: string): FeedbackUdfald => ({ ok: false, status, fejl });
/** Control characters are dropped and a line break is a space: it is one plain line. */
const renLinje = (s: string): string => s.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim();

/** `due` is the card that is due now (kortDue), null = none. Only its own day can be answered. */
export function parseFeedbackSvar(raw: unknown, o: { due: FeedbackDag | null }): FeedbackUdfald {
  const x = betaFeedbackTekst();
  if (!erObj(raw)) return nej(400, x.ugyldigForespoergsel);
  const dag = raw['dag'];
  if (!(FEEDBACK_DAGE as readonly unknown[]).includes(dag)) return nej(400, x.ukendtSpoergsmaal);
  if (o.due !== dag) return nej(409, x.venterIkke);
  const v = raw['vurdering'];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) return nej(400, x.vaelgVurdering);
  let tekst: string | null = null;
  if (raw['tekst'] !== undefined && raw['tekst'] !== null) {
    if (typeof raw['tekst'] !== 'string' || raw['tekst'].length > TEKST_MAKS) return nej(400, x.tekstForLang(TEKST_MAKS));
    tekst = renLinje(raw['tekst']) || null;
  }
  let betale: Betale | null = null;
  if (raw['betale'] !== undefined && raw['betale'] !== null) {
    if (dag !== 14 || !(BETALE as readonly unknown[]).includes(raw['betale'])) return nej(400, x.ugyldigtBetale);
    betale = raw['betale'] as Betale;
  }
  return { ok: true, svar: { dag: dag as FeedbackDag, vurdering: v as FeedbackSvar['vurdering'], tekst, betale } };
}
