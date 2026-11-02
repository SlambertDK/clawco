// KC-0129: vCard 2.1/3.0/4.0 (Apple Contacts export, Google Takeout contacts) → plain contacts. Reads FN (else N),
// ORG, BDAY and NOTE; folded lines, escapes and quoted-printable are decoded; everything else is ignored.

import { KONTAKTER_MAKS, lavKontakt, type Kontakt } from './typer.ts';

/** `=C3=98` quoted-printable → text (UTF-8); soft line breaks are already unfolded by the caller. */
function qp(v: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < v.length; i += 1) {
    const h = v[i] === '=' ? /^[0-9A-Fa-f]{2}/.exec(v.slice(i + 1, i + 3)) : null;
    if (h) { bytes.push(parseInt(h[0], 16)); i += 2; } else bytes.push(...Buffer.from(v[i] ?? '', 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

const udFold = (v: string): string => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** Content lines with folding undone (a line starting with space/tab continues the one before; QP `=` at the end too). */
function linjer(tekst: string): string[] {
  const raa = tekst.replace(/\r\n?/g, '\n').split('\n');
  const ud: string[] = [];
  for (const l of raa) {
    const forrige = ud.length - 1;
    if (forrige >= 0 && /^[ \t]/.test(l)) ud[forrige] += l.slice(1);
    else if (forrige >= 0 && /ENCODING=QUOTED-PRINTABLE/i.test(ud[forrige] ?? '') && /=$/.test(ud[forrige] ?? '')) ud[forrige] = (ud[forrige] ?? '').slice(0, -1) + l;
    else ud.push(l);
  }
  return ud;
}

/** BDAY as free text: `19800229` → `1980-02-29`; anything else as written. */
const dag = (v: string): string => v.trim().replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');

export function parseVcard(tekst: string): Kontakt[] {
  const ud: Kontakt[] = [];
  let kort: { fn?: string; n?: string; org?: string; bday?: string; note?: string } | null = null;
  for (const l of linjer(tekst)) {
    if (ud.length >= KONTAKTER_MAKS) break;
    const hoved = l.trim();
    if (/^BEGIN:VCARD$/i.test(hoved)) { kort = {}; continue; }
    if (/^END:VCARD$/i.test(hoved)) {
      if (kort) {
        const navn = kort.fn || kort.n;
        const k = lavKontakt({ navn, org: kort.org, foedselsdag: kort.bday, noter: kort.note });
        if (k) ud.push(k);
      }
      kort = null;
      continue;
    }
    if (!kort) continue;
    const m = /^([A-Za-z][A-Za-z0-9-]*)((?:;[^:]*)?):(.*)$/.exec(l);
    if (!m) continue;
    const felt = (m[1] ?? '').toUpperCase();
    const vaerdi = /QUOTED-PRINTABLE/i.test(m[2] ?? '') ? qp(m[3] ?? '') : (m[3] ?? '');
    if (felt === 'FN') kort.fn = udFold(vaerdi);
    else if (felt === 'N') {
      // Family;Given;Additional;Prefix;Suffix → "Given Additional Family"
      const [efter = '', foer = '', mellem = ''] = vaerdi.split(';').map(udFold);
      kort.n = [foer, mellem, efter].map((x) => x.trim()).filter(Boolean).join(' ');
    } else if (felt === 'ORG') kort.org = vaerdi.split(/(?<!\\);/).map(udFold).map((x) => x.trim()).filter(Boolean).join('; ');
    else if (felt === 'BDAY') kort.bday = dag(vaerdi);
    else if (felt === 'NOTE') kort.note = udFold(vaerdi);
  }
  return ud;
}
