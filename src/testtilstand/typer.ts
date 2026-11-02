// The contract between the test world's story (indhold.ts) and its engine
// (skriv.ts, ur.ts, the world builder). Types only. Lifted from the demo's
// typer.ts (KC-0058); KC-0068.

import type { ChatEntry, LogEntry } from '../store/types.ts';
import type { Husstand } from '../identitet/husstand.ts';
import type { PauseTilstand } from '../graenser/nodstop.ts';
import type { Revision } from '../graenser/revisionslog.ts';
import type { KilderKonfig } from '../kilder/register.ts';
import type { Profil } from '../store/profil.ts';
import type { Settings } from '../settings.ts';
import type { Post } from '../kilder/helbred.ts';
import type { Dagstal } from '../tillid/dagstal.ts';
import type { Skjult } from '../tillid/skjulte.ts';
import type { Stikbog } from '../tillid/stikproeve.ts';

/** One moment of the day the panel can jump to. */
export type Moment = {
  id: string;
  /** Copenhagen wall time "HH:MM". */
  tid: string;
  /** KC-0103: days after the story's day the clock is on (the next morning: 1); absent = the day itself. */
  dagPlus?: number;
  /**
   * KC-0147 / KC-0152: the clock is on the next such weekday (0 = Sunday … 6 = Saturday), 1–7 days after the story's day,
   * instead of `dagPlus` (Monday: Nu shows the week's number; Tuesday: the weekend card). See momentPlus.
   */
  ugedag?: number;
  /** Short Danish label for the panel, e.g. "Vågner". */
  navn: string;
  /** Where the browser lands after the jump, e.g. "/rum/hjem". */
  url: string;
  /** The line Henrik says to the voice at this moment; also what lyt() returns without a whisper model. */
  replik: string;
};

/** One room's files as the store keeps them (rum/<id>/state.json, log.jsonl, chat.jsonl). */
export type RumFroe = { state: unknown; log?: LogEntry[]; chat?: ChatEntry[] };

/** A himalaya `envelope list --json` row, as src/rooms/mail/source.ts reads it. */
export type Kuvert = Record<string, unknown>;

/** Everything a moment needs on disk, built for one test date. */
export type Froe = {
  /** Room id → files. Includes hjem, dagen, mail, nyheder, skrive, univers, univers-<slug>, nav. */
  rum: Record<string, RumFroe>;
  /** Folder name (e.g. "Folders/Handling", "Inbox") → envelopes the test mail runner returns. */
  mappe: Record<string, Kuvert[]>;
  /** The Dagen/Nyheder source file content (shape of test/fixtures/avis_data_sample.json); null = none (a cold start). */
  avis: unknown;
  /** The Hermes mail plan file content (shape of the dev plan fixture), or null for none. */
  mailPlan: unknown;
  /** KC-0116: husstand.json — one fictional person per role. */
  husstand: Husstand;
  /** KC-0124: pause.json for a paused moment; absent = Clawco runs. */
  pause?: PauseTilstand;
  /** KC-0124: the audit lines the moment starts with, oldest first (written through the audit log, so the chain holds). */
  revision?: Revision[];
  /** KC-0142: the rules file's text (<vault>/Clawco/regler.md); absent = no file. */
  regler?: string;
  /** KC-0147: dagstal.jsonl — one snapshot per past day (eight weeks and the current week so far); absent = a fresh install, no history. */
  dagstal?: Dagstal[];
  /** KC-0145: skjulte.jsonl — what the app kept off the screen; absent = nothing recorded. */
  skjulte?: Skjult[];
  /** KC-0145: stikproever.json — the Sunday sample's ledger; absent = none drawn. */
  stikproever?: Stikbog;
  /** KC-0132: kilder.json — which fake connectors are connected at this moment; absent = none. */
  kilder?: KilderKonfig;
  /** KC-0139: helbred.json — what the app remembers of each connected source's health; absent = nothing (all ok). */
  helbred?: Record<string, Post>;
  /** KC-0126: profil.json — Start's step 1 answered; absent = no profile. */
  profil?: Profil;
  /** KC-0127: indstillinger.json — Start's step 2 (provider, tier models, last live tests); absent = none. */
  indstillinger?: Settings;
  /** KC-0138: Hermes' gateway hook files under beskeder/ — the inbound log and the gateway status; absent = no hook. */
  beskeder?: { log: string; status: string };
};

/** What the scripted Hermes knows when it answers. */
export type SvarKontekst = { moment: Moment; dag: string };
