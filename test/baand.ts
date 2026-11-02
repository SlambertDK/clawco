// KC-0064 test helpers: slice one band out of a room render, read the count line.
export type BaandNavn = 'kraever' | 'indhold' | 'igang' | 'ordnet';

/** The markup from `data-baand="<b>"` to the next band terminator; '' when the band is absent. */
export function baandDel(out: string, b: BaandNavn): string {
  const i = out.indexOf(`data-baand="${b}"`);
  if (i < 0) return '';
  const j = out.indexOf('<!--/baand-->', i);
  return out.slice(i, j < 0 ? undefined : j);
}

/** The text of the count line, tags stripped, entities decoded. */
export function taelleTekst(out: string): string {
  const m = out.match(/<p class="taellelinje">([\s\S]*?)<\/p>/);
  if (!m) return '';
  return m[1]!.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
}
