// The one escaper (AGENTS.md §4.9). Everything rendered from user or Hermes
// text goes through esc() or the html`` tag.

const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => MAP[c] ?? c);
}

/** Markup already escaped/trusted. Only html`` produces it. */
export class Markup {
  readonly s: string;
  constructor(s: string) { this.s = s; }
  toString(): string { return this.s; }
}

function render(v: unknown): string {
  if (v instanceof Markup) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Markup {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < values.length ? render(values[i]) : ''); });
  return new Markup(out);
}

/** Wrap a string you have already escaped/built as markup. Use sparingly. */
export function raw(s: string): Markup { return new Markup(s); }
