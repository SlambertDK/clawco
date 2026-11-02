// The state shape of the room Mail and the validator for Hermes' answer.
// Hermes proposes decisions per mail in Folders/Handling; the app adds the
// numbers and the "ordnet" list deterministically and never trusts the
// client's text for a handling.

import { SchemaError, type Handling } from '../dagen/schema.ts';
import type { OrdnetPost } from './source.ts';
import { parseVisuel, type Visuel } from '../../shell/visuel.ts';
import { ZoneFejl, zoneFra, synligFor, type DataZone, type Zoneret } from '../../identitet/zoner.ts';
import type { Person } from '../../identitet/husstand.ts';
import { agentGulv, verbFra } from '../../graenser/verber.ts';
import { mailTekst } from './tekster.ts';

/** KC-0117: every source of this room is privat until the source registry (KC-0120) gives zones. */
export const KORSEL: DataZone = 'privat';

export type Mulighed = Handling;

export const MAIL_TYPER = ['svar', 'aktion', 'info', 'nyhedsbrev', 'regning', 'kvittering'] as const;
export type MailType = (typeof MAIL_TYPER)[number];
export const MAPPER = ['Archive', 'Folders/Afventer', 'Folders/Måske', 'Folders/Regninger', 'Folders/køb', 'Folders/vigtige docs', 'Folders/Handling'] as const;

export type Beslutning = {
  mailId: string;
  emne: string;
  fra: string;
  modtaget: string;
  type: MailType;
  resume: string;
  betydning: string;
  frist?: string;
  udkast?: string;
  arkivmappe: string;
  muligheder: Mulighed[];
  afgjort?: { mulighedId: string; tid: string };
  /** KC-0059: pictogram, headline and picture the decision is read from. */
  visuel?: Visuel;
} & Zoneret;

export type Ordnet = { mailId: string; emne: string; fra: string; til: string; hvorfor: string; tid: string; handling: Handling } & Zoneret;

export type MailState = {
  dato: string;
  genereret: string;
  tal: { handling: number; afventer: number; regninger: number; sorteretIDag: number };
  beslutninger: Beslutning[];
  ordnet: Ordnet[];
  hermesStatus: string;
  /** KC-0214: the mail connector the room was built from (its name); absent = Hermes' himalaya path. Then there is no Send. */
  forbindelse?: string;
  /** KC-0223: the connection can only read (Gmail): the room offers no Færdig, draft or Send, and the actions refuse. */
  laeseKun?: true;
};

export type OrdnetInput = OrdnetPost & { emne?: string; fra?: string };
export type MailFacts = { tal: MailState['tal']; ordnet: OrdnetInput[] };

const MAX_BESLUTNINGER = 20;
const MAX_MULIGHEDER = 2;
const HANDLING = 'Folders/Handling';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const optStr = (v: unknown, max = 400): string | undefined => { const s = str(v, max); return s ? s : undefined; };

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'm';
}

/** The app's own handling for a mail Kira sorted today: move it back to Handling. */
export function ordnetHandling(o: OrdnetInput): Handling {
  return {
    id: `ordnet-${o.mailId}`,
    label: 'Fortryd',
    instruktion: `Flyt mail ${o.mailId} ("${o.emne ?? ''}") fra ${o.til} tilbage til ${HANDLING}: himalaya message move --from "${o.til}" --to "${HANDLING}" ${o.mailId}`,
    fortryd: `Flyt mail ${o.mailId} fra ${HANDLING} til ${o.til} igen: himalaya message move --from "${HANDLING}" --to "${o.til}" ${o.mailId}`,
  };
}

function mulighed(v: unknown, mailId: string, i: number): Mulighed | null {
  if (!isObj(v)) return null;
  const label = str(v['label'], 80);
  const instruktion = str(v['instruktion'], 2000);
  if (!label || !instruktion) return null;
  const rawId = str(v['id'], 40) || slug(label) || String(i + 1);
  const id = `${mailId}-${slug(rawId)}`;
  const fortryd = optStr(v['fortryd'], 2000);
  const m: Mulighed = fortryd ? { id, label, instruktion, fortryd } : { id, label, instruktion };
  if (v['tilAndre'] === true) m.tilAndre = true;
  m.verb = verbFra(v['verb'], agentGulv(m));
  return m;
}

export function parseMailState(raw: unknown, facts: MailFacts, now: Date, previous?: MailState | null): MailState {
  if (!isObj(raw)) throw new SchemaError('Mail: svaret er ikke et objekt');
  const prevAfgjort = new Map<string, NonNullable<Beslutning['afgjort']>>();
  const prevUdkast = new Map<string, string>();
  const prevVisuel = new Map<string, Visuel>();
  for (const b of previous?.beslutninger ?? []) { if (b.afgjort) prevAfgjort.set(b.mailId, b.afgjort); if (b.udkast) prevUdkast.set(b.mailId, b.udkast); if (b.visuel) prevVisuel.set(b.mailId, b.visuel); }

  const list = Array.isArray(raw['beslutninger']) ? raw['beslutninger'] : [];
  const beslutninger: Beslutning[] = [];
  for (const b of list) {
    if (!isObj(b)) continue;
    const mailId = str(b['mailId'], 40);
    if (!mailId) continue;
    const muligheder: Mulighed[] = [];
    const rawM = Array.isArray(b['muligheder']) ? b['muligheder'] : [];
    rawM.forEach((m, i) => { const x = mulighed(m, mailId, i); if (x && muligheder.length < MAX_MULIGHEDER && !muligheder.some((y) => y.id === x.id)) muligheder.push(x); });
    const betydning = str(b['betydning'], 500);
    if (!betydning) throw new SchemaError(`Mail ${mailId}: betydning mangler`);
    const typeRaw = str(b['type'], 20).toLowerCase();
    const type = (MAIL_TYPER as readonly string[]).includes(typeRaw) ? (typeRaw as MailType) : 'info';
    const mappeRaw = str(b['arkivmappe'], 60);
    const arkivmappe = (MAPPER as readonly string[]).includes(mappeRaw) ? mappeRaw : 'Archive';
    let zone: DataZone;
    try { zone = zoneFra(b['zone'], KORSEL); } catch (e) { if (e instanceof ZoneFejl) throw new SchemaError(`Mail ${mailId}: ${e.message}`); throw e; }
    const post: Beslutning = {
      zone,
      mailId,
      emne: str(b['emne'], 200) || mailTekst().udenEmne,
      fra: str(b['fra'], 120) || mailTekst().ukendtAfsender,
      modtaget: str(b['modtaget'], 40),
      type,
      resume: str(b['resume'], 400),
      betydning,
      arkivmappe,
      muligheder,
    };
    const frist = optStr(b['frist'], 40); if (frist) post.frist = frist;
    const udkast = prevUdkast.get(mailId) ?? optStr(b['udkast'], 4000); if (udkast) post.udkast = udkast;
    const visuel = parseVisuel(b['visuel']) ?? prevVisuel.get(mailId); if (visuel) post.visuel = visuel;
    const prev = prevAfgjort.get(mailId); if (prev) post.afgjort = prev;
    beslutninger.push(post);
    if (beslutninger.length >= MAX_BESLUTNINGER) break;
  }

  const ordnet: Ordnet[] = facts.ordnet.map((o) => ({
    zone: KORSEL, mailId: o.mailId, emne: o.emne ?? '', fra: o.fra ?? '', til: o.til, hvorfor: o.hvorfor, tid: o.tid, handling: ordnetHandling(o),
  }));

  return {
    dato: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now),
    genereret: now.toISOString(),
    tal: { ...facts.tal },
    beslutninger,
    ordnet,
    hermesStatus: str(raw['hermesStatus'], 80) || mailTekst().foelger,
  };
}

/**
 * KC-0117: the room as `person` may see it — mails and ordnet items `synligFor` denies are gone. The folder counts
 * (`tal`) are the owner's privat numbers (no ejer): a person who may not see privat gets zeros, so the counts match the screen.
 */
export function synligMail(state: MailState, person: Person): MailState {
  return {
    ...state,
    tal: synligFor(person, { zone: KORSEL }) ? state.tal : { handling: 0, afventer: 0, regninger: 0, sorteretIDag: 0 },
    beslutninger: state.beslutninger.filter((b) => synligFor(person, b)),
    ordnet: state.ordnet.filter((o) => synligFor(person, o)),
  };
}

/** Every handling a click may name: each mulighed and each ordnet Fortryd. */
export function handlingerIMail(state: MailState): Map<string, Handling> {
  const m = new Map<string, Handling>();
  for (const b of state.beslutninger) for (const x of b.muligheder) m.set(x.id, x);
  for (const o of state.ordnet) m.set(o.handling.id, o.handling);
  return m;
}

/** KC-0097: an undecided informational mail or receipt with nothing to do but Færdig (no mulighed of its own). */
export function kunFaerdig(b: Beslutning): boolean {
  return !b.afgjort && (b.type === 'info' || b.type === 'kvittering') && b.muligheder.length === 0;
}

/** Undecided mails. */
export function venterMail(state: MailState | null): number {
  return state ? state.beslutninger.filter((b) => !b.afgjort).length : 0;
}
