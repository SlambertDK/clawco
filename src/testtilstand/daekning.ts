// What "alle funktioner" means for the test world (KC-0068, spec invariant 3):
// every item here must be on screen in at least one moment, and
// test/testtilstand/daekning.test.ts fails until it is. Kinds are derived from
// the code's own lists, so a new kind fails the suite until it is seeded in
// indhold/; situations with no list to derive from are kept by hand below
// (AGENTS.md §4 rule 11). `marker` is a string the rendered HTML contains when
// the item is on screen.

import { ROOMS } from '../rooms/registry.ts';
import { ROOM_MODULES } from '../rooms/modules.ts';
import { BILLEDER, TONER, ZONER, type Tone } from '../shell/visuel.ts';
import { tilstandFraTone } from '../shell/sprog.ts';
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

const afledt = (praefiks: string, vaerdier: readonly string[], marker: (v: string) => string): Daekning[] =>
  vaerdier.map((v) => ({ id: `${praefiks}:${v}`, marker: marker(v), kilde: 'afledt' }));

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
  ['kopier-udkast-mail', 'data-kopier="Hej Clara\n\nTak for dagsordenen'], // Kopiér on a reply draft in Mail (KC-0091; marker = the seeded draft's start)
  ['kopier-udkast-skrive', 'data-kopier="Hej Clara. Tak for et godt'],     // Kopiér on the open document in Skrive (KC-0091; marker = the seeded text's start)
  ['faerdig-alle', 'data-aktion="faerdig-alle"'],
  ['dagen-ikke-bygget', 'data-element="Dagen er ikke bygget i dag"'], // Dagen from an earlier day: Byg Dagen nu (KC-0095; the moment "Næste morgen")
  ['alt-ordnet', 'class="card alt-ordnet"'],                 // nothing waits: Alt er ordnet (KC-0099; the moment "Sent aften")              // Mail: one button for the mails that only need Færdig (KC-0097; seeded by the two orientation mails)
  ['spoergsmaal', 'cc-spoergsmaal'],                          // a question back from Claude Code (KC-0045)
  ['tillid', 'data-cc-tal="'],                                 // trust numbers (KC-0048)
  ['send-til-claude-code', 'data-cc-kort="'],                  // a card sent to Claude Code (KC-0046)
  ['kopier-prompt', 'data-kopier="'],                          // a prompt to copy
  ['skriv-igen', 'class="btn btn-primary" data-regnskab="'],   // write a bill again after Fortryd (KC-0066)
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
  ['kilde-beskeder-besked', 'data-besked-kanal="'],                  // KC-0138: a card in Nu on one message, sender by name, "Clawco læser kun" (Ella on Signal, "Aften")
  ['kilde-beskeder-log-ind-igen', 'Hermes har mistet en af dine beskedkanaler'], // KC-0138: Signal is gone from Hermes overnight — Nu's connection card in the fixed words (the moment "Lørdag i næste uge")
  // Not in the world: Beskeder's connect card in Start (the day is past onboarding, and in the cold start the pile offers
  // it last). Its states (no channel, conversations to choose, chosen) are held by test/kilder/beskeder/kilde.test.ts.
  ['kilde-kalender-kort', 'data-kilde="google-kalender"'],       // the Google calendar over the world's fake Google in Kilder (KC-0133; its card is data for Start, KC-0128)
  ['kilde-kalender-log-ind-igen', 'Log ind med Google igen'],   // Google refused the refresh token (KC-0133; the moment "Næste morgen")
  ['kilde-kort-trin', 'data-kilde-trin="google-kalender"'],     // Start step 3: setting up one's own Google app, one step at a time (KC-0133; the cold start)
  ['kilde-gmail-kort', 'data-kilde="mail-gmail"'],               // Gmail through "Log ind med Google" over the world's fake Google in Kilder (KC-0135; the moment "Gmail er koblet")
  ['kilde-gmail-trin', 'data-kilde-trin="mail-gmail"'],          // KC-0135: Gmail's setup steps in Start step 3 (the cold start), with its own return address and the mail scope to copy
  ['kilde-gmail-kun-mail', 'Google er allerede koblet: kun mail mangler'], // KC-0135: Gmail's card when the calendar is connected, only mail missing (the moment "Kold start: Google koblet, mail mangler")
  ['kilde-helbred-log-ind-igen', 'data-kilde-helbred="log-ind-igen"'], // KC-0139: Nu's card for a source that was logged out (the moment "Kalenderen er logget ud")
  ['kilde-helbred-nede', 'data-kilde-helbred="nede"'],                 // KC-0139: the card for a source that stopped answering (the moment "Mailen svarer ikke")
  ['kilde-helbred-snart-udloebet', 'data-kilde-helbred="snart-udloebet"'], // KC-0139: the card for an access that runs out soon (the moment "Adgangen udløber snart")
  ['kilde-helbred-ikke-opdateret', 'data-ikke-opdateret'],             // KC-0139: a room's elements labelled "ikke opdateret siden …" (Dagen at "Kalenderen er logget ud")
  ['chat', 'id="chat-form"'],                                 // the chat in the room
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
  // Excluded: the blocks forespoergsel and ressource. They are defined in src/shell/katalog.ts, not built; no renderer
  // draws them until E5 builds them (KC-0109), so nothing can show them (BYGGET leaves them out).
  // Excluded: "Se ændringen (PR)" on a finished opgave. Its schema (udvikling/opgaver.ts) only accepts GitHub pull
  // links, and nothing in the test world may point at the real world, so no moment shows it.
];

export const DAEKNING: readonly Daekning[] = [
  ...afledt('rum', rum, (id) => `<body data-room="${id}"`),
  ...afledt('tone', TONER, (t) => `vis-ikon tilstand-${tilstandFraTone(t as Tone)}`),
  ...afledt('zone', ZONER, (z) => `zone zone-${z}`),
  ...afledt('billede', BILLEDER, (b) => `<div class="${b}`),
  ...afledt('kort', TYPER, (t) => `data-kort-type="${t}"`),
  ...afledt('regnskab', HVOR, (h) => `data-regnskab="${h}"`),
  ...afledt('art', ART, (a) => `data-regnskab-art="${a}"`),
  ...afledt('opgave', STATUSSER, (s) => `data-cc-status="${s}"`),
  ...afledt('rolle', ROLLER, (r) => `data-rolle="${r}"`),
  ...afledt('husstand-rolle', ROLLER, (r) => `data-medlem-rolle="${r}"`), // KC-0148: Husstanden lists a member of every role
  ...afledt('invitation', INVITATIONER, (s) => `data-invitation="${s}"`), // KC-0154: a pending invitation of each kind on the owner's Husstanden (indhold/husstand.ts)
  ...afledt('datazone', DATAZONER, (z) => `data-datazone="${z}"`),
  ...afledt('blok', BYGGET, (b) => `data-blok="${b}"`), // KC-0119: every built block on screen somewhere
  ...afledt('situation', SITUATION_IDER, (s) => `data-situation="${s}"`), // KC-0114: Nu (Hjem) and the meeting view carry it
  ...afledt('kilde-tilstand', KILDE_TILSTANDE, (t) => `data-kilde-tilstand="${t}"`), // KC-0120: Kilder in the Kø panel (states seeded by KILDE_TILSTAND)
  ...afledt('omkostninger', OMKOSTNING_SAMLET, (s) => `data-omkostninger-samlet="${s}"`), // KC-0212: the owner's cost card in Kø (seeded per moment by indhold/omkostninger.ts)
  // KC-0131: every step of Start's journey, open (not started) and Klaret — a new step fails until a moment seeds both.
  ...alleTrin().flatMap((t): Daekning[] => [
    { id: `start-trin-${t.id}-aaben`, marker: `data-trin="${t.id}" data-trin-status="ikke-startet"`, kilde: 'afledt' },
    { id: `start-trin-${t.id}-klaret`, marker: `data-trin="${t.id}" data-trin-status="klaret"`, kilde: 'afledt' },
  ]),
  ...afledt('tailscale', TS_TILSTANDE, (t) => `data-tailscale="${t}"`), // KC-0161: Start's Tailscale card in every state (the moments "Tailscale: …", indhold/tailscale.ts)
  ...afledt('beta-feedback', FEEDBACK_DAGE.map(String), (d) => `data-beta-feedback="${d}"`), // KC-0203: the feedback card of day 3, 7 and 14 (the moments "Beta: dag …", indhold/beta.ts)
  ...afledt('foresp', FORESP_TILSTANDE, (t) => `data-foresp-tilstand="${t}"`), // KC-0149: a request in every state (indhold/husstand.ts)
  ...afledt('ressource', RESSOURCE_SLAGS, (s) => `data-ressource-slags="${s}"`), // KC-0150: a resource of every kind (indhold/husstand.ts)
  ...afledt('trin', TRIN.map((t) => String(t.trin)), (t) => `data-regel-trin="${t}"`), // KC-0143: a rule on every trin in Viden (indhold/tillid.ts)
  ...HAAND.map(([id, marker]): Daekning => ({ id, marker, kilde: 'haand' })),
];
