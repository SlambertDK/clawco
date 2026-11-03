// KC-0244: the few cards of the test world that the front page of clawco.work shows, in Danish and in English. The world's content is
// Danish on purpose (KC-0170): every other card, line and name stays Danish at the English moments. These are the exceptions, held to
// what the five screenshots show — the Saturday card in Nu, the mail decision, a request and the double-booked car in Husstanden —
// so the English page can show an English screen. Read at call time (sprogNu), never at module load: the moment sets the language
// (froe.ts wraps the seeding in medSprog) and a scripted answer is given in the language of the request that asked. Danish values are the
// text the cards always had. What Hermes runs when a button is pressed (`instruktion`, `fortryd`) is not here: it stays what the
// scripted Hermes recognises, and it is never on screen.

import { sprogNu, type Sprog } from '../../store/sprog.ts';

type Indhold = {
  /** Weekday letters of the week picture in a card (Sunday first, as Date.getUTCDay counts). */
  ugedage: readonly string[];
  birthe: { titel: string; betyder: string; grundlag: readonly string[]; anbefaling: string; knap: string; overskrift: string };
  mail2401: { resume: string; betydning: string; udkast: string; overskrift: string };
  /** Maja's request to Henrik, with Hermes' suggested alternative time. */
  hent: { titel: string; anbefaling: string; alternativ: string };
  stor: string;
  lille: string;
  /** The two bookings of the double-booked big car. */
  bookinger: { odense: string; indkoeb: string };
  sammenfaldAnbefaling: string;
};

const DA: Indhold = {
  ugedage: ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'],
  birthe: {
    titel: 'Maja spørger: fødselsdag hos Birthe lørdag kl. 14?',
    betyder: 'Maja har skrevet, at Birthe (din mor) fylder år, og at I er velkomne lørdag kl. 14. Din kalender er fri hele lørdagen.',
    grundlag: ['Besked fra Maja i aften', 'Din kalender: lørdag har ingen aftaler', 'I morgen: tog 07.12, ingen kollision'],
    anbefaling: 'Svar ja og reservér lørdag kl. 14.00–17.00. Jeg svarer ikke Maja; det gør du selv.',
    knap: 'Reservér lørdag',
    overskrift: 'Lørdag er fri – sig ja?',
  },
  mail2401: {
    resume: 'Clara sender dagsordenen til mødet kl. 11 og beder om en kort bekræftelse.',
    betydning: 'Tre punkter: valg af kabeltracé, tidsplanen for kabelleverandøren og fordelingen af meromkostningen. Hun vil vide, at du kommer, og om Jonas er med. Svar kort: vi ses kl. 11.',
    udkast: 'Hej Clara\n\nTak for dagsordenen. Jonas og jeg er med kl. 11, så vi ses.\n\nVenlig hilsen\nHenrik',
    overskrift: 'Bekræft: vi ses kl. 11',
  },
  hent: { titel: 'Kan du hente Ella fra svømning i morgen?', anbefaling: 'Du har intet andet i kalenderen i morgen eftermiddag.', alternativ: 'Kan 17.00' },
  stor: 'Den store bil',
  lille: 'Den lille bil',
  bookinger: { odense: 'Til Odense', indkoeb: 'Storindkøb til fødselsdagen' },
  sammenfaldAnbefaling: 'Maja kører hele dagen; den lille bil er fri, mens Henrik handler.',
};

const EN: Indhold = {
  ugedage: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  birthe: {
    titel: 'Maja asks: Birthe’s birthday on Saturday at 14.00?',
    betyder: 'Maja has written that Birthe (your mother) is turning a year older, and that you are welcome on Saturday at 14.00. Your calendar is free all Saturday.',
    grundlag: ['Message from Maja tonight', 'Your calendar: nothing on Saturday', 'Tomorrow: train 07.12, no clash'],
    anbefaling: 'Say yes and reserve Saturday 14.00–17.00. I do not answer Maja; you do that yourself.',
    knap: 'Reserve Saturday',
    overskrift: 'Saturday is free – say yes?',
  },
  mail2401: {
    resume: 'Clara sends the agenda for the 11.00 meeting and asks for a short confirmation.',
    betydning: 'Three points: the choice of cable route, the schedule of the cable supplier and how to split the extra cost. She wants to know that you are coming, and whether Jonas is joining. Answer briefly: see you at 11.',
    udkast: 'Hi Clara\n\nThanks for the agenda. Jonas and I will be there at 11, so see you then.\n\nKind regards\nHenrik',
    overskrift: 'Confirm: see you at 11',
  },
  hent: { titel: 'Can you pick up Ella from swimming tomorrow?', anbefaling: 'You have nothing else in the calendar tomorrow afternoon.', alternativ: 'Can do 17.00' },
  stor: 'The big car',
  lille: 'The little car',
  bookinger: { odense: 'To Odense', indkoeb: 'Big shop for the birthday' },
  sammenfaldAnbefaling: 'Maja is driving all day; the little car is free while Henrik shops.',
};

const INDHOLD: Record<Sprog, Indhold> = { da: DA, en: EN };

/** The front page's cards in the language being rendered (Danish when none is set). */
export const indhold = (): Indhold => INDHOLD[sprogNu()];
