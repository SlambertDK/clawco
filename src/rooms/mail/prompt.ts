// What we ask Hermes in the room Mail. Pure functions.

import type { RunSpec } from '../dagen/prompt.ts';
import type { MailState } from './schema.ts';
import type { TrimmedMail } from './source.ts';
import { copenhagenDate, copenhagenTime } from '../dagen/source.ts';
import { VISUEL_SKEMA } from '../../shell/visuel.ts';
import { byggPrompt, elementSegment, fortrydOpgave, handlingsOpgave, PEGER } from '../../agent/prompt.ts';
import { KORSEL } from './schema.ts';

/** A mail id from Hermes' JSON as it may stand in the app's own text (commands, task sentences): safe characters only. */
const rentId = (id: string): string => id.replace(/[^\w.-]/g, '').slice(0, 40);

const ROLLE = `Du er Hermes, Henriks agent, og du arbejder inde i rummet "Mail" i hans kontrolcenter. Mappen Folders/Handling i Proton er Henriks rigtige indbakke: der ligger kun mails, hvor han ejer næste skridt. Rummet gør hver mail til én beslutning med knapper.`;

const SKEMA = `\`\`\`json
{
  "beslutninger": [
    {
      "mailId": "242",
      "emne": "emnet",
      "fra": "afsenderens navn",
      "modtaget": "ISO-dato fra listen",
      "type": "svar | aktion | info | nyhedsbrev | regning | kvittering",
      "resume": "én linje: hvad mailen er",
      "betydning": "1-2 linjer: hvad den betyder for Henrik, og hvad der bør ske. Det er den tekst, han læser i stedet for mailen.",
      "frist": "YYYY-MM-DD hvis der er en frist, ellers udelad",
      "udkast": "KUN ved type svar: et færdigt udkast til svar i Henriks stemme (dansk, kort, konkret). Ellers udelad.",
      "arkivmappe": "hvor mailen skal hen, når Henrik er færdig med den: Archive | Folders/Afventer | Folders/Måske | Folders/Regninger | Folders/køb | Folders/vigtige docs",
      "muligheder": [ { "id": "afmeld", "label": "Afmeld", "instruktion": "præcis instruktion til dig selv", "fortryd": "hvis det kan gøres om" } ],
      "visuel": ${VISUEL_SKEMA}
    }
  ],
  "hermesStatus": "3-6 ord om hvad du holder øje med"
}
\`\`\``;

const REGLER = `Regler:
- Læs hver mail med din terminal: \`himalaya message read -m Folders/Handling <id>\` (brug \`-m Folders/Handling\` hver gang). Lad være med at gætte ud fra emnet alene.
- Skriv dansk, kort og konkret. Henrik åbner ikke Proton: "betydning" skal gøre det overflødigt.
- "type": svar = Henrik skal svare (skriv "udkast"); aktion = han skal gøre noget andet (bestille, bekræfte, betale, vælge); info = ren orientering; nyhedsbrev = nyhedsbrev/markedsføring; regning = faktura/påmindelse; kvittering = ordre/levering.
- "muligheder" er valgfri (0-2) og kun ting, du selv kan udføre med dine værktøjer:
  · Nyhedsbreve: "Afmeld" med instruktion: find List-Unsubscribe-headeren eller afmeld-linket (\`himalaya message read -m Folders/Handling --raw <id> | grep -i unsubscribe\`), åbn https-linket med dit web-værktøj og bekræft; findes kun mailto, så meld det tilbage uden at sende.
  · Aktioner: fx finde et telefonnummer, en dato eller et beløb frem, slå noget op, lave en kalenderblok.
  · Aldrig flytninger (det gør appen i baggrunden), aldrig "lad ligge".
  · Sæt "tilAndre": true på en mulighed, når det, den laver, er til andre mennesker (fx et udkast til en bekræftelse eller et svar). Du laver kun udkastet; Henrik sender selv. Knappen bliver rød. Ellers udelad feltet.
- Du må aldrig sende, besvare eller videresende mail, aldrig slette, aldrig flytte til Trash eller Spam, og aldrig oprette mapper.
- Giv hver beslutning et "visuel" (KC-0060): et tilbud eller en regning mod budget eller tidligere tilbud som "beloeb", et nyhedsbrev som "prikker" (hvor mange af de sidste, Henrik har åbnet, hvis du ved det), afsender og andre personer som "personer".
- Medtag alle mails i listen (højst 20). Svar KUN med ét JSON-objekt i en \`\`\`json-blok. Ingen tekst udenom.`;

function tidslinje(now: Date): string {
  return `Nu er det ${copenhagenDate(now)} kl. ${copenhagenTime(now.toISOString())} (Europe/Copenhagen).`;
}

export function buildMailRefreshRun(data: TrimmedMail, now: Date): RunSpec {
  const list = data.handling.map((e) => ({ id: e.id, emne: e.emne, fra: e.fra, modtaget: e.modtaget, laest: e.laest, flag: e.flag, vedhaeftning: e.vedhaeftning }));
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      katalog: true,
      opgave: `${ROLLE}\n\nDu får listen over mails i Folders/Handling som JSON i beskeden. Læs dem og svar med præcis dette skema:\n\n${SKEMA}\n\n${REGLER}`,
      data: [{ kilde: 'mail', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\nTal: ${JSON.stringify(data.tal)}\n\nMails i Folders/Handling (${list.length}):\n\`\`\`json\n${JSON.stringify(list, null, 1)}\n\`\`\`` }],
    }),
  };
}

// KC-0214: the refresh in a Clawco without agent tools (a Sky tenant), from the mail connector's envelopes. The agent
// cannot read a body and has no tools, so it proposes no muligheder and no folder: Færdig moves the mail to the
// account's archive through the connector. The shared rules are taken from REGLER, so the two never drift apart.
const ROLLE_FORBINDELSE = `Du er Hermes, Henriks agent, og du arbejder inde i rummet "Mail" i hans kontrolcenter. Du får afsender, emne og dato på de nyeste mails i hans indbakke. Rummet gør hver mail til én beslutning med knapper.`;
const SKEMA_FORBINDELSE = SKEMA.split('\n').filter((l) => !/^\s*"(arkivmappe|muligheder)"/.test(l)).join('\n');
const faelles = (start: string): string => REGLER.split('\n').find((l) => l.startsWith(start)) ?? '';
const REGLER_FORBINDELSE = [
  'Regler:',
  '- Du kan ikke læse selve mailene, og du har ingen værktøjer: du har kun afsender, emne og dato. Vurdér ud fra dem, og sig det i "betydning", når det er et skøn ud fra emnet.',
  '- Skriv dansk, kort og konkret.',
  faelles('- "type":'),
  '- Når Henrik trykker Færdig, flytter appen mailen til arkivet i hans mailkonto. Du foreslår ingen andre knapper og ingen mappe.',
  '- Du må aldrig sende, besvare eller videresende mail, aldrig slette og aldrig flytte noget selv.',
  faelles('- Giv hver beslutning'),
  faelles('- Medtag alle mails'),
].join('\n');

// KC-0223: the same for a connection Clawco may only read (Gmail): the card is a reading aid, so no draft, folder
// or button is asked for — Henrik moves and answers mails in his own mail app.
const ROLLE_LAESEKUN = `Du er Hermes, Henriks agent, og du arbejder inde i rummet "Mail" i hans kontrolcenter. Du får afsender, emne og dato på de ulæste og markerede mails i hans indbakke. Rummet gør hver mail til én beslutning, han kan læse i stedet for mailen.`;
const SKEMA_LAESEKUN = SKEMA_FORBINDELSE.split('\n').filter((l) => !/^\s*"udkast"/.test(l)).join('\n');
const REGLER_LAESEKUN = [
  'Regler:',
  '- Du kan ikke læse selve mailene, og du har ingen værktøjer: du har kun afsender, emne og dato. Vurdér ud fra dem, og sig det i "betydning", når det er et skøn ud fra emnet.',
  '- Skriv dansk, kort og konkret.',
  faelles('- "type":').replace(' (skriv "udkast")', ''),
  '- Clawco kan kun læse denne mailkonto: Henrik flytter og besvarer mails selv i sin egen mailapp. Du foreslår ingen knapper, intet udkast og ingen mappe.',
  '- Du må aldrig sende, besvare eller videresende mail, aldrig slette og aldrig flytte noget selv.',
  faelles('- Giv hver beslutning'),
  faelles('- Medtag alle mails'),
].join('\n');

/**
 * KC-0214: the refresh from the mail connector's inbox (`navn`: the connector), for an agent without tools.
 * KC-0223 `laeseKun`: the connection can only read, so the ask has no draft, folder or button.
 */
export function buildMailRefreshForbindelseRun(data: TrimmedMail, now: Date, navn: string, o: { laeseKun?: boolean } = {}): RunSpec {
  const list = data.handling.map((e) => ({ id: e.id, emne: e.emne, fra: e.fra, modtaget: e.modtaget, laest: e.laest, flag: e.flag, vedhaeftning: e.vedhaeftning }));
  const laeseKun = o.laeseKun === true;
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      katalog: true,
      opgave: `${laeseKun ? ROLLE_LAESEKUN : ROLLE_FORBINDELSE}\n\nDu får listen over ${laeseKun ? 'ulæste og markerede mails' : 'mails'} i indbakken som JSON i beskeden. Læs dem og svar med præcis dette skema:\n\n${laeseKun ? SKEMA_LAESEKUN : SKEMA_FORBINDELSE}\n\n${laeseKun ? REGLER_LAESEKUN : REGLER_FORBINDELSE}`,
      data: [{ kilde: 'mail', zone: KORSEL, tillid: 'utroet', tekst: `${tidslinje(now)}\n\n${laeseKun ? 'Ulæste og markerede mails' : 'Mails'} i indbakken (${navn}, ${list.length} af ${data.tal.indbakke}):\n\`\`\`json\n${JSON.stringify(list, null, 1)}\n\`\`\`` }],
    }),
  };
}

const HANDLING_REGLER = `Regler for handlinger:
- Udfør handlingen med din terminal (himalaya), inden for det knappen må. Kontrollér bagefter, at mailen ligger hvor den skal (\`himalaya envelope list -m <mappe> -s 50 --json\`).
- Du må aldrig sende, besvare eller videresende mail, aldrig slette og aldrig flytte til Trash. Hvis handlingen kræver det, gør du det ikke og siger hvorfor.
- Svar med højst to korte danske sætninger om, hvad du gjorde. Ingen JSON.`;

/**
 * KC-0123: subjects, senders and summaries came from mail (via Hermes) — an afledt segment, never task text.
 * KC-0218 `medDato`: the connector chat has only envelopes, so the date each mail came in is part of what it knows.
 */
function indholdSegment(state: MailState | null, medResume: boolean, foer = '', medDato = false) {
  const kort = state && { tal: state.tal, beslutninger: state.beslutninger.map((b) => ({ mailId: b.mailId, emne: b.emne, fra: b.fra, ...(medDato ? { modtaget: b.modtaget } : {}), ...(medResume ? { resume: b.resume } : {}), afgjort: Boolean(b.afgjort) })) };
  return { kilde: 'rum-state', zone: KORSEL, tillid: 'afledt' as const, tekst: `${foer}${kort ? `Rummets indhold:\n\`\`\`json\n${JSON.stringify(kort, null, 1)}\n\`\`\`` : 'Rummet har ingen data endnu.'}` };
}

/** `verb`: the handling's verb as the policy layer ran it (KC-0122); the run's task sentence is the app's text for it. */
export function buildMailHandlingRun(label: string, instruktion: string, state: MailState, verb: string): RunSpec {
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${ROLLE}\n\n${handlingsOpgave(verb)} Rummets indhold i kort form står også i beskeden.\n\n${HANDLING_REGLER}`,
      data: [{ kilde: 'handling', zone: KORSEL, tillid: 'afledt', tekst: instruktion }, indholdSegment(state, false, `Knappen: "${label}"\n\n`)],
    }),
  };
}

export function buildMailFortrydRun(fortryd: string, state: MailState): RunSpec {
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${ROLLE}\n\n${fortrydOpgave()} Tal i rummet: ${JSON.stringify(state.tal)}\n\n${HANDLING_REGLER}`,
      data: [{ kilde: 'fortryd', zone: KORSEL, tillid: 'afledt', tekst: fortryd }],
    }),
  };
}

/**
 * KC-0218 `forbindelse`: the room runs on a mail connector (a Clawco without Hermes' tools), so the chat answers from
 * what the connector reads — sender, subject and date — and names no tool. Absent = Henrik's installation: unchanged.
 */
export type MailChatForbindelse = { navn: string; kanHandle: boolean; nu?: Date };

function chatForbindelseOpgave(f: MailChatForbindelse): string {
  const grænse = f.kanHandle
    ? 'Mailen flytter Henrik selv med Færdig i rummet.'
    : 'Clawco kan kun læse denne mailkonto, så Henrik flytter og besvarer mails i sin egen mailapp.';
  return `Du er Hermes, Henriks agent, og du svarer i rummet "Mail" i hans kontrolcenter. Rummet viser de nyeste mails i hans indbakke i mailkontoen ${f.navn}, hver som én beslutning.

Rummets indhold står som afledt data i beskeden. ${PEGER}

Det her ved du: mailforbindelsen ${f.navn} læser afsender, emne og dato på indbakkens nyeste mails, og rummet ved, hvilke af dem Henrik allerede har afgjort. Det er alt. Du kan ikke læse selve mailene, og du kan ikke flytte, skrive kladder eller sende.

Regler for chatten:
- Svar kort på dansk ud fra afsender, emne og dato: fx hvem der har skrevet i dag, hvor mange mails der venter, eller hvad en mail fra en bestemt afsender handler om.
- Hvad en mail handler om, ved du kun ud fra emnet: sig, at det er et gæt ud fra emnet.
- Spørger Henrik om mere, end du ved (hvad der står i en mail, eller at flytte, svare eller sende), så sig det i én sætning: du ser kun afsender, emne og dato. ${grænse}
- Du må aldrig sende, besvare eller videresende mail og aldrig slette.`;
}

export function buildMailChatRun(besked: string, kontekst: string | undefined, state: MailState | null, forbindelse?: MailChatForbindelse): RunSpec {
  if (forbindelse) {
    return {
      ...byggPrompt({
        rum: 'mail',
        zone: KORSEL,
        opgave: chatForbindelseOpgave(forbindelse),
        data: [indholdSegment(state, true, `${tidslinje(forbindelse.nu ?? new Date())}\n\n`, true), ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
      }),
    };
  }
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nRummets indhold står som afledt data i beskeden. ${PEGER} Læs mailen med himalaya, hvis det hjælper.\n\nRegler for chatten:
- Svar kort på dansk. Brug himalaya til at læse mails, når det giver et bedre svar.
- Du må aldrig sende, besvare eller videresende mail, aldrig slette og aldrig flytte til Trash. Flytninger sker kun gennem rummets knapper.`,
      data: [indholdSegment(state, true), ...elementSegment(kontekst, KORSEL), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: besked }],
    }),
  };
}

/** The mail's subject as it stands in the beskeden: it came from the sender, so it is utroet. */
const emneSegment = (mailId: string, emne: string) => ({ kilde: 'mail', zone: KORSEL, tillid: 'utroet' as const, tekst: `Mail ${rentId(mailId)} har emnet: ${emne}` });

export function buildKladdeRun(mailId: string, emne: string, tekst: string): RunSpec {
  const id = rentId(mailId);
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nHenrik har skrevet (eller godkendt) et svar på mail ${id} (emnet står i beskeden) i kontrolcentret. Du skal gem den som kladde i Proton: byg en rå RFC 5322-besked med To = afsenderen af mail ${id} (slå den op med \`himalaya message read -m Folders/Handling ${id}\`), Subject = "Re: <emnet>", In-Reply-To og References = mailens Message-ID, og teksten nedenfor som brødtekst, og læg den i mappen Drafts med \`himalaya message add -m Drafts\`. Du må aldrig sende, besvare eller videresende; kun gemme kladden. Svar med én kort dansk sætning om, at kladden ligger i Drafts, eller hvad der gik galt.`,
      data: [emneSegment(mailId, emne), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: `Svar på mail ${id}:\n\n${tekst}` }],
    }),
  };
}

export function buildBaggrundFlytRun(mailId: string, mappe: string): RunSpec {
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nDette er en baggrundsopgave uden Henrik. Flyt mailen med himalaya og bekræft bagefter med \`himalaya envelope list -m ${mappe} -s 50 --json\`. Aldrig slette, aldrig Trash. Svar med én kort dansk sætning.`,
      data: [{ kilde: 'baggrund', zone: KORSEL, tillid: 'betroet', tekst: `himalaya message move --from Folders/Handling --to ${mappe} ${rentId(mailId)}` }],
    }),
  };
}

/** Henrik pressed Send after approving the draft: that click is his explicit ok. */
export function buildSendRun(mailId: string, emne: string, tekst: string): RunSpec {
  const id = rentId(mailId);
  return {
    ...byggPrompt({
      rum: 'mail',
      zone: KORSEL,
      opgave: `${ROLLE}\n\nHenrik har godkendt svaret nedenfor i kontrolcentret og trykket Send. Det er hans udtrykkelige ok til at sende præcis denne ene mail. Send den som svar på mail ${id} (emnet står i beskeden) med \`himalaya message reply -m Folders/Handling ${id}\` og flaget \`--send\`, med teksten nedenfor som brødtekst (brug --body eller stdin; se \`himalaya message reply --help\`). Ret ikke i teksten, tilføj ingen signatur ud over den, kontoen selv sætter, send kun denne ene mail og ikke til andre modtagere end dem, svaret naturligt går til. Bekræft bagefter, at mailen ligger i Sent (\`himalaya envelope list -m Sent -s 5 --json\`). Svar med én kort dansk sætning: sendt til hvem, eller hvad der gik galt.`,
      data: [emneSegment(mailId, emne), { kilde: 'henrik', zone: KORSEL, tillid: 'betroet', tekst: `Svar på mail ${id}:\n\n${tekst}` }],
    }),
  };
}
