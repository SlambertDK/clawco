// KC-0052: "jeg vil skrive" in the chat opens Skrive. A small deterministic
// reader, run before Hermes is asked: an opening verb with a room name ("åbn
// mail"), or the wish to do a room's thing ("jeg vil læse nyhederne"). Anything
// else is a sentence for Hermes. Pure.
//
// KC-0170: the reader understands Danish AND English always, whatever the language of the request: a person may type
// either. Only what the chat SAYS back (the example phrases, the help answer) follows the request's language.

import { sprogNu } from '../store/sprog.ts';

export type Aabning = { id: string; /** The sentence says more than the wish: send it on to the room's chat. */ videre: boolean };

const NAVNE_DA: Record<string, string> = {
  hjem: 'hjem|forsiden',
  start: 'start|velkomsten|rejsen|opsætningen',
  dagen: 'dagen|kalenderen|min kalender|min dag',
  mail: 'mail|mails|mailen|min mail|mine mails|indbakken',
  skrive: 'skrive|skriv',
  nyheder: 'nyheder|nyhederne|morgenavisen',
  univers: 'univers|universer|universerne',
  husstand: 'husstand|husstanden|familien',
};
const NAVNE_EN: Record<string, string> = {
  hjem: 'home|home page|the home page|front page|the front page|the start page',
  start: 'start|setup|the setup|welcome|the welcome|the journey',
  dagen: 'day|the day|my day|calendar|the calendar|my calendar|today',
  mail: 'mail|mails|the mail|my mail|my mails|inbox|the inbox|my inbox|email|emails|the email|my email|my emails',
  skrive: 'write|writing|the writing',
  nyheder: 'news|the news|my news|morning paper|the morning paper',
  univers: 'universe|universes|the universe|the universes',
  husstand: 'household|the household|my household|family|the family|my family',
};
// Both languages in one alternation per room; the room ids (and so the order of the list) come from the Danish table.
const NAVNE: Record<string, string> = Object.fromEntries(Object.entries(NAVNE_DA).map(([id, da]) => [id, `${da}|${NAVNE_EN[id]}`]));
/** KC-0148: rooms the chat opens and lists only when they are there for the person (Husstanden: src/hushold/personer.ts). */
export type AabnValg = { husstand?: boolean };
const kanAabne = (id: string, o: AabnValg): boolean => id !== 'husstand' || o.husstand === true;
const AABN_DA = '(?:åbn|åbne|vis|vise|gå til|gå ind i|gå tilbage til|tilbage til|tag mig til|hop til|skift til)(?: mig)?(?: rummet)?';
const AABN_EN = '(?:open|show|go to|go into|go back to|back to|take me to|switch to)(?: me)?(?: the| my)?(?: room)?';
const AABN = `(?:${AABN_DA}|${AABN_EN})`;
// An apostrophe is dropped before reading (ord), so "let's" is "lets" and "I'd" is "id".
const OENSKE_DA = '(?:jeg (?:vil|skal|må|gerne vil|har brug for at)|lad os|lad mig|hjælp mig(?: med)?(?: at)?|kan vi)(?: gerne| lige)*';
const OENSKE_EN = '(?:i(?: just| really)* (?:want to|need to|have to|must|would like to|will|wanna)|id(?: just| really)* like to|lets|let us|let me|help me(?: to)?|can we|could we)(?: just| really| gladly| please)*';
const OENSKE = `(?:${OENSKE_DA}|${OENSKE_EN})`;
const GOERE: Record<string, string> = {
  skrive: 'skrive|write',
  nyheder: `(?:læse|se|tjekke|kigge på) (?:${NAVNE['nyheder']})|(?:read|see|check|look at|catch up on) (?:${NAVNE['nyheder']})`,
  mail: `(?:læse|se|tjekke|svare på|rydde op i|gå igennem|kigge på) (?:${NAVNE['mail']})|(?:read|see|check|answer|reply to|clean up|go through|look at) (?:${NAVNE['mail']})`,
  dagen: `(?:se|tjekke|kigge på) (?:${NAVNE['dagen']})|(?:see|check|look at) (?:${NAVNE['dagen']})`,
};
/** KC-0098: one phrase per room above that opens it — what "Hvad kan jeg sige?" lists. The tests prove each one is read as written. */
const EKSEMPEL_DA: Record<string, string> = {
  hjem: 'Tilbage til forsiden',
  start: 'Åbn opsætningen',
  dagen: 'Åbn dagen',
  mail: 'Åbn mail',
  skrive: 'Jeg vil skrive',
  nyheder: 'Jeg vil læse nyhederne',
  univers: 'Åbn universerne',
  husstand: 'Åbn husstanden',
};
const EKSEMPEL_EN: Record<string, string> = {
  hjem: 'Back to the front page',
  start: 'Open the setup',
  dagen: 'Open the day',
  mail: 'Open mail',
  skrive: 'I want to write',
  nyheder: 'I want to read the news',
  univers: 'Open the universes',
  husstand: 'Open the household',
};
/** The whole message is a request for the help (after case and punctuation): "hjælp mig med at skrive …" is for Hermes. */
const HJAELP = new Set(['hvad kan jeg sige', 'hjælp', 'hvad kan du', 'what can i say', 'help', 'what can you do']);
/** Words that add nothing to the wish: "okay, jeg vil lige skrive noget" is still just the wish. */
const FYLD = new Set(['okay', 'ok', 'hej', 'hermes', 'nu', 'tak', 'lige', 'gerne', 'så', 'noget', 'lidt', 'en', 'et', 'tekst', 'please', 'venligst', 'du', 'kan', 'mig', 'igen', 'og',
  'hi', 'hello', 'hey', 'now', 'thanks', 'thank', 'just', 'really', 'kindly', 'gladly', 'some', 'something', 'little', 'bit', 'a', 'an', 'you', 'can', 'could', 'would', 'text', 'me', 'and', 'again', 'so']);

const ord = (t: string): string => t.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// \b is ASCII-only, so "æøå" need explicit edges.
const fund = (tekst: string, moenster: string): string | null => new RegExp(`(?:^|\\s)(${moenster})(?=\\s|$)`, 'u').exec(tekst)?.[1] ?? null;

export function rumFraBesked(besked: string, univers: readonly { id: string; navn: string }[], o: AabnValg = {}): Aabning | null {
  const t = ord(besked);
  const kandidater: [string, string][] = [
    ...univers.map((u): [string, string] => [`univers-${u.id}`, `${AABN} (?:${esc(ord(u.navn))})|${OENSKE} (?:arbejde (?:med|på)|se|kigge på|åbne|work (?:on|with)|see|look at|open|check) (?:${esc(ord(u.navn))})`]),
    ...Object.entries(NAVNE).filter(([id]) => kanAabne(id, o)).map(([id, navne]): [string, string] => [id, `${AABN} (?:${navne})${GOERE[id] ? `|${OENSKE} (?:${GOERE[id]})` : ''}`]),
  ];
  for (const [id, moenster] of kandidater) {
    const hit = fund(t, moenster);
    if (!hit) continue;
    const rest = t.replace(hit, ' ').split(' ').filter((w) => w && !FYLD.has(w));
    return { id, videre: rest.length > 0 };
  }
  return null;
}

/** KC-0098: "Hvad kan jeg sige?" — answered by the chat itself, never sent to Hermes. */
export const erHjaelp = (besked: string): boolean => HJAELP.has(ord(besked));

/** What the chat opens, one phrase each: the rooms of NAVNE (so a new room cannot be forgotten) and each univers by name. */
export function hvadKanJegSige(univers: readonly { id: string; navn: string }[], o: AabnValg = {}): { id: string; saet: string }[] {
  const en = sprogNu() === 'en';
  const eksempel = en ? EKSEMPEL_EN : EKSEMPEL_DA;
  return [
    ...Object.keys(NAVNE).filter((id) => kanAabne(id, o)).map((id) => ({ id, saet: eksempel[id] ?? '' })),
    ...univers.map((u) => ({ id: `univers-${u.id}`, saet: `${en ? 'Open' : 'Åbn'} ${u.navn}` })),
  ].filter((e) => e.saet);
}

export function hjaelpSvar(univers: readonly { id: string; navn: string }[], o: AabnValg = {}): string {
  const [indled, slut] = sprogNu() === 'en' ? ['You can say, for example:', 'Anything else, you can just ask me.'] : ['Du kan sige for eksempel:', 'Alt andet kan du bare spørge mig om.'];
  return `${indled}\n${hvadKanJegSige(univers, o).map((e) => `• "${e.saet}"`).join('\n')}\n${slut}`;
}

/** KC-0146: the wish to see what Clawco knows ("hvad ved du om mig", "hvad har du gemt"): the chat opens /viden. Never Slet alt. */
const VIDEN = /^(?:(?:hej|hi|hello|hey|okay|ok|hermes) )*(?:hvad (?:ved (?:du|clawco|hermes) om mig|har (?:du|clawco|hermes) gemt(?: om mig)?)|what (?:(?:do|does) (?:you|clawco|hermes) know about me|(?:have|has) (?:you|clawco|hermes) (?:stored|saved|kept)(?: about me)?))$/u;
export const erVidenBesked = (besked: string): boolean => VIDEN.test(ord(besked));

/** KC-0154: the wish to invite someone ("inviter en", "jeg vil invitere min datter"): the chat opens the owner's invite page. */
const INVITER = /^(?:(?:hej|hi|hello|hey|okay|ok|hermes) )*(?:(?:jeg vil(?: gerne)?|kan jeg|hjælp mig med at|lad mig|i (?:want to|would like to)|id like to|can i|help me(?: to)?|let me) )?(?:invitere|inviter|invitér|invite)(?: [\p{L}\p{N} -]{1,60})?$/u;
export const erInviterBesked = (besked: string): boolean => INVITER.test(ord(besked));
