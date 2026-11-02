// KC-0241: fixed inputs for the voice layer (src/stemme/), rendered without a chosen language. The files in
// test/fixtures/sprog-stemme/ were captured from these inputs BEFORE the strings moved into src/stemme/tekster.ts;
// test/stemme/tekster.test.ts holds the outputs to them byte for byte (no language set, and 'da' chosen). The room and
// card content is plain ASCII English on purpose, so an English run shows only the words the voice layer owns. Change a
// golden only when the Danish copy changes on purpose.

import { AGENT_CONFIG, AGENT_FIRST_MESSAGE, AGENT_PROMPT, KEYTERMS, antalTekst } from '../../src/stemme/agent.ts';
import { medKildeHelbred, medKuratorKort, oversigtAf } from '../../src/stemme/oversigt.ts';
import { saetning, taleAfsender, taleDato, taleKlokken } from '../../src/stemme/tale.ts';
import type { StemmeRum } from '../../src/stemme/types.ts';
import type { Kort } from '../../src/rooms/hjem/kort.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

export const NU = new Date('2026-10-26T12:00:00.000Z');
export const PERSON = { id: FAMILIE.ejer.id, login: null, navn: FAMILIE.ejer.navn, rolle: 'ejer' as const };

const mail: StemmeRum = { rum: 'mail', resume: 'Two mails wait for your decision.', punkter: [
  { id: 'xyz', sig: 'Mail from Anne: Offer.', valg: [{ id: 'xyz-call', label: 'Call' }, { id: 'aktion:faerdig:xyz', label: 'Done' }] },
  { id: 'abc', sig: 'Mail from Bo: Invoice.', valg: [{ id: 'aktion:faerdig:abc', label: 'Done' }] },
] };
const dagen: StemmeRum = { rum: 'dagen', resume: 'Four meetings today.', punkter: [{ id: 'anb', sig: 'My recommendation: move the meeting.', valg: [{ id: 'anb', label: 'Move the meeting' }] }] };
const skrive: StemmeRum = { rum: 'skrive', resume: 'No draft in progress.', punkter: [] };
const nyheder: StemmeRum = { rum: 'nyheder', resume: 'The paper.', punkter: [] };
const bank: StemmeRum = { rum: 'bank', resume: 'Balance.', punkter: [] };
const hjem: StemmeRum = { rum: 'hjem', resume: 'Nothing special.', punkter: [] };
const husstand: StemmeRum = { rum: 'husstand', resume: 'A quiet week.', punkter: [] };

export const kort = (o: Partial<Kort> & Pick<Kort, 'id' | 'titel'>): Kort => ({
  type: 'tjeneste', betyder: 'The plan costs more from November.', grundlag: ['Mail from the supplier.'], kilder: [], anbefaling: 'Switch to yearly billing.', prioritet: 3, ...o,
});

const TOM = { tekst: 'Nothing waits.', punkter: [] };

export const STEMME: Record<string, () => string> = {
  'agent-config.json': () => JSON.stringify(AGENT_CONFIG, null, 2),
  'agent-prompt.txt': () => AGENT_PROMPT,
  'agent-foerste-besked.txt': () => AGENT_FIRST_MESSAGE,
  'keyterms.json': () => JSON.stringify(KEYTERMS),
  'antal.txt': () => [0, 1, 2, 5].map(antalTekst).join('\n'),
  'oversigt-fuld.txt': () => oversigtAf([mail, dagen, skrive]).tekst,
  'oversigt-orden.txt': () => oversigtAf([bank, skrive, nyheder, dagen, mail, hjem, husstand]).tekst,
  'oversigt-en.txt': () => oversigtAf([dagen]).tekst,
  'oversigt-tom.txt': () => oversigtAf([{ ...mail, punkter: [] }, skrive]).tekst,
  'kurator-et.txt': () => medKuratorKort(TOM, [kort({ id: 'k1', titel: 'Supplier raises the price' })], PERSON, NU).tekst,
  'kurator-flere.txt': () => medKuratorKort(TOM, [kort({ id: 'k1', titel: 'Supplier raises the price', prioritet: 2 }), kort({ id: 'k2', titel: 'Invoice from Acme', prioritet: 1, anbefaling: 'Book it.' }), kort({ id: 'k3', titel: 'A new model', prioritet: 4 }), kort({ id: 'k4', titel: 'Fourth card', prioritet: 5 })], PERSON, NU).tekst,
  'kurator-ingen.txt': () => medKuratorKort(TOM, [], PERSON, NU).tekst,
  'helbred.txt': () => medKildeHelbred(TOM, ['The calendar needs a new login.', 'The calendar needs a new login.', 'The mail source is slow.']).tekst,
  'tale-klokken.txt': () => ['10:00', '10:30', '9.05', '09:00', '  7:45 ', '0:00', 'noon', ''].map(taleKlokken).join('\n'),
  'tale-dato.txt': () => ['2026-10-29', '2026-10-29T10:00', '2026-01-01 09:30', '2026-03-01T00:00', '2026-02-30', 'tomorrow', '2026-12-31T23:59'].map(taleDato).join('\n'),
  'tale-afsender.txt': () => ['Anne Hansen <anne@x.example>', '"Bo" <bo@x.example>', 'carl@x.example', '<dina@x.example>', 'Erik'].map(taleAfsender).join('\n'),
  'tale-saetning.txt': () => ['Hello **world** [link](https://x.example) done', 'Already ends.', 'Really?', '', '   '].map(saetning).join('\n'),
};
