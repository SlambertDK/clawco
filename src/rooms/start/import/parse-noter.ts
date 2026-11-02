// KC-0129: a folder of notes the user exported (`.md`, `.txt`, `.html` — Apple Notes via a user export, Keep via
// Takeout) → note texts. HTML is turned into plain text (scripts, styles and comments dropped, entities decoded).
// Apple Notes' own database is never read. The text is data: it goes to the model wrapped as untrusted (foreslaa.ts).

export type NoteTekst = { titel: string; tekst: string };

export const NOTE_MAKS = 20_000;
const NOTER_MAKS = 200;

const ENTITETER: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML → text: block tags become line breaks, the rest of the tags go, entities are decoded. */
export function htmlTilTekst(html: string): string {
  const uden = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return uden
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') { const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : ' '; }
      return ENTITETER[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function parseNoter(filer: { navn: string; tekst: string }[]): NoteTekst[] {
  const ud: NoteTekst[] = [];
  for (const f of filer) {
    if (ud.length >= NOTER_MAKS) break;
    const html = /\.html?$/i.test(f.navn);
    const tekst = (html ? htmlTilTekst(f.tekst) : f.tekst).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, NOTE_MAKS);
    if (!tekst) continue;
    ud.push({ titel: f.navn.replace(/\.[^.]+$/, '').slice(0, 120), tekst });
  }
  return ud;
}
