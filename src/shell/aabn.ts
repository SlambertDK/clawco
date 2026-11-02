// KC-0052: "jeg vil skrive" in the chat opens Skrive. A small deterministic
// reader, run before Hermes is asked: an opening verb with a room name ("åbn
// mail"), or the wish to do a room's thing ("jeg vil læse nyhederne"). Anything
// else is a sentence for Hermes. Pure.

export type Aabning = { id: string; /** The sentence says more than the wish: send it on to the room's chat. */ videre: boolean };

const NAVNE: Record<string, string> = {
  hjem: 'hjem|forsiden',
  start: 'start|velkomsten|rejsen|opsætningen',
  dagen: 'dagen|kalenderen|min kalender|min dag',
  mail: 'mail|mails|mailen|min mail|mine mails|indbakken',
  skrive: 'skrive|skriv',
  nyheder: 'nyheder|nyhederne|morgenavisen',
  univers: 'univers|universer|universerne',
  husstand: 'husstand|husstanden|familien',
};
/** KC-0148: rooms the chat opens and lists only when they are there for the person (Husstanden: src/hushold/personer.ts). */
export type AabnValg = { husstand?: boolean };
const kanAabne = (id: string, o: AabnValg): boolean => id !== 'husstand' || o.husstand === true;
const AABN = '(?:åbn|åbne|vis|vise|gå til|gå ind i|gå tilbage til|tilbage til|tag mig til|hop til|skift til)(?: mig)?(?: rummet)?';
const OENSKE = '(?:jeg (?:vil|skal|må|gerne vil|har brug for at)|lad os|lad mig|hjælp mig(?: med)?(?: at)?|kan vi)(?: gerne| lige)*';
const GOERE: Record<string, string> = {
  skrive: 'skrive',
  nyheder: `(?:læse|se|tjekke|kigge på) (?:${NAVNE['nyheder']})`,
  mail: `(?:læse|se|tjekke|svare på|rydde op i|gå igennem|kigge på) (?:${NAVNE['mail']})`,
  dagen: `(?:se|tjekke|kigge på) (?:${NAVNE['dagen']})`,
};
/** KC-0098: one phrase per room above that opens it — what "Hvad kan jeg sige?" lists. The tests prove each one is read as written. */
const EKSEMPEL: Record<string, string> = {
  hjem: 'Tilbage til forsiden',
  start: 'Åbn opsætningen',
  dagen: 'Åbn dagen',
  mail: 'Åbn mail',
  skrive: 'Jeg vil skrive',
  nyheder: 'Jeg vil læse nyhederne',
  univers: 'Åbn universerne',
  husstand: 'Åbn husstanden',
};
/** The whole message is a request for the help (after case and punctuation): "hjælp mig med at skrive …" is for Hermes. */
const HJAELP = new Set(['hvad kan jeg sige', 'hjælp', 'hvad kan du']);
/** Words that add nothing to the wish: "okay, jeg vil lige skrive noget" is still just the wish. */
const FYLD = new Set(['okay', 'ok', 'hej', 'hermes', 'nu', 'tak', 'lige', 'gerne', 'så', 'noget', 'lidt', 'en', 'et', 'tekst', 'please', 'venligst', 'du', 'kan', 'mig', 'igen', 'og']);

const ord = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// \b is ASCII-only, so "æøå" need explicit edges.
const fund = (tekst: string, moenster: string): string | null => new RegExp(`(?:^|\\s)(${moenster})(?=\\s|$)`, 'u').exec(tekst)?.[1] ?? null;

export function rumFraBesked(besked: string, univers: readonly { id: string; navn: string }[], o: AabnValg = {}): Aabning | null {
  const t = ord(besked);
  const kandidater: [string, string][] = [
    ...univers.map((u): [string, string] => [`univers-${u.id}`, `${AABN} (?:${esc(ord(u.navn))})|${OENSKE} (?:arbejde (?:med|på)|se|kigge på|åbne) (?:${esc(ord(u.navn))})`]),
    ...Object.entries(NAVNE).filter(([id]) => kanAabne(id, o)).map(([id, navne]): [string, string] => [id, `${AABN} (?:${navne})${GOERE[id] ? `|${OENSKE} ${GOERE[id]}` : ''}`]),
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
  return [
    ...Object.keys(NAVNE).filter((id) => kanAabne(id, o)).map((id) => ({ id, saet: EKSEMPEL[id] ?? '' })),
    ...univers.map((u) => ({ id: `univers-${u.id}`, saet: `Åbn ${u.navn}` })),
  ].filter((e) => e.saet);
}

export function hjaelpSvar(univers: readonly { id: string; navn: string }[], o: AabnValg = {}): string {
  return `Du kan sige for eksempel:\n${hvadKanJegSige(univers, o).map((e) => `• "${e.saet}"`).join('\n')}\nAlt andet kan du bare spørge mig om.`;
}

/** KC-0146: the wish to see what Clawco knows ("hvad ved du om mig", "hvad har du gemt"): the chat opens /viden. Never Slet alt. */
const VIDEN = /^(?:(?:hej|okay|ok|hermes) )*hvad (?:ved (?:du|clawco|hermes) om mig|har (?:du|clawco|hermes) gemt(?: om mig)?)$/u;
export const erVidenBesked = (besked: string): boolean => VIDEN.test(ord(besked));
