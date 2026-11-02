// Mail in the test world (KC-0068): the seven mails in Handling as Hermes turns
// them into decisions (one of every mail type), and what Henrik did with them.
// Lifted from the demo's historie.ts (KC-0058) and extended against main's
// MAIL_TYPER and the graense option (tilAndre, KC-0066/0067).

import type { LogEntry } from '../../store/types.ts';
import { parseMailState, type MailFacts, type MailState, type OrdnetInput } from '../../rooms/mail/schema.ts';
import type { Fakta } from './fakta.ts';
import { logFra, ugedagKort, type Raa } from './faelles.ts';
import { fraForbindelse } from '../../rooms/mail/source.ts';
import { kildeData, mappe, NAT } from './kilder.ts';

export const FORTRYD_BETALING = 'Fjern betalingen til Rørvang VVS (4.210 kr.) fra listen Betalinger igen.';
export const FORTRYD_PAAMINDELSE = 'Slet påmindelsen fredag kl. 07.55 om skolekoncerten.';
export const AFSENDER: Record<string, string> = { '2401': 'Clara Holm', '2402': 'Lysnet El-service', '2403': 'Rørvang VVS', '2404': 'Vindbrevet', '2405': 'Skolen', '2406': 'Lægehuset', '2407': 'Cykelhuset' };

/** The seven mails in Folders/Handling, as Hermes would turn them into decisions. */
export function mailAlle(f: Fakta): Raa[] {
  // A picture holds at most six days (visuel.ts): the six that end with, or include, Friday.
  const start = Math.max(1, f.fredagPlus - 5);
  const fredag = Array.from({ length: 6 }, (_, i) => ({ navn: ugedagKort(f, start + i), fri: ['lør', 'søn'].includes(ugedagKort(f, start + i)), ...(start + i === f.fredagPlus ? { ikon: 'school', valgt: true } : {}) }));
  return [
    {
      mailId: '2401', emne: 'Dagsorden til kl. 11: Havvind Nord', fra: 'Clara Holm', modtaget: f.iso('21:40', -1), type: 'svar',
      visuel: { ikon: 'users', overskrift: 'Bekræft: vi ses kl. 11', billede: { art: 'personer', personer: [{ navn: 'Clara Holm', rolle: 'Nordvik' }, { navn: 'Jonas Berg', rolle: 'Vestnet' }] } },
      resume: 'Clara sender dagsordenen til mødet kl. 11 og beder om en kort bekræftelse.',
      betydning: 'Tre punkter: valg af kabeltracé, tidsplanen for kabelleverandøren og fordelingen af meromkostningen. Hun vil vide, at du kommer, og om Jonas er med. Svar kort: vi ses kl. 11.',
      frist: f.dag, udkast: 'Hej Clara\n\nTak for dagsordenen. Jonas og jeg er med kl. 11, så vi ses.\n\nVenlig hilsen\nHenrik', arkivmappe: 'Archive', muligheder: [],
    },
    {
      mailId: '2402', emne: 'Tilbud: ny eltavle med fejlstrømsafbryder', fra: 'Lysnet El-service', modtaget: f.iso('18:12', -3), type: 'svar',
      visuel: { ikon: 'zap', tone: 'adv', overskrift: '2.600 kr. over budget', billede: { art: 'beloeb', vaerdi: 18400, graense: 15800, enhed: 'kr.', tekst: 'Tilbud', graenseTekst: 'Budget' } },
      resume: 'Tilbud på 18.400 kr. inkl. moms for ny eltavle.',
      betydning: 'Tilbuddet er på 18.400 kr., 2.600 kr. over det, du regnede med, fordi de har lagt to ekstra grupper på. Prisen gælder til fredag. Bed om en pris uden de to ekstra grupper, så kan du sammenligne.',
      frist: f.plus(f.fredagPlus), udkast: 'Hej\n\nTak for tilbuddet på 18.400 kr. Kan I give en pris uden de to ekstra grupper? Så vender jeg tilbage inden fredag.\n\nVenlig hilsen\nHenrik', arkivmappe: 'Folders/Afventer',
      muligheder: [
        { id: 'find-nummer', label: 'Find deres telefonnummer', instruktion: 'Find telefonnummeret i signaturen i mail 2402 og skriv det. Ring ikke.' },
        { id: 'besigtigelse', label: 'Foreslå besigtigelse', instruktion: 'Lav et udkast til et svar til Lysnet El-service, der foreslår besigtigelse tirsdag kl. 16, og læg det i Drafts. Send ikke.', tilAndre: true },
      ],
    },
    {
      mailId: '2403', emne: 'Faktura 4.210 kr.: nyt blandingsbatteri', fra: 'Rørvang VVS', modtaget: f.iso('09:12', -5), type: 'regning',
      visuel: { ikon: 'receipt', tone: 'god', overskrift: 'Passer med tilbuddet', billede: { art: 'beloeb', vaerdi: 4210, graense: 4210, enhed: 'kr.', tekst: 'Faktura', graenseTekst: 'Tilbud' } },
      resume: 'Faktura for udskiftning af blandingsbatteriet i køkkenet.',
      betydning: `Beløbet 4.210 kr. matcher tilbuddet fra tidligere, så den kan bare betales. Forfald ${f.forfald}. Jeg betaler aldrig selv: læg den i Betalinger, så godkender du den.`,
      frist: f.plus(7), arkivmappe: 'Folders/Regninger',
      muligheder: [{ id: 'laeg-i-betalinger', label: 'Læg i betalinger', instruktion: `Læg fakturaen fra mail 2403 (Rørvang VVS, 4.210 kr., forfald ${f.forfald}) i listen Betalinger. Betal ikke selv.`, fortryd: FORTRYD_BETALING },
        // KC-0122: the scripted Hermes also proposes paying — Clawco shows it as a line it will not do, never a button.
        { id: 'betal', label: 'Betal regningen', instruktion: 'Betal fakturaen fra Rørvang VVS på 4.210 kr. med det samme.', verb: 'betal' }],
    },
    {
      mailId: '2404', emne: 'Ugens vindbrev', fra: 'Vindbrevet', modtaget: f.iso('06:00', -1), type: 'nyhedsbrev',
      visuel: { ikon: 'mail-x', overskrift: 'Aldrig åbnet – afmeld', billede: { art: 'prikker', antal: 0, ialt: 12, tekst: 'åbnet' } },
      resume: 'Ugentligt nyhedsbrev om havvind.', betydning: 'Du har ikke åbnet det i tre måneder. Afmeld, så er det væk.', arkivmappe: 'Archive',
      muligheder: [{ id: 'afmeld', label: 'Afmeld', instruktion: 'Find List-Unsubscribe i mail 2404 og afmeld via https-linket.' },
        // KC-0122: a delete needs Henrik's own tap (a red button that asks for a yes).
        { id: 'slet', label: 'Slet nyhedsbrevet', instruktion: 'Slet mail 2404.', verb: 'slet' }],
    },
    {
      mailId: '2405', emne: 'Tilmelding til skolekoncerten åbner fredag kl. 8', fra: 'Skolen', modtaget: f.iso('14:05', -1), type: 'aktion',
      visuel: { ikon: 'school', overskrift: 'Tilmeld Ella fredag kl. 8', billede: { art: 'uge', dage: fredag } },
      resume: 'Tilmeldingen til skolekoncerten åbner fredag kl. 8; der er få pladser.',
      betydning: 'Pladserne plejer at være væk inden for en time. Sæt en påmindelse fredag kl. 07.55, så tilmelder du Ella, så snart den åbner.',
      frist: f.plus(f.fredagPlus), arkivmappe: 'Folders/Afventer',
      muligheder: [{ id: 'paamind', label: 'Påmind mig fredag 07.55', instruktion: 'Opret en påmindelse fredag kl. 07.55: "Tilmeld Ella til skolekoncerten".', fortryd: FORTRYD_PAAMINDELSE }],
    },
    {
      mailId: '2406', emne: 'Nye åbningstider i lægehuset', fra: 'Lægehuset', modtaget: f.iso('10:30', -2), type: 'info',
      visuel: { ikon: 'info', tone: 'rolig', overskrift: 'Lukket fredag eftermiddag' },
      resume: 'Lægehuset holder lukket fredag eftermiddag fra næste måned.', betydning: 'Kun til orientering: der er ingen tider hos lægen i kalenderen. Marker den som færdig.', arkivmappe: 'Archive', muligheder: [],
    },
    {
      mailId: '2407', emne: 'Kvittering: cykellygter', fra: 'Cykelhuset', modtaget: f.iso('16:45', -1), type: 'kvittering',
      visuel: { ikon: 'circle-check', tone: 'god', overskrift: 'Betalt: 249 kr.', billede: { art: 'beloeb', vaerdi: 249, graense: 249, enhed: 'kr.', tekst: 'Kvittering', graenseTekst: 'Ordre' } },
      resume: 'Kvittering for et sæt cykellygter.', betydning: 'Beløbet passer med ordren. Intet at gøre; den ryger i Køb.', arkivmappe: 'Folders/køb', muligheder: [],
    },
  ];
}

/** KC-0117: every seeded mail is privat, explicitly (the test world's one source zone). */
const mailPrivat = (f: Fakta): Raa[] => mailAlle(f).map((b) => ({ ...b, zone: 'privat' }));

/** What Hermes answers when Mail is built at moment `n`: the decisions while the mails are in Handling (then Handling is empty). */
export const mailRaa = (n: number, f: Fakta): Raa => ({ beslutninger: n >= 2 ? [] : mailPrivat(f), hermesStatus: 'Holder øje med Handling' });

/** When each decision was settled (moment 2 on): mulighedId 'sendt' or 'faerdig', Copenhagen time. */
const AFGJORT: Record<string, [string, string]> = {
  '2401': ['sendt', '09:34'], '2402': ['faerdig', '09:41'], '2403': ['faerdig', '09:44'], '2404': ['faerdig', '09:46'],
  '2405': ['faerdig', '09:48'], '2406': ['faerdig', '09:49'], '2407': ['faerdig', '09:50'],
};

export function mailState(n: number, f: Fakta): MailState {
  const m = mappe(n, f);
  const facts: MailFacts = {
    tal: { handling: m['Folders/Handling']?.length ?? 0, afventer: m['Folders/Afventer']?.length ?? 0, regninger: m['Folders/Regninger']?.length ?? 0, sorteretIDag: NAT.length },
    ordnet: NAT.map((x): OrdnetInput => ({ mailId: x.id, til: x.til, hvorfor: x.hvorfor, tid: f.iso('03:10'), emne: x.emne, fra: x.fra })),
  };
  const state = parseMailState({ beslutninger: mailPrivat(f), hermesStatus: 'Holder øje med Handling' }, facts, new Date(f.iso('03:12')), null);
  if (n >= 2) for (const b of state.beslutninger) { const t = AFGJORT[b.mailId]; if (t) b.afgjort = { mulighedId: t[0], tid: f.iso(t[1]) }; }
  return state;
}

export function mailLog(f: Fakta, n: number): LogEntry[] {
  const flyt = (fra: string, mailId: string): string => `himalaya message move --from ${fra} --to Folders/Handling ${mailId}`;
  const faerdig = (id: string, til: string, hhmm: string): { fra: number; hhmm: string; kilde: 'hermes'; tekst: string; handlingId: string; fortryd: string } =>
    ({ fra: 2, hhmm, kilde: 'hermes', tekst: `Flyttet til ${til.replace(/^Folders\//, '')}.`, handlingId: `faerdig-${id}`, fortryd: flyt(til, id) });
  return logFra('mail', [
    { fra: 0, hhmm: '03:10', kilde: 'hermes', tekst: 'Hermes sorterede 12 mails i nat: 7 arkiveret, 2 til Regninger, 2 til Afventer og 1 til vigtige dokumenter.' },
    { fra: 0, hhmm: '03:12', kilde: 'hermes', tekst: 'Hermes læste Handling (7 mails, 12 sorteret i dag).' },
    { fra: 2, hhmm: '09:34', kilde: 'hermes', tekst: 'Sendt til Clara Holm. Mailen ligger i Sendt.', handlingId: 'send-2401' },
    faerdig('2401', 'Archive', '09:35'),
    { fra: 2, hhmm: '09:40', kilde: 'hermes', tekst: 'Kladden til Lysnet El-service ligger i Drafts. Intet er sendt.', handlingId: 'kladde-2402' },
    faerdig('2402', 'Folders/Afventer', '09:41'),
    { fra: 2, hhmm: '09:43', kilde: 'hermes', tekst: `Fakturaen fra Rørvang VVS (4.210 kr., forfald ${f.forfald}) ligger i Betalinger. Intet er betalt; det godkender du selv.`, handlingId: '2403-laeg-i-betalinger', fortryd: FORTRYD_BETALING },
    faerdig('2403', 'Folders/Regninger', '09:44'),
    { fra: 2, hhmm: '09:45', kilde: 'hermes', tekst: 'Vindbrevet er afmeldt via linket i mailen. Du får ikke flere.', handlingId: '2404-afmeld' },
    faerdig('2404', 'Archive', '09:46'),
    { fra: 2, hhmm: '09:47', kilde: 'hermes', tekst: 'Påmindelsen fredag kl. 07.55 er sat: tilmeld Ella til skolekoncerten.', handlingId: '2405-paamind', fortryd: FORTRYD_PAAMINDELSE },
    faerdig('2405', 'Folders/Afventer', '09:48'),
    faerdig('2406', 'Archive', '09:49'),
    faerdig('2407', 'Folders/køb', '09:50'),
  ], n, f);
}

/**
 * KC-0223: Mail as it stands once Gmail is connected (a connection Clawco may only read), built the way the app builds it —
 * from the same envelopes the world's Gmail reads, keeping only what waits (unread or flagged). Nothing to press: no draft,
 * no folder, no buttons.
 */
const GMAIL_BETYDNING: Record<string, { type: string; betydning: string }> = {
  '2503': { type: 'svar', betydning: 'Løbeklubben inviterer til sommerfest og vil have et svar; ud fra emnet er det en invitation.' },
  '2505': { type: 'info', betydning: 'Fejlvagten melder tre nye fejl i nat; ud fra emnet er det til orientering.' },
};
/** What the scripted Hermes answers a read-only refresh: a decision per waiting mail the prompt listed (never a draft, folder or button). */
export function gmailRaa(n: number, f: Fakta): Raa {
  const d = fraForbindelse(kildeData(n, f).mail, new Date(f.iso('08:47', 1)), { laeseKun: true });
  return {
    beslutninger: d.handling.map((e) => ({ mailId: e.id, emne: e.emne, fra: e.fra, modtaget: e.modtaget, type: GMAIL_BETYDNING[e.id]?.type ?? 'info', betydning: GMAIL_BETYDNING[e.id]?.betydning ?? 'Ulæst; ud fra emnet er der intet at gøre.', zone: 'privat' })),
    hermesStatus: 'Holder øje med indbakken',
  };
}

export function gmailMailState(n: number, f: Fakta): MailState {
  const antal = fraForbindelse(kildeData(n, f).mail, new Date(f.iso('08:47', 1)), { laeseKun: true }).tal.handling;
  const state = parseMailState(gmailRaa(n, f), { tal: { handling: antal, afventer: 0, regninger: 0, sorteretIDag: 0 }, ordnet: [] }, new Date(f.iso('08:47', 1)), null);
  return { ...state, forbindelse: 'Gmail', laeseKun: true };
}

export const gmailMailLog = (f: Fakta, antal: number): LogEntry[] =>
  logFra('mail', [{ fra: 0, ved: f.iso('08:47', 1), kilde: 'hermes', tekst: `Hermes læste indbakken (${antal} ulæste eller markerede mails).` }], 0, f);
