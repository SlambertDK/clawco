-- 0019 model (KC-0264): the included Calm model, through Sky's own model proxy. Not destructive (a new schema, one new
-- table in an existing schema, nothing changed or dropped).
-- Invariants: a tenant's model token is never stored, only its SHA-256 (the token is derived from the tenant's data key,
-- hemmeligheder/modeltoken.ts, and delivered to the container's private tmpfs after every start); a revoked token stays
-- as a row with `tilbagekaldt` set and never matches again; `generation` is bumped by a rotation (a new token, the old
-- one stops matching at once). The ledger holds one row per call with token counts and a price, never a prompt, an
-- answer or any other content; rows are appended, never updated. The tenant id is the fleet's random slug (hus-xxxxxxxx),
-- which names no person.
CREATE TABLE hemmeligheder.model_token (
  tenant text PRIMARY KEY CHECK (tenant ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  hash text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  oprettet timestamptz NOT NULL,
  roteret timestamptz,
  tilbagekaldt timestamptz
);

CREATE SCHEMA model;

CREATE TABLE model.forbrug (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kald_id uuid NOT NULL UNIQUE,
  tenant text NOT NULL CHECK (tenant ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  -- The UTC month the call counts against, as its first day.
  maaned date NOT NULL CHECK (extract(day FROM maaned) = 1),
  model text NOT NULL CHECK (char_length(model) <= 80),
  udbyder text NOT NULL CHECK (char_length(udbyder) <= 30),
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  cache_laes_tokens bigint NOT NULL CHECK (cache_laes_tokens >= 0),
  cache_skriv_5m_tokens bigint NOT NULL CHECK (cache_skriv_5m_tokens >= 0),
  cache_skriv_1t_tokens bigint NOT NULL CHECK (cache_skriv_1t_tokens >= 0),
  pris_mikro_usd bigint NOT NULL CHECK (pris_mikro_usd >= 0),
  tid timestamptz NOT NULL
);
CREATE INDEX forbrug_tenant_maaned ON model.forbrug (tenant, maaned);
CREATE INDEX forbrug_tid ON model.forbrug (tid);
