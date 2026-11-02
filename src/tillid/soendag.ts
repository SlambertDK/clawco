// KC-0145: the Sunday job. Sunday from 18:00 (Copenhagen) the week's sample is drawn once: the number is the count of the
// app's own `skjult` records for the ISO week, the five come from traekStikproeve (seeded by the week). A week with
// nothing hidden is still written (traek empty): the job does not fire again, and Nu shows no card (KC-0052).
// The clock is injected; the setting soendagstjek (default on) is read through `til`.

import { soendagDue } from '../scheduler.ts';
import { ugeAf } from './dagstal.ts';
import { iUge, type SkjultLager } from './skjulte.ts';
import { medStopTilbud, traekStikproeve, type StikbogLager } from './stikproeve.ts';

export type SoendagUdfald = 'oprettet' | 'ikke-tid' | 'findes' | 'fra';

export async function soendagsTjek(o: { skjulte: SkjultLager; bog: StikbogLager; til: () => Promise<boolean>; now: Date }): Promise<SoendagUdfald> {
  if (!soendagDue(o.now)) return 'ikke-tid';
  if (!(await o.til())) return 'fra';
  const uge = ugeAf(o.now);
  let udfald: SoendagUdfald = 'findes';
  const alle = await o.skjulte.alle();
  await o.bog.endre((b) => {
    if (b.uger.some((u) => u.uge === uge)) return b;
    udfald = 'oprettet';
    const ny = { ...b, uger: [...b.uger, { uge, skjulte: iUge(alle, uge).length, traek: traekStikproeve(alle, uge), forkerte: 0 }] };
    return medStopTilbud(ny, o.now);
  });
  return udfald;
}
