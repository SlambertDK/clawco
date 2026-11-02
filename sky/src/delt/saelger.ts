// Who the seller is, for receipts (KC-0209). It is READ from section 1 of the terms (docs/legal/vilkaar.<sprog>.md):
// the one place the identity is written (KC-0210: a person, no company, no CVR), so a receipt can never name
// anyone else than the terms do, and no name or address is a literal in code (AGENTS §0 r6). The seller is the first
// sentence of that section. Fail closed: a section that is missing, empty or still a placeholder gives no receipt.
import fs from 'node:fs';
import path from 'node:path';

export type SaelgerSprog = 'da' | 'en';

/** A sentence ends at a full stop followed by a capital letter ("Danmark. Du kan …"; "company no. no CVR" does not end one). */
const SAETNINGSSLUT = /\.(?=\s+[A-ZÆØÅ])/;

/** The first paragraph under the "## 1." heading (up to a blank line or the next heading); '' when there is none. */
function foersteAfsnit(tekst: string): string {
  const linjer = tekst.split('\n');
  const start = linjer.findIndex((l) => /^## 1\./.test(l));
  if (start < 0) return '';
  const ud: string[] = [];
  for (const l of linjer.slice(start + 1)) {
    if (l.startsWith('#')) break;
    if (!l.trim()) { if (ud.length) break; continue; }
    ud.push(l.trim());
  }
  return ud.join(' ');
}

export function laesSaelger(mappe: string, sprog: SaelgerSprog): string {
  const fil = `vilkaar.${sprog}.md`;
  let tekst: string;
  try { tekst = fs.readFileSync(path.join(mappe, fil), 'utf8'); } catch { throw new Error(`sælger: ${fil} kan ikke læses i ${mappe}`); }
  const afsnit = foersteAfsnit(tekst.replace(/\r\n/g, '\n'));
  const saetning = (afsnit.split(SAETNINGSSLUT)[0] ?? '').trim();
  const komplet = afsnit.includes('.') && saetning.length < afsnit.length ? `${saetning}.` : saetning;
  if (!komplet) throw new Error(`sælger: ${fil} punkt 1 har ingen sælger`);
  if (/[\[\]]/.test(komplet)) throw new Error(`sælger: ${fil} punkt 1 har stadig en pladsholder i stedet for sælgeren`);
  if (komplet.length > 300) throw new Error(`sælger: ${fil} punkt 1 er for lang til en kvittering (første sætning over 300 tegn)`);
  return komplet;
}

/** Both languages, read at start: a Sky that cannot name its seller does not start (like the consent versions). */
export function laesSaelgere(mappe: string): Record<SaelgerSprog, string> {
  return { da: laesSaelger(mappe, 'da'), en: laesSaelger(mappe, 'en') };
}
