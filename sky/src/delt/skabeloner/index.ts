// Sky's mail templates (KC-0178): one function renders every mail, so a preview (KC-0184 shows the
// owner the invitation before it is sent) and the sent mail cannot differ. Plain text first, a minimal
// HTML part beside it: no image, no remote resource, no tracking parameter. Every value is checked
// (one line, no control or direction characters, a bounded length) and escaped in the HTML part.
// The files are `<skabelon>.<sprog>.txt|html`; the first line of the .txt file is the subject.
import fs from 'node:fs';
import { esc } from '../html.ts';

export const SKABELONER = ['maillink', 'invitation', 'konto-slettet'] as const;
export type Skabelon = (typeof SKABELONER)[number];
export const SPROG = ['da', 'en'] as const;
export type Sprog = (typeof SPROG)[number];

/** The typed data each template takes. `minutter`/`dage` come from the caller's own constant. */
export type SkabelonData = {
  maillink: { link: string; minutter: string };
  invitation: { link: string; inviterer: string; husstand: string; dage: string };
  'konto-slettet': { dage: string };
};

export type Mail = { emne: string; tekst: string; html: string };

/** A template could not be filled (missing or unsafe data). The message names the field, never its value. */
export class SkabelonFejl extends Error {}

type Felt = 'link' | 'navn' | 'tal';
const FELTER: { [K in Skabelon]: Record<keyof SkabelonData[K], Felt> } = {
  maillink: { link: 'link', minutter: 'tal' },
  invitation: { link: 'link', inviterer: 'navn', husstand: 'navn', dage: 'tal' },
  'konto-slettet': { dage: 'tal' },
};

const MAKS_NAVN = 80;
// C0/C1 controls, line/paragraph separators, and the bidi overrides/isolates that can disguise text.
const FORBUDT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

type Filer = { emne: string; tekst: string; html: string };
const FILER = new Map<string, Filer>();
for (const s of SKABELONER) {
  for (const sp of SPROG) {
    const laes = (endelse: string) => fs.readFileSync(new URL(`./${s}.${sp}.${endelse}`, import.meta.url), 'utf8');
    const txt = laes('txt');
    const skel = txt.indexOf('\n\n');
    if (skel < 0) throw new Error(`skabelon ${s}.${sp}.txt: første linje er emnet, så en tom linje`);
    FILER.set(`${s}.${sp}`, { emne: txt.slice(0, skel).trim(), tekst: txt.slice(skel + 2), html: laes('html') });
  }
}

function tjekLink(v: string): string {
  let u: URL;
  try { u = new URL(v); } catch { throw new SkabelonFejl('skabelon: link er ikke en adresse'); }
  // The exact string we were given must be what the URL parser keeps: no spaces, quotes or tricks.
  if (u.href !== v) throw new SkabelonFejl('skabelon: link er ikke på normal form');
  const lokal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && lokal)) throw new SkabelonFejl('skabelon: link skal være https (http kun på localhost)');
  return v;
}

function tjek(skabelon: Skabelon, data: Record<string, string>): Record<string, string> {
  const ud: Record<string, string> = {};
  for (const [navn, felt] of Object.entries(FELTER[skabelon]) as [string, Felt][]) {
    const v = data[navn];
    if (typeof v !== 'string') throw new SkabelonFejl(`skabelon ${skabelon}: ${navn} mangler`);
    if (felt === 'link') ud[navn] = tjekLink(v);
    else if (felt === 'tal') {
      if (!/^[1-9]\d{0,3}$/.test(v)) throw new SkabelonFejl(`skabelon ${skabelon}: ${navn} skal være et tal`);
      ud[navn] = v;
    } else {
      const t = v.trim();
      if (!t || t.length > MAKS_NAVN || FORBUDT.test(t)) throw new SkabelonFejl(`skabelon ${skabelon}: ${navn} skal være én linje på 1-${MAKS_NAVN} tegn`);
      ud[navn] = t;
    }
  }
  return ud;
}

function udfyld(skabelon: string, vaerdier: Record<string, string>, escape: (s: string) => string): string {
  return skabelon.replace(/\{\{([a-z]+)\}\}/g, (_, navn: string) => {
    const v = vaerdier[navn];
    if (v === undefined) throw new SkabelonFejl(`skabelon: ukendt pladsholder ${navn}`);
    return escape(v);
  });
}

/** Renders one mail. Throws SkabelonFejl on an unknown template or language, or missing/unsafe data. */
export function renderMail(b: { skabelon: Skabelon; sprog?: Sprog; data: Record<string, string> }): Mail {
  if (!(SKABELONER as readonly string[]).includes(b.skabelon)) throw new SkabelonFejl('skabelon: ukendt skabelon');
  const sprog = b.sprog ?? 'da';
  const f = FILER.get(`${b.skabelon}.${sprog}`);
  if (!f) throw new SkabelonFejl('skabelon: ukendt sprog');
  const v = tjek(b.skabelon, b.data);
  const emne = udfyld(f.emne, v, (s) => s);
  return { emne, tekst: udfyld(f.tekst, v, (s) => s), html: udfyld(f.html, { ...v, emne }, esc) };
}

/** The typed entry points (callers that know their template get their data checked by the compiler). */
export const maillink = (data: SkabelonData['maillink'], sprog?: Sprog): Mail => renderMail({ skabelon: 'maillink', data, ...(sprog ? { sprog } : {}) });
export const invitation = (data: SkabelonData['invitation'], sprog?: Sprog): Mail => renderMail({ skabelon: 'invitation', data, ...(sprog ? { sprog } : {}) });
export const kontoSlettet = (sprog?: Sprog): Mail => renderMail({ skabelon: 'konto-slettet', data: {}, ...(sprog ? { sprog } : {}) });
