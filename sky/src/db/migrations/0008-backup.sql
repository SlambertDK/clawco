-- 0008 backup (KC-0185): the state of the nightly copies and of the restore drills. Not destructive (a new
-- schema and new tables only). The copies themselves live encrypted in the R2 bucket; these rows say what was
-- taken and when, so Sky can show that no tenant is overlooked (counts only, never names in a status).
-- A scope (omfang) is a tenant slug (fleet/flaade.ts TENANT_ID) or `db` for Sky's own database.
-- Invariants: a snapshot row exists only after its object was uploaded; its manifest (file count + sha256,
-- taken at backup time) is what a restore drill compares with; a row is removed only together with its
-- object (30-day retention, or a deleted tenant's purge date); a drill row is never changed after it is written.
CREATE SCHEMA drift;

CREATE TABLE drift.kopi (
  omfang text PRIMARY KEY CHECK (omfang ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  oprettet timestamptz NOT NULL,
  sidste_forsoeg timestamptz,
  sidste_succes timestamptz,
  -- The last failed attempt's error (Docker's, pg_dump's or R2's own short message; never a key).
  sidste_fejl text,
  -- The newest good snapshot and its size in bytes (encrypted).
  snapshot text,
  bytes bigint CHECK (bytes >= 0)
);

CREATE TABLE drift.snapshot (
  omfang text NOT NULL REFERENCES drift.kopi(omfang),
  id text NOT NULL CHECK (id ~ '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$'),
  tid timestamptz NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  antal_filer integer NOT NULL CHECK (antal_filer >= 0),
  manifest text NOT NULL CHECK (manifest ~ '^[0-9a-f]{64}$'),
  -- The master key version a `db` dump is sealed under (0 for a tenant: its DEK never changes).
  kek_version integer NOT NULL DEFAULT 0 CHECK (kek_version >= 0),
  PRIMARY KEY (omfang, id)
);

CREATE TABLE drift.proeve (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  omfang text NOT NULL,
  snapshot text NOT NULL,
  startet timestamptz NOT NULL,
  slut timestamptz NOT NULL,
  ok boolean NOT NULL,
  -- The last step reached: hentet, aabnet, manifest, gendannet, sund, sammenlignet.
  trin text NOT NULL,
  fejl text
);
CREATE INDEX proeve_startet ON drift.proeve(startet);
