-- 0005 hemmeligheder (KC-0181): one data key (DEK) per tenant, stored only wrapped under the master
-- key (sky/src/hemmeligheder/kuvert.ts). Not destructive (a new schema and a new table only).
-- Invariants: Postgres never holds an unwrapped DEK (an envelope is exactly nonce 12 + key 32 + tag 16
-- bytes of AES-256-GCM output); a deleted tenant's envelope is kept until its purge date (30 days, the
-- backup retention) and then destroyed (kuvert NULL), after which nothing of that tenant can be opened.
-- Rows are never deleted: a destroyed row is the tombstone proving the key is gone. The tenant id is
-- the fleet's tenant name (the same slug format as fleet/flaade.ts TENANT_ID).
CREATE SCHEMA hemmeligheder;

CREATE TABLE hemmeligheder.tenant_noegle (
  tenant text PRIMARY KEY CHECK (tenant ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  kuvert bytea CHECK (kuvert IS NULL OR octet_length(kuvert) = 60),
  -- The master key version the envelope is wrapped under (bumped by roter-masternoegle).
  kek_version integer NOT NULL CHECK (kek_version >= 1),
  status text NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv', 'slettet')),
  oprettet timestamptz NOT NULL,
  roteret timestamptz,
  slettet_ved timestamptz,
  destrueres timestamptz,
  destrueret timestamptz,
  CHECK ((status = 'aktiv') = (slettet_ved IS NULL)),
  CHECK ((slettet_ved IS NULL) = (destrueres IS NULL)),
  CHECK ((kuvert IS NULL) = (destrueret IS NOT NULL)),
  CHECK (destrueret IS NULL OR status = 'slettet')
);
CREATE INDEX tenant_noegle_purge ON hemmeligheder.tenant_noegle(destrueres) WHERE destrueret IS NULL;
