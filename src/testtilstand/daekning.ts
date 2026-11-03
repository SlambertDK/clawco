// What "alle funktioner" means for the test world (KC-0068, spec invariant 3):
// every item here must be on screen in at least one moment, and
// test/testtilstand/daekning.test.ts fails until it is. Kinds are derived from
// the code's own lists, so a new kind fails the suite until it is seeded in
// indhold/; situations with no list to derive from are kept by hand below
// (AGENTS.md §4 rule 11). `marker` is a string the rendered HTML contains when
// the item is on screen; `vises` is the one way to ask (KC-0069: an attribute
// marker `data-…` counts only as a real attribute, with whitespace before it).

import { ROOMS } from '../rooms/registry.ts';
import { ROOM_MODULES } from '../rooms/modules.ts';
import { BILLEDER, TONER, ZONER } from '../shell/visuel.ts';
import { ART, HVOR, TYPER } from '../rooms/hjem/kort.ts';
import { STATUSSER } from '../udvikling/opgaver.ts';
import { ROLLER } from '../identitet/roller.ts';
import { DATAZONER } from '../identitet/zoner.ts';
import { SITUATION_IDER } from '../situation/regler.ts';
import { BYGGET } from '../shell/katalog.ts';
import { KILDE_TILSTANDE } from '../shell/kilder.ts';
import { TILSTANDE as FORESP_TILSTANDE } from '../hushold/foresp.ts';
import { SLAGS as RESSOURCE_SLAGS } from '../hushold/ressource.ts';
import { INVITATIONER } from '../hushold/invitation.ts';
import { OMKOSTNING_SAMLET } from '../shell/omkostninger.ts';
import { alleTrin } from '../rooms/start/trin.ts';
import { TRIN } from '../tillid/trin.ts';
import { TS_TILSTANDE } from '../shell/tailscale.ts';
import { FEEDBACK_DAGE } from '../beta/tilstand.ts';

export type Daekning = { id: string; marker: string; kilde: 'afledt' | 'haand' };

/** KC-0069: whether the rendered `html` shows the item with this `marker`. An attribute marker (`data-…`) must stand as an attribute: after whitespace, never glued onto another name or text. */
export function vises(marker: string, html: string): boolean {
  if (!/^data-[a-z]/.test(marker)) return html.includes(marker);
  for (let i = html.indexOf(marker); i >= 0; i = html.indexOf(marker, i + 1)) if (i > 0 && /\s/.test(html[i - 1] ?? '')) return true;
  return false;
}

const afledt = (praefiks: string, vaerdier: readonly string[], marker: (v: string) => string): Daekning[] =>
  vaerdier.map((v) => ({ id: `${praefiks}:${v}`, marker: marker(v), kilde: 'afledt' }));

/** One derived source: the values the code itself lists (id = `<praefiks>:<value>`) and how a value shows on screen. */
export type Afledt = { praefiks: string; vaerdier: readonly string[]; marker: (v: string) => string };

const rum = [...new Set([...ROOMS.filter((r) => r.built).map((r) => r.id), ...ROOM_MODULES.map((m) => m.id)])];

/** Situations no list in the code enumerates. A new one is added here with its seed. */
const HAAND: [string, string][] = [
  ['univers', 'data-room="univers-'],                          // one univers' own room
  ['fortryd-hjem', 'data-hjem-fortryd="'],                     // Fortryd in Hjem's log
  ['fortryd-log', 'data-fortryd="'],                           // Fortryd in a room's log
  ['fortrudt', 'log-undone'],                                  // a log line that was undone
  ['graense', 'btn btn-graense'],                              // a handling that goes to other people (KC-0067)
  ['graense-kraever-ja', 'data-graense="kraever-ja"'],         // a button that needs a human yes before anything runs (KC-0122)
  ['graense-afvist', 'data-graense="afvist"'],                 // the log line that says what Clawco did not do (KC-0122)
  ['kladde', 'data-aktion="kladde"'],                          // a mail draft
  ['mail-forbindelse', 'data-mail-kilde="forbindelse"'],       // Mail built from the mail connector, no Send (KC-0214; the cold start's fake mail)
  ['mail-laes-kun', 'data-mail-kilde="laes-kun"'],            // Mail from a connection Clawco may only read: waiting mails, nothing to press (KC-0223; the moment "Gmail er koblet")
  ['senere', 'data-senere-aabn="'],                            // Senere on a card (KC-0096)
  ['senere-aften', 'data-senere="aften"'],                     // its choice "I aften", only before 17.00
  ['senere-morgen', 'data-senere="morgen"'],                   // its choice "I morgen"
  ['senere-i-log', 'Udsat til i morgen kl. 07: '],             // the log line of a card put away (its card is off screen: gone, not greyed out)
  ['i-koe', '<span class="chip tilstand-rolig">I kø</span>'], // KC-0069: Nu's I gang row for a run waiting in the queue (the moment "Kørsler i kø")
  ['kopier-udkast-mail', 'data-kopier="Hej Clara\n\nTak for dagsordenen'], // Kopiér on a reply draft in Mail (KC-0091; marker = the seeded draft's start)
  ['kopier-udkast-skrive', 'data-kopier="Hej Clara. Tak for et godt'],     // Kopiér on the open document in Skrive (KC-0091; marker = the seeded text's start)
  ['faerdig-alle', 'data-aktion="faerdig-alle"'],
  ['dagen-ikke-bygget', 'data-element="Dagen er ikke bygget i dag"'], // Dagen from an earlier day: Byg Dagen nu (KC-0095; the moment "Næste morgen")
  ['alt-ordnet', 'class="card alt-ordnet"'],                 // nothing waits: Alt er ordnet (KC-0099; the moment "Sent aften")              // Mail: one button for the mails that only need Færdig (KC-0097; seeded by the two orientation mails)
  ['spoergsmaal', 'cc-spoergsmaal'],                          // a question back from Claude Code (KC-0045)
  ['tillid', 'data-cc-tal="'],                                 // trust numbers (KC-0048)
  ['send-til-claude-code', 'data-cc-kort="'],                  // a card sent to Claude Code (KC-0046)
  ['kopier-prompt', 'data-kopier="'],                          // a prompt to copy
  ['skriv-igen', 'data-regnskab-igen=""'],                     // write a bill again after Fortryd (KC-0066; KC-0069: only a bill whose line was undone carries it — the moment "Aften" and on)
  ['fortryd-regnskab', 'data-regnskab="fortryd"'],             // undo a written ledger line
  ['flyt-regnskab', 'data-regnskab="flyt"'],                   // move a line to the other ledger
  ['skrive-forslag', 'class="card forslag"'],                  // Hermes' proposal in Skrive
  ['skrive-gem', 'data-status="gemmer i Obsidian"'],           // Skrive: Gem i Obsidian
  ['nyheder-gem', 'data-status="gemmer til senere"'],          // Nyheder: Gem til senere
  ['nyheder-del', 'class="btn btn-ghost del" data-del-titel="'], // Del on a news item that has a link (KC-0102; Nyheder and Dagen's Morgenavisen)
  ['kilde-noter-kort', 'data-kilde="noter"'],                  // the notes connector over the world's vault in Kilder (KC-0136; its card is data for Start, KC-0128)
  ['kilde-noter-mappe-mangler', 'Mappen med dine noter er væk'], // the notes folder is gone: Kilder in Kø says so in the fixed words (KC-0136, KC-0139; the moment "Næste morgen")
  ['kilde-nyheder-kort', 'data-kilde="nyheder-rss"'],            // the user's own news feeds over the world's fake feeds in Kilder (KC-0137; its card is data for Start, KC-0128)
  ['kilde-nyheder-fejl', 'Kilder, der ikke svarede i dag: Den døve avis'], // one of the three feeds does not answer, named calmly in Nyheder (KC-0137; the moment "Næste morgen")
  ['kilde-nyheder-egne', 'data-kilde-feed="'],                    // KC-0222: the news sources by name in Kilder in Kø, Fjern on each (the world's three feeds)
  ['kilde-nyheder-tilfoej', 'data-kilde-feed-adresse'],           // KC-0222: the field that adds a source by its address under the same list
  ['kilde-beskeder-kort', 'data-kilde="beskeder"'],                  // KC-0138: Beskeder connected over the world's inbound log in Kilder (from the moment "Aften")
  ['kilde-beskeder-samtale', 'data-kilde-samtale="'],                // KC-0224: Beskeder' conversations by name in Kilder in Kø, Ella and Maja chosen, the street's group not (from "Aften")
  ['kilde-beskeder-valg', 'data-kilde-samtale-valg="'],              // KC-0224: the checkbox that chooses or un-chooses a conversation after the connection
  ['kilde-beskeder-besked', 'data-besked-kanal="'],                  // KC-0138: a card in Nu on one message, sender by name, "Clawco læser kun" (Ella on Signal, "Aften")
  ['kort-besked-arbejde', 'data-kort-type="familie" data-datazone="arbejde"'], // KC-0226: a card on one message from an arbejde conversation (Clara on Telegram), zone chip beside the others ("Aften")
  ['kort-besked-husstand', 'data-kort-type="familie" data-datazone="husstand"'], // KC-0226: the same from a husstand conversation (Maja on WhatsApp)
  ['kort-fra-arbejdet', 'Fra arbejdet'],                              // KC-0226: the arbejde message card's kind label is not "Fra familien"
  ['kilde-beskeder-log-ind-igen', 'Hermes har mistet en af dine beskedkanaler'], // KC-0138: Signal is gone from Hermes overnight — Nu's connection card in the fixed words (the moment "Lørdag i næste uge")
  // Not in the world: Beskeder's connect card in Start (the day is past onboarding, and in the cold start the pile offers
  // it last). Its states (no channel, conversations to choose, chosen) are held by test/kilder/beskeder/kilde.test.ts.
  ['kilde-kalender-kort', 'data-kilde="google-kalender"'],       // the Google calendar over the world's fake Google in Kilder (KC-0133; its card is data for Start, KC-0128)
  ['kilde-kalender-log-ind-igen', 'Log ind med Google igen'],   // Google refused the refresh token (KC-0133; the moment "Næste morgen")
  ['kilde-kort-trin', 'data-kilde-trin="google-kalender"'],     // Start step 3: setting up one's own Google app, one step at a time (KC-0133; the cold start)
  ['kilde-gmail-kort', 'data-kilde="mail-gmail"'],               // Gmail through "Log ind med Google" over the world's fake Google in Kilder (KC-0135; the moment "Gmail er koblet")
  ['kilde-gmail-trin', 'data-kilde-trin="mail-gmail"'],          // KC-0135: Gmail's setup steps in Start step 3 (the cold start), with its own return address and the mail scope to copy
  ['kilde-gmail-kun-mail', 'Google er allerede koblet: kun mail mangler'], // KC-0135: Gmail's card when the calendar is connected, only mail missing (the moment "Kold start: Google koblet, mail mangler")
  ['kilde-aula-forbind', 'data-kilde-kort="aula-kalender"'],      // KC-0235: Aula's connect card in Start (KC-0236: inside the Danmark-pakke group, not among step 3's calendars; the cold start)
  ['kilde-aula-trin', 'data-kilde-trin="aula-kalender"'],          // KC-0235: its steps in Aula's own words, one at a time
  ['kilde-aula-kort', 'data-kilde="aula-kalender"'],               // KC-0235: Aula connected in Kilder in Kø (the moments "Aula er koblet" and "Aula-linket er trukket tilbage")
  ['kilde-aula-uge', 'Skole-hjem-samtale for Ella'],               // KC-0235: an Aula event in the household's shared week (the moment "Aula er koblet"); its organizer, invitees and description are in the file and never on screen
  ['kilde-aula-tilbagekaldt', 'Kalenderlinket virker ikke længere'], // KC-0235/KC-0139: the link is revoked — Nu's card in the fixed words (the moment "Aula-linket er trukket tilbage")
  ['kilde-helbred-log-ind-igen', 'data-kilde-helbred="log-ind-igen"'], // KC-0139: Nu's card for a source that was logged out (the moment "Kalenderen er logget ud")
  ['kilde-helbred-nede', 'data-kilde-helbred="nede"'],                 // KC-0139: the card for a source that stopped answering (the moment "Mailen svarer ikke")
  ['kilde-helbred-snart-udloebet', 'data-kilde-helbred="snart-udloebet"'], // KC-0139: the card for an access that runs out soon (the moment "Adgangen udløber snart")
  ['kilde-helbred-ikke-opdateret', 'data-ikke-opdateret'],             // KC-0139: a room's elements labelled "ikke opdateret siden …" (Dagen at "Kalenderen er logget ud")
  ['chat', 'id="chat-form"'],                                 // the chat in the room
  ['lyt', 'data-sig="'],                                       // Lyt: an element that can be read aloud (KC-0069; a chat answer or a Mail card)
  ['tale-ind', 'id="chat-mic"'],                               // the microphone (Lyt reads answers aloud)
  ['samtale', 'id="samtale-toggle"'],                          // Samtale
  ['naeste', 'data-naeste data-start="'],                      // Hjem: the next appointment today with its countdown (KC-0088)
  ['band-kraever', 'data-baand="kraever"'],                    // Nu's three bands (KC-0115)
  ['band-igang', 'data-baand="igang"'],
  ['band-ordnet', 'data-baand="ordnet"'],
  ['nu-moede', 'data-nu-moede'],                               // the meeting on now in Nu's I gang (KC-0115; the moment "Under mødet")
  ['rum-liste', 'data-rum-liste'],                             // the Rum list in the chat, the phone's way to the rooms (KC-0115)
  ['telefon-tilstand', 'fold-knap'],                           // the phone's core first, the rest one tap away (KC-0024)
  ['nodstop-knap', 'data-nodstop="stop"'],                     // Stop alt in the Kø panel (KC-0124)
  ['pause-baand', 'data-nodstop="pause"'],                     // the band while Clawco is paused (KC-0124; the moment "Sat på pause")
  ['stoette-slaaet-fra', 'data-stoette="fra"'],                // the owner's card "Lad support se med", off (KC-0188; every moment but one)
  ['stoette-aktiv', 'data-stoette="baand"'],                    // the red band while support looks along (KC-0188; the moment "Mailen svarer ikke")
  ['revision-liste', 'data-revision="liste"'],                 // "Hvad Clawco har gjort" in the Kø panel (KC-0124)
  ['regler-ulaeselig', 'data-regler="ulaeselig"'],             // Nu: the rules file cannot be read, Hermes is on trin 0 (KC-0142; the moment "Næste morgen")
  ['start-trin-aabent', 'data-trin="velkommen" data-trin-status="ikke-startet"'], // Start: step 1 open (KC-0126; the moment "Kold start")
  ['start-trin-klaret', 'data-trin-status="klaret"'],                        // Start: a step Klaret (the moment "Kold start: velkommen klaret")
  ['start-foreslaaet-tilfoejelse', 'data-forslag-kilde="'],                   // Start: a source worth adding (the calendar, three invites in mail)
  ['start-model-aaben', 'id="model-form"'],                                   // Start: step 2's provider form (KC-0127; the moment "Kold start: velkommen klaret")
  ['start-model-fejl', 'data-model-test="fejl"'],                             // step 2: a live test failed, with the Danish reason (the moment "Kold start: nøglen afvist")
  ['start-model-virker', 'data-model-test="ok"'],                             // step 2: Virker and how fast (the moment "Kold start: modellen virker")
  ['start-github-kode', 'data-github-kode'],                                  // KC-0263: Copilot's GitHub sign-in: the code and the link while waiting (the moment "Kold start: log ind med GitHub")
  ['start-github-inde', 'data-aktion="github-ud"'],                           // KC-0263: signed in as the login, with Log ud (the moment "Kold start: logget ind med GitHub")
  ['husstand-uge', 'data-uge-hvem="'],                                        // Husstanden: the shared week with whose each entry is (KC-0148; the family calendar)
  ['start-forhaandsvisning', 'data-forhaandsvisning="'],                      // KC-0128: a first source's preview in Nu (the moment "første kilde forbundet")
  ['start-kilde-kort', 'data-kilde-kort="'],                                  // KC-0128: a connect card from the registry in Start (steps 3 and 4)
  ['start-kilde-fejl', 'data-kilde-fejl="'],                                  // KC-0128: a connected source whose first read failed (the moment "kilden svarer ikke")
  ['foresp-udloeb-paamindelse', 'data-foresp-paamindelse'],                  // KC-0149: a reminder to whoever decides a request (Maja asks Henrik)
  ['foresp-venter-paa-andre', 'data-gruppe="Venter på andre"'],              // KC-0149: Nu's I gang line for a request the other has not answered
  ['kanal-send', 'data-kanal-send="'],                                        // KC-0153: the red Send of a request to Maja's channel, with the exact message (indhold/husstand.ts)
  ['kanal-svar', 'data-kanal-svar'],                                          // KC-0153: an answer that came as a message on her channel (Maja's "kl 14")
  ['kanal-fritekst', 'data-kanal-fritekst'],                                  // KC-0153: her free text on the channel, a line that never acts
  ['sammenfald', 'data-sammenfald="'],                                        // KC-0150: a clash card for its two bookers (Henrik ↔ Maja, the big car)
  ['lordag-konflikt', 'data-konflikt="'],                                    // KC-0152: the weekend card for both adults (Henrik ↔ Maja, Ella; the moment "Tirsdag før weekenden")
  ['bil-lordag', 'data-booking="b-kursus"'],                                  // KC-0151: the Saturday of the cars — Maja's course holds the big car (the moment "Lørdag i næste uge")
  ['bil-udkast', 'data-udkast="'],                                            // KC-0151: a booking card waiting for Henrik's tap (the moment "Lørdag i næste uge")
  ['bil-tilfoej', 'data-ressource-form'],                                     // KC-0151/KC-0215: "Tilføj ting" (a kind and owners) in Husstanden
  ['ressource-ret', 'data-ressource-ret="'],                                  // KC-0215: "Ret" on a thing's block (name, kind, owners) for an owner of it
  ['ressource-fjern', 'data-ressource-fjern'],                                // KC-0215: "Fjern" — the confirmation with the one red button
  ['start-tillidskort', 'data-tillidskort'],                                  // KC-0130: the one card that explains the trust ladder (the moment "Kold start: efter første Ret")
  ['start-foerste-ret', 'data-foerste-ret="aaben"'],                          // KC-0130: step 6 open, pointing at Nu (the moment "Kold start: ret-trinnet åbent")
  ['start-foerste-ret-tom', 'data-foerste-ret="tom"'],                        // KC-0130: step 6 with nothing in Nu yet (the cold moments before a first source)
  ['start-foerste-ret-tak', 'data-foerste-ret="tak"'],                        // KC-0130: step 6 after the Ret: the thanks above the explanation card
  ['start-import-bunke', 'data-import-bunke'],                              // KC-0129: step 5's pile of proposals, one line each with Gem / Spring over (the moment "Kold start: forslag fra importen")
  ['start-import-form', 'id="import-form"'],                                  // KC-0129: step 5's form with the provider named (the moment "Kold start: tag det med, åbent")
  ['start-import-mappe-mangler', 'data-import-mappe="mangler"'],              // KC-0129: step 5 before a notes folder exists
  ['start-import-findes', 'data-import-status="findes"'],                     // KC-0129: a name already in the register: "opdater?" with the diff (the moment "Kold start: forslag fra importen")
  ['start-import-opdater', 'data-aktion="import-opdater"'],                  // KC-0219: Opdater on that line, writing the diff into the file; Fortryd puts the old file back (same moment)
  ['tailscale-offentlig', 'data-tailscale-offentlig'],                        // KC-0161: the delt card when Tailscale reports Clawco open to the internet (the moment "Tailscale: åbent for internettet")
  ['start-import-gemt', 'data-import-gemt'],                                  // KC-0129: what was taken with, after a saved import (the moment "Kold start: importen gemt")
  ['ugetal', 'data-ugetal="linje"'],                                           // KC-0147: the week's number (Nu on a Monday — the moment "Mandag morgen" — and always on /viden)
  ['ugetal-soejler', 'data-ugetal="soejler"'],                                  // KC-0147: the eight-week row of bars with its text alternative (/viden)
  ['viden', 'data-viden'],                                                   // KC-0146: "Hvad Clawco ved om dig" (/viden, every moment)
  ['slet-alt-bekraeft', 'data-slet-alt="bekraeft"'],                         // KC-0146: Slet alt's confirmation view (/viden/slet-alt)
  ['kraever-regel', 'data-kraever-regel'],                                    // KC-0143: a bill not written on its own, no rule covers it (the moment "Næste morgen": the rules file is broken)
  ['regelforslag', 'data-regelforslag="'],                                      // KC-0144: the card "Skal jeg gøre det til en regel?" after Ikke relevant on the parcel card (the moments "Lige før et møde" to "Eftermiddag")
  ['regel-gaelder-alt', 'data-regel-alt'],
  ['stikproeve', 'data-stikproeve="'],                                         // KC-0145: the Sunday sample in Nu, five lines with Rigtigt / Skulle have vist mig det (the moment "Søndag aften")
  ['stop-soendagstjek', 'data-soendagstjek-stop'],                             // KC-0145: "Skal vi stoppe søndagstjekket?" after three clean weeks (the moment "Søndag: stop tjekket?")
  ['regelforslag-start', 'data-regelforslag-start="'],                      // KC-0227: the same proposal under Start's explanation card (the moment "Kold start: efter første Ret")
  ['regelforslag-pause', 'data-regelforslag-pause="'],                         // KC-0145: the proposal to pause the rule that hid a wrong item (the moment "Søndag aften")                                    // KC-0143: a rule for every source says "gælder alt" in Viden
  ['beta-kort', 'data-beta-kort'],                                              // KC-0203: the plain "lukket beta" card (the moment "Beta: første besøg")
  ['beta-betale', 'data-beta-betale="'],                                         // KC-0203: the pay question of day 14 (the moment "Beta: dag 14")
  ['beta-deling-side', 'data-beta-json>'],                                       // KC-0203: "Hvad deler jeg?" with the answer as it stands (/beta/deling, the moment "Beta: Hvad deler jeg?")
  ['beta-deling-hvis', 'data-beta-json-hvis'],                                   // KC-0203: what switching sharing on would add (consent off)
  ['beta-deling-link', 'data-beta-deling-link'],                                 // KC-0203: the link in the Kø panel (every beta moment)
  ['post-start-trin', 'data-post-start'],                                       // KC-0233: Start's Danmark-pakke step (the moment "Digital Post: Start-trinnet")
  ['post-kort', 'data-post-kort="'],                                            // KC-0233: the card "Ny Digital Post" in Nu (the moment "Ny Digital Post")
  ['post-viser', 'data-post-viser'],                                            // KC-0233: its link to the person's chosen viewer
  ['post-set', 'data-post-set="'],                                              // KC-0233: its one button, "Set den"
  ['post-kan-ikke-se', 'data-post-kort="kan-ikke-se"'],                          // KC-0233: the card when the mail cannot be read (the moment "Digital Post: mailen svarer ikke")
  ['pakke-gruppe', 'data-danmark-pakke'],                                        // KC-0236: Start's one group "Danmark-pakke" (the cold start: Aula's card; "Digital Post: Start-trinnet": Aula's card and the Digital Post step together)
  ['pakke-aula-ikke-nu', 'data-aktion="aula-ikke-nu"'],                          // KC-0236: Aula's card can be put away for 30 days
  ['nu-aula', 'data-aula-kort="'],                                               // KC-0236: a school event today or tomorrow as an element in Nu (the moment "Aula er koblet")
  ['nu-aula-i-dag', 'data-aula-dag="i-dag"'],                                    // KC-0236: ... one that is today
  ['nu-aula-i-morgen', 'data-aula-dag="i-morgen"'],                              // KC-0236: ... and one that is tomorrow
  ['uge-institution', 'data-uge-institution'],                                   // KC-0236: the institution (the calendar's name) as the source label of an event in the shared week
  // Excluded: the blocks forespoergsel and ressource. They are defined in src/shell/katalog.ts, not built; no renderer
  // draws them until E5 builds them (KC-0109), so nothing can show them (BYGGET leaves them out).
  // Excluded: "Se ændringen (PR)" on a finished opgave. Its schema (udvikling/opgaver.ts) only accepts GitHub pull
  // links, and nothing in the test world may point at the real world, so no moment shows it.
];

/** KC-0069: the derived sources, exported so the guard test compares against this list itself (the tone of a head is named explicitly: a head without a tone is also "rolig" on screen). */
export const AFLEDTE: readonly Afledt[] = [
  { praefiks: 'rum', vaerdier: rum, marker: (id) => `<body data-room="${id}"` },
  { praefiks: 'tone', vaerdier: TONER, marker: (t) => `data-tone="${t}"` },
  { praefiks: 'zone', vaerdier: ZONER, marker: (z) => `zone zone-${z}` },
  { praefiks: 'billede', vaerdier: BILLEDER, marker: (b) => `<div class="${b}` },
  { praefiks: 'kort', vaerdier: TYPER, marker: (t) => `data-kort-type="${t}"` },
  { praefiks: 'regnskab', vaerdier: HVOR, marker: (h) => `data-regnskab="${h}"` },
  { praefiks: 'art', vaerdier: ART, marker: (a) => `data-regnskab-art="${a}"` },
  { praefiks: 'opgave', vaerdier: STATUSSER, marker: (s) => `data-cc-status="${s}"` },
  { praefiks: 'rolle', vaerdier: ROLLER, marker: (r) => `data-rolle="${r}"` },
  { praefiks: 'husstand-rolle', vaerdier: ROLLER, marker: (r) => `data-medlem-rolle="${r}"` }, // KC-0148: Husstanden lists a member of every role
  { praefiks: 'invitation', vaerdier: INVITATIONER, marker: (s) => `data-invitation="${s}"` }, // KC-0154: a pending invitation of each kind on the owner's Husstanden (indhold/husstand.ts)
  { praefiks: 'datazone', vaerdier: DATAZONER, marker: (z) => `data-datazone="${z}"` },
  { praefiks: 'blok', vaerdier: BYGGET, marker: (b) => `data-blok="${b}"` }, // KC-0119: every built block on screen somewhere
  { praefiks: 'situation', vaerdier: SITUATION_IDER, marker: (s) => `data-situation="${s}"` }, // KC-0114: Nu (Hjem) and the meeting view carry it
  { praefiks: 'kilde-tilstand', vaerdier: KILDE_TILSTANDE, marker: (t) => `data-kilde-tilstand="${t}"` }, // KC-0120: Kilder in the Kø panel (states seeded by KILDE_TILSTAND)
  { praefiks: 'omkostninger', vaerdier: OMKOSTNING_SAMLET, marker: (s) => `data-omkostninger-samlet="${s}"` }, // KC-0212: the owner's cost card in Kø (seeded per moment by indhold/omkostninger.ts)
  { praefiks: 'tailscale', vaerdier: TS_TILSTANDE, marker: (t) => `data-tailscale="${t}"` }, // KC-0161: Start's Tailscale card in every state (the moments "Tailscale: …", indhold/tailscale.ts)
  { praefiks: 'beta-feedback', vaerdier: FEEDBACK_DAGE.map(String), marker: (d) => `data-beta-feedback="${d}"` }, // KC-0203: the feedback card of day 3, 7 and 14 (the moments "Beta: dag …", indhold/beta.ts)
  { praefiks: 'foresp', vaerdier: FORESP_TILSTANDE, marker: (t) => `data-foresp-tilstand="${t}"` }, // KC-0149: a request in every state (indhold/husstand.ts)
  { praefiks: 'ressource', vaerdier: RESSOURCE_SLAGS, marker: (s) => `data-ressource-slags="${s}"` }, // KC-0150: a resource of every kind (indhold/husstand.ts)
  { praefiks: 'trin', vaerdier: TRIN.map((t) => String(t.trin)), marker: (t) => `data-regel-trin="${t}"` }, // KC-0143: a rule on every trin in Viden (indhold/tillid.ts)
];

export const DAEKNING: readonly Daekning[] = [
  ...AFLEDTE.flatMap((a) => afledt(a.praefiks, a.vaerdier, a.marker)),
  // KC-0131: every step of Start's journey, open (not started) and Klaret — a new step fails until a moment seeds both.
  ...alleTrin().flatMap((t): Daekning[] => [
    { id: `start-trin-${t.id}-aaben`, marker: `data-trin="${t.id}" data-trin-status="ikke-startet"`, kilde: 'afledt' },
    { id: `start-trin-${t.id}-klaret`, marker: `data-trin="${t.id}" data-trin-status="klaret"`, kilde: 'afledt' },
  ]),
  ...HAAND.map(([id, marker]): Daekning => ({ id, marker, kilde: 'haand' })),
];
