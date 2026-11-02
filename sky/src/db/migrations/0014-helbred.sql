-- 0014 helbred (KC-0189): the status feed's history. Not destructive (new tables in the existing drift schema only).
-- Every minute the poller (drift/helbred/poller.ts) asks each klar tenant's /health over the private network and
-- judges each status component; those raw rows are kept 7 days, rolled into one row per component per day kept 90
-- days. The daily job (drift/helbred/historik.ts rydOp) deletes older rows and logs the counts (AGENTS §4 r5).
-- Invariants: the public feed is derived from these tables and never carries a tenant slug, address, account or
-- email; a tenant measurement holds no content (state, latency, the sha /health reported); a mail result holds an
-- outcome code, never a recipient or a template's data.

-- One row per tenant per pass. tilstand: sund (ok, the expected sha, fast), traeg (slow), syg (no answer, ok false or
-- a wrong sha), opdaterer (a rollout step is active for it, KC-0186).
CREATE TABLE drift.helbred_maaling (
  tid timestamptz NOT NULL,
  tenant text NOT NULL CHECK (tenant ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  tilstand text NOT NULL CHECK (tilstand IN ('sund', 'traeg', 'syg', 'opdaterer')),
  ok boolean NOT NULL,
  ms integer CHECK (ms >= 0),
  sha text CHECK (sha ~ '^[0-9a-f]{7,64}$'),
  PRIMARY KEY (tid, tenant)
);

-- One row per component per pass (the same tid as the pass's measurements).
CREATE TABLE drift.helbred_komponent (
  tid timestamptz NOT NULL,
  komponent text NOT NULL CHECK (komponent IN ('login', 'adgang', 'oprettelse', 'sikkerhedskopi', 'mail', 'clawco')),
  status text NOT NULL CHECK (status IN ('ok', 'nedsat', 'nede')),
  PRIMARY KEY (tid, komponent)
);

-- One row per component per whole UTC day: passes per status, and the expected passes that never happened (ukendt).
CREATE TABLE drift.helbred_dag (
  dag date NOT NULL,
  komponent text NOT NULL CHECK (komponent IN ('login', 'adgang', 'oprettelse', 'sikkerhedskopi', 'mail', 'clawco')),
  ok integer NOT NULL CHECK (ok >= 0),
  nedsat integer NOT NULL CHECK (nedsat >= 0),
  nede integer NOT NULL CHECK (nede >= 0),
  ukendt integer NOT NULL CHECK (ukendt >= 0),
  PRIMARY KEY (dag, komponent)
);

-- The outcome of every mail Sky sends (KC-0178's Post seam, wrapped in server.ts): ok, or the PostFejl code.
CREATE TABLE drift.helbred_post (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tid timestamptz NOT NULL,
  ok boolean NOT NULL,
  kode text CHECK (kode ~ '^[a-z-]{1,24}$'),
  CHECK (ok = (kode IS NULL))
);
CREATE INDEX helbred_post_tid ON drift.helbred_post(tid);

-- The operator's incidents (sky/scripts/haendelse.mjs): plain text, shown in the public feed.
CREATE TABLE drift.helbred_haendelse (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titel text NOT NULL CHECK (char_length(titel) BETWEEN 1 AND 120),
  tekst text NOT NULL CHECK (char_length(tekst) BETWEEN 1 AND 2000),
  start timestamptz NOT NULL,
  slut timestamptz CHECK (slut IS NULL OR slut >= start),
  oprettet timestamptz NOT NULL
);
