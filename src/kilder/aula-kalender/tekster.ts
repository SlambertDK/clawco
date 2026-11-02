// KC-0170: the words of the Aula reader, Danish and English (the shape of src/kilder/tekster.ts). Aula is a product name,
// and so are the labels of Aula's own screens that the steps quote ("Ugekalender", "Kalendersynkronisering"): the user
// sees them in Aula in Danish whatever language Clawco speaks, so they stay as they are in both tables. Nothing here ever
// repeats the link (it is the secret).

import { efterSprog } from '../tekst-hjaelp.ts';

const da = {
  navn: 'Aula',
  handling: { forbind: 'Forbind Aula', skiftLink: 'Skift link' },
  linkEtiket: 'Linket "Ugekalender" fra Aula',
  kortTekst: 'Clawco kan læse din kalender i Aula gennem det private kalenderlink, Aula selv laver til forældre: uden MitID. Clawco læser kun tid, titel, sted og institution, aldrig hvem der er inviteret eller beskrivelser, og kan aldrig ændre noget i Aula.',
  forbundetTil: (vaert: string): string => ` Forbundet til ${vaert}.`,
  trin: [
    'Åbn Aula i browseren eller i appen, og gå til Kalender. Vælg Kalendersynkronisering (Synkronisér kalender).',
    'Sæt fluebenet ved samtykket til, at Aula må overføre dine kalenderbegivenheder til en ekstern kalender. Fjerner du fluebenet senere, stopper deling ved kilden.',
    'Vælg den institution og de begivenhedstyper, du vil se, og tryk Opret kalenderlink.',
    'Kopiér linket "Ugekalender" (det der opdateres hvert femte minut), og indsæt det herunder. Linket virker som en adgangskode: del det ikke med andre.',
  ],

  // health
  tilbagekaldt: 'Aula-linket virker ikke mere: lav et nyt kalenderlink i Aula (samtykket kan være trukket tilbage, eller kommunen har slået synkronisering fra).',
  ingenLink: 'Der er intet kalenderlink gemt. Indsæt linket fra Aula igen.',
  svarerIkkeNu: 'Aula svarer ikke lige nu.',
  vaertSvarerIkkeNu: (vaert: string): string => `${vaert} svarer ikke lige nu.`,
  vaertSvarerLangsomt: (vaert: string): string => `${vaert} svarer langsomt.`,

  // refusals
  ligner: 'Det ligner ikke et Aula-kalenderlink. Kopiér linket "Ugekalender" i Aula, og indsæt det her.',
  indsaetLinket: 'Indsæt linket fra Aula.',
  skalBegynde: 'Linket skal begynde med https://. Kopiér linket "Ugekalender" fra Aula.',
  ikkeAula: 'Det er ikke et link fra Aula. Linket skal ligge på aula.dk.',
  virkerIkkeIkkeKalender: 'Aula-linket virker ikke mere: svaret er ikke en kalender. Lav et nyt kalenderlink i Aula.',
  virkerIkke: 'Aula-linket virker ikke mere. Lav et nyt kalenderlink i Aula.',
  svarede: { tid: 'Aula svarede ikke i tide.', stor: 'Aula-kalenderen er for stor.', andet: 'Aula svarer ikke lige nu.' },
  ikkeForbundet: 'Aula er ikke forbundet med et kalenderlink.',
  ligneIkkeSvar: 'Det ligner ikke et Aula-kalenderlink: svaret er ikke en kalender.',
  afviserLinket: 'Aula afviser linket. Lav et nyt kalenderlink i Aula (Ugekalender), og indsæt det her.',
  svarerIkkeProvIgen: 'Aula svarer ikke lige nu. Prøv igen om lidt.',
  opsatTekst: (antal: number): string => `Aula-kalenderen svarede: ${antal} ${antal === 1 ? 'aftale' : 'aftaler'} de næste syv dage.`,
};

export type AulaTekster = typeof da;

const en: AulaTekster = {
  navn: 'Aula',
  handling: { forbind: 'Connect Aula', skiftLink: 'Change link' },
  linkEtiket: 'The "Ugekalender" link from Aula',
  kortTekst: 'Clawco can read your calendar in Aula through the private calendar link Aula itself makes for parents: without MitID. Clawco only reads time, title, place and institution, never who is invited or descriptions, and can never change anything in Aula.',
  forbundetTil: (vaert) => ` Connected to ${vaert}.`,
  trin: [
    'Open Aula in the browser or in the app, and go to Calendar. Choose "Kalendersynkronisering" (calendar synchronisation).',
    'Tick the consent that lets Aula transfer your calendar events to an external calendar. If you remove the tick later, sharing stops at the source.',
    'Choose the institution and the event types you want to see, and press "Opret kalenderlink" (create calendar link).',
    'Copy the "Ugekalender" link (the one that is updated every five minutes), and paste it below. The link works like a password: do not share it with anyone.',
  ],

  tilbagekaldt: 'The Aula link no longer works: make a new calendar link in Aula (the consent may have been withdrawn, or the municipality may have turned synchronisation off).',
  ingenLink: 'No calendar link is saved. Paste the link from Aula again.',
  svarerIkkeNu: 'Aula is not answering right now.',
  vaertSvarerIkkeNu: (vaert) => `${vaert} is not answering right now.`,
  vaertSvarerLangsomt: (vaert) => `${vaert} is answering slowly.`,

  ligner: 'That does not look like an Aula calendar link. Copy the "Ugekalender" link in Aula, and paste it here.',
  indsaetLinket: 'Paste the link from Aula.',
  skalBegynde: 'The link must begin with https://. Copy the "Ugekalender" link from Aula.',
  ikkeAula: 'That is not a link from Aula. The link must be on aula.dk.',
  virkerIkkeIkkeKalender: 'The Aula link no longer works: the answer is not a calendar. Make a new calendar link in Aula.',
  virkerIkke: 'The Aula link no longer works. Make a new calendar link in Aula.',
  svarede: { tid: 'Aula did not answer in time.', stor: 'The Aula calendar is too large.', andet: 'Aula is not answering right now.' },
  ikkeForbundet: 'Aula is not connected with a calendar link.',
  ligneIkkeSvar: 'That does not look like an Aula calendar link: the answer is not a calendar.',
  afviserLinket: 'Aula refuses the link. Make a new calendar link in Aula ("Ugekalender"), and paste it here.',
  svarerIkkeProvIgen: 'Aula is not answering right now. Try again in a moment.',
  opsatTekst: (antal) => `The Aula calendar answered: ${antal} ${antal === 1 ? 'appointment' : 'appointments'} in the next seven days.`,
};

export const AULA_TEKSTER = { da, en };
export const aulaTekst = (): AulaTekster => efterSprog(AULA_TEKSTER);
