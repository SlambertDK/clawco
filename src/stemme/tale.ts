// Helpers that turn stored text into something a voice can read aloud:
// no markdown, no URLs, dates and times as words, full sentences. Pure.

const DAGE = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const MAANEDER = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];

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

/** "10:00" → "klokken 10", "10.30" → "klokken 10.30"; anything else is returned as it came. */
export function taleKlokken(tid: string): string {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(tid.trim());
  if (!m) return tid.trim();
  const h = String(Number(m[1]));
  return m[2] === '00' ? `klokken ${h}` : `klokken ${h}.${m[2]}`;
}

/** "2026-10-29" → "torsdag den 29. oktober"; "2026-10-29T10:00" adds " klokken 10". Non-ISO text is returned as it came. */
export function taleDato(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso.trim());
  if (!m) return iso.trim();
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() !== Number(m[2]) - 1) return iso.trim();
  const dato = `${DAGE[d.getUTCDay()]} den ${d.getUTCDate()}. ${MAANEDER[d.getUTCMonth()]}`;
  return m[4] && m[5] ? `${dato} ${taleKlokken(`${m[4]}:${m[5]}`)}` : dato;
}

/** "Anne Hansen <anne@x.example>" → "Anne Hansen"; a bare address stays as the part before the @. */
export function taleAfsender(fra: string): string {
  const navn = fra.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  if (navn) return navn;
  const adr = /<?([^<>@\s]+)@/.exec(fra);
  return adr?.[1] ?? fra.trim();
}
