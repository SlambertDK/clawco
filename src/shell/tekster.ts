// KC-0170: every string of the shell (nav, header, Kø panel, chat, dialogs, the bands), Danish and English, in the
// shape of sky/src/tilmelding/tekster.ts: plain text or small functions, escaped by whoever renders them. English
// must have exactly Danish's keys (the type and test/shell/tekster.test.ts hold that). A room keeps its own table
// beside its code (src/rooms/start/tekster.ts) and reads the language from here.
//
// The language of a request is the profile's (Start step 1, src/store/profil.ts), set once per request by the
// composition root (medSprog in server.ts). No language set = Danish: Henrik's installation, which predates the
// profile, renders exactly as before (test/fixtures/sprog/ holds that byte for byte).

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Sprog } from '../store/profil.ts';
import { ROOMS } from '../rooms/registry.ts';
import { ROLLE_NAVN, type Rolle } from '../identitet/roller.ts';
import { PRODUKT } from './navn.ts';

export type { Sprog };

const da = {
  /** The page's lang attribute and the locale for numbers. */
  lang: 'da',
  lokale: 'da-DK',
  /** Room names in the nav, the crumb and the title: the registry's own (the source of truth). */
  rum: Object.fromEntries(ROOMS.map((r) => [r.id, r.navn])) as Record<string, string>,
  rolle: { ...ROLLE_NAVN } as Record<Rolle, string>,
  /** Danish chat phrases (suggestion chips, "I chatten kan du sige") are shown only where the chat reads them. */
  chatSaetninger: true as boolean,

  // The pause band (KC-0124)
  du: 'Du',
  stoppedeAlt: (hvem: string, naar: string): string => `${hvem} stoppede alt${naar}.`,
  altStoppet: (naar: string): string => `Alt blev stoppet${naar}.`,
  kl: (klokke: string): string => ` kl. ${klokke}`,
  paaPause: `${PRODUKT} er sat på pause`,
  intetKoerer: 'Intet kører, og intet nyt starter. ',
  kunEjerenStarter: `Kun ejeren kan starte ${PRODUKT} igen.`,
  startIgen: 'Start igen',

  // Support looks along (KC-0188)
  supportTil: (til: string): string => `Support kigger med til ${til}`,
  supportKanSe: 'Support kan se det samme som ejeren, men ikke ændre noget. Alt, hvad der bliver åbnet, står i loggen.',
  grund: ' Grund: ',
  slaaFra: 'Slå fra',
  ladSupport: 'Lad support se med',
  supportTilKort: (til: string): string => `Support kigger med til ${til}. Du kan slå det fra i det røde bånd.`,
  supportFra: `Slået fra. Slår du det til, kan én hos ${PRODUKT}s support se det samme som dig, også din mail og din kalender, men ikke ændre noget. Alt, hvad de åbner, står i loggen, og det slukker af sig selv.`,
  hvorLaenge: 'Hvor længe',
  timer: (t: number): string => (t === 1 ? '1 time' : `${t} timer`),
  hvadKigge: 'Hvad skal de kigge på? (valgfrit, én linje)',

  // Nav and header
  rumEtiket: 'Rum',
  hermes: 'Hermes:',
  samtale: 'Samtale',
  samtaleTitel: 'Tal med Hermes — hænderfrit, svaret læses op',
  koe: 'Kø',
  klar: 'Klar',
  samtaleKlar: 'klar',
  lydFra: 'Lyd fra',
  stop: 'Stop',
  samtaleIntro: 'Tryk Samtale, så fortæller jeg hvad der venter, og du svarer med stemmen.',

  // The Kø panel
  hermesKoe: "Hermes' kø",
  beskedPaaSkaermen: 'Få besked på skærmen',
  luk: 'Luk',
  stopAlt: 'Stop alt',
  stopAltTekst: `Standser alt, ${PRODUKT} er i gang med, og holder det på pause, til ejeren starter igen.`,
  intetIGang: 'Intet i gang.',
  hvadGjort: `Hvad ${PRODUKT} har gjort`,
  sagdeNej: `Det ${PRODUKT} sagde nej til`,
  henter: 'Henter …',
  hvadVed: `Hvad ${PRODUKT} ved om dig`,
  faaHjaelp: 'Få hjælp',
  taenkeniveau: 'Tænkeniveau',
  smaating: 'Småting (chat, handlinger, kladder)',
  analyse: 'Analyse og forslag (bygge rum, udkast, forslag)',
  hermesStandard: "Hermes' standard",
  hermesStemme: "Hermes' stemme",
  stemme: 'Stemme',
  stemmeAuto: 'vælges automatisk',
  stemmeTom: 'Tom = jeg vælger selv en dansk stemme.',
  gem: 'Gem',
  proevStemmen: 'Prøv stemmen',
  stemmeProeve: 'Hej Henrik. Sådan lyder jeg. Skal vi tage det, der venter?',
  husstanden: 'Husstanden',
  testtilstand: 'Testtilstand',
  testHint: 'Prøv alle funktioner med opdigtede data',

  // The chat
  spoergHermes: 'Spørg Hermes',
  tilClaudeTitel: 'Send det, du skriver, til Claude Code',
  lukChatten: 'Luk chatten',
  om: 'Om: ',
  fjernMarkering: 'Fjern markeringen',
  tryk: 'Tryk',
  klik: 'Klik',
  kontekstHint: ' på en kasse eller en linje i rummet, så handler chatten om den.',
  forslag: 'Forslag',
  skrivOm: (k: string): string => `Skriv om: ${k}`,
  skrivTil: 'Skriv til Hermes …',
  talTil: 'Tal til Hermes',
  talTilTitel: 'Tal til Hermes (tryk, tal, tryk igen)',
  send: 'Send',

  // The shortcuts dialog
  genveje: 'Genveje',
  gaaTilRum: 'Gå til rummet med det nummer i menuen',
  skrivTilHermes: 'Skriv til Hermes',
  lukVindue: 'Luk chatten eller et vindue',
  visGenveje: 'Vis genvejene',
  iChattenKan: 'I chatten kan du sige',
  hvadKanJegSige: 'Hvad kan jeg sige?',
  altAndet: 'Alt andet svarer Hermes på.',

  // Send til Claude Code (the developer's own dialog)
  tilClaude: 'Send til Claude Code',
  projekt: 'Projekt',
  claudeSaetning: 'Hvad skal Claude Code gøre? Én sætning.',
  annuller: 'Annuller',

  // The bands and the block catalog (shell/sprog.ts, shell/fold.ts)
  spoerg: 'Spørg',
  del: 'Del',
  venterPaaDig: (n: number): string => `${n} venter på dig`,
  intetVenter: 'Intet venter på dig',
  nIGang: (n: number): string => `${n} i gang`,
  nOrdnet: (n: number): string => `${n} ordnet`,
  hermesArbejder: 'Hermes arbejder',
  iKoe: 'I kø',
  iGang: 'I gang',
  kraeverDig: 'Kræver dig',
  ordnetFold: (n: number): string => `ordnet (${n})`,
  vis: 'Vis ',
  ikkeTilbudt: 'Ikke tilbudt: ',

  /** What public/app.js shows; embedded in the page as window.KC_TEKST (strings only). */
  klient: {
    fortryd: 'Fortryd',
    udfoert: ' — udført',
    om: 'Om: ',
    skrivOm: 'Skriv om: ',
    skrivTil: 'Skriv til Hermes …',
    fejl: 'Fejl: ',
    klar: 'Klar',
    klarPrefiks: 'Klar: ',
    hermesFejlede: 'Hermes fejlede',
    arbejder: 'arbejder …',
    intetIGang: 'Intet i gang.',
    lykkedesIkke: 'Det lykkedes ikke. Prøv igen.',
    aabn: 'Åbn',
    aabnRum: 'Åbn ',
    vis: 'Vis ',
    skjul: 'Skjul ',
    slukTest: 'Sluk testtilstand',
    testFejlede: 'Testtilstand fejlede',
    bruger: 'Bruger: ',
    gemtIndstillinger: 'Gemt. Gælder, næste gang Hermes går i gang.',
    kunneIkkeGemme: 'Kunne ikke gemme.',
    forbindelseTilbage: 'Forbindelsen er tilbage',
    linkKopieret: 'Link kopieret',
    kunneIkkeKopiere: 'Kunne ikke kopiere: ',
  },
};

export type Tekster = typeof da;

const en: Tekster = {
  lang: 'en',
  lokale: 'en-GB',
  rum: { hjem: 'Now', start: 'Start', dagen: 'Today', mail: 'Mail', skrive: 'Write', nyheder: 'News', univers: 'Universes', husstand: 'Household' },
  rolle: { ejer: 'owner', medlem: 'member', barn: 'child', gaest: 'guest', stoette: 'support' },
  chatSaetninger: false,

  du: 'You',
  stoppedeAlt: (hvem, naar) => `${hvem} stopped everything${naar}.`,
  altStoppet: (naar) => `Everything was stopped${naar}.`,
  kl: (klokke) => ` at ${klokke}`,
  paaPause: `${PRODUKT} is paused`,
  intetKoerer: 'Nothing runs, and nothing new starts. ',
  kunEjerenStarter: `Only the owner can start ${PRODUKT} again.`,
  startIgen: 'Start again',

  supportTil: (til) => `Support is looking along until ${til}`,
  supportKanSe: 'Support can see the same as the owner, but cannot change anything. Everything that is opened is written to the log.',
  grund: ' Reason: ',
  slaaFra: 'Turn off',
  ladSupport: 'Let support look along',
  supportTilKort: (til) => `Support is looking along until ${til}. You can turn it off in the red band.`,
  supportFra: `Off. If you turn it on, someone at ${PRODUKT} support can see the same as you, including your mail and your calendar, but cannot change anything. Everything they open is written to the log, and it turns itself off.`,
  hvorLaenge: 'For how long',
  timer: (t) => (t === 1 ? '1 hour' : `${t} hours`),
  hvadKigge: 'What should they look at? (optional, one line)',

  rumEtiket: 'Rooms',
  hermes: 'Hermes:',
  samtale: 'Talk',
  samtaleTitel: 'Talk with Hermes, hands-free; the answer is read aloud',
  koe: 'Queue',
  klar: 'Ready',
  samtaleKlar: 'ready',
  lydFra: 'Sound off',
  stop: 'Stop',
  samtaleIntro: 'Press Talk, and I tell you what is waiting; you answer with your voice.',

  hermesKoe: "Hermes' queue",
  beskedPaaSkaermen: 'Get notified on screen',
  luk: 'Close',
  stopAlt: 'Stop everything',
  stopAltTekst: `Stops everything ${PRODUKT} is doing, and keeps it paused until the owner starts it again.`,
  intetIGang: 'Nothing in progress.',
  hvadGjort: `What ${PRODUKT} has done`,
  sagdeNej: `What ${PRODUKT} said no to`,
  henter: 'Loading …',
  hvadVed: `What ${PRODUKT} knows about you`,
  faaHjaelp: 'Get help',
  taenkeniveau: 'Thinking level',
  smaating: 'Small things (chat, actions, drafts)',
  analyse: 'Analysis and proposals (building rooms, drafts, proposals)',
  hermesStandard: "Hermes' default",
  hermesStemme: "Hermes' voice",
  stemme: 'Voice',
  stemmeAuto: 'chosen automatically',
  stemmeTom: 'Empty = I choose a Danish voice myself.',
  gem: 'Save',
  proevStemmen: 'Try the voice',
  stemmeProeve: 'Hi. This is how I sound. Shall we take what is waiting?',
  husstanden: 'The household',
  testtilstand: 'Test mode',
  testHint: 'Try every feature with made-up data',

  spoergHermes: 'Ask Hermes',
  tilClaudeTitel: 'Send what you write to Claude Code',
  lukChatten: 'Close the chat',
  om: 'About: ',
  fjernMarkering: 'Remove the selection',
  tryk: 'Tap',
  klik: 'Click',
  kontekstHint: ' a box or a line in the room, and the chat is about it.',
  forslag: 'Suggestions',
  skrivOm: (k) => `Write about: ${k}`,
  skrivTil: 'Write to Hermes …',
  talTil: 'Talk to Hermes',
  talTilTitel: 'Talk to Hermes (tap, talk, tap again)',
  send: 'Send',

  genveje: 'Shortcuts',
  gaaTilRum: 'Go to the room with that number in the menu',
  skrivTilHermes: 'Write to Hermes',
  lukVindue: 'Close the chat or a window',
  visGenveje: 'Show the shortcuts',
  iChattenKan: 'In the chat you can say',
  hvadKanJegSige: 'What can I say?',
  altAndet: 'Hermes answers anything you write.',

  tilClaude: 'Send to Claude Code',
  projekt: 'Project',
  claudeSaetning: 'What should Claude Code do? One sentence.',
  annuller: 'Cancel',

  spoerg: 'Ask',
  del: 'Share',
  venterPaaDig: (n) => `${n} waiting for you`,
  intetVenter: 'Nothing is waiting for you',
  nIGang: (n) => `${n} in progress`,
  nOrdnet: (n) => `${n} done`,
  hermesArbejder: 'Hermes is working',
  iKoe: 'Queued',
  iGang: 'In progress',
  kraeverDig: 'Needs you',
  ordnetFold: (n) => `done (${n})`,
  vis: 'Show ',
  ikkeTilbudt: 'Not offered: ',

  klient: {
    fortryd: 'Undo',
    udfoert: ' — done',
    om: 'About: ',
    skrivOm: 'Write about: ',
    skrivTil: 'Write to Hermes …',
    fejl: 'Error: ',
    klar: 'Ready',
    klarPrefiks: 'Done: ',
    hermesFejlede: 'Hermes failed',
    arbejder: 'working …',
    intetIGang: 'Nothing in progress.',
    lykkedesIkke: 'It did not work. Try again.',
    aabn: 'Open',
    aabnRum: 'Open ',
    vis: 'Show ',
    skjul: 'Hide ',
    slukTest: 'Turn off test mode',
    testFejlede: 'Test mode failed',
    bruger: 'Uses: ',
    gemtIndstillinger: 'Saved. Applies the next time Hermes starts on something.',
    kunneIkkeGemme: 'Could not save.',
    forbindelseTilbage: 'The connection is back',
    linkKopieret: 'Link copied',
    kunneIkkeKopiere: 'Could not copy: ',
  },
};

export const TEKSTER: { da: Tekster; en: Tekster } = { da, en };

/** The language of an installation without a profile: Henrik's, from before Start existed. */
export const STANDARD_SPROG: Sprog = 'da';

const sprogNu$ = new AsyncLocalStorage<Sprog>();

/** Runs `fn` with `sprog` as the language of everything it renders (one request, one test). */
export const medSprog = <T>(sprog: Sprog, fn: () => T): T => sprogNu$.run(sprog, fn);

/** The language being rendered; STANDARD_SPROG when none is set (an installation without a profile). */
export const sprogNu = (): Sprog => sprogNu$.getStore() ?? STANDARD_SPROG;

/** The shell's strings in the language being rendered. */
export const tekst = (): Tekster => TEKSTER[sprogNu()];

/** The client's table as an inline script for <head>: `<` and the line separators escaped so nothing closes the tag. */
export const klientTekst = (): string =>
  `<script>window.KC_TEKST=${JSON.stringify({ ...tekst().klient, rum: tekst().rum }).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`)}</script>`;
