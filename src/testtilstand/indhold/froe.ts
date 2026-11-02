// Everything a moment of the test world needs on disk (KC-0068): every room's
// state and log, the mail folders, the morning paper and the night's mail plan.
// Deterministic for (moment, dag). Lifted from the demo's historie.ts (KC-0058).

import type { Froe, RumFroe } from '../typer.ts';
import { fakta, momentNr, momentPlus, MOMENT_TABEL, plusDag, rumNr, type Fakta } from './fakta.ts';
import { dagstalFroe } from './dagstal.ts';
import { logFra } from './faelles.ts';
import { avisFil, beskedFroe, GMAIL_FORBUNDET, helbredFroe, kilderKonfig, mailPlan, mappe } from './kilder.ts';
import { dagenLog, dagenState, STATUS_EFTER_AFTEN } from './dagen.ts';
import { gmailMailLog, gmailMailState, mailLog, mailState } from './mail.ts';
import { medRssKilder, nyhederLog, nyhederState } from './nyheder.ts';
import { skriveLog, skriveState } from './skrive.ts';
import { hjemLog, hjemState } from './hjem.ts';
import { opgaver } from './udvikling.ts';
import { HAVVIND, havvindForloeb, havvindStadie, HUSET, husetState, UNIVERS_LOG, universIndeks } from './univers.ts';
import { UDVIKLING } from '../../udvikling/lager.ts';
import { universRum } from '../../rooms/univers/lager.ts';
import { husstandState, TEST_HUSSTAND, TEST_INVITEREDE } from './husstand.ts';
import { pauseFroe } from './nodstop.ts';
import { reglerTekst } from './tillid.ts';
import { erKold, koldFroe, startFaerdig } from './start.ts';
import { mandagFor } from '../../tillid/dagstal.ts';
import { skjulteFroe, soendagForslag, stikbogFroe } from './stikproeve.ts';
import { STOETTE_MOMENT, stoetteFroe } from './stoette.ts';

/** When Henrik opened each room (moment index it is true from, room, Copenhagen time): the nav shows what is relevant now (KC-0052). */
const AABNET: [number, string, string][] = [
  [0, 'hjem', '06:55'], [1, 'dagen', '07:15'], [1, 'nyheder', '08:14'], [1, universRum(HAVVIND), '08:12'], [1, 'mail', '09:25'],
  [2, 'univers', '10:28'], [2, 'hjem', '10:45'], [4, 'skrive', '12:12'], [4, 'hjem', '14:10'], [5, 'hjem', '19:30'],
];

function navState(n: number, f: Fakta): { aabnet: Record<string, string> } {
  const aabnet: Record<string, string> = {};
  for (const [fra, rum, hhmm] of AABNET) if (fra <= n) aabnet[rum] = f.iso(hhmm);
  return { aabnet };
}

/** KC-0223: Mail once Gmail is connected, with the one log line of the read. */
function gmailMail(n: number, f: Fakta): RumFroe {
  const state = gmailMailState(n, f);
  return { state, log: gmailMailLog(f, state.beslutninger.length) };
}

/** Everything the app needs on disk at `momentId` on `dag` (YYYY-MM-DD, Copenhagen). Throws on an unknown moment. */
export function froe(momentId: string, dag: string): Froe {
  if (erKold(momentId)) return koldFroe(momentId, fakta(dag)); // KC-0126: the world variant kold, beside the day
  const n = momentNr(momentId);
  const s = rumNr(n); // after the evening (KC-0103) the rooms stay as they were; Hjem and Claude Code move on
  const f = fakta(dag);
  const m = MOMENT_TABEL[n];
  const plus = m ? momentPlus(m, dag) : 0;
  const nu = f.iso(m?.tid ?? '00:00', plus);
  const havvind = havvindForloeb(f);
  const rum: Record<string, RumFroe> = {
    hjem: { state: hjemState(n, f), log: hjemLog(f, n) },
    dagen: { state: { ...dagenState(s, f), ...(STATUS_EFTER_AFTEN[momentId] ? { hermesStatus: STATUS_EFTER_AFTEN[momentId] } : {}) }, log: dagenLog(f, s) },
    mail: GMAIL_FORBUNDET.includes(momentId) ? gmailMail(n, f) : { state: mailState(s, f), log: mailLog(f, s) }, // KC-0223: Gmail connected = the read-only view
    nyheder: { state: medRssKilder(nyhederState(s, f), momentId), log: nyhederLog(f, s) },
    skrive: { state: skriveState(s, f), log: skriveLog(f, s) },
    univers: { state: universIndeks(s, f), log: logFra('univers', UNIVERS_LOG(), s, f) },
    [universRum(HAVVIND)]: { state: havvind.stadier[havvindStadie(s)], log: logFra(universRum(HAVVIND), havvind.log, s, f) },
    [universRum(HUSET)]: { state: husetState(s, f) },
    [UDVIKLING]: { state: { opgaver: opgaver(f, nu) } },
    nav: { state: navState(n, f) },
    start: { state: startFaerdig(f) }, // KC-0126: the day is an install past onboarding
    husstand: { state: husstandState(n, f) }, // KC-0149: requests in every state
  };
  // KC-0145: the Sunday sample — the week's records, the ledger, and the pause proposal from the line answered wrong.
  const mandag = mandagFor(plusDag(dag, plus));
  const stikbog = stikbogFroe(momentId, mandag, new Date(nu));
  const pause = soendagForslag(momentId, mandag, new Date(nu), reglerTekst(momentId, dag));
  if (pause.length) { const h = rum['hjem']!.state as { regelforslag?: unknown[] }; h.regelforslag = [...(h.regelforslag ?? []), ...pause]; }
  return { ...(stikbog ? { skjulte: [...skjulteFroe(plusDag(mandag, -14)), ...skjulteFroe(plusDag(mandag, -7)), ...skjulteFroe(mandag)], stikproever: stikbog } : {}), rum, mappe: mappe(s, f), avis: avisFil(f), mailPlan: mailPlan(), husstand: { personer: [...TEST_HUSSTAND.personer, ...TEST_INVITEREDE] } /* KC-0154: two invitations waiting */, regler: reglerTekst(momentId, dag), dagstal: dagstalFroe(plusDag(dag, plus)), kilder: kilderKonfig(momentId, f), beskeder: beskedFroe(n, f, momentId), ...(helbredFroe(momentId, f) ? { helbred: helbredFroe(momentId, f) as NonNullable<ReturnType<typeof helbredFroe>> } : {}), ...(momentId === 'pause' ? pauseFroe(f) : {}), ...(momentId === STOETTE_MOMENT ? stoetteFroe(f) : {}) /* KC-0188: support looks along */ };
}
