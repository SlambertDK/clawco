-- 0018 loginkode kode (KC-0246): the sign-in mail also carries a short one-time code, for a person who asks for the mail on
-- one device and opens it on another. Not destructive (two new columns on loginkode).
-- Invariants: the code is derived from the link token (so a page opened by the link can show it) and is stored only as a
-- salted SHA-256 (the salt is the row's own link hash), never in clear; `forsoeg` counts the tries made with a code against
-- this login, and the fifth wrong one spends the whole login (link and code), so a new mail is needed. A row from before
-- this migration has no `kode_hash` and can only be used by its link.

ALTER TABLE loginkode
  ADD COLUMN kode_hash text CHECK (kode_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN forsoeg smallint NOT NULL DEFAULT 0;
