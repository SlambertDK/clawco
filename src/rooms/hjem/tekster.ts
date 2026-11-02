// KC-0170: Nu's strings (the room Hjem: render.ts and stikproeve.ts), Danish and English, in the shape of
// src/shell/tekster.ts (which also says which language is being rendered). Plain text or small functions: the
// renderers escape all of it. English must have exactly Danish's keys (the type and test/rooms/hjem-tekster.test.ts
// hold that). Danish is derived, not retyped, where a registry already owns the words (the room descriptions, the
// trust ladder's steps, the Sunday check's source names). Not here: Hermes' prompt, the log lines written to the store
// and the errors the routes answer with — those stay Danish.

import { sprogNu } from '../../shell/tekster.ts';
import { PRODUKT } from '../../shell/navn.ts';
import { ROOMS } from '../registry.ts';
import { ikkeEndnu } from '../../graenser/afgoer.ts';
import { TRIN, type Trin } from '../../tillid/trin.ts';
import { SKJULT_KILDE } from '../../tillid/skjulte.ts';
import type { KortType } from './kort.ts';

const da = {
  // Header and room
  overskrift: 'Det, der kalder på dig lige nu.',
  kalenderen: 'Kalenderen: ',
  /** The app's own fixed text with straight quotes: render.ts shows it unescaped, so never put user text in it. */
  chatHint: 'Sig i chatten, hvad du vil — fx "jeg vil skrive" — så åbner rummet.',
  /** The registry's descriptions of the rooms, for the tiles (Danish = the registry's own). */
  flise: Object.fromEntries(ROOMS.map((r) => [r.id, r.beskrivelse])) as Record<string, string>,
  tegnetIkkeBygget: 'Tegnet, ikke bygget endnu',
  tegnetTekst: 'Rummet er tegnet i prototypen, men ikke bygget endnu. Dagen er det første rum, der er bygget rigtigt mod Hermes.',
  seTegningen: 'Se tegningen af rummet',
  foersteKig: 'Første kig',

  // Times: "09.30" in Danish

  // Group titles (the bands)
  regler: 'Regler',
  soendagstjek: 'Søndagstjek',
  forbindelser: 'Forbindelser',
  ccSpoerger: 'Claude Code spørger',
  ccParkerede: 'Claude Code parkerede',
  ligeNu: 'Lige nu',
  flereKort: 'flere kort',
  venterPaaDig: 'Venter på dig',
  alle: (n: number): string => `alle ${n}`,
  moedeNu: 'Mødet nu',
  venterPaaAndre: 'Venter på andre',
  hosCc: 'Hos Claude Code',
  alleOpgaver: (n: number): string => `alle ${n} opgaver`,
  gjort: 'Gjort',
  skrevetIRegnskab: 'Skrevet i regnskab',
  intetAtGoere: 'Intet at gøre',
  ccFaerdig: 'Claude Code færdig',
  hermesHarGjort: 'Hermes har gjort',

  // Everything is sorted
  altOrdnet: 'Alt er ordnet',
  detNaeste: (titel: string, tid: string): string => `Det næste i dag er ${titel} kl. ${tid}.`,
  hermesHolderOje: 'Hermes holder øje og siger til, når noget kræver dig.',

  // The meeting on now
  slutterKl: (tid: string): string => `Slutter kl. ${tid}`,
  aabnMoedet: 'Åbn mødet',

  // Cards
  kortet: (titel: string): string => `Kortet: ${titel}`,
  typeLabel: { tjeneste: 'Tjeneste', familie: 'Fra familien', regning: 'Regning', nyhed: 'Nyhed' } as Record<KortType, string>,
  anbefaling: 'Anbefaling',
  kilder: 'Kilder: ',
  hvorfor: 'Hvorfor?',
  ret: 'Ret',
  senere: 'Senere',
  luk: 'Luk',
  svarIMail: 'Svar i Mail',
  kopierPrompt: 'Kopiér prompt',
  sendTilClaude: (projekt: string): string => `Send til Claude Code · ${projekt}`,
  hvorBeskrivelse: { shelfatlas: 'ShelfAtlas-regnskabet', privat: 'det private regnskab' } as Record<'shelfatlas' | 'privat', string>,
  hvorKnap: { shelfatlas: 'ShelfAtlas', privat: 'privat' } as Record<'shelfatlas' | 'privat', string>,
  skrevetI: (hvor: string): string => `Skrevet i ${hvor}`,
  iHvor: (hvor: string): string => `i ${hvor}`,
  fortrydRegnskab: 'Fortryd regnskab',
  flytTil: (hvor: string): string => `Flyt til ${hvor}`,
  skrivI: (hvor: string): string => `Skriv i ${hvor}`,
  kraeverRegel: ikkeEndnu('bogfoer'),
  senereVisIgen: 'Vis kortet igen',
  senereVisDet: 'Vis det igen',
  iAften: 'I aften',
  iMorgen: 'I morgen',
  beskedLinje: (afsender: string, kanal: string): string => `Besked fra ${afsender} på ${kanal} · ${PRODUKT} læser kun og svarer aldrig selv. Svar selv i ${kanal}.`,

  // Claude Code's rows
  ccStatus: { sendt: 'Sendt', modtaget: 'Modtaget', 'i-gang': 'I gang', parkeret: 'Parkeret', faerdig: 'Færdig' } as Record<'sendt' | 'modtaget' | 'i-gang' | 'parkeret' | 'faerdig', string>,
  ditSvar: (svar: string): string => `Dit svar: ${svar} — Claude Code tager den op, næste gang den arbejder i projektet.`,
  seAendringen: 'Se ændringen (PR)',
  ccSpoergerElement: (tekst: string): string => `Claude Code spørger: ${tekst}`,
  om: 'Om: ',
  anbefalet: '← anbefalet',
  egneOrd: 'Eller svar med dine egne ord',
  ditSvarFelt: 'Dit svar',
  svar: 'Svar',
  ccTal: (projekt: string, landet: number, rullet: number, parkeret: number, minutter?: number): string => {
    const tid = minutter === undefined ? '' : ` · typisk ${minutter < 120 ? `${minutter} min` : `${Math.round(minutter / 60)} timer`}`;
    return `${projekt}: ${landet} ${landet === 1 ? 'færdig' : 'færdige'} · ${rullet} rullet tilbage${tid} · ${parkeret} parkeret`;
  },

  // The ledger and the log
  fortryd: 'Fortryd',
  fortrudtKl: (tid: string): string => `Fortrudt kl. ${tid}`,

  // Rules
  reglerFejlTitel: 'Reglerne kan ikke læses',
  reglerFejlTekst: 'Indtil filen er rettet, gør Hermes intet af sig selv: den ser kun og foreslår.',
  fejlen: (hvorfor: string): string => `Fejlen: ${hvorfor}.`,
  filen: (fil: string): string => `Filen: ${fil}`,
  forslagElement: (titel: string): string => `Regelforslag: ${titel}`,
  forslagTilRegel: 'Forslag til en regel',
  skalDetVaereRegel: 'Skal jeg gøre det til en regel?',
  skalReglenPaaPause: 'Skal jeg sætte reglen på pause?',
  retReglen: 'Ret reglen',
  nejTak: 'Nej tak',
  jaRegel: 'Ja, gør det til en regel',
  jaPause: 'Ja, sæt den på pause',
  forslagFor: (titel: string): string => `Forslag: ${titel}`,
  /** The ladder's steps (src/tillid/trin.ts): Danish is the ladder's own words. */
  trin: Object.fromEntries(TRIN.map((t) => [t.trin, { navn: t.navn, saetning: t.saetning }])) as Record<Trin, { navn: string; saetning: string }>,
  gaelder: (kilde: string, slags: string | undefined, trin: number, navn: string, saetning: string): string => `Gælder ${kilde}${slags ? ` · ${slags}` : ''} · Trin ${trin}, ${navn}: ${saetning}`,
  pauserSamtidig: (regel: string): string => `Et ja sætter samtidig ${regel} på pause.`,
  komFra: 'Kom fra: ',
  komFraSkjult: (titel: string): string => `søndagstjekket: «${titel}» skulle have været vist`,
  komFraKort: (art: 'ret' | 'ikke-relevant', titel: string): string => `dit ${art === 'ret' ? 'Ret' : 'Ikke relevant'} på «${titel}»`,

  // The Sunday check (stikproeve.ts)
  stikOverskrift: (skjulte: number, n: number): string => `Denne uge skjulte jeg ${skjulte} ting. Her er ${n} ${n === 1 ? 'tilfældig' : 'tilfældige'}. Var det rigtigt?`,
  stikElement: (overskrift: string): string => `Søndagstjek: ${overskrift}`,
  stikTekst: 'Tallet er talt af Clawco: det, jeg lagde væk i ugen. Svarer du Skulle have vist mig det, foreslår jeg, hvad der skal ændres; intet ændres uden dit ja.',
  skjultKilde: { ...SKJULT_KILDE } as Record<string, string>,
  regelId: (id: string): string => `regel ${id}`,
  rigtigt: 'Rigtigt',
  skulleHaveVaeretVist: 'Skulle have været vist',
  skulleHaveVistMig: 'Skulle have vist mig det',
  stopTitel: 'Skal vi stoppe søndagstjekket?',
  stopTekst: 'Tre uger i træk var alt det, jeg skjulte, rigtigt. Du kan tænde tjekket igen med Fortryd i loggen.',
  jaStop: 'Ja, stop det',
  nejFortsaet: 'Nej, fortsæt',
};

export type HjemTekster = typeof da;

const en: HjemTekster = {
  overskrift: 'What calls for you right now.',
  kalenderen: 'The calendar: ',
  chatHint: 'Say in the chat what you want, e.g. "I want to write", and the room opens.',
  flise: {
    hjem: 'What calls for you right now.',
    start: 'The journey from a cold start: one card per step, until Clawco knows you.',
    dagen: 'The day in three lines, the calendar and the morning paper.',
    mail: 'Decisions about mails in Action. Hermes sorts the rest.',
    skrive: 'Write a text together with Hermes: drafts, suggestions, use or reject.',
    nyheder: 'The morning paper in lanes, picked by Hermes, with save for later.',
    univers: 'One place per subject that grows: documents, notes, tasks and meetings.',
    husstand: 'Who is in the household, and a shared week with what applies to everyone.',
  },
  tegnetIkkeBygget: 'Drawn, not built yet',
  tegnetTekst: 'The room is drawn in the prototype but not built yet. Today is the first room built for real against Hermes.',
  seTegningen: 'See the drawing of the room',
  foersteKig: 'First look',


  regler: 'Rules',
  soendagstjek: 'Sunday check',
  forbindelser: 'Connections',
  ccSpoerger: 'Claude Code asks',
  ccParkerede: 'Claude Code parked',
  ligeNu: 'Right now',
  flereKort: 'more cards',
  venterPaaDig: 'Waiting for you',
  alle: (n) => `all ${n}`,
  moedeNu: 'The meeting now',
  venterPaaAndre: 'Waiting for others',
  hosCc: 'With Claude Code',
  alleOpgaver: (n) => `all ${n} tasks`,
  gjort: 'Done',
  skrevetIRegnskab: 'Written in the ledger',
  intetAtGoere: 'Nothing to do',
  ccFaerdig: 'Claude Code finished',
  hermesHarGjort: 'Hermes has done',

  altOrdnet: 'Everything is sorted',
  detNaeste: (titel, tid) => `Next today is ${titel} at ${tid}.`,
  hermesHolderOje: 'Hermes keeps watch and tells you when something needs you.',

  slutterKl: (tid) => `Ends at ${tid}`,
  aabnMoedet: 'Open the meeting',

  kortet: (titel) => `Card: ${titel}`,
  typeLabel: { tjeneste: 'Service', familie: 'From the family', regning: 'Bill', nyhed: 'News' },
  anbefaling: 'Recommendation',
  kilder: 'Sources: ',
  hvorfor: 'Why?',
  ret: 'Correct',
  senere: 'Later',
  luk: 'Close',
  svarIMail: 'Reply in Mail',
  kopierPrompt: 'Copy prompt',
  sendTilClaude: (projekt) => `Send to Claude Code · ${projekt}`,
  hvorBeskrivelse: { shelfatlas: 'the ShelfAtlas ledger', privat: 'the private ledger' },
  hvorKnap: { shelfatlas: 'ShelfAtlas', privat: 'private' },
  skrevetI: (hvor) => `Written in ${hvor}`,
  iHvor: (hvor) => `in ${hvor}`,
  fortrydRegnskab: 'Undo ledger line',
  flytTil: (hvor) => `Move to ${hvor}`,
  skrivI: (hvor) => `Write in ${hvor}`,
  kraeverRegel: 'I am not allowed to book this yet: which rule should cover it?',
  senereVisIgen: 'Show the card again',
  senereVisDet: 'Show it again',
  iAften: 'This evening',
  iMorgen: 'Tomorrow',
  beskedLinje: (afsender, kanal) => `Message from ${afsender} on ${kanal} · ${PRODUKT} only reads and never answers by itself. Answer in ${kanal} yourself.`,

  ccStatus: { sendt: 'Sent', modtaget: 'Received', 'i-gang': 'In progress', parkeret: 'Parked', faerdig: 'Finished' },
  ditSvar: (svar) => `Your answer: ${svar} — Claude Code will pick it up the next time it works in the project.`,
  seAendringen: 'See the change (PR)',
  ccSpoergerElement: (tekst) => `Claude Code asks: ${tekst}`,
  om: 'About: ',
  anbefalet: '← recommended',
  egneOrd: 'Or answer in your own words',
  ditSvarFelt: 'Your answer',
  svar: 'Answer',
  ccTal: (projekt, landet, rullet, parkeret, minutter) => {
    const tid = minutter === undefined ? '' : ` · typically ${minutter < 120 ? `${minutter} min` : `${Math.round(minutter / 60)} hours`}`;
    return `${projekt}: ${landet} finished · ${rullet} rolled back${tid} · ${parkeret} parked`;
  },

  fortryd: 'Undo',
  fortrudtKl: (tid) => `Undone at ${tid}`,

  reglerFejlTitel: 'The rules cannot be read',
  reglerFejlTekst: 'Until the file is fixed, Hermes does nothing by itself: it only watches and suggests.',
  fejlen: (hvorfor) => `The error: ${hvorfor}.`,
  filen: (fil) => `The file: ${fil}`,
  forslagElement: (titel) => `Rule proposal: ${titel}`,
  forslagTilRegel: 'Proposal for a rule',
  skalDetVaereRegel: 'Shall I make it a rule?',
  skalReglenPaaPause: 'Shall I pause the rule?',
  retReglen: 'Correct the rule',
  nejTak: 'No thanks',
  jaRegel: 'Yes, make it a rule',
  jaPause: 'Yes, pause it',
  forslagFor: (titel) => `Proposal: ${titel}`,
  trin: {
    0: { navn: 'look', saetning: 'Hermes may look and suggest, but does nothing by itself.' },
    1: { navn: 'sort', saetning: 'Hermes may sort and put things in Done, but never write in your files or create appointments.' },
    2: { navn: 'keep the ledger', saetning: 'Hermes may write lines in your ledger, each with Undo.' },
    3: { navn: 'prepare', saetning: 'Hermes may make drafts and prepare, but you send and use them yourself.' },
    4: { navn: 'act with undo', saetning: 'Hermes may act in your own systems, and you can undo.' },
  },
  gaelder: (kilde, slags, trin, navn, saetning) => `Applies to ${kilde}${slags ? ` · ${slags}` : ''} · Step ${trin}, ${navn}: ${saetning}`,
  pauserSamtidig: (regel) => `A yes pauses ${regel} at the same time.`,
  komFra: 'Came from: ',
  komFraSkjult: (titel) => `the Sunday check: "${titel}" should have been shown`,
  komFraKort: (art, titel) => `your ${art === 'ret' ? 'Correct' : 'Not relevant'} on "${titel}"`,

  stikOverskrift: (skjulte, n) => `This week I hid ${skjulte} ${skjulte === 1 ? 'thing' : 'things'}. Here ${n === 1 ? 'is' : 'are'} ${n} at random. Was it right?`,
  stikElement: (overskrift) => `Sunday check: ${overskrift}`,
  stikTekst: 'The number is counted by Clawco: what I put away this week. If you answer Should have shown me this, I suggest what to change; nothing changes without your yes.',
  skjultKilde: { kuratoren: 'Now: nothing to do', mail: 'Mail: put in Done' },
  regelId: (id) => `rule ${id}`,
  rigtigt: 'Right',
  skulleHaveVaeretVist: 'Should have been shown',
  skulleHaveVistMig: 'Should have shown me this',
  stopTitel: 'Shall we stop the Sunday check?',
  stopTekst: 'Three weeks in a row, everything I hid was right. You can turn the check back on with Undo in the log.',
  jaStop: 'Yes, stop it',
  nejFortsaet: 'No, keep going',
};

export const HJEM_TEKSTER: { da: HjemTekster; en: HjemTekster } = { da, en };

/** Nu's strings in the language being rendered. Call it at render time, never at module load. */
export const hjemTekst = (): HjemTekster => HJEM_TEKSTER[sprogNu()];
