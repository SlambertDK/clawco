// Sky's mail templates (KC-0178): one function renders every mail, so a preview (KC-0184 shows the
// owner the invitation before it is sent) and the sent mail cannot differ. Plain text first, a minimal
// HTML part beside it: no image, no remote resource, no tracking parameter. Every value is checked
// (one line, no control or direction characters, a bounded length) and escaped in the HTML part.
// The files are `<skabelon>.<sprog>.txt|html`; the first line of the .txt file is the subject.
import fs from 'node:fs';
import { esc } from '../html.ts';

export const SKABELONER = ['maillink', 'invitation', 'konto-slettet', 'kvittering', 'fortrydelse', 'opsigelse', 'fornyelse', 'stoette-startet', 'alarm', 'betaling-fejlet', 'betaling-paamindelse', 'proeve-slut', 'velkomst', 'kom-i-gang', 'proeve-slutter', 'driftsbesked'] as const;
export type Skabelon = (typeof SKABELONER)[number];
export const SPROG = ['da', 'en'] as const;
export type Sprog = (typeof SPROG)[number];

/** The typed data each template takes. `minutter`/`dage` come from the caller's own constant. */
export type SkabelonData = {
  maillink: { link: string; minutter: string };
  invitation: { link: string; inviterer: string; husstand: string; dage: string };
  'konto-slettet': { dage: string };
  // KC-0209: the consumer-rights mails. Every value is one line of text the caller built from the one price
  // source and the one seller source; `link` is the account page, `vilkaarlink` the accepted terms.
  kvittering: { saelger: string; produkt: string; pris: string; betaling: string; fortrydfrist: string; vilkaarversion: string; vilkaarlink: string; link: string };
  fortrydelse: { saelger: string; produkt: string; tidspunkt: string; tilbage: string };
  opsigelse: { saelger: string; produkt: string; slutter: string; link: string };
  fornyelse: { saelger: string; produkt: string; pris: string; dato: string; link: string };
  /** KC-0188: support started — the hours (1, 4 or 24) and the Copenhagen time it ends, e.g. 14.05. */
  'stoette-startet': { timer: string; til: string };
  // KC-0187: an operator alert (drift/alarm.ts): the rule's fixed title and a line of counts and tenant ids.
  alarm: { titel: string; tekst: string };
  // KC-0196: the grace stages (abonnement/frist.ts). `dato` is the day the payment failed or the trial ended, in the
  // owner's language; `link` the subscription page, where the card is fixed or a plan chosen.
  'betaling-fejlet': { produkt: string; dato: string; link: string };
  'betaling-paamindelse': { produkt: string; dato: string; link: string };
  'proeve-slut': { dato: string; link: string };
  // KC-0200: the welcome mails (abonnement/velkomst.ts). `link` opens the Clawco (velkomst), its Start room (kom-i-gang) or
  // the subscription page (proeve-slutter); `abonnement` is one line on the trial built by the caller; `hjaelp` the support
  // mailbox and `svartid` the response-time sentence (config/hjaelp.json); `afmeld` the one-click unsubscribe link (tips
  // mail only); `saelger` the seller's identity read from the terms (delt/saelger.ts), closing every mail.
  velkomst: { link: string; abonnement: string; hjaelp: string; svartid: string; konto: string; saelger: string };
  'kom-i-gang': { link: string; afmeld: string; hjaelp: string; saelger: string };
  'proeve-slutter': { dato: string; link: string; saelger: string };
  // KC-0230: the operator's own notice to customers (sky/scripts/besked-til-kunder.ts): a one-line subject and a text
  // that keeps its line breaks. The only mail whose words are not fixed here, so it is sent by a human's yes only.
  driftsbesked: { titel: string; tekst: string };
};

export type Mail = { emne: string; tekst: string; html: string };

/** A template could not be filled (missing or unsafe data). The message names the field, never its value. */
export class SkabelonFejl extends Error {}

/** `linje`: one line of ordinary text, up to 300 characters (a price line, a date, the seller's identity).
 *  `tekst` (KC-0230): several lines, up to 4000 characters, line breaks kept (the operator's notice). */
type Felt = 'link' | 'navn' | 'tal' | 'linje' | 'tekst';
const FELTER: { [K in Skabelon]: Record<keyof SkabelonData[K], Felt> } = {
  maillink: { link: 'link', minutter: 'tal' },
  invitation: { link: 'link', inviterer: 'navn', husstand: 'navn', dage: 'tal' },
  'konto-slettet': { dage: 'tal' },
  kvittering: { saelger: 'linje', produkt: 'navn', pris: 'linje', betaling: 'linje', fortrydfrist: 'linje', vilkaarversion: 'navn', vilkaarlink: 'link', link: 'link' },
  fortrydelse: { saelger: 'linje', produkt: 'navn', tidspunkt: 'linje', tilbage: 'linje' },
  opsigelse: { saelger: 'linje', produkt: 'navn', slutter: 'linje', link: 'link' },
  fornyelse: { saelger: 'linje', produkt: 'navn', pris: 'linje', dato: 'linje', link: 'link' },
  'stoette-startet': { timer: 'tal', til: 'navn' },
  alarm: { titel: 'navn', tekst: 'linje' },
  'betaling-fejlet': { produkt: 'navn', dato: 'linje', link: 'link' },
  'betaling-paamindelse': { produkt: 'navn', dato: 'linje', link: 'link' },
  'proeve-slut': { dato: 'linje', link: 'link' },
  velkomst: { link: 'link', abonnement: 'linje', hjaelp: 'linje', svartid: 'linje', konto: 'link', saelger: 'linje' },
  'kom-i-gang': { link: 'link', afmeld: 'link', hjaelp: 'linje', saelger: 'linje' },
  'proeve-slutter': { dato: 'linje', link: 'link', saelger: 'linje' },
  driftsbesked: { titel: 'linje', tekst: 'tekst' },
};

const MAKS_NAVN = 80;
const MAKS_LINJE = 300;
export const MAKS_TEKST = 4000;
// C0/C1 controls, line/paragraph separators, and the bidi overrides/isolates that can disguise text.
const FORBUDT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

// The same, but a line break is allowed (a text keeps its paragraphs); a carriage return and the rest stay refused.
const FORBUDT_TEKST = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202A-\u202E\u2066-\u2069]/;

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

/** A link a mail may carry: https on normal form (http only on localhost). Also checks the unsubscribe header's link. */
export function tjekLink(v: string): string {
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
    } else if (felt === 'tekst') {
      const t = v.trim();
      if (!t || t.length > MAKS_TEKST || FORBUDT_TEKST.test(t)) throw new SkabelonFejl(`skabelon ${skabelon}: ${navn} skal være en tekst på 1-${MAKS_TEKST} tegn uden styretegn`);
      ud[navn] = t;
    } else if (felt === 'linje') {
      const t = v.trim();
      if (!t || t.length > MAKS_LINJE || FORBUDT.test(t)) throw new SkabelonFejl(`skabelon ${skabelon}: ${navn} skal være én linje på 1-${MAKS_LINJE} tegn`);
      ud[navn] = t;
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
export const stoetteStartet = (data: SkabelonData['stoette-startet'], sprog?: Sprog): Mail => renderMail({ skabelon: 'stoette-startet', data, ...(sprog ? { sprog } : {}) });
export const kontoSlettet = (sprog?: Sprog): Mail => renderMail({ skabelon: 'konto-slettet', data: {}, ...(sprog ? { sprog } : {}) });
export const kvittering = (data: SkabelonData['kvittering'], sprog?: Sprog): Mail => renderMail({ skabelon: 'kvittering', data, ...(sprog ? { sprog } : {}) });
export const fortrydelse = (data: SkabelonData['fortrydelse'], sprog?: Sprog): Mail => renderMail({ skabelon: 'fortrydelse', data, ...(sprog ? { sprog } : {}) });
export const opsigelse = (data: SkabelonData['opsigelse'], sprog?: Sprog): Mail => renderMail({ skabelon: 'opsigelse', data, ...(sprog ? { sprog } : {}) });
export const fornyelse = (data: SkabelonData['fornyelse'], sprog?: Sprog): Mail => renderMail({ skabelon: 'fornyelse', data, ...(sprog ? { sprog } : {}) });
