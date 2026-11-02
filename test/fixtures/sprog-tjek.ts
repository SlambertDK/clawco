// KC-0170: the checks every language table and every converted surface share. A table test (shell, Start, each room)
// holds that English has exactly Danish's keys and shapes, that no string is empty and that no Danish string was
// copied over; a surface test holds that an English render has no Danish word left in what the user reads.

/** Keys and value shapes of a text table, recursively (functions by arity). */
export function form(v: unknown): unknown {
  if (typeof v === 'function') return `fn/${v.length}`;
  if (typeof v === 'string') return 'tekst';
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, form(x)]));
  return typeof v;
}

/** The paths of empty strings in a table. */
export const tomme = (v: Record<string, unknown>, sti = ''): string[] =>
  Object.entries(v).flatMap(([k, x]) => (typeof x === 'string' && !x.trim() ? [sti + k] : typeof x === 'object' && x !== null ? tomme(x as Record<string, unknown>, `${sti}${k}.`) : []));

/** The paths whose string is the same in both tables. */
export function ensStrenge(a: Record<string, unknown>, b: Record<string, unknown>, sti = ''): string[] {
  return Object.entries(a).flatMap(([k, x]) => {
    const y = b[k];
    if (typeof x === 'string') return x === y ? [sti + k] : [];
    if (typeof x === 'object' && x !== null && typeof y === 'object' && y !== null) return ensStrenge(x as Record<string, unknown>, y as Record<string, unknown>, `${sti}${k}.`);
    return [];
  });
}

/** What the user reads: text nodes and the attributes a screen reader or a tooltip shows. Scripts and styles are not read. */
export function laesbart(doc: string): string {
  const uden = doc.replace(/<head>[\s\S]*<\/head>/, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const attrs = [...uden.matchAll(/\s(?:title|aria-label|placeholder|data-sig|data-element|data-status)="([^"]*)"/g)].map((m) => m[1]);
  const tekst = uden.replace(/<[^>]+>/g, '\n');
  return [tekst, ...attrs].join('\n').replace(/&[a-z#0-9]+;/g, ' ');
}

/** A Danish letter, or a Danish word that is no English word. Proper nouns pass (Hermes, Clawco, Claude Code). */
export const DANSK = /[æøåÆØÅ]|\b(?:og|ikke|eller|på|hvad|når|jeg|skal|kan|til|med|Intet|Gem|Luk|Fortryd|Klar|Kræver|ordnet|venter|Rum|Kø|Trin|Næste|Klaret|Valgfrit|Virker|Spring|Ikke)\b/;

/** The lines of a rendered document that read as Danish. */
export const danskeLinjer = (doc: string): string[] => laesbart(doc).split('\n').map((l) => l.trim()).filter((l) => l && DANSK.test(l));
