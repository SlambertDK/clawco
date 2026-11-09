// The Kuratoren run: one Hermes run through the run registry that reads what is
// new (mail, news), asks Hermes to stand by or retire the open cards, writes
// bills into the ledgers (the app writes, Hermes only proposes) and stores the
// merged cards as Hjem's whole state.json. The invariant: the mail cursor and
// `sete` are stored only when the run succeeds, so a failed run re-reads the
// same mail next time (the ledger marker makes that safe).

import type { KuratorBesked, RoomDeps } from '../rooms/module.ts';
import type { RunRecord } from '../runs.ts';
import type { RumLager } from '../store/types.ts';
import { kortTypeFra, type Kort, type KortType, type KuratorState } from '../rooms/hjem/kort.ts';
import { KORSEL, kortUdenVaerktoej, kunSynlige, mergeKort, parseKuratorSvar, zoneFelter } from '../rooms/hjem/kort.ts';
import { synligFor, zoneAf, type DataZone } from '../identitet/zoner.ts';
import type { Person } from '../identitet/husstand.ts';
import { extractJson } from '../rooms/dagen/schema.ts';
import { copenhagenDate } from '../rooms/dagen/source.ts';
import { FORTRYD_FJERN, skrivRegnskab } from './regnskab.ts';
import { KURATOR_MAPPER, nyeMails } from './input.ts';
import { buildKuratorRun } from './prompt.ts';
import { knytBeskeder, nyeBeskeder, seteEfter } from './beskeder.ts';
import { afgoer } from '../graenser/afgoer.ts';
import type { Intet } from '../rooms/hjem/kort.ts';
import type { ReglerLaest } from '../tillid/lager.ts';
import type { Skjult } from '../tillid/skjulte.ts';
import { createHash } from 'node:crypto';
import { kuratorTekst, zoneOrd } from './tekster.ts';

export const HJEM = 'hjem';

const tom = (): KuratorState => ({ kort: [], intet: [], afvist: [], sete: [] });

/** Hjem's stored Kuratoren state; the empty state when none (or a field is missing). */
export async function laesKurator(store: RumLager): Promise<KuratorState> {
  const s = await store.readState<Partial<KuratorState>>(HJEM);
  if (!s || typeof s !== 'object') return tom();
  const { regelforslag, ...rest } = s;
  return {
    ...rest,
    ...(Array.isArray(regelforslag) ? { regelforslag } : {}),
    // KC-0119: a stored card of the legacy kind forespoergsel is read as familie (rewritten on the next save).
    kort: Array.isArray(s.kort) ? s.kort.map((k) => (k && k.type !== kortTypeFra(k.type) ? { ...k, type: kortTypeFra(k.type) as KortType } : k)) : [],
    intet: Array.isArray(s.intet) ? s.intet : [],
    afvist: Array.isArray(s.afvist) ? s.afvist : [],
    sete: Array.isArray(s.sete) ? s.sete : [],
  };
}

/**
 * KC-0117: Hjem's state as `person` may see it — for display, counts and voice only. Never write the result back
 * (the stored file holds every person's cards). The id lists (afvist, sete) are not elements and stay.
 */
export function synligKurator(s: KuratorState, person: Person): KuratorState {
  const ud: KuratorState = { ...s, kort: kunSynlige(s.kort, person), intet: kunSynlige(s.intet, person) };
  if (s.lukket) ud.lukket = kunSynlige(s.lukket, person);
  if (s.regelforslag) ud.regelforslag = kunSynlige(s.regelforslag, person);
  if (s.regnskab) ud.regnskab = Object.fromEntries(Object.entries(s.regnskab).filter(([, r]) => synligFor(person, r)));
  return ud;
}

// Every write of Hjem's state (the run's merge, every card button, the chat's flyt) goes through one chain
// per store, and each step re-reads the state inside the chain: no writer can overwrite another's change.
const koer = new WeakMap<RumLager, Promise<unknown>>();

/**
 * The one way to change Hjem's state: `fn` gets the current state (read inside the chain) and returns the
 * next one, which is written; returning the very same object writes nothing. `fn` may do other I/O (ledger
 * files) first: the chain is held until it is done. A throw writes nothing and does not block later steps.
 * Never call endreKurator from inside `fn` (that would wait for itself).
 */
export function endreKurator(store: RumLager, fn: (s: KuratorState) => KuratorState | Promise<KuratorState>): Promise<KuratorState> {
  const trin = async (): Promise<KuratorState> => {
    const nu = await laesKurator(store);
    const ny = await fn(nu);
    if (ny !== nu) await store.writeState(HJEM, ny);
    return ny;
  };
  const naeste = (koer.get(store) ?? Promise.resolve()).then(trin, trin);
  koer.set(store, naeste.catch(() => undefined));
  return naeste;
}

const iFlugt = (d: RoomDeps): boolean => d.runs.list().some((r) => r.kind === 'kurator' && (r.status === 'queued' || r.status === 'running'));

/** What a ledger row is about, for Henrik's rules (the reference install's R-0002 is "mail / regning", trin 2). */
const REGNING = { kilde: 'mail', slags: 'regning' } as const;

/**
 * Writes the ledger row for every bill card that survived the merge, came from
 * this answer (new or updated) and names a ledger, and returns the merged cards
 * with `skrevet` set plus the updated `regnskab` map. A card id with an entry in
 * state.regnskab is never written again (undone or moved rows stay as Henrik
 * left them). A row that already exists ('findes') only marks the card; its log
 * entry is added if a crash between write and log left it missing.
 * KC-0143: a row is trin 2 (bogføre) done on its own, so each passes the policy layer with Henrik's rules as they
 * are on disk now; without a covering rule nothing is written and the card carries `kraeverRegel` (it asks which
 * rule should cover it, and its "Skriv i …" button is Henrik's own yes). No regnskab entry is kept for it, so a
 * later answer under a covering rule writes it.
 */
async function skrivRegninger(d: RoomDeps, merged: KuratorState, fraSvar: Set<string>): Promise<KuratorState> {
  const gammelt = merged.regnskab ?? {};
  const emner = merged.kort.filter((k) => fraSvar.has(k.id) && k.type === 'regning' && k.regnskab && !k.regnskabUklart && !gammelt[k.id]);
  if (emner.length === 0) return merged;
  if (!d.vaultRod) {
    console.error('kurator: ingen vault sat op — regnskabslinjer skrives ikke i denne kørsel');
    return merged;
  }
  const regler = d.regler ? await d.regler.laes() : undefined;
  const regnskab = { ...gammelt };
  const skrevne = new Map<string, Kort>();
  for (const k of emner) {
    const l = k.regnskab;
    if (!l) continue;
    const handlingId = `regnskab:${k.id}`;
    const zone = zoneAf(k);
    const a = afgoer({ rum: HJEM, id: handlingId, verb: 'bogfoer', zoner: [zone], gaelder: REGNING }, { person: d.person, kanal: 'baggrund', ja: false, regler });
    await d.revision?.skriv({ person: d.person.id, kanal: 'planlagt', rum: HJEM, verb: 'bogfoer', udfald: a.udfald === 'afvis' ? 'afvist' : a.udfald, hvorfor: a.hvorfor, handlingId, zoner: [zone], kilde: 'graense' });
    if (a.udfald !== 'tillad') {
      skrevne.set(k.id, { ...k, kraeverRegel: true });
      continue;
    }
    const fil = d.regnskabsfil(l.hvor);
    const resultat = await skrivRegnskab(fil, k.id, l);
    if (resultat === 'skrevet' || !(await d.store.readLog(HJEM, 1000)).some((e) => e.handlingId === handlingId)) {
      await d.store.appendLog(HJEM, { kilde: 'hermes', tekst: kuratorTekst().logSkrev(l.leverandoer, l.beloeb, l.valuta, l.hvor), handlingId, fortryd: FORTRYD_FJERN });
    }
    regnskab[k.id] = { hvor: l.hvor, status: 'skrevet', leverandoer: l.leverandoer, beloeb: l.beloeb, valuta: l.valuta, ...zoneFelter(k) };
    const { kraeverRegel: _ny, ...uden } = k;
    skrevne.set(k.id, { ...uden, skrevet: { hvor: l.hvor, fil } });
  }
  return { ...merged, kort: merged.kort.map((k) => skrevne.get(k.id) ?? k), regnskab };
}

/** KC-0145: an intet line's cited rule stays only when it is an active rule in the file this run read; else it is dropped. */
function medGyldigRegel(intet: Intet[], regler: ReglerLaest | undefined): Intet[] {
  const aktive = new Set(regler?.tilstand === 'ok' ? regler.saet.regler.filter((r) => r.status === 'aktiv').map((r) => r.id) : []);
  return intet.map((i) => {
    if (!i.regel || aktive.has(i.regel)) return i;
    const { regel: _ugyldig, ...uden } = i;
    return uden;
  });
}

/** KC-0145: the records of the intet lines this merge added (new lines and the cards that did not fit). */
function skjulteFra(nye: Intet[], stamp: string): Skjult[] {
  return nye.map((i, n) => ({
    id: `intet:${createHash('sha256').update(`${stamp}|${n}|${i.titel}`).digest('hex').slice(0, 16)}`,
    tid: stamp, titel: i.titel, kilde: 'kuratoren', ...(i.regel ? { regelId: i.regel } : {}),
  }));
}

/** KC-0226: the zones that get a run of their own beside the privat one. Each reads only its own zone's messages and open cards. */
const ZONE_KOERSLER = ['arbejde', 'husstand'] as const;

/**
 * Starts the Kuratoren run(s) and returns the first (the privat one when there is one), or null when nothing is new
 * anywhere or a Kuratoren run is already queued or running. A deep run is allowed once a day (state.sidstDyb); a second
 * request the same day runs as a normal one.
 *
 * KC-0226: one run per zone that has material. The privat run reads mail, news and the privat messages, as it always
 * did. A run over arbejde (or husstand) exists only while that zone has messages not sent before (`beskederSete`,
 * the same "new since" signal the privat run uses), and reads those messages and that zone's open cards only: a quiet
 * zone costs no run, and no prompt ever holds two zones.
 */
export async function startKurator(
  d: RoomDeps,
  o: { dyb: boolean; nyheder: string[] | null; nyhederStempel?: string; personer?: string },
): Promise<RunRecord | null> {
  if (iFlugt(d)) return null;
  const now = d.now();
  const state = await laesKurator(d.store);
  // KC-0214: with a mail connector that can act (a Sky tenant) the new mail is its inbox; else Hermes' folders via himalaya.
  // KC-0223: a read-only connection is for the Mail room; Kuratoren keeps its own path until it gets one (follow-up).
  const w = d.mailForbindelse ? await d.mailForbindelse() : null;
  const v = w?.kanHandle ? w : null;
  const kilde = v ? { forbindelse: () => v.laes() } : { run: d.mailRunner, himalaya: d.himalaya, mapper: KURATOR_MAPPER };
  const input = await nyeMails({ ...kilde, sete: state.sete, ...(state.cursor ? { cursor: state.cursor } : {}), now });
  // One deep (web) run a day: a second ask the same day (Copenhagen) runs as a normal one, whoever asks.
  const dyb = o.dyb && !(state.sidstDyb && copenhagenDate(new Date(state.sidstDyb)) === copenhagenDate(now));
  // KC-0138: new messages of the chosen conversations, per zone (a message is of the zone its conversation was put in). A failed read is no messages.
  const alleBeskeder = d.beskeder ? await d.beskeder().catch(() => []) : [];
  const beskeder = nyeBeskeder(alleBeskeder, state.beskederSete ?? []);
  const zoneBeskeder = ZONE_KOERSLER.map((zone) => ({ zone, beskeder: nyeBeskeder(alleBeskeder, state.beskederSete ?? [], zone) })).filter((z) => z.beskeder.length > 0);
  const privatNyt = input.mails.length > 0 || o.nyheder !== null || dyb || beskeder.length > 0;
  if (!privatNyt && zoneBeskeder.length === 0) return null;
  // KC-0142: the rules as they are on disk now (Henrik may have edited them since the last run). Read before the check below, so check and starts are one synchronous stretch.
  const regler = privatNyt && d.regler ? await d.regler.laes() : undefined;
  // Another start may have slipped in while we read mail: check again, synchronously before runs.start.
  if (iFlugt(d)) return null;

  const startede: RunRecord[] = [];
  if (privatNyt) startede.push(startPrivat(d, { o, state, input, dyb, beskeder, regler, v, now }));
  for (const z of zoneBeskeder) startede.push(startZone(d, z.zone, z.beskeder, state, now));
  return startede[0] ?? null;
}

/** The privat run: mail, news and the privat messages, as before KC-0226. */
function startPrivat(
  d: RoomDeps,
  c: { o: { nyheder: string[] | null; nyhederStempel?: string; personer?: string }; state: KuratorState; input: Awaited<ReturnType<typeof nyeMails>>; dyb: boolean; beskeder: KuratorBesked[]; regler: ReglerLaest | undefined; v: object | null; now: Date },
): RunRecord {
  const { o, state, input, dyb, beskeder, regler, v, now } = c;
  const spec = buildKuratorRun({
    mails: input.mails,
    nyheder: o.nyheder,
    aabne: state.kort,
    lukket: state.lukket ?? [],
    dyb,
    now,
    stier: { vault: d.vaultRod, ...(o.personer ? { personer: o.personer } : {}) },
    ...(regler ? { regler } : {}),
    ...(v ? { mailKilde: 'forbindelse' as const } : {}),
    vaerktoejer: d.hermes.harVaerktoejer,
    ...(beskeder.length ? { beskeder } : {}),
  });

  return d.runs.start({
    kind: 'kurator',
    room: HJEM,
    zone: 'privat',
    label: dyb ? kuratorTekst().labelKuratorGrundigt : kuratorTekst().labelKurator,
    spec,
    onDone: async (output) => {
      let skjulte: Skjult[] = [];
      const raa = parseKuratorSvar(extractJson(output)); // throws SvarFejl: one correction by Hermes (KC-0050), else the run fails; nothing is written
      // KC-0259: a button the agent proposed anyway is dropped (below); the room log says so, one line per card.
      const fjernede = d.hermes.harVaerktoejer ? [] : [...raa.nye, ...raa.opdater].filter((k) => k.handling);
      // Inside the chain: Henrik may have dismissed a card or undone a row while Hermes thought, and
      // no button can write between our merge and our write.
      const ny = await endreKurator(d.store, async (nu) => {
        // KC-0138: a card on a message gets the app's sender line; a beskedId this run did not send (nor a stored card of this zone) is dropped.
        const foer = nu.kort.filter((k) => zoneAf(k) === KORSEL);
        const svar = { ...raa, nye: kortUdenVaerktoej(knytBeskeder(raa.nye, beskeder, foer), d.hermes.harVaerktoejer), opdater: kortUdenVaerktoej(knytBeskeder(raa.opdater, beskeder, foer), d.hermes.harVaerktoejer), intet: medGyldigRegel(raa.intet, regler) };
        // Merge first: only a card that stays on screen gets a ledger row (and so an undo button).
        const merged = await skrivRegninger(d, mergeKort(nu, svar, d.now(), KORSEL), new Set([...svar.nye, ...svar.opdater].map((k) => k.id)));
        const stamp = d.now().toISOString();
        skjulte = skjulteFra(merged.intet.filter((i) => !nu.intet.includes(i)), stamp);
        const s: KuratorState = { ...merged, cursor: input.cursor, sete: input.sete, sidst: stamp };
        if (dyb) s.sidstDyb = stamp;
        if (beskeder.length) s.beskederSete = seteEfter(nu.beskederSete ?? [], beskeder);
        // Only a successful run marks the news as seen (a failed one re-reads it next time).
        if (o.nyheder !== null && o.nyhederStempel) s.nyhederSet = o.nyhederStempel;
        return s;
      });
      for (const k of fjernede) await d.store.appendLog(HJEM, { kilde: 'system', tekst: kuratorTekst().logHandlingFjernet(k.titel.slice(0, 80)) });
      // KC-0145: what this run kept off the screen, as the app's own record (the Sunday sample counts these).
      if (d.skjulte && skjulte.length) await d.skjulte.noter(skjulte).catch((err: unknown) => console.error('skjulte:', err instanceof Error ? err.message : err));
      d.live.notify(HJEM);
      return { text: kuratorTekst().kortTal(ny.kort.length) };
    },
  });
}

/**
 * KC-0226: a run over one other zone. It sends that zone's new messages and open cards and nothing else; its cards are
 * stored with the zone set (so Nu draws the chip and `synligFor` decides who sees them); the other zones' stored cards
 * stay as they are (mergeKort). It stamps only what it read (`beskederSete`): the mail cursor, the seen mail, the news
 * stamp, the deep-run day and `sidst` are the privat run's, so a quiet zone never delays the privat schedule.
 * Its intet lines stay in Hjem's state (with the zone) but are not recorded for the Sunday sample, which is privat.
 */
function startZone(d: RoomDeps, zone: DataZone, beskeder: KuratorBesked[], state: KuratorState, now: Date): RunRecord {
  const spec = buildKuratorRun({
    mails: [], nyheder: null, aabne: state.kort, lukket: state.lukket ?? [], dyb: false, now, stier: { vault: d.vaultRod }, zone, beskeder,
  });
  const run = d.runs.start({
    kind: 'kurator',
    room: HJEM,
    zone,
    label: kuratorTekst().labelKuratorZone(zoneOrd(zone).toLowerCase()),
    spec,
    onDone: async (output) => {
      const raa = parseKuratorSvar(extractJson(output), zone); // an element naming another zone is a SvarFejl: corrected once, else the run fails and nothing is written
      let lagt = 0;
      const ny = await endreKurator(d.store, async (nu) => {
        // A card of this zone can take a sender line only from this run's messages or a stored card of this same zone.
        const foer = nu.kort.filter((k) => zoneAf(k) === zone);
        const svar = { ...raa, nye: knytBeskeder(raa.nye, beskeder, foer), opdater: knytBeskeder(raa.opdater, beskeder, foer), intet: medGyldigRegel(raa.intet, undefined) };
        const merged = mergeKort(nu, svar, d.now(), zone);
        const egne = new Set(merged.kort.filter((k) => zoneAf(k) === zone).map((k) => k.id));
        lagt = [...svar.nye, ...svar.opdater].filter((k) => egne.has(k.id)).length;
        return { ...merged, beskederSete: seteEfter(nu.beskederSete ?? [], beskeder) };
      });
      // The room log (only when a card came out of it: a quiet zone adds no line) and the audit line both name the zone.
      if (lagt > 0) await d.store.appendLog(HJEM, { kilde: 'hermes', zone, tekst: kuratorTekst().logZoneKort(zoneOrd(zone), lagt) });
      await d.revision?.skriv({
        person: d.person.id, kanal: 'planlagt', rum: HJEM, verb: 'laes', udfald: 'tillad', ...(run ? { runId: run.id } : {}), zoner: [zone], kilde: 'kurator',
        hvorfor: `Kuratoren læste ${beskeder.length === 1 ? 'én besked' : `${beskeder.length} beskeder`} i zonen ${zone}.`,
      }).catch((err: unknown) => console.error('kurator: revisionslinjen kunne ikke skrives:', err instanceof Error ? err.message : err));
      d.live.notify(HJEM);
      return { text: kuratorTekst().kortTal(ny.kort.length) };
    },
  });
  return run;
}
