-- 0002 konti (KC-0177): accounts, passkeys, single-use login links, sessions, WebAuthn challenges
-- and rate-limit counters. Not destructive (new tables only).
-- Invariant: no column holds anything that logs a person in on its own. Link tokens and session ids
-- are stored as SHA-256 only; passkeys store the public key; challenges are useless without the
-- authenticator's private key.

CREATE TABLE konto (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL once the account is deleted (the row stays as a tombstone so billing can refer to the id).
  email text UNIQUE CHECK (email = lower(email)),
  oprettet timestamptz NOT NULL,
  slettet_ved timestamptz,
  -- Staff (KC-0188): made by sky/scripts/goer-personale.ts only, passkey only, never by sign-up.
  personale boolean NOT NULL DEFAULT false,
  CHECK ((email IS NULL) = (slettet_ved IS NOT NULL))
);

CREATE TABLE passkey (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  konto_id bigint NOT NULL REFERENCES konto(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  taeller bigint NOT NULL,
  transports text[] NOT NULL DEFAULT '{}',
  navn text NOT NULL,
  oprettet timestamptz NOT NULL,
  sidst_brugt timestamptz
);
CREATE INDEX passkey_konto ON passkey(konto_id);

CREATE TABLE loginkode (
  hash text PRIMARY KEY,
  email text NOT NULL,
  -- SHA-256 of the browser-binding cookie set when the link was requested (defeats login CSRF).
  binding text NOT NULL,
  oprettet timestamptz NOT NULL,
  udloeber timestamptz NOT NULL,
  brugt timestamptz
);
CREATE INDEX loginkode_email ON loginkode(email);

CREATE TABLE session (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hash text NOT NULL UNIQUE,
  konto_id bigint NOT NULL REFERENCES konto(id) ON DELETE CASCADE,
  oprettet timestamptz NOT NULL,
  sidst_set timestamptz NOT NULL,
  udloeber timestamptz NOT NULL,
  -- When the person last proved who they are (passkey or link); "fresh" = within 5 minutes.
  autentificeret timestamptz NOT NULL,
  metode text NOT NULL CHECK (metode IN ('passkey', 'link')),
  enhed text NOT NULL DEFAULT '',
  csrf text NOT NULL
);
CREATE INDEX session_konto ON session(konto_id);

CREATE TABLE udfordring (
  udfordring text PRIMARY KEY,
  formaal text NOT NULL CHECK (formaal IN ('registrering', 'login')),
  konto_id bigint REFERENCES konto(id) ON DELETE CASCADE,
  udloeber timestamptz NOT NULL
);

CREATE TABLE graense (
  -- A SHA-256 of "<kind>:<email or IP>", never the identifier itself.
  noegle text NOT NULL,
  vindue timestamptz NOT NULL,
  antal integer NOT NULL,
  PRIMARY KEY (noegle, vindue)
);
