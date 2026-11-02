-- 0016 mailvalg (KC-0200): whether an account wants the tips mail (the day-3 "getting started?" mail), and the hash of
-- the one-click unsubscribe link that mail carries (RFC 8058). Not destructive (one new table).
-- Invariants: no row = tips are on (the default); the row holds no address and no content; the unsubscribe token is
-- stored as SHA-256 only and can do one thing (turn tips off for its own account); a new link replaces the previous
-- hash. Service mails (welcome, trial ending, billing) are never governed by this row. A deleted account's row goes
-- with it (konto/slet.ts).

CREATE TABLE mailvalg (
  -- No ON DELETE: an account row is a tombstone, never deleted (0002).
  konto_id bigint PRIMARY KEY REFERENCES konto(id),
  tips boolean NOT NULL,
  afmeld_hash text UNIQUE CHECK (afmeld_hash ~ '^[0-9a-f]{64}$'),
  opdateret timestamptz NOT NULL
);
