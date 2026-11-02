// KC-0170: fixed inputs for Nu (the room Hjem), rendered without a chosen language. The files in
// test/fixtures/sprog-hjem/ were captured from these inputs BEFORE the strings moved into src/rooms/hjem/tekster.ts;
// test/rooms/hjem-tekster.test.ts holds the renders to them byte for byte. Change a golden only when the Danish copy
// changes on purpose. Data in the inputs is plain ASCII English so an English render shows only the room's own words.

import { renderHjem, renderPlaceholder, type HjemData } from '../../src/rooms/hjem/render.ts';
import type { Kort } from '../../src/rooms/hjem/kort.ts';
import type { Regelforslag } from '../../src/tillid/forslag.ts';
import type { Stikuge } from '../../src/tillid/stikproeve.ts';
import type { KildeHelbredKort } from '../../src/shell/kilde-helbred.ts';
import { html } from '../../src/shell/html.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

export const NU = new Date('2026-10-26T12:00:00.000Z');
const person = { id: FAMILIE.ejer.id, login: null, navn: FAMILIE.ejer.navn, rolle: 'ejer' as const };

const kort = (o: Partial<Kort> & Pick<Kort, 'id' | 'titel'>): Kort => ({
  type: 'tjeneste', betyder: 'The plan costs more from November.', grundlag: ['Mail from the supplier, 25 Oct.'], kilder: ['https://example.org/price', 'Mail 12'],
  anbefaling: 'Switch to yearly billing.', prioritet: 3, ...o,
});

const forslag = (o: Partial<Regelforslag> & Pick<Regelforslag, 'id'>): Regelforslag => ({
  kortId: 'k:rev', kortTitel: 'Invoice from Acme', titel: 'Always sort invoices from Acme', tekst: 'You corrected two invoices from Acme.', trin: 1, gaelder: { kilde: 'mail', slags: 'invoice' },
  art: 'ret', hash: 'h1', oprettet: '2026-10-25T08:00:00.000Z', status: 'afventer', ...o,
});

const stikuge: Stikuge = {
  uge: '2026-10-19', skjulte: 212, forkerte: 0,
  traek: [
    { id: 's1', tid: '2026-10-22T08:00:00.000Z', titel: 'Newsletter from Shop', kilde: 'mail', regelId: 'r1' },
    { id: 's2', tid: '2026-10-22T09:00:00.000Z', titel: 'Receipt from Cafe', kilde: 'kuratoren', svar: 'rigtigt' },
    { id: 's3', tid: '2026-10-22T10:00:00.000Z', titel: 'Alert from Bank', kilde: 'mail', svar: 'forkert' },
  ],
};

const helbred: KildeHelbredKort = { id: 'falsk-kalender', navn: 'Fake calendar', slags: 'kalender', auth: 'oauth', vist: 'log-ind-igen', zone: 'privat', sidstLaest: '2026-10-24T08:00:00.000Z', felter: [], kanForbinde: true };

/** A full Nu: every band and group the room draws. */
const FULD: HjemData = {
  hilsen: 'Good day, Henrik',
  now: NU,
  person,
  situation: 'dagen',
  venter: [{ roomId: 'dagen', tekst: 'One recommendation waits: use 13 for the draft.' }, { roomId: 'mail', tekst: 'Three mails need a decision.' }, { roomId: 'skrive', tekst: 'A draft is ready.' }, { roomId: 'nyheder', tekst: 'The paper is ready.' }],
  venterPaaAndre: [{ roomId: 'husstand', tekst: 'Rikke has not answered the Saturday request.' }],
  hermes: [
    { tid: '2026-10-26T09:30:00.000Z', tekst: 'Built Today.', id: 'l1', handlingId: 'k:1:h', fortryd: 'undo it' },
    { tid: '2026-10-26T09:40:00.000Z', tekst: 'Moved a mail.', id: 'l2', fortryd: 'undo it', fortrudt: '2026-10-26T10:15:00.000Z' },
    { tid: '2026-10-26T09:50:00.000Z', tekst: 'Wrote a ledger line.', id: 'l3', handlingId: 'regnskab:b1' },
    { tid: '2026-10-26T10:00:00.000Z', tekst: 'Refused to pay a bill.', graense: 'afvist' },
    { tid: '2026-10-25T09:00:00.000Z', tekst: 'Old entry from yesterday morning.', id: 'l5', fortryd: 'undo it' },
  ],
  gjort: ['k:done:h'],
  naeste: { titel: 'Planning meeting', start: '2026-10-26T14:50:00.000Z' },
  gamle: { kalender: { slags: 'kalender', sidstLaest: '2026-10-25T08:00:00.000Z', ok: true } },
  kort: [
    kort({ id: 'k:1', titel: 'Supplier raises the price', prioritet: 1, handling: { id: 'k:1:h', label: 'Switch plan', instruktion: 'Switch the plan.' }, mailId: '42', zone: 'husstand', ejer: FAMILIE.partner.id }),
    kort({ id: 'k:bill', type: 'regning', titel: 'Invoice from Acme', prioritet: 2, regnskab: { hvor: 'privat', dato: '2026-10-20', leverandoer: 'Acme', beloeb: '120', valuta: 'DKK', art: 'koeb', emne: 'Tools' }, udvikling: { projekt: 'shelfatlas' } }),
    kort({ id: 'k:unclear', type: 'regning', titel: 'Invoice from Beta', prioritet: 3, regnskabUklart: true, anbefaling: '' }),
    kort({ id: 'k:paid', type: 'regning', titel: 'Invoice from Gamma', prioritet: 4, skrevet: { hvor: 'shelfatlas', fil: 'x.md' }, regnskab: { hvor: 'shelfatlas', dato: '2026-10-21', leverandoer: 'Gamma', beloeb: '9', valuta: 'EUR', art: 'abonnement', emne: 'Hosting' } }),
    kort({ id: 'k:rule', type: 'regning', titel: 'Invoice from Delta', prioritet: 5, kraeverRegel: true, regnskab: { hvor: 'privat', dato: '2026-10-21', leverandoer: 'Delta', beloeb: '5', valuta: 'EUR', art: 'koeb', emne: 'Misc' } }),
    kort({ id: 'k:msg', type: 'familie', titel: 'Message from Nora', prioritet: 6, beskedId: 'b-0123456789abcdef', besked: { kanal: 'whatsapp', afsender: 'Nora' }, kilder: [] }),
    kort({ id: 'k:news', type: 'nyhed', titel: 'A new model', prioritet: 7, prompt: 'Try the new model.', anbefaling: '' }),
    kort({ id: 'k:done', type: 'familie', titel: 'Booked the car', prioritet: 8, handling: { id: 'k:done:h', label: 'Book it', instruktion: 'Book.' } }),
  ],
  intet: [{ titel: 'Newsletter', hvorfor: 'No action needed' }, { titel: 'Receipt' , hvorfor: '' }],
  regnskab: [{ id: 'old1', hvor: 'shelfatlas', leverandoer: 'Acme', beloeb: '120', valuta: 'DKK' }, { id: 'old2', hvor: 'privat' }],
  claudeCode: [
    { id: 'c1', status: 'sendt', projekt: 'Clawco', saetning: 'Add a dark chip.', oprettet: '2026-10-26T07:00:00.000Z' },
    { id: 'c2', status: 'modtaget', projekt: 'Clawco', saetning: 'Fix the footer.', oprettet: '2026-10-26T07:01:00.000Z', ticket: 'KC-1' },
    { id: 'c3', status: 'i-gang', projekt: 'Clawco', saetning: 'Rename the tab.', oprettet: '2026-10-26T07:02:00.000Z', ticket: 'KC-2' },
    { id: 'c4', status: 'parkeret', projekt: 'Clawco', saetning: 'Pick a colour.', oprettet: '2026-10-26T07:03:00.000Z', ticket: 'KC-3', spoergsmaal: { tekst: 'Which colour?', valg: ['Blue', 'Green'] } },
    { id: 'c5', status: 'parkeret', projekt: 'Clawco', saetning: 'Wait for a key.', oprettet: '2026-10-26T07:04:00.000Z', ticket: 'KC-4', grund: 'No key yet.' },
    { id: 'c6', status: 'parkeret', projekt: 'Clawco', saetning: 'Choose a font.', oprettet: '2026-10-26T07:05:00.000Z', ticket: 'KC-5', svar: 'Plex', spoergsmaal: { tekst: 'Which font?', valg: [] } },
    { id: 'c7', status: 'faerdig', projekt: 'Clawco', saetning: 'Ship the nav.', oprettet: '2026-10-25T07:00:00.000Z', ticket: 'KC-6', bevis: 'Tests pass. PR: https://example.org/pr/7', pr: 'https://example.org/pr/7' },
    { id: 'c8', status: 'parkeret', projekt: 'Clawco', saetning: 'Needs a free answer.', oprettet: '2026-10-26T07:06:00.000Z', spoergsmaal: { tekst: 'Which name?', valg: [] } },
  ],
  ccTal: [{ projekt: 'Clawco', landet: 3, rullet: 1, parkeret: 2, aabne: 0, minutter: 45 }, { projekt: 'Other', landet: 1, rullet: 0, parkeret: 0, aabne: 0, minutter: 300 }],
  synlige: new Set(['hjem', 'dagen', 'mail', 'skrive', 'nyheder', 'start']),
  igang: [{ id: 'r1', label: 'Sorting mail', status: 'running' }, { id: 'r2', label: 'Building Today', status: 'queued' }],
  venterIalt: 9,
  reglerFejl: { hvorfor: 'line 4 is not valid', fil: 'regler.json' },
  forhaandsvisninger: [{ id: 'fv:1', html: html`<article class="card"><p>First look at the calendar.</p></article>` }],
  regelforslag: [
    forslag({ id: 'f1', pauser: 'r7' }),
    forslag({ id: 'f2', kunPause: true, pauser: 'r8', kortId: 'skjult:s3', kortTitel: 'Alert from Bank', titel: 'Pause the rule that hid the alert', tekst: 'The rule hid an alert you wanted.', art: 'ikke-relevant' as Regelforslag['art'] }),
    forslag({ id: 'f3', art: 'ikke-relevant' as Regelforslag['art'], gaelder: { kilde: 'kuratoren' }, trin: 0 }),
  ],
  ugetal: html`<p class="row-note" data-ugetal>This week: 4 things needed you.</p>`,
  stikproeve: stikuge,
  stopTilbud: true,
};

export const HJEM_FULD = (): string => String(renderHjem(FULD));

/** The same Nu in the "meeting" situation: the meeting row, no tiles, no Ordnet. */
export const HJEM_MOEDE = (): string => {
  const { naeste: _uden, ...uden } = FULD;
  return String(renderHjem({ ...uden, situation: 'moede', moede: { titel: 'Budget meeting', url: '/rum/univers-moeder', slut: '2026-10-26T12:45:00.000Z' } }));
};

/** Nothing waits: the calm "all done" card, with and without a next appointment. */
export const HJEM_TOMT = (): string => String(renderHjem({ hilsen: 'Good day', venter: [], hermes: [], venterIalt: 0, now: NU })) + String(renderHjem({
  hilsen: 'Good day', venter: [], hermes: [], venterIalt: 0, now: NU, naeste: { titel: 'Planning meeting', start: '2026-10-26T14:50:00.000Z' }, situation: 'aften',
}));

/** One failing connection (the card comes from the shell) next to one waiting line. */
export const HJEM_HELBRED = (): string => String(renderHjem({ hilsen: 'Good day', venter: [{ roomId: 'mail', tekst: 'One mail waits.' }], hermes: [], now: NU, person, kildeHelbred: [helbred] }));

export const HJEM_PLADS = (): string => String(renderPlaceholder({ id: 'mail', navn: 'Mail', built: false, beskrivelse: 'Decisions about mail.' }));

export const HJEM: Record<string, () => string> = { fuld: HJEM_FULD, moede: HJEM_MOEDE, tomt: HJEM_TOMT, helbred: HJEM_HELBRED, plads: HJEM_PLADS };
/** The cases an English render must be clean in: the connection card is the shell's (src/shell/kilde-helbred.ts). */
export const HJEM_RENE = ['fuld', 'moede', 'tomt', 'plads'] as const;
