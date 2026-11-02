// The connector framework (KC-0132, spec §5 `src/kilder/<id>/`, D5, D6, D9):
// one model for every source of data — calendar, mail, notes, news, messages —
// so a new connector lands without touching the rooms. A connector has an id,
// a zone, an auth kind, read(), optional act() through declared verbs, an
// onboarding card and a health check. Depends on nothing in src/ but the
// identity zone/person types and the policy layer's verb list.
//
// The data shapes restate what the rooms read today (they import nothing from
// src/rooms); test/kilder/former.test.ts fails typecheck if they drift.

import type { DataZone } from '../identitet/zoner.ts';
import type { Verb } from '../graenser/verber.ts';

export const SLAGS = ['kalender', 'mail', 'noter', 'nyheder', 'beskeder'] as const;
export type Slags = (typeof SLAGS)[number];
export const AUTH = ['oauth', 'apikey', 'local', 'bridge'] as const;
export type Auth = (typeof AUTH)[number];
export const HELBRED = ['ok', 'snart-udloebet', 'log-ind-igen', 'nede', 'langsomt'] as const;
export type HelbredStatus = (typeof HELBRED)[number];

/** A connector id: lowercase, digits and dashes — also a safe file name for its secrets. */
export const KILDE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const erSlags = (v: unknown): v is Slags => typeof v === 'string' && (SLAGS as readonly string[]).includes(v);

/** kalender: the JSON scripts/kalender_uge.py prints (events as the script writes them; Dagen's trimUge trims). */
export type KalenderData = { generated: string; days: { date: string; events: Record<string, unknown>[] }[]; errors: string[] };
/** mail: an envelope as src/rooms/mail/source.ts reads it — never a body. */
export type Kuvert = { id: string; emne: string; fra: string; fraEmail?: string; modtaget: string; laest: boolean; flag: boolean; vedhaeftning: boolean; messageId?: string };
/** nyheder: RaaNyhed and KildeStatus of src/rooms/nyheder/source.ts. */
export type Nyhed = { titel: string; kilde: string; url?: string; resume?: string; udgivet?: string };
export type NyhedsStatus = { antal: number; medNyheder: number; nyheder: number; fejlede: string[] };
export type NyhederData = { nyheder: Nyhed[]; status: NyhedsStatus };
/** noter (KC-0136): names, relations and note titles only — no note bodies. */
export type NoterData = { personer: { navn: string; relation: string; mappe: string }[]; noter: { titel: string; sti: string; aendret: string }[] };
/**
 * beskeder (KC-0138): text cut to 500 characters; attachments never read (name and type only). `samtaleId` is a hash
 * key and `afsender.navn` a person, a display name or "ukendt afsender" — never a phone number or handle. `id` is
 * stable per message; `zone` is the one the user chose for its conversation.
 */
export type Besked = {
  kanal: string; samtaleId: string; samtaleNavn: string; afsender: { navn: string; personId?: string }; tid: string; tekst: string; laest: boolean;
  id?: string; zone?: DataZone; vedhaeftning?: { navn: string; type: string }[];
};

export type SlagsData = { kalender: KalenderData; mail: Kuvert[]; nyheder: NyhederData; noter: NoterData; beskeder: Besked[] };

/** What read() returns: trimmed input for a room. `uklar: true` = untrusted content (D6); the prompt builder wraps it. */
export type Laesning = { [S in Slags]: { slags: S; hentet: string; uklar: true; data: SlagsData[S] } }[Slags];

/** A declared action: its verb on the policy layer's ladder (never pay, send to others, delete or cross zones). */
export type VerbSpec = { verb: Verb; tekst: string };

/**
 * A field on the onboarding card. `hemmelig` values go to the secret module, never to kilder.json. `muligheder`
 * (KC-0136): the only values the field accepts, each with its label; `forslag`: values to offer (e.g. the vaults
 * found on the machine) without limiting what may be typed.
 */
export type Felt = {
  navn: string; etiket: string; type: 'tekst' | 'hemmelig' | 'mappe' | 'fil'; paakraevet: boolean; maks?: number;
  /** KC-0137: `fil` = the card asks for a file and sends its text (up to `maks` characters). `flere` = several values, one per line (line breaks allowed). */
  flere?: boolean;
  /** KC-0137: a stored option the card never shows and a connect body may never carry — only opsaet() sets it (e.g. a feed list), up to `maks`. */
  skjult?: boolean;
  muligheder?: { vaerdi: string; etiket: string }[]; forslag?: string[];
  /** KC-0133: an app-level key (TILLADTE_NOEGLER, e.g. KC_GOOGLE_CLIENT_ID) the value is set as in the host's env file — never kilder.json or the source's secret file. */
  miljoe?: string;
};
/**
 * The onboarding card Start renders (data only, no HTML): title, text, fields, the button's label, and an optional trigger.
 * `trin` (KC-0133): a setup to walk through one step at a time before the fields make sense; `kopier` is a value
 * shown ready to copy (e.g. the redirect address a provider must be told).
 */
export type KildeKort = { titel: string; tekst: string; felter: Felt[]; handling: string; trigger?: string; trin?: { tekst: string; kopier?: string }[] };
/** `udloeber` (KC-0139): when the access is known to expire (ISO), e.g. an app-level token; within 48 h the health state reads snart-udloebet. */
export type Helbred = { status: HelbredStatus; tekst?: string; udloeber?: string };
/** KC-0120: a working source — ok, or still reading while its access expires soon. Only a working source is read. */
export const virker = (h: Helbred | null): boolean => h?.status === 'ok' || h?.status === 'snart-udloebet';
/**
 * What act() answers. `fortryd` (KC-0214): how the connector undoes what it just did — a declared action and its
 * arguments (e.g. the moved mail's new UID); the room stores it on the log line and Fortryd runs it through handl().
 */
export type Resultat = { ok: boolean; tekst: string; fortryd?: { navn: string; args: Record<string, string> } };

/** What a connector gets on every call: the clock, its zone and options, and its own secrets (never another's). */
export type KildeKontekst = {
  nu: Date;
  zone: DataZone;
  valg: Readonly<Record<string, string>>;
  hemmelighed(): Promise<Record<string, string> | null>;
  /**
   * KC-0135: whether another connector is connected (a yes or no, never its options or secrets) — so a connector on the
   * same provider can say "already connected: only X is missing". Absent (a bare test context) = nothing else is.
   */
  erForbundet?(id: string): Promise<boolean>;
};

export interface Kilde {
  id: string;
  navn: string;
  slags: Slags;
  /** The zone it reads into unless kilder.json says otherwise. */
  zone: DataZone;
  auth: Auth;
  /** Untrusted-content tag (KC-0123). Every source is untrusted; the field exists so E7 can rely on it. Absent = 'uklar'. */
  tillid?: 'uklar';
  /** 'forbundet': connected by the host's own setup (a legacy adapter) until disconnected in kilder.json. */
  standard?: 'forbundet';
  read(ctx: KildeKontekst): Promise<Laesning>;
  /** Declared actions by name, e.g. { flyt: { verb: 'sorter', … } }. act() is only ever called with one of these. */
  verber?: Readonly<Record<string, VerbSpec>>;
  act?(navn: string, args: unknown, ctx: KildeKontekst): Promise<Resultat>;
  kort(ctx: KildeKontekst): Promise<KildeKort>;
  helbred(ctx: KildeKontekst): Promise<Helbred>;
  /**
   * KC-0136, not for oauth: prepares the source with the chosen options before it is recorded (e.g. creates the
   * notes folder). Returns the options to store (only the card's non-secret fields) and a sentence for the log;
   * a KildeFejl refuses the connection and nothing is recorded.
   */
  opsaet?(ctx: KildeKontekst): Promise<{ tekst: string; valg: Record<string, string> }>;
  /** KC-0133: on disconnect, before its credentials are removed — e.g. revoke the grant at the provider. Best effort: a failure still disconnects. */
  frakobl?(ctx: KildeKontekst): Promise<void>;
  /** auth 'oauth': the provider's consent URL for `state`, and the code it sends back (for that state) turned into credentials. */
  oauth?: {
    start(state: string, tilbage: string, ctx: KildeKontekst): Promise<{ url: string }>;
    tilbage(kode: string, ctx: KildeKontekst, state: string): Promise<Record<string, string>>;
  };
}

/** A connector refusal with the HTTP status a route answers (fail closed: 400/403/404/409, 502 when the source fails). */
export class KildeFejl extends Error {
  readonly status: 400 | 403 | 404 | 409 | 502;
  constructor(status: 400 | 403 | 404 | 409 | 502, besked: string) { super(besked); this.name = 'KildeFejl'; this.status = status; }
}
