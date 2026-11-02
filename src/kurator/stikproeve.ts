// KC-0145: "Skulle have vist mig det" on the Sunday sample feeds the KC-0144 proposal flow — and nothing more. With a rule
// as the reason (and that rule active in the file now) the app stores its own pending proposal to pause it (one per rule
// while it waits); Hermes is
// asked (a 'laer' run, the item's title, source and rule as context) and may answer with a narrower rule, which replaces
// the pause proposal and still pauses the old rule on Ja. This file never touches the rules file: the only writer is the
// approve route in server.ts, behind Henrik's own tap.

import type { RoomDeps } from '../rooms/module.ts';
import type { RunRecord } from '../runs.ts';
import type { Skjult } from '../tillid/skjulte.ts';
import { extractForslagBlok, laegTil, pauseForslag } from '../tillid/forslag.ts';
import { endreKurator, HJEM } from './kurator.ts';
import { gemRegelforslag, kanForeslaa, meldForslag } from './regelforslag.ts';
import { buildSkjultRun } from './kortprompt.ts';

/** The proposal's card: the hidden item (one proposal per item, like one per corrected card). */
export const skjultKort = (p: Skjult): { id: string; titel: string; zone: 'privat' } => ({ id: `skjult:${p.id}`, titel: p.titel, zone: 'privat' });

/** Call in the request (a run's callback has no person). Resolves to the Hermes run. */
export async function skulleVises(d: RoomDeps, p: Skjult): Promise<RunRecord> {
  const forslag = kanForeslaa(d);
  const regler = d.regler ? await d.regler.laes() : undefined;
  const regel = p.regelId && regler?.tilstand === 'ok' ? regler.saet.regler.find((r) => r.id === p.regelId && r.status === 'aktiv') : undefined;
  const kort = skjultKort(p);
  if (forslag && regel) {
    const nu = d.now();
    let lagt = false;
    await endreKurator(d.store, (s) => {
      // One pending proposal per rule to pause: a second wrong under the same rule is counted, not proposed again.
      if (s.regelforslag?.some((f) => f.status === 'afventer' && f.pauser === regel.id)) return s;
      const l = laegTil(s.regelforslag, pauseForslag(regel, { kort, nu }), nu);
      lagt = l.udfald === 'lagt' || l.udfald === 'erstattet';
      return lagt ? { ...s, regelforslag: l.liste } : s;
    });
    if (lagt) meldForslag(d);
  }
  return d.runs.start({
    kind: 'laer',
    room: HJEM,
    label: 'Nu: lærer af søndagstjekket',
    spec: buildSkjultRun(p, regel, d.now(), regler),
    onDone: async (output) => {
      const { tekst, blok } = forslag ? extractForslagBlok(output) : { tekst: output, blok: undefined };
      const text = tekst.trim().slice(0, 600) || 'Noteret.';
      await d.store.appendLog(HJEM, { kilde: 'hermes', tekst: text });
      if (forslag) await gemRegelforslag(d, { kort, art: 'ret', blok, ...(regel ? { pauser: regel.id } : {}) }).catch((err: unknown) => console.error('regelforslag:', err instanceof Error ? err.message : err));
      return { text };
    },
  });
}
