// KC-0170: the Start room's strings — the step cards (trin.ts), step 1 and step 2 (render.ts) — Danish and English, in
// the shape of src/shell/tekster.ts (which also says which language is being rendered). Plain text only: render.ts
// escapes all of it. English must have exactly Danish's keys (the type and test/shell/tekster.test.ts hold that).
// Not here yet (follow-up): the sub-cards of steps 3–6 (kilderender, import, tailscalekort, tillidskort,
// regelforslag) and the room's log lines.

import { sprogNu } from '../../shell/tekster.ts';
import { MODEL_FEJL, type ModelFejlArt } from './modelfejl.ts';
import type { Udbyder } from './udbydere.ts';
import type { Profil, TrinStatus } from './schema.ts';
import type { Niveau } from './trin.ts';

const da = {
  rumIntro: 'Rejsen fra kold start: ét kort per trin. Svar på det øverste, så står det næste klar.',
  vaerdAtTilfoeje: 'Værd at tilføje',
  detErGjort: 'Det er gjort',
  ikkeNu: 'Ikke nu',
  laeggerVaek: 'lægger forslaget væk',
  forslag: (navn: string): string => `Forslag: ${navn}`,
  fortrudtKl: 'Fortrudt kl. ',
  fortryd: 'Fortryd',

  // The step cards
  trinElement: (titel: string): string => `Trin: ${titel}`,
  status: { 'ikke-startet': 'Næste', 'i-gang': 'I gang', klaret: 'Klaret', 'sprunget-over': 'Sprunget over' } as Record<TrinStatus, string>,
  valgfrit: 'Valgfrit',
  trin: {
    velkommen: { titel: 'Velkommen', tekst: 'Fortæl Clawco, hvad du hedder, hvilket sprog Hermes skal svare på, og om du er alene eller en husstand.' },
    model: { titel: 'Vælg din model', tekst: 'Indsæt en nøgle fra din udbyder, eller brug en model på din egen maskine. Clawco prøver den straks, så du kan se, at den virker.' },
    'foerste-kilde': { titel: 'Første kilde', tekst: 'Vælg, om du vil starte med kalenderen eller mailen. Lige efter står der noget at se på i Nu.' },
    'flere-kilder': { titel: 'Flere kilder', tekst: 'Én kilde ad gangen, og kun hvis du vil. Hver ny kilde giver straks noget at se på.' },
    import: { titel: 'Tag det med', tekst: 'Fortæl Hermes det, de andre assistenter ved om dig: indsæt deres svar, eller læg en kontaktfil eller nogle noter ind. Intet bliver skrevet, før du har trykket Gem.' },
    'foerste-ret': { titel: 'Ret én ting', tekst: 'Tryk Ret på et kort, der ikke passer, eller Ikke relevant på et, du ikke vil se. Så lærer Hermes dig at kende.' },
  },

  // Step 1
  laptopVelkommen: 'Fortæl Clawco, hvad du hedder, og hvilket sprog Hermes skal svare på.',
  hvadHedderDu: 'Hvad hedder du?',
  navnEksempel: 'Fx Alma',
  hvilketSprog: 'Hvilket sprog skal Hermes svare på?',
  sprogValg: { da: 'Dansk', en: 'Engelsk' } as Record<Profil['sprog'], string>,
  aleneEllerHusstand: 'Er du alene, eller er I en husstand?',
  husstandValg: { alene: 'Alene', husstand: 'En husstand' } as Record<Profil['husstand'], string>,
  gemmer: 'gemmer',
  gem: 'Gem',
  gemAendringen: 'Gem ændringen',
  retProfilen: 'Ret profilen',
  ejerenFortaeller: 'Ejeren fortæller Clawco, hvem I er.',
  duHedder: (navn: string, sprog: Profil['sprog']): string => `Du hedder ${navn} · Hermes svarer på ${{ da: 'dansk', en: 'engelsk' }[sprog]}`,
  duEr: (husstand: Profil['husstand']): string => ` · du er ${{ alene: 'alene', husstand: 'en husstand' }[husstand]}`,

  // Step 2
  niveau: { lille: 'Den hurtige', taenker: 'Den grundige' } as Record<Niveau, string>,
  modelElement: (niveau: string): string => `Model: ${niveau}`,
  virkerMs: (sek: string): string => `Virker · ${sek} s`,
  virker: 'Virker',
  virkerIkke: 'Virker ikke',
  ingenModel: 'ingen model valgt',
  ikkeProevet: 'Ikke prøvet endnu.',
  test: 'Test',
  proeverModellen: 'prøver modellen',
  udbyder: 'Udbyder',
  udbyderNavn: (u: Udbyder): string => u.navn,
  noeglePlaceholder: (u: Udbyder): string => u.noeglePlaceholder,
  noegleFra: 'Nøgle fra udbyderen',
  beholdGemte: ' (tom = behold den gemte)',
  adressen: 'Adressen på din maskine (tom = standard)',
  nyModel: (niveau: string): string => `${niveau} model`,
  gemOgTest: 'Gem og test',
  gemmerOgProever: 'gemmer og prøver modellen',
  kanIkkeSkrive: "Clawco kan ikke skrive til Hermes' indstillinger herfra. Kør kommandoen på Hermes' maskine, indsæt værdien, når den spørger, og tryk så Test.",
  kopierKommando: 'Kopiér kommandoen',
  noegleGivet: (laengde: number): string => `Nøglen er givet til Hermes. Gemt (${laengde} tegn).`,
  adresse: 'Adresse: ',
  ingenDatamappe: 'Clawco har ingen datamappe, så modellen kan ikke vælges her.',
  ingenAgentNoegleEjer: 'Clawco har ingen nøgle til Hermes endnu. Ejeren indsætter den.',
  ingenAgentNoegle: "Clawco har ingen nøgle til Hermes endnu. Indsæt den nøgle, Hermes' api-server bruger (API_SERVER_KEY i Hermes' .env).",
  noegleTilHermes: 'Nøgle til Hermes',
  gemmerNoeglen: 'gemmer nøglen',
  utilgaengeligFoer: 'Hermes svarer ikke, så Clawco kan ikke prøve en model endnu. Clawco installerer ikke Hermes selv: installer og start Hermes på maskinen (fx ',
  utilgaengeligEfter: '), og åbn så Start igen.',
  ejerenVaelger: 'Ejeren vælger modellen.',
  skiftModel: 'Skift model',
  /** Why a model test failed, as Start shows it; the Danish sentences are modelfejl.ts's own (matched back there). */
  modelFejl: { ...MODEL_FEJL } as Record<ModelFejlArt, string>,

  // Step 6
  takRet: 'Tak. Det hjælper Hermes at kende dig. Her er, hvordan den får mere frihed.',
  intetAtRette: 'Der er ikke noget at rette endnu; Hermes lægger det første op, når der er noget.',
  proevDetPaa: 'Prøv det på ',
  iNu: (titel: string): string => `»${titel}« i Nu`,
  foersteKortINu: 'det første kort i Nu',
  ikkeRelevantErLuk: '. Ikke relevant er knappen Luk; skriv gerne hvorfor, så husker Hermes det.',
  springOver: 'Spring over',
  springerOver: 'springer over',
};

export type StartTekster = typeof da;

const EGEN_MASKINE: Readonly<Record<string, string>> = { lmstudio: 'LM Studio on your own machine', ollama: 'Ollama on your own machine' };
const PLACEHOLDER: Readonly<Record<string, string>> = { copilot: 'github_pat_… or ghu_…' };

const en: StartTekster = {
  rumIntro: 'The journey from a cold start: one card per step. Answer the top one, and the next is ready.',
  vaerdAtTilfoeje: 'Worth adding',
  detErGjort: 'Done',
  ikkeNu: 'Not now',
  laeggerVaek: 'putting the suggestion away',
  forslag: (navn) => `Suggestion: ${navn}`,
  fortrudtKl: 'Undone at ',
  fortryd: 'Undo',

  trinElement: (titel) => `Step: ${titel}`,
  status: { 'ikke-startet': 'Next', 'i-gang': 'In progress', klaret: 'Done', 'sprunget-over': 'Skipped' },
  valgfrit: 'Optional',
  trin: {
    velkommen: { titel: 'Welcome', tekst: 'Tell Clawco your name, which language to use, and whether you are alone or a household.' },
    model: { titel: 'Choose your model', tekst: 'Paste a key from your provider, or use a model on your own machine. Clawco tests it right away, so you can see that it works.' },
    'foerste-kilde': { titel: 'First source', tekst: 'Choose whether to start with your calendar or your mail. Right after, there is something to look at in Now.' },
    'flere-kilder': { titel: 'More sources', tekst: 'One source at a time, and only if you want. Each new source gives you something to look at straight away.' },
    import: { titel: 'Bring it along', tekst: 'Tell Hermes what the other assistants know about you: paste their answer, or add a contacts file or some notes. Nothing is written until you press Save.' },
    'foerste-ret': { titel: 'Correct one thing', tekst: 'Press Correct on a card that is wrong, or Not relevant on one you do not want to see. That is how Hermes gets to know you.' },
  },

  laptopVelkommen: 'Tell Clawco your name and which language to use.',
  hvadHedderDu: 'What is your name?',
  navnEksempel: 'For example Alma',
  hvilketSprog: 'Which language should Clawco and Hermes use?',
  sprogValg: { da: 'Dansk', en: 'English' },
  aleneEllerHusstand: 'Are you alone, or are you a household?',
  husstandValg: { alene: 'Alone', husstand: 'A household' },
  gemmer: 'saving',
  gem: 'Save',
  gemAendringen: 'Save the change',
  retProfilen: 'Edit the profile',
  ejerenFortaeller: 'The owner tells Clawco who you are.',
  duHedder: (navn, sprog) => `Your name is ${navn} · Hermes answers in ${{ da: 'Danish', en: 'English' }[sprog]}`,
  duEr: (husstand) => ` · you are ${{ alene: 'alone', husstand: 'a household' }[husstand]}`,

  niveau: { lille: 'The quick one', taenker: 'The thorough one' },
  modelElement: (niveau) => `Model: ${niveau}`,
  virkerMs: (sek) => `Works · ${sek} s`,
  virker: 'Works',
  virkerIkke: 'Does not work',
  ingenModel: 'no model chosen',
  ikkeProevet: 'Not tested yet.',
  test: 'Test it',
  proeverModellen: 'testing the model',
  udbyder: 'Provider',
  udbyderNavn: (u) => EGEN_MASKINE[u.id] ?? u.navn,
  noeglePlaceholder: (u) => PLACEHOLDER[u.id] ?? u.noeglePlaceholder,
  noegleFra: 'Key from the provider',
  beholdGemte: ' (empty = keep the saved one)',
  adressen: 'The address on your machine (empty = default)',
  nyModel: (niveau) => `${niveau}: model`,
  gemOgTest: 'Save and test',
  gemmerOgProever: 'saving and testing the model',
  kanIkkeSkrive: "Clawco cannot write to Hermes' settings from here. Run the command on Hermes' machine, paste the value when it asks, and then press Test it.",
  kopierKommando: 'Copy the command',
  noegleGivet: (laengde) => `The key has been given to Hermes. Saved (${laengde} characters).`,
  adresse: 'Address: ',
  ingenDatamappe: 'Clawco has no data folder, so the model cannot be chosen here.',
  ingenAgentNoegleEjer: 'Clawco has no key for Hermes yet. The owner adds it.',
  ingenAgentNoegle: "Clawco has no key for Hermes yet. Paste the key that Hermes' API server uses (API_SERVER_KEY in Hermes' .env).",
  noegleTilHermes: 'Key for Hermes',
  gemmerNoeglen: 'saving the key',
  utilgaengeligFoer: 'Hermes does not answer, so Clawco cannot test a model yet. Clawco does not install Hermes itself: install and start Hermes on the machine (for example ',
  utilgaengeligEfter: '), and then open Start again.',
  ejerenVaelger: 'The owner chooses the model.',
  skiftModel: 'Change model',
  modelFejl: {
    noegle: 'The key was refused. Check that you copied the whole key and that it still exists at the provider.',
    kredit: 'The account at the provider has no credit left. Top it up at the provider, and try again.',
    model: 'The provider does not know the model. Choose another model.',
    forbindelse: 'The server does not answer. Check that it is running and that the address is right.',
    tid: 'The model did not answer within 20 seconds.',
    'agent-noegle': 'Clawco has no key for Hermes yet.',
    'agent-afvist': "Hermes refused Clawco's key. Check the key for Hermes.",
    'model-noegle': 'Clawco has no key for a language model yet. Choose a provider, and paste your key in Start.',
    'kun-hermes': 'That provider only works through Hermes. Choose another provider in Start.',
    tom: 'The model answered, but without text.',
    ukendt: 'The model did not answer as expected. Try again in a little while.',
  },

  takRet: 'Thank you. It helps Hermes get to know you. Here is how it earns more freedom.',
  intetAtRette: 'There is nothing to correct yet; Hermes puts up the first thing when there is something.',
  proevDetPaa: 'Try it on ',
  iNu: (titel) => `»${titel}« in Now`,
  foersteKortINu: 'the first card in Now',
  ikkeRelevantErLuk: '. Not relevant is the Close button; feel free to write why, so Hermes remembers it.',
  springOver: 'Skip',
  springerOver: 'skipping',
};

export const START_TEKSTER: { da: StartTekster; en: StartTekster } = { da, en };

/** Start's strings in the language being rendered. */
export const startTekst = (): StartTekster => START_TEKSTER[sprogNu()];
