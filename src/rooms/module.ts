// What every built room offers the server. Rooms never import each other;
// the server looks a room up by id (modules.ts) and calls these.

import type { AgentClient } from '../agent/types.ts';
import type { Sprog } from '../store/profil.ts';
import type { RumLager } from '../store/types.ts';
import type { RunRegistry, RunRecord } from '../runs.ts';
import type { Markup } from '../shell/html.ts';
import type { Naeste } from '../shell/naeste.ts';
import type { Runner } from './mail/source.ts';
import type { LiveBus } from '../live.ts';
import type { StemmeRum } from '../stemme/types.ts';
import type { Person } from '../identitet/husstand.ts';
import type { DataZone } from '../identitet/zoner.ts';
import type { Verb } from '../graenser/verber.ts';
import type { Revisionslog } from '../graenser/revisionslog.ts';
import type { ReglerLager } from '../tillid/lager.ts';
import type { SkjultLager } from '../tillid/skjulte.ts';
import type { ProfilLager } from '../store/profil.ts';
import type { ModelSyn, ModelTestSyn, Niveau } from './start/trin.ts';
import type { GithubLogin } from '../agent/github-enhed.ts';
import type { Inkluderet } from '../agent/inkluderet.ts';
import type { KalenderLaesning } from '../hushold/uge.ts';
import type { OptagetKalender } from '../hushold/konflikt.ts';
import type { IndkommendeBesked } from '../hushold/kanal.ts';
import type { RetBus } from './rethaendelse.ts';
import type { RegelSeam } from './start/regelforslag.ts';
import type { ImportSkriver } from './start/import/skriver.ts';
import type { KildeFriskhed } from '../shell/friskhed.ts';
import type { RssNyheder } from './nyheder/source.ts';
import type { TsSyn } from '../shell/tailscale.ts';

export type RoomDeps = {
  store: RumLager;
  hermes: AgentClient;
  runs: RunRegistry;
  now: () => Date;
  /** Dagen: where Kiras pipeline writes today's JSON ({date} placeholder). */
  dagenSourceGlob: string;
  /** Mail: Hermes' state dir with mail-plan-auto-*.json, and how to run himalaya. */
  mailStateDir: string;
  mailRunner: Runner;
  himalaya: string;
  /** Skrive: folder where "Gem i Obsidian" writes notes (Henrik's vault inbox). */
  vaultInbox: string;
  /** KC-0213: the one vault root every writer shares ('' = none known): the rules file, the ledgers, the inbox, the register. */
  vaultRod: string;
  /** KC-0213: the absolute file of the ledger `hvor` (the install's regnskab.json, else <vault>/Clawco/Regnskab/); '' without a vault root. */
  regnskabsfil: (hvor: 'shelfatlas' | 'privat') => string;
  /** Rooms notify after every change so open pages refresh themselves. */
  live: LiveBus;
  /** The meeting tick (univers/moedetik.ts): path to scripts/kalender_uge.py (empty = off). Dagen reads `ugeKalender`. */
  kalenderScript: string;
  /**
   * KC-0133: Dagen's week — the connected calendar source's read (`uge`: the kalender_uge.py JSON; a source the user
   * connected wins over the host's own), wired by the composition root (rooms import nothing from src/kilder).
   * `fraVaerten`: it is the host's own (kira-kalender), whose install has the morning paper — so it never builds the
   * day alone. null when none is connected or it cannot be read; absent = no week.
   */
  ugeKalender?: () => Promise<{ uge: unknown; fraVaerten: boolean } | null>;
  /**
   * KC-0139: how fresh the connected source of one slags is ('kalender', 'mail'), for the rooms that read one: its last
   * successful read and whether it works now. null = nothing to say (no connected source, or none read yet).
   */
  kildeFriskhed?: (slags: 'kalender' | 'mail') => Promise<KildeFriskhed | null>;
  /**
   * KC-0137: Nyheder's own feeds — the nyheder-rss connector's read, in the paper's shape, wired by the composition
   * root. null = the connector is not connected (the room is exactly as before); a connected one that cannot be
   * read answers an empty list, so the room never sends Hermes after a paper nobody set up.
   */
  rssNyheder?: () => Promise<RssNyheder | null>;
  /**
   * KC-0117: who is looking, for this request (identity middleware). Views, counts and the spoken overview show
   * only what `synligFor(person, element)` allows. Outside a request (timers) it is INGEN, who sees nothing private.
   */
  readonly person: Person;
  /** KC-0124: the audit log the policy port writes one line per decision to; absent = no audit (tests without a data dir). */
  revision?: Revisionslog;
  /** KC-0142: Henrik's rules file (<vault>/Clawco/regler.md), read fresh by every run that thinks; absent = no rules (trin 0). */
  regler?: ReglerLager;
  /** KC-0145: where the app records what it kept off the screen (the Sunday sample's count); absent = not recorded. */
  skjulte?: SkjultLager;
  /** KC-0126: the user's profile ($KC_DATA_DIR/profil.json); absent = no data dir, so no profile can be saved. */
  profil?: ProfilLager;
  /** KC-0126: what Start reads of the rest of the app, wired by the composition root (rooms import neither src/kilder nor src/kurator). Absent = nothing connected, journey not Done. */
  rejse?: RejseKilder;
  /** KC-0127: the model choice (indstillinger.json), wired by the composition root. Absent = no data dir, so step 2 cannot be saved. */
  model?: ModelVindue;
  /** KC-0148: the household universe's window on identity and the calendar connectors, wired by the composition root. Absent = single-user, no Husstanden. */
  husstand?: HusstandKilder;
  /**
   * KC-0214: the mail connector that can act (a Sky tenant: no Hermes tools), wired by the composition root (rooms
   * import nothing from src/kilder). null or absent = Hermes' himalaya path: the host's own mail source is connected
   * (Henrik's install), or no connected mail source can move and draft.
   */
  mailForbindelse?: () => Promise<MailForbindelse | null>;
  /**
   * KC-0138: the messages of the conversations the user chose on the Beskeder card (src/kilder/beskeder via the
   * registry, wired by the composition root). Read-only; never a phone number or handle. Absent = no message source.
   */
  beskeder?: () => Promise<KuratorBesked[]>;
  /** KC-0130: where a Ret / Ikke relevant is announced (Luk, and Hjem's chat about a card); Start's step 6 listens. Absent = nobody listens. */
  retBus?: RetBus;
  /** KC-0227: the rule proposals waiting for this person's answer, the list Nu's card is drawn from (wired in server.ts). Absent = Start shows the explanation card alone. */
  regelforslag?: RegelSeam;
  /** KC-0129: Start's step 5 writes people and the profile through the notes connector's writers, never itself. Absent = no import. */
  importSkriver?: ImportSkriver;
  /** KC-0160: laptop mode now (one person on this machine only): Start leaves the household question out. */
  laptop?: () => boolean;
  /** KC-0170: the screen's language before a profile exists (the installation's record, store/installation.ts); absent = Danish. */
  standardSprog?: () => Sprog;
  /** KC-0161: Start's window on the local Tailscale (read-only state, and the one share command on a tap), wired by the composition root. Absent = no card (Sky, no wiring). */
  tailscale?: TailscaleVindue;
  /** KC-0233: Start's Danmark-pakke step (Digital Post), wired by the composition root over src/danmark/vindue.ts. Absent = no step (no data dir). */
  danmark?: DanmarkVindue;
  /** KC-0129: the one folder raw uploads live in while a proposal is made (default `<os tmp>/clawco-import`); emptied when the proposals are saved or cancelled, and after an hour. */
  importTmp?: string;
};

/** KC-0138: src/kilder/types.ts's Besked as Kuratoren reads it (restated: rooms import nothing from src/kilder). */
export type KuratorBesked = { id?: string; kanal: string; samtaleNavn: string; afsender: { navn: string; personId?: string }; tid: string; tekst: string; zone?: DataZone };

/** KC-0214: src/kilder/mail-vindue.ts's MailVindue restated (server.ts assigning one to the other keeps them in step). */
export type MailForbindelse = {
  navn: string;
  /** KC-0223: false = a read-only connection (envelopes only): the room offers no move, draft or send. */
  kanHandle: boolean;
  /** The newest INBOX envelopes — never a body. */
  laes(): Promise<{ id: string; emne: string; fra: string; fraEmail?: string; modtaget: string; laest: boolean; flag: boolean; vedhaeftning: boolean; messageId?: string }[]>;
  /** One declared verb through the connector registry (policy layer + audit line). `fortryd`: how to undo it, the same way. */
  handl(navn: 'flyt' | 'kladde', args: Record<string, string>, i: { person: Person; kanal: 'knap' | 'stemme' | 'chat' | 'baggrund' }): Promise<{ ok: boolean; tekst: string; fortryd?: { navn: string; args: Record<string, string> } }>;
};

/** KC-0233: Start's window on the Digital Post rule (src/danmark/vindue.ts, restated: rooms import nothing from src/danmark). `gem` and `ikkeNu` throw ActionError with a plain sentence. */
export type DanmarkVindue = {
  /** The step while it is open (a mail source is connected, no sender confirmed, not put away); null = nothing to show. */
  start(): Promise<{ kandidater: string[]; laeser: 'ok' | 'kan-ikke-se'; viser: string; visere: { id: string; navn: string }[]; domaener: readonly string[] } | null>;
  /** Confirm the notification sender and the viewer; refuses an address that is not a Digital Post sender. */
  gem(afsender: string, viser: string): Promise<void>;
  ikkeNu(): Promise<void>;
  /** KC-0236: whether the Aula card in the Danmark-pakke group was put away less than 30 days ago, and the "Ikke nu" that puts it away. */
  aulaUdsat(): Promise<boolean>;
  aulaIkkeNu(): Promise<void>;
};

/** KC-0161: Start's window on Tailscale. The runner behind it only ever runs the three allow-listed commands (src/shell/tailscale.ts). */
export type TailscaleVindue = {
  /** The port the app listens on: what the one button shares, and what the posted body must name. */
  port: number;
  /** A laptop install (KC-0160): one user, loopback only; Start leaves the household question out. */
  laptop(): boolean;
  /** The state now, from the local CLI; never throws (`ukendt`). */
  laes(): Promise<TsSyn>;
  /** `tailscale serve --bg <port>` and the new state; throws TsFejl with a plain sentence. */
  del(): Promise<TsSyn>;
};

/** KC-0127: Start's window on the model settings. Clawco keeps no model key; that goes through the agent (AgentClient.saetModelNoegle). */
export type ModelVindue = {
  /** The provider, the tiers' models, each tier's last test and its current revision. */
  laes(): Promise<ModelSyn>;
  /** Sets the provider and both tiers' models (the same store as the Kø panel); runs use them at once. */
  vaelg(v: { udbyder: string; lille: string; taenker: string }): Promise<void>;
  saetTest(niveau: Niveau, t: ModelTestSyn): Promise<void>;
  /** Clawco's own key to Hermes (a keyless install, KC-0156): the env file and the process, so no restart is needed. */
  saetAgentNoegle(vaerdi: string): Promise<{ noegle: string; laengde: number }>;
  /** For model discovery at the provider (tests inject a stub; nothing in tests reaches the network). */
  fetchImpl?: typeof fetch;
  /** The live test's timeout (20 s). */
  testMs: number;
  /** KC-0263: "Sign in with GitHub" for the Copilot transport (only beside the built-in agent); absent = none. */
  github?: GithubLogin;
  /**
   * KC-0265: Clawco's AI included in a Sky plan (the model proxy's meter and what it last said); absent = this installation
   * does not have it, and Start never offers it (a self-hoster never sees it).
   */
  inkluderet?: Pick<Inkluderet, 'forbrug' | 'brugt' | 'utilgaengelig' | 'lyt'>;
};


/** KC-0148: what the household universe reads of the rest of the app (src/hushold imports neither src/kilder nor a room). */
export type HusstandKilder = {
  /** The persons of the household (E1 identity, husstand.json); empty = single-user. */
  personer(): Promise<Person[]>;
  /**
   * KC-0154: writes the household's persons (husstand.json, validated and atomic) — the owner's invite, role change and
   * removal, inside the room's queue. Absent = the household cannot be changed from here.
   */
  gemPersoner?(personer: Person[]): Promise<void>;
  /**
   * KC-0153: the go-between's inbound messages after a time (the channel client's read side only). Absent = no channel.
   * Sending is never reachable from here: only the human-tap route holds the client.
   */
  kanalSvar?(siden: string): Promise<IndkommendeBesked[]>;
  /** Every connected calendar as read, with its zone and who connected it; one that cannot be read is left out. */
  kalendere(): Promise<KalenderLaesning[]>;
  /**
   * KC-0152: every connected calendar of every zone, with whether its owner shares event titles with the household
   * (KC-0142's rule). Only the weekend check reads this, and it reduces what it reads to busy blocks at once
   * (blokkeFraKalendere); absent = no weekend check.
   */
  alleKalendere?(): Promise<OptagetKalender[]>;
  /** Whether Husstanden is there for the person looking (the Univers overview links to it then). */
  synlig(): Promise<boolean>;
};

/** KC-0126: Start's window on the rest of the app (spec §3 Done, and the connector registry for "worth adding"). */
export type RejseKilder = {
  /** The Done input: real elements Nu shows (Start's own lines not counted), and whether Ret or Ikke relevant was pressed once. */
  faerdigInput(): Promise<{ nuElementer: number; rettet: boolean }>;
  /** KC-0130: the first element in Nu that carries Ret (its title), for step 6's pointer; null = none. Absent = none. */
  foersteKort?(): Promise<{ titel: string } | null>;
  /** Every registered source and whether it is connected. */
  kilder(): Promise<{ id: string; navn: string; slags: string; forbundet: boolean }[]>;
  /** KC-0128: the onboarding cards Start renders for steps 3–4 (data, never HTML or a secret), with each connected source's health. */
  kort?(): Promise<KildeKortSyn[]>;
  /** What the connected mail sources read: subject and time only, never a body. */
  mail(): Promise<{ emne: string; modtaget: string }[]>;
};

/** KC-0128: a source's card as Start sees it — the registry's KildeKort restated (rooms do not import src/kilder). */
export type KildeKortSyn = {
  id: string; navn: string; slags: string; zone: DataZone; forbundet: boolean;
  /** Health of a connected source; null when not connected. `tekst` is the connector's own words. */
  helbred: { status: string; tekst?: string } | null;
  kort: {
    titel: string; tekst: string; handling: string;
    felter: { navn: string; etiket: string; type: 'tekst' | 'hemmelig' | 'mappe' | 'fil'; paakraevet: boolean; maks?: number; flere?: boolean; skjult?: boolean; muligheder?: { vaerdi: string; etiket: string }[]; forslag?: string[] }[];
    /** KC-0133: a setup to walk through one step at a time before the fields make sense; `kopier` = a value to copy. */
    trin?: { tekst: string; kopier?: string }[];
  };
};

export type RoomView = {
  main: Markup;
  hermesStatus: string;
  /** Page title when it is not the room's name (a univers shows its own name). */
  titel?: string;
  /** HTTP status of the page; absent = 200 (a univers that does not exist is 404 with a plain main; KC-0154: a page the role may not open is 403). */
  status?: 403 | 404;
};

export interface RoomModule {
  readonly id: string;
  /** KC-0117/KC-0122: the one zone this room's runs read. */
  readonly korsel: DataZone;
  /** KC-0122: the verb of every startAction name the room offers; a name missing here never runs. */
  readonly aktionVerber?: Readonly<Record<string, Verb>>;
  /** KC-0161: the startAction names that need a human tap (the red-button token bound to this exact press), though their verb is not a limit; the card's button carries data-kraever-ja. */
  readonly aktionTap?: readonly string[];
  /** KC-0122: the verb and zones of a handling in the stored state, as the person sees it; null = not there (nothing runs). */
  handlingVerb?(deps: RoomDeps, id: string): Promise<{ verb: string; zoner: DataZone[] } | null>;
  view(deps: RoomDeps): Promise<RoomView>;
  /** Start a rebuild; null when the mode is unknown for this room. */
  startOpdater(deps: RoomDeps, mode: string): Promise<RunRecord | null>;
  /** Null when the handling id is not in the stored state. */
  startHandling(deps: RoomDeps, id: string): Promise<RunRecord | null>;
  /** Null when the log entry cannot be undone. */
  startFortryd(deps: RoomDeps, logId: string): Promise<RunRecord | null>;
  startChat(deps: RoomDeps, besked: string, kontekst: string | undefined): Promise<RunRecord>;
  /** How many things wait for Henrik in this room. */
  venter(deps: RoomDeps): Promise<number>;
  /** One line per waiting thing, for Hjem. */
  hjemVenter(deps: RoomDeps): Promise<{ roomId: string; tekst: string }[]>;
  /** KC-0149: one line per thing the person started that waits on someone else (Nu's I gang band). */
  hjemIgang?(deps: RoomDeps): Promise<{ roomId: string; tekst: string }[]>;
  /** KC-0149: the room's clock (expiry, reminders), driven by startTik in scheduler.ts outside any request. */
  tik?(deps: RoomDeps): Promise<void>;
  /** KC-0088: the next appointment today, for Hjem's "Næste" line. Null = nothing left. */
  naeste?(deps: RoomDeps): Promise<Naeste | null>;
  /** Room-specific actions with a JSON body (POST /api/rum/:id/aktion/:name). Null = unknown action; throw ActionError for a 400. */
  startAction?(deps: RoomDeps, name: string, body: Record<string, unknown>): Promise<RunRecord | null>;
  /** A file the room can hand out (GET /rum/:id/dok/:name). Null = not found. */
  fil?(deps: RoomDeps, name: string): Promise<{ content: string; contentType: string; filename: string } | null>;
  /** The spoken view: what in this room suits voice (KC-0015). Rooms without it are silent in the overview. */
  stemme?(deps: RoomDeps): Promise<StemmeRum>;
}

/** A refused action: 400 by default; 403 = not this person's (KC-0149), 404 = not in the stored state, 409 = already settled. */
export class ActionError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409 = 400) { super(message); this.name = 'ActionError'; this.status = status; }
}
