// Helpers that turn stored text into something a voice can read aloud:
// no markdown, no URLs, dates and times as words, full sentences. Pure.

import { stemmeTekst } from './tekster.ts';

/** Strips URLs and markdown, collapses whitespace. Angle brackets stay (escaping is the renderer's job). */
export function taleTekst(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One cleaned sentence that ends in . ! or ? — empty in, empty out. */
export function saetning(s: string): string {
  const t = taleTekst(s);
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** "10:00" → "klokken 10", "10.30" → "klokken 10.30" (English: "at 10", "at 10:30"); anything else is returned as it came. */
export function taleKlokken(tid: string): string {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(tid.trim());
  if (!m) return tid.trim();
  const h = String(Number(m[1]));
  return stemmeTekst().tale.klokken(h, m[2]!);
}

/** "2026-10-29" → "torsdag den 29. oktober" (English: "Thursday 29 October"); "2026-10-29T10:00" adds " klokken 10". Non-ISO text is returned as it came. */
export function taleDato(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso.trim());
  if (!m) return iso.trim();
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1) return iso.trim();
  const t = stemmeTekst().tale;
  const dato = t.dato(t.dage[d.getUTCDay()]!, d.getUTCDate(), t.maaneder[d.getUTCMonth()]!);
  return m[4] && m[5] ? t.datoMedTid(dato, taleKlokken(`${m[4]}:${m[5]}`)) : dato;
}

/** "Anne Hansen <anne@x.example>" → "Anne Hansen"; a bare address stays as the part before the @. */
export function taleAfsender(fra: string): string {
  const navn = fra.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (navn) return navn;
  const adr = /<?([^<>@\s]+)@/.exec(fra);
  return adr?.[1] ?? fra.trim();
}
