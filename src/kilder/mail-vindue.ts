// KC-0214: the composition root's window on the mail connector that can act
// (a Sky tenant with no Hermes tools). Rooms import nothing from src/kilder;
// RoomDeps.mailForbindelse restates this shape. The window is closed (null)
// when the host's own mail source (kira-mail: Hermes reads and moves mail
// with himalaya) is connected — Henrik's install keeps its tool path — and
// when no connected mail source declares both `flyt` and `kladde` — or, KC-0223,
// declares no verbs at all: then the window is read-only (`kanHandle: false`,
// e.g. Gmail), derived from what the connector declares, never from its id.
// A source that declares only some verbs is neither, and gets no window.

import type { Person } from '../identitet/husstand.ts';
import type { Kontekst } from '../graenser/afgoer.ts';
import type { KildeRegister } from './register.ts';
import type { Kuvert, Resultat } from './types.ts';

export type MailVindue = {
  /** The connector's name, for the room's copy ("Indbakken i Mail"). */
  navn: string;
  /** KC-0223: whether the connection can move mails and write drafts. false = it can only read: the room offers no such handling. */
  kanHandle: boolean;
  /** The newest INBOX envelopes, cleaned by the registry — never a body. */
  laes(): Promise<Kuvert[]>;
  /** One declared verb through the registry: the policy layer decides and writes one audit line. */
  handl(navn: 'flyt' | 'kladde', args: Record<string, string>, i: { person: Person; kanal: Kontekst['kanal'] }): Promise<Resultat>;
};

const kanHandle = (v: Readonly<Record<string, unknown>> | undefined): boolean =>
  Boolean(v && Object.hasOwn(v, 'flyt') && Object.hasOwn(v, 'kladde'));

const kunLaes = (k: { verber?: Readonly<Record<string, unknown>> | undefined; act?: unknown }): boolean =>
  !k.act && Object.keys(k.verber ?? {}).length === 0;

export async function mailForbindelse(register: Pick<KildeRegister, 'forbundne' | 'laes' | 'handl'>): Promise<MailVindue | null> {
  const forbundne = await register.forbundne('mail');
  if (forbundne.some((k) => k.standard === 'forbundet')) return null;
  const handler = forbundne.find((x) => kanHandle(x.verber) && x.act);
  const k = handler ?? forbundne.find(kunLaes);
  if (!k) return null;
  return {
    navn: k.navn,
    kanHandle: Boolean(handler),
    async laes() {
      const l = await register.laes(k.id);
      return l.slags === 'mail' ? l.data : [];
    },
    handl: (navn, args, i) => register.handl(k.id, navn, args, i),
  };
}
