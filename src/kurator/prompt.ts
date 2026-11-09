// What we ask Hermes in a Kuratoren run (Hjem's recurring "what does this mean
// for Henrik" pass). Pure function: data in, { input, instructions } out. The
// answer is validated by rooms/hjem/kort.ts.

import path from 'node:path';
import type { RunSpec } from '../rooms/dagen/prompt.ts';
import { copenhagenDate, copenhagenTime } from '../rooms/dagen/source.ts';
import { KORSEL, MAX_KORT } from '../rooms/hjem/kort.ts';
import type { Kort, Lukning } from '../rooms/hjem/kort.ts';
import type { NyMail } from './input.ts';
import type { KuratorBesked } from '../rooms/module.ts';
import { PROJEKTER } from '../udvikling/projekter.ts';
import { visuelSkema } from '../shell/visuel.ts';
import { kuratorPromptTekst } from './prompt-tekster.ts';
import { byggPrompt } from '../agent/prompt.ts';
import { reglerTilPrompt } from '../tillid/prompt.ts';
import type { ReglerLaest } from '../tillid/lager.ts';
import { zoneAf, type DataZone, type Zoneret } from '../identitet/zoner.ts';

export type KuratorInput = {
  mails: NyMail[];
  /** Headlines from today's Nyheder state; null = no new news since the last run. */
  nyheder: string[] | null;
  aabne: Kort[];
  /** KC-0039: cards Henrik closed, newest first, with his reason. */
  lukket?: Lukning[];
  /** The daily deeper run that searches the web for advisories and model news. */
  dyb: boolean;
  now: Date;
  stier: { vault: string; personer?: string };
  /** KC-0142: Henrik's rules file as read for this run; absent = no rules (trin 0). */
  regler?: ReglerLaest;
  /** KC-0214: the mail came from the mail connector (envelopes only, no agent tools); absent = Hermes reads it with himalaya. */
  mailKilde?: 'forbindelse';
  /** KC-0259: whether the agent has tools (Hermes); false = the built-in agent: no web search, no card with a button that runs a tool. Absent = true. */
  vaerktoejer?: boolean;
  /** KC-0138: new messages from the conversations the user chose; absent or empty = none. */
  beskeder?: KuratorBesked[];
  /**
   * KC-0226: the one zone this run reads; absent = privat (the run it always was). A run over arbejde or husstand reads
   * that zone's messages and open cards only (no mail, news or ledger), and whatever else is handed in is left out:
   * two zones never share a prompt.
   */
  zone?: DataZone;
};

// KC-0241: the words are in prompt-tekster.ts, read at call time in the language of the run.

function regler(i: KuratorInput): string {
  const T = kuratorPromptTekst();
  // An empty vault path means the app does not know where the vault is: say so instead of a relative path.
  const v = (...dele: string[]) => i.stier.vault
    ? path.join(i.stier.vault, ...dele)
    : T.vaultUkendt(dele.join('/'));
  return T.regler({
    laes: i.mailKilde === 'forbindelse' ? T.laesForbindelse : T.laesHimalaya,
    projekter: v('30-Projekter', '_oversigt'), cloudflare: v('50-System', 'Cloudflare'), oekonomi: v('10-Privat', 'Økonomi'),
    personer: i.stier.personer ? T.personerLinje(i.stier.personer) : '',
    net: i.vaerktoejer === false ? T.ingenNet : T.net(i.dyb, v('50-System')),
    handling: i.vaerktoejer === false ? T.handlingUdenVaerktoejer : T.handlingMedVaerktoejer,
    udvikling: PROJEKTER.map((p) => `${p.navn} = "${p.id}"`).join(', '),
    maxKort: MAX_KORT,
    beskedLinje: i.beskeder?.length ? `- ${T.beskedRegel}\n` : '',
  });
}

/** KC-0259: without tools the card schema has no "handling" line (the field names are the same in both languages). */
const skemaTilAgent = (skema: string, vaerktoejer: boolean): string => (vaerktoejer ? skema : skema.split('\n').filter((l) => !/^\s*"handling":/.test(l)).join('\n'));

/** Sender name only: Kuratoren must never see or echo an address (KC-0023). */
function navn(fra: string): string {
  const at = fra.indexOf('@');
  return at === -1 ? fra : fra.slice(0, at).trim() || kuratorPromptTekst().ukendtAfsender;
}

/** What Hermes is told of an open card: enough to stand by it, not the whole card. */
const kompaktKort = (aabne: readonly Kort[]): Record<string, unknown>[] => aabne.map((k) => {
  const o: Record<string, unknown> = { id: k.id, type: k.type, titel: k.titel, betyder: k.betyder, anbefaling: k.anbefaling };
  if (k.gyldigTil) o['gyldigTil'] = k.gyldigTil;
  // The app wrote this bill's row (Henrik may have moved it): Hermes must not re-place it.
  if (k.skrevet) { const T = kuratorPromptTekst(); o['regnskab'] = T.skrevetI(T.hvor[k.skrevet.hvor] ?? ''); }
  if (k.udvikling) o['udvikling'] = k.udvikling;
  return o;
});

/** KC-0226: the elements of one zone (a missing stored zone reads as privat). */
const iZone = <T extends Zoneret>(liste: readonly T[], zone: DataZone): T[] => liste.filter((e) => zoneAf(e) === zone);
const beskederIZone = (b: readonly KuratorBesked[] | undefined, zone: DataZone): KuratorBesked[] => (b ?? []).filter((x) => (x.zone ?? 'privat') === zone);

export function buildKuratorRun(inp: KuratorInput): RunSpec {
  const zone = inp.zone ?? 'privat';
  if (zone !== 'privat') return buildZoneRun(inp, zone);
  // KC-0226: a privat run reads privat only, whatever it is handed: no stored card, closed card or message of another zone is shown to it.
  const i: KuratorInput = { ...inp, aabne: iZone(inp.aabne, 'privat'), lukket: iZone(inp.lukket ?? [], 'privat'), beskeder: beskederIZone(inp.beskeder, 'privat') };
  const T = kuratorPromptTekst();
  const kompakt = kompaktKort(i.aabne);
  const mails = i.mails.map((m) => ({ mappe: m.mappe, id: m.id, emne: m.emne, fra: navn(m.fra), modtaget: m.modtaget }));
  const tidslinje = T.tidslinje(copenhagenDate(i.now), copenhagenTime(i.now.toISOString()));
  const mailDel = mails.length ? T.nyeMails(mails.length, JSON.stringify(mails, null, 1)) : T.ingenMails;
  const nyhedDel = i.nyheder === null ? T.ingenNyheder : T.nyheder(i.nyheder.length, i.nyheder.map((t) => `- ${t}`).join('\n'));
  const kortDel = kompakt.length ? T.aabneKort(kompakt.length, JSON.stringify(kompakt, null, 1)) : T.ingenKort;
  const lukket = i.lukket ?? [];
  const lukDel = lukket.length ? T.lukkede(lukket) : '';
  const beskeder = (i.beskeder ?? []).map((b) => ({ id: b.id, kanal: b.kanal, samtale: b.samtaleNavn, fra: b.afsender.navn, tid: b.tid, tekst: b.tekst }));
  const beskedSegment = beskeder.length
    ? [{ kilde: 'beskeder', zone: KORSEL, tillid: 'utroet' as const, tekst: T.nyeBeskeder(beskeder.length, JSON.stringify(beskeder, null, 1)) }]
    : [];
  const opgave = T.opgave(T.rolle, T.henriksOrd, T.typer, skemaTilAgent(T.skema(PROJEKTER.map((p) => p.id).join(' | '), visuelSkema()), i.vaerktoejer !== false), regler(i));
  const tekst = `${tidslinje}\n\n${mailDel}\n\n${nyhedDel}\n\n${kortDel}${lukDel}`;
  return byggPrompt({ rum: 'kurator', zone: KORSEL, opgave, katalog: true, regler: reglerTilPrompt(i.regler), data: [{ kilde: 'mail', zone: KORSEL, tillid: 'utroet', tekst }, ...beskedSegment] });
}

// ---------- KC-0226: a run over one other zone (arbejde, husstand) ----------
// Reads that zone's messages and open cards only. No mail, news, ledger, vault lookups or Henrik's rules: those are
// privat-run material, and nothing of another zone may stand in this prompt (invariant, test/kurator/zoner.test.ts).

const zoneRolle = (zone: DataZone): string => { const T = kuratorPromptTekst(); return T.zoneRolle(zone, T.zoneSamtaler[zone] ?? ''); };

function buildZoneRun(inp: KuratorInput, zone: DataZone): RunSpec {
  const T = kuratorPromptTekst();
  const aabne = kompaktKort(iZone(inp.aabne, zone));
  const lukket = iZone(inp.lukket ?? [], zone);
  const beskeder = beskederIZone(inp.beskeder, zone).map((b) => ({ id: b.id, kanal: b.kanal, samtale: b.samtaleNavn, fra: b.afsender.navn, tid: b.tid, tekst: b.tekst }));
  const tidslinje = T.tidslinje(copenhagenDate(inp.now), copenhagenTime(inp.now.toISOString()));
  const kortDel = aabne.length ? T.aabneKort(aabne.length, JSON.stringify(aabne, null, 1)) : T.ingenKort;
  const lukDel = lukket.length ? T.lukkede(lukket) : '';
  const beskedDel = beskeder.length ? T.nyeBeskeder(beskeder.length, JSON.stringify(beskeder, null, 1)) : T.ingenBeskeder;
  const opgave = T.opgaveZone(zoneRolle(zone), T.zoneType, T.zoneSkema(visuelSkema()), T.zoneRegler({ zone, maxKort: MAX_KORT, beskedLinje: beskeder.length > 0 ? `- ${T.beskedRegel}\n` : '' }));
  return byggPrompt({
    rum: 'kurator', zone, opgave, katalog: true,
    data: [
      { kilde: 'ur', zone, tillid: 'betroet', tekst: tidslinje },
      { kilde: 'kort', zone, tillid: 'afledt', tekst: `${kortDel}${lukDel}` },
      { kilde: 'beskeder', zone, tillid: 'utroet', tekst: beskedDel },
    ],
  });
}
