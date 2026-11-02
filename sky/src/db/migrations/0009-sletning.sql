-- 0009 sletning (KC-0206): the "Hent alt" link and the deletion receipt. Not destructive (new tables only).
-- Invariants: an export link is stored as SHA-256 only, belongs to one account and lives 24 hours (the zip is
-- built when the link is opened, so no copy of anyone's data is ever stored here); a deleted account's links
-- go with it. A receipt row holds no email, no slug and no content: a hash of the account id, when, the role,
-- what was kept and why (sky/src/konto/beholdt.ts) and the date the backups are gone. Receipts are never changed.

CREATE TABLE eksportlink (
  hash text PRIMARY KEY CHECK (hash ~ '^[0-9a-f]{64}$'),
  -- No ON DELETE: an account row is a tombstone, never deleted (0002); deletion removes the links itself.
  konto_id bigint NOT NULL REFERENCES konto(id),
  oprettet timestamptz NOT NULL,
  udloeber timestamptz NOT NULL,
  CHECK (udloeber > oprettet)
);
CREATE INDEX eksportlink_konto ON eksportlink(konto_id);

CREATE TABLE sletkvittering (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SHA-256 hex of "clawco-konto:<id>" (konto/beholdt.ts kontoHash).
  konto_hash text NOT NULL CHECK (konto_hash ~ '^[0-9a-f]{64}$'),
  slettet_ved timestamptz NOT NULL,
  rolle text NOT NULL CHECK (rolle IN ('ejer', 'medlem', 'alene')),
  -- What was kept and why, as the list stood at the time of deletion.
  beholdt jsonb NOT NULL,
  -- The latest date any backup holding the account is gone (deletion + 30 days).
  kopier_vaek timestamptz NOT NULL,
  CHECK (kopier_vaek > slettet_ved)
);
