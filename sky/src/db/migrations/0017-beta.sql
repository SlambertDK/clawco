-- 0017 beta (KC-0203): the closed beta with ten households. Not destructive (a new schema with new tables only).
-- Invariants: an invitation code is never stored, only its SHA-256, an expiry and its state; a code is spent once;
-- nothing here holds tenant content except the feedback line a person wrote and sent on purpose (at most 500
-- characters). The measures from a tenant (first-value time, things that needed the person per day) exist only for
-- a household that ticked "Som betatester deler jeg disse tal"; the retention days are what the gateway itself saw
-- (a date per household, no content) and exist for every beta household. Deleting an account deletes its rows
-- here (konto/slet.ts); the invitation row stays as a spent code with no account named.
CREATE SCHEMA beta;

CREATE TABLE beta.invitation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SHA-256 hex of the code; the code itself is printed once by the operator's script and never stored.
  hash text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  oprettet timestamptz NOT NULL,
  udloeber timestamptz NOT NULL CHECK (udloeber > oprettet),
  brugt timestamptz,
  -- No ON DELETE: an account row is a tombstone, never deleted (0002). Set to NULL when the account is deleted.
  brugt_af bigint REFERENCES konto(id),
  annulleret timestamptz,
  CHECK (brugt_af IS NULL OR brugt IS NOT NULL)
);

-- One row per household (its owner's account) per UTC day on which the gateway let a member through.
CREATE TABLE beta.set (
  konto_id bigint NOT NULL REFERENCES konto(id),
  dag date NOT NULL,
  PRIMARY KEY (konto_id, dag)
);

-- One row per beta household: the consent given at redemption (and kept current by what the tenant reports), and
-- the three timings the tenant reports with consent. Cleared when consent is withdrawn.
CREATE TABLE beta.maal (
  konto_id bigint PRIMARY KEY REFERENCES konto(id),
  samtykke boolean NOT NULL,
  hentet timestamptz,
  tilmelding_ms integer CHECK (tilmelding_ms >= 0),
  kilde_forbundet_ms integer CHECK (kilde_forbundet_ms >= 0),
  foerste_vaerdi_ms integer CHECK (foerste_vaerdi_ms >= 0)
);

-- "Ting der krævede dig": a count per household and UTC day, reported with consent. A number, never an element.
CREATE TABLE beta.dagtal (
  konto_id bigint NOT NULL REFERENCES konto(id),
  dag date NOT NULL,
  kraever integer NOT NULL CHECK (kraever >= 0),
  PRIMARY KEY (konto_id, dag)
);

-- The answers to the cards on day 3, 7 and 14 (the person sends them on purpose, also without consent for numbers).
CREATE TABLE beta.feedback (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  konto_id bigint NOT NULL REFERENCES konto(id),
  dag smallint NOT NULL CHECK (dag IN (3, 7, 14)),
  vurdering smallint NOT NULL CHECK (vurdering BETWEEN 1 AND 5),
  tekst text CHECK (char_length(tekst) <= 500),
  -- Day 14 only: would you pay the draft prices (G5, KC-0169).
  betale text CHECK (betale IN ('ja', 'maaske', 'nej')),
  tid timestamptz NOT NULL,
  UNIQUE (konto_id, dag)
);
