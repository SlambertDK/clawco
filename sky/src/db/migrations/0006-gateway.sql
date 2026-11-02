-- 0006 gateway (KC-0183): the one-time codes that carry a login from the account app to a tenant's own
-- host. Not destructive (a new schema and a new table only). The route table is the fleet's own
-- flaade.tenant (state klar); the gateway's tenant session is a signed cookie tied to the Sky session, so
-- ending that session (log out, revoke, account deletion) ends tenant access at the next refresh.
-- Invariant: no column logs anyone in on its own — the code is stored as SHA-256 only, single use, 60 s.
CREATE SCHEMA gateway;

CREATE TABLE gateway.kode (
  hash text PRIMARY KEY,
  konto_id bigint NOT NULL REFERENCES konto(id) ON DELETE CASCADE,
  -- Logging out deletes the Sky session, and with it any code it had not yet spent.
  session_id bigint NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  slug text NOT NULL CHECK (slug ~ '^hus-[a-z2-7]{8}$'),
  -- The tenant path to land on after the exchange (relative, checked before it is stored).
  naeste text NOT NULL,
  oprettet timestamptz NOT NULL,
  udloeber timestamptz NOT NULL,
  brugt timestamptz
);
CREATE INDEX kode_udloeber ON gateway.kode(udloeber);
CREATE INDEX kode_slug ON gateway.kode(slug);
