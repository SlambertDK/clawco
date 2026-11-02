// The test world's scripted Hermes (KC-0068): recognises the kind of run from
// the instructions the app's own prompt builders write, and answers as Hermes
// would at the current moment — refreshes with the moment's JSON, handlinger
// and Fortryd with one or two sentences, Skrive and Univers with the blocks
// their parsers read. Never sends, pays or deletes anything. Lifted from the
// demo's historie.ts (demoSvar, KC-0058).

import type { AgentRunRequest } from '../../agent/types.ts';
import type { SvarKontekst } from '../typer.ts';
import { fakta, momentNr, momentPlus, plusDag, rumNr, type Fakta } from './fakta.ts';
import { fenced, type Raa } from './faelles.ts';
import { chatSvar } from './samtale.ts';
import { dagenRaa, OPFOELGNING, STATUS_EFTER_AFTEN } from './dagen.ts';
import { AFSENDER, gmailRaa, mailRaa } from './mail.ts';
import { nyhederRaa } from './nyheder.ts';
import { koldKuratorRaa, kuratorRaa, MOENSTER, regelforslagTil } from './hjem.ts';
import { erKold, importSvar } from './start.ts';
import { IMPORT_MARKOER } from '../../rooms/start/import/foreslaa.ts';
import { opfoelgningAfsnit, OPFOELGNING_KILDER } from './skrive.ts';
import { enkeltSide, FORB_MAAL, forberedelseSvar, genereltMoede } from './univers.ts';
import { NYHEDEN_TITEL } from './kilder.ts';
import { bilBooking } from './husstand.ts';
import { udenData, udpak } from '../../agent/udtroet.ts';

// KC-0123: what the app sends as data stands in wrapped segments; Henrik's words and the app's own text outside them.
const kontekstAf = (req: AgentRunRequest): string | undefined => /"Om: ([^"\n]+)"/.exec(segment(req, 'element'))?.[1];
const sidsteAfsnit = (s: string): string => s.split('\n\n').at(-1) ?? s;
/** The text of the run's first data segment from `kilde` ('' when there is none). */
const segment = (req: AgentRunRequest, kilde: string): string => udpak(req.input).find((d) => d.kilde === kilde)?.tekst ?? '';

// ---------- Handlinger and Fortryd ----------

/** `i`: the handling's (or the Fortryd's) own text, as the app quoted it. */
function handlingSvar(i: string, f: Fakta, fortryd: boolean): string {
  const tabel: [RegExp, string][] = [
    [/Flyt kalenderaftalen "Løbetur" i dag fra 17/, 'Løbeturen ligger nu kl. 12.15–13.00 i kalenderen. Der er tørvejr midt på dagen, og kl. 14.00 er stadig ledig.'],
    [/Flyt kalenderaftalen "Løbetur" i dag tilbage til 17/, 'Løbeturen ligger igen kl. 17.00. Husk, at det regner kl. 16–19.'],
    [/Opret en kalenderaftale i dag kl\. 15\.45/, 'Afhentningen kl. 15.45 ligger i kalenderen med en påmindelse kl. 15.30. SFO lukker kl. 16.00.'],
    [/Slet kalenderaftalen "Hent Ella/, 'Afhentningen er slettet fra kalenderen. Husk selv, at Maja har nattevagt.'],
    [/Gem Claras dagsorden/, 'Dagsordenen ligger som PDF i læsemappen på telefonen, og påmindelsen er sat til kl. 07.35. Intet er sendt.'],
    [/Fjern dagsordenen fra læsemappen/, 'Dagsordenen er fjernet fra læsemappen, og påmindelsen kl. 07.35 er slettet.'],
    [/Saml notaterne fra mødet/, 'Jeg har samlet notaterne fra sidste møde og tracé-notatet i Havvind Nord og lavet fire talepunkter og en kort præsentation. Åbn universet, så ligger mødet klar.'],
    [/Fjern forberedelsen af mødet/, 'Forberedelsen er fjernet fra Havvind Nord; notaterne ligger stadig.'],
    [/udkast til en kort besked til Maja/, 'Udkastet til beskeden til Maja ligger i dine udkast. Intet er sendt; det gør du selv.'],
    [/Slet udkastet til beskeden til Maja/, 'Udkastet til beskeden til Maja er slettet.'],
    [/Skriv første udkast til opfølgningen/, `Udkastet "${OPFOELGNING}" ligger i Skrive: tre afsnit ud fra mødet. Intet er sendt.`],
    [/Fjern udkastet "Opfølgning/, 'Udkastet er fjernet fra Skrive.'],
    [/Opret en kalenderaftale lørdag/, 'Lørdag kl. 14.00–17.00 er reserveret: Fødselsdag hos Birthe. Jeg har ikke svaret Maja; det gør du selv.'],
    [/Slet kalenderaftalen "Fødselsdag hos Birthe"/, 'Reservationen er slettet; lørdag er fri igen.'],
    [/Find telefonnummeret i signaturen/, 'Nummeret står i signaturen: 70 10 20 30. Jeg har ikke ringet.'],
    [/foreslår besigtigelse/, 'Udkastet til elektrikeren med forslag om besigtigelse tirsdag kl. 16 ligger i Drafts. Intet er sendt; det gør du selv.'],
    [/Læg fakturaen fra mail 2403/, `Fakturaen fra Rørvang VVS (4.210 kr., forfald ${f.forfald}) ligger i Betalinger. Intet er betalt; det godkender du selv.`],
    [/Fjern betalingen til Rørvang/, 'Betalingen er fjernet fra Betalinger igen.'],
    [/List-Unsubscribe i mail 2404/, 'Vindbrevet er afmeldt via linket i mailen. Du får ikke flere.'],
    [/påmindelse fredag kl\. 07\.55/, 'Påmindelsen fredag kl. 07.55 er sat: tilmeld Ella til skolekoncerten.'],
    [/Slet påmindelsen fredag/, 'Påmindelsen om skolekoncerten er slettet.'],
    [/resumé af nyheden/, 'Jeg har lagt et kort resumé af nyheden som note i universet Havvind Nord: den nordlige korridor er godkendt, den vestlige kræver stadig dispensation.'],
    [/Fjern noten "Nyhed/, 'Noten er fjernet fra Havvind Nord igen.'],
    [/himalaya message move --from \S+ --to Folders\/Handling/, 'Mailen ligger i Handling igen.'],
  ];
  const hit = tabel.find(([re]) => re.test(i));
  if (hit) return hit[1];
  const kort = i.length > 110 ? `${i.slice(0, 107).trimEnd()}…` : i;
  return fortryd ? `Gjort om: ${kort}` : `Gjort: ${kort}`;
}

// ---------- Skrive ----------

type Afsnit = { id: string; tekst: string };

/** The paragraphs the draft segment lists as "[a1] …", in order (KC-0123: the draft is data, not instructions). */
function afsnitFraInstruktioner(i: string): Afsnit[] {
  return [...i.matchAll(/\[(a\d+)\] ([\s\S]*?)(?=\n\n\[a\d+\] |\n\nRegler|$)/g)].map((m) => ({ id: m[1] ?? 'a1', tekst: (m[2] ?? '').trim() }));
}

function omskriv(tekst: string, type: string): { ny: string; hvorfor: string } {
  const saetninger = tekst.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (type === 'kortere') {
    const kort = saetninger.length > 1 ? (saetninger[0] ?? tekst) : tekst.length > 90 ? `${tekst.slice(0, tekst.lastIndexOf(' ', 90)).trimEnd()}.` : tekst;
    return { ny: kort, hvorfor: 'Kun det vigtigste er bevaret.' };
  }
  if (type === 'konkret') return { ny: `${tekst} [SÆT IND: tal eller dato]`, hvorfor: 'Hvor der mangler fakta, står en markering i stedet for et gæt.' };
  if (type === 'varmere') return { ny: `${tekst.replace(/[.!?]?$/, '')} – tak for samarbejdet indtil nu.`, hvorfor: 'En varmere tone uden at blive højtidelig.' };
  return { ny: tekst.replace(/\b(meget|rigtig|ret|faktisk|bare|egentlig|jo)\s+/gi, '').replace(/\s{2,}/g, ' ').trim() || tekst, hvorfor: 'Fyld og gentagelser er fjernet.' };
}

function forslagBlok(afsnit: Afsnit[], vaelg: string | null, type: string): { forslag: Raa[] } {
  const maal = vaelg ? afsnit.filter((a) => a.id === vaelg) : [...afsnit].sort((a, b) => b.tekst.length - a.tekst.length).slice(0, 2).sort((a, b) => a.id.localeCompare(b.id));
  const valgt = maal.length ? maal : afsnit.slice(0, 1);
  return { forslag: valgt.map((a) => { const o = omskriv(a.tekst, type); return { afsnitId: a.id, ny: o.ny, hvorfor: o.hvorfor }; }) };
}

function nytDokument(titel: string, brief: string, f: Fakta): Raa {
  if (/clara|opfølg|havvind|mødet/i.test(brief)) return { titel: titel || OPFOELGNING, afsnit: opfoelgningAfsnit(f), kilder: OPFOELGNING_KILDER(f) };
  if (/elektriker|eltavle|tilbud/i.test(brief)) return { titel: titel || 'Svar til elektrikeren', afsnit: ['Hej. Tak for tilbuddet på ny eltavle.', 'Prisen på 18.400 kr. er 2.600 kr. over det, jeg regnede med. Kan I give en pris uden de to ekstra grupper?', 'Jeg vender tilbage inden fredag. Venlig hilsen Henrik'], kilder: ['Tilbud fra Lysnet El-service'] };
  if (/birthe|mor\b|fødselsdag/i.test(brief)) return { titel: titel || 'Hilsen til Birthe', afsnit: ['Kære mor. Tillykke med fødselsdagen.', 'Vi glæder os til lørdag kl. 14, og Ella har en tegning med.', 'Kram fra Henrik, Maja og Ella'], kilder: [] };
  const emne = brief.trim().replace(/[.!?]+$/, '') || 'Nyt dokument';
  const stort = `${emne.charAt(0).toUpperCase()}${emne.slice(1, 60)}`;
  return { titel: titel || stort, afsnit: [`${stort}.`, 'Hvad der skal afklares, hvem det rører, og hvad næste skridt er: det udfylder vi sammen. Skriv selv, eller bed mig stramme, gøre mere konkret eller lave et forslag.'], kilder: [] };
}

// ---------- Univers ----------

function forberedSvar(req: AgentRunRequest, f: Fakta): string {
  const moedet = segment(req, 'kalender');
  const titel = /Mødet: ([^\n]+)/.exec(moedet)?.[1]?.trim() ?? 'Mødet';
  const navne = (/Deltagere: ([^\n]+)/.exec(moedet)?.[1] ?? '').split(',').map((x) => x.replace(/<[^>]*>/g, '').trim()).filter((x) => x && !/^ingen noteret/.test(x));
  const onske = /Henriks ønske til mødet: ([^\n]+)/.exec(udenData(req.input))?.[1]?.trim();
  const eget = onske && !onske.startsWith('(ikke oplyst') ? onske : undefined;
  const svar = /havvind/i.test(titel) ? forberedelseSvar(f, eget ?? FORB_MAAL) : genereltMoede(titel, navne, eget);
  return fenced('Her er forberedelsen. Det, jeg har gættet, er markeret som gæt.', { forberedelse: svar });
}

const OPRET = /\b(lav|opret|tilføj|skriv|sæt|læg)\b/i;

function universChat(req: AgentRunRequest, n: number, f: Fakta): string {
  const besked = udenData(req.input);
  const kontekst = kontekstAf(req);
  const navn = /^Universet "([^"]+)"/.exec(segment(req, 'univers'))?.[1] ?? 'universet';
  const erMoede = kontekst !== undefined && /^Møde(t)?: /.test(kontekst);
  if (/forbered/i.test(besked)) {
    if (!erMoede) return 'Peg på mødet først, så ved jeg, hvilket du mener. Tryk på forbered-knappen under mødet, eller sig det i chatten med mødet valgt.';
    const titel = kontekst.replace(/^Møde(t)?: /, '');
    const svar = /havvind/i.test(titel) ? forberedelseSvar(f) : genereltMoede(titel, [], undefined);
    return fenced(`Jeg har forberedt "${titel}" igen: mål, deltagere, talepunkter og en præsentation.`, { forberedelse: svar });
  }
  if (OPRET.test(besked) && /\b(opgave|to-?do)\b/i.test(besked)) {
    const rest = besked.replace(/^.*?\b(opgave|to-?do)\b[^:]*:?\s*/i, '').trim() || besked.trim();
    const titel = `${rest.charAt(0).toUpperCase()}${rest.slice(1, 90)}`.replace(/[.!?]+$/, '');
    return fenced(`Jeg har lagt opgaven i ${navn}.`, { elementer: [{ type: 'opgave', titel, note: 'Lagt af Hermes.' }] });
  }
  if (OPRET.test(besked) && /\b(note|notat)\b/i.test(besked)) {
    const rest = besked.replace(/^.*?\b(note|notat)\b[^:]*:?\s*/i, '').trim() || besked.trim();
    return fenced(`Jeg har lagt en note i ${navn}.`, { elementer: [{ type: 'note', titel: `Note: ${rest.slice(0, 50)}`, tekst: rest }] });
  }
  if (OPRET.test(besked) && /\b(præsentation|slides|dokument)\b/i.test(besked)) {
    const emne = besked.replace(/^.*?\b(præsentation|slides|dokument)\b\s*(om|til|for)?\s*/i, '').trim().slice(0, 60) || navn;
    const htmlTekst = enkeltSide(emne.charAt(0).toUpperCase() + emne.slice(1), [{ overskrift: 'Hvorfor nu', punkter: ['Det er tid til at tage stilling.'] }, { overskrift: 'Næste skridt', punkter: ['Vi aftaler, hvem der gør hvad, og hvornår.'] }]);
    return fenced(`Jeg har lavet et dokument i ${navn}.`, { elementer: [{ type: 'dokument', titel: `Dokument: ${emne}`.slice(0, 80), html: htmlTekst }] });
  }
  return chatSvar('univers', n, besked, f, kontekst).tekst;
}

function oversigtChat(req: AgentRunRequest, n: number, f: Fakta): string {
  const besked = udenData(req.input);
  if (/univers/i.test(besked) && /\b(lav|opret|nyt)\b/i.test(besked)) {
    const emne = /om (?:min |mit |en |et )?([^.!?\n]{2,40})/i.exec(besked)?.[1]?.trim() ?? 'Mit emne';
    const navn = emne.charAt(0).toUpperCase() + emne.slice(1);
    return fenced(`Jeg har oprettet universet "${navn}".`, { nytUnivers: { navn, om: `Alt om ${emne}, samlet ét sted.` } });
  }
  return chatSvar('univers-oversigt', n, besked, f, kontekstAf(req)).tekst;
}

// ---------- The scripted Hermes ----------

/** The answer to a run the app started, as Hermes would give it at `ctx.moment` on `ctx.dag`. */
export function svar(req: AgentRunRequest, ctx: SvarKontekst): string {
  const i = req.instructions;
  const input = udenData(req.input); // Henrik's words and the app's own text; the quoted data is read by segment()
  // KC-0131: the cold start is a fresh install on the story's morning (its calendar is the morning's).
  const kold = erKold(ctx.moment.id);
  const hel = kold ? 0 : momentNr(ctx.moment.id);
  const n = rumNr(hel); // the rooms' story ends with the evening (KC-0103); Kuratoren and the chat in Hjem move on
  const f = fakta(ctx.dag);

  if (i.includes(IMPORT_MARKOER)) return importSvar(req); // KC-0129: Start's step 5
  if (i.includes('Du forbereder et møde')) return forberedSvar(req, f);
  if (i.includes('Du arbejder i Univers-oversigten')) return oversigtChat(req, n, f);
  if (i.includes('Du arbejder i ét univers')) return universChat(req, n, f);
  if (i.includes('Du er Kuratoren')) return fenced('Her er kortene.', kold ? koldKuratorRaa(f) : kuratorRaa(hel, f));
  if (i.includes('har lukket et kort fra Kuratoren')) {
    const grund = /Henriks grund: ([^\n]+)/.exec(input)?.[1]?.trim() ?? '';
    const noteret = grund ? `Noteret i min hukommelse: "${grund.slice(0, 80)}". Jeg tager det ikke op igen.` : 'Noteret. Jeg tager det ikke op igen.';
    // KC-0144: Henrik named a pattern ("altid", "aldrig", "hver gang") — one proposal for a rule, which only his Ja makes real.
    const kortTitel = /Kortet fra Kuratoren: "([^"\n]+)"/.exec(segment(req, 'kort'))?.[1] ?? '';
    return i.includes('"regelforslag"') && MOENSTER.test(grund) ? fenced(noteret, { regelforslag: regelforslagTil(kortTitel) }) : noteret;
  }
  // KC-0145: "Skulle have vist mig det" on the Sunday sample — Hermes notes it; a rule's pause proposal is already the app's.
  if (i.includes('søndagens stikprøve')) return 'Noteret: den slags viser jeg dig fremover i stedet for at lægge den væk.';
  if (i.includes('trykket "Fortryd"')) return handlingSvar(segment(req, 'fortryd'), f, true);
  if (i.includes('gem den som kladde')) {
    const id = /mail (\d+)/.exec(input)?.[1] ?? '';
    return `Kladden til ${AFSENDER[id] ?? 'modtageren'} ligger i Drafts. Intet er sendt.`;
  }
  if (/trykket Send/.test(i)) {
    const id = /mail (\d+)/.exec(input)?.[1] ?? '';
    return `Sendt til ${AFSENDER[id] ?? 'modtageren'}. Mailen ligger i Sendt. (Testtilstand: intet forlader maskinen.)`;
  }
  if (i.includes('baggrundsopgave')) {
    const til = /--to (\S+)/.exec(input)?.[1] ?? 'Archive';
    return `Flyttet til ${til.replace(/^Folders\//, '')}.`;
  }
  if (i.includes('trykket på knappen')) return handlingSvar(segment(req, 'handling'), f, false);

  if (i.includes('første udkast')) {
    const titel = /Titel: ([^\n(]+)/.exec(input)?.[1]?.trim() ?? '';
    const brief = /Brief: ([\s\S]+)/.exec(input)?.[1]?.trim() ?? input;
    return fenced('Her er udkastet.', nytDokument(/^\(find selv/.test(titel) ? '' : titel, brief, f));
  }
  if (i.includes('Giv højst 3 forslag') && i.includes('afsnit-id\'er i klammer') && !i.includes('Regler for chatten')) {
    const afsnit = afsnitFraInstruktioner(segment(req, 'udkast'));
    const id = /afsnitId: (a\d+)/.exec(input)?.[1] ?? null;
    const type = /Stram op/.test(input) ? 'stram' : /mere konkret/.test(input) ? 'konkret' : /varmere/.test(input) ? 'varmere' : 'kortere';
    return fenced('Her er forslaget.', forslagBlok(afsnit, id, type));
  }

  if (/svar med præcis dette skema/i.test(i)) {
    if (i.includes('rummet "Nyheder"')) return fenced('Her er avisen.', nyhederRaa());
    // KC-0131: the cold mail folders are empty, so there is nothing to decide.
    // KC-0223: the refresh from a connection Clawco may only read (the moments where Gmail is connected).
    if (i.includes('rummet "Mail"') && i.includes('Clawco kan kun læse denne mailkonto')) return fenced('Her er beslutningerne.', gmailRaa(n, f));
    if (i.includes('rummet "Mail"')) return fenced('Her er beslutningerne.', kold ? { beslutninger: [], hermesStatus: 'Holder øje med Handling' } : mailRaa(n, f));
    // KC-0103: on the next morning "Byg Dagen nu" builds that day, as its 07.05 build would have.
    const status = STATUS_EFTER_AFTEN[ctx.moment.id];
    return fenced('Her er dagen.', momentPlus(ctx.moment, ctx.dag) ? dagenRaa(0, fakta(plusDag(ctx.dag, momentPlus(ctx.moment, ctx.dag)))) : { ...dagenRaa(n, f), ...(status ? { hermesStatus: status } : {}) });
  }

  // Chats, per room.
  const kontekst = kontekstAf(req);
  if (i.includes('rummet "Skrive"')) {
    const r = chatSvar('skrive', n, input, f, kontekst);
    if (!r.kortere) return r.tekst;
    const afsnit = afsnitFraInstruktioner(segment(req, 'udkast'));
    if (!afsnit.length) return 'Der er intet udkast at gøre kortere endnu. Bed mig skrive et nyt, så kan jeg stramme det bagefter.';
    const valgt = /^Afsnit (\d+)/.exec(kontekst ?? '')?.[1];
    return fenced(r.tekst, forslagBlok(afsnit, valgt ? `a${valgt}` : null, 'kortere'));
  }
  if (i.includes('rummet "Dagen"')) {
    const r = chatSvar('dagen', n, input, f, kontekst);
    if (!r.flyt) return r.tekst;
    const kalender = (dagenRaa(n, f)['kalender'] as Raa[]).map((k) => (/Løb/.test(String(k['titel'])) ? { ...k, tid: r.flyt?.tid, slut: r.flyt?.slut, status: 'flyttet', note: `Flyttet til kl. ${r.flyt?.tid} efter dit ønske.` } : k));
    if (!kalender.some((k) => /Løb/.test(String(k['titel'])))) return 'Løbeturen er overstået for i dag. Sig til, hvis jeg skal lægge et nyt løb ind i morgen.';
    kalender.sort((a, b) => String(a['tid']).localeCompare(String(b['tid'])));
    return fenced(r.tekst, { opdater: { kalender } });
  }
  if (i.includes('rummet "Mail"')) return chatSvar('mail', n, input, f, kontekst).tekst;
  // KC-0149: a request's suggestion run (neutral advice and another time; never a state).
  if (i.includes('rummet "Husstanden" med en forespørgsel')) return fenced('Et forslag til svaret.', { anbefaling: 'Den fælles uge er fri på det tidspunkt.', alternativer: [{ kl: '17:00', tekst: 'Kan 17.00' }] });
  // KC-0150: the neutral suggestion for a clash — the small car first.
  if (i.includes('har booket den samme ting')) return fenced('Et forslag.', { foerste: 'v1', anbefaling: 'Den lille bil er fri, så den kan klare det uden at nogen skal bytte.' });
  // KC-0152: the weekend card's neutral phrasing (the two adults by name, never "du").
  if (i.includes('weekendkort')) return fenced('Et forslag til kortet.', { resume: 'Lørdag er Henrik på cykeltur 9 til 14, og Maja til kaffe 11 til 13.', spoergsmaal: 'Hvem har Ella?' });
  if (i.includes('rummet "Husstanden"')) {
    // KC-0151: a wish to use a car is answered with a booking block; the app makes the card, Hermes books nothing.
    const bil = bilBooking(input, f, ctx.moment.id);
    if (bil) return fenced('Jeg har lagt et kort frem i Husstanden.', { booking: bil });
    return chatSvar('husstand', n, input, f, kontekst).tekst; // KC-0148
  }
  if (i.includes('rummet "Nyheder"')) {
    if (kontekst && /grønt lys|nordvik/i.test(kontekst)) return `${NYHEDEN_TITEL}: den nordlige korridor er godkendt, den vestlige kræver stadig dispensation. Det er det valg, I tager med Clara.`;
    return chatSvar('nyheder', n, input, f, kontekst).tekst;
  }
  const hjem = chatSvar('hjem', hel, sidsteAfsnit(input), f, kontekst).tekst;
  // KC-0144: Ret on a card with a pattern in his words → a proposal; Ret reglen on a proposal → the same rule, in his words.
  if (i.includes('"regelforslag"') && kontekst?.startsWith('Kortet: ') && MOENSTER.test(sidsteAfsnit(input))) return fenced(hjem, { regelforslag: regelforslagTil(kontekst.slice('Kortet: '.length)) });
  if (i.includes('"regelforslag"') && kontekst?.startsWith('Forslag: ')) {
    const forrige = /Forslaget Henrik retter: (\{.*\})/.exec(segment(req, 'regelforslag'))?.[1];
    const rettet = forrige ? { ...(JSON.parse(forrige) as Raa), tekst: sidsteAfsnit(input).slice(0, 400) } : null;
    return rettet ? fenced('Jeg har rettet forslaget; det er stadig dit ja, der gør det til en regel.', { regelforslag: rettet }) : hjem;
  }
  return hjem;
}
