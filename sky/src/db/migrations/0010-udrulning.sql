-- 0010 udrulning (KC-0186): rolling a new tenant image out in cohorts. Not destructive (two new columns with
-- defaults on flaade.tenant, three new tables in drift).
-- Invariants: a tenant counts as upgraded only when its own /health reported the release's sha (the row's
-- tilstand `opgraderet` is written only after that); a tenant is never upgraded without a restore point (its id
-- is on the row before the container is touched); at most one rollout is active at a time; a tenant appears at
-- most once per rollout (no tenant upgraded twice, none skipped silently: every row ends in a named state).

-- The tenant's cohort: intern (the operator's own test tenant), kanari (about 5 %), alle. New tenants: alle.
ALTER TABLE flaade.tenant ADD COLUMN hold text NOT NULL DEFAULT 'alle' CHECK (hold IN ('intern', 'kanari', 'alle'));
-- Set while the tenant's container is being replaced: the gateway shows "Opdaterer, et øjeblik" instead of an error.
ALTER TABLE flaade.tenant ADD COLUMN opdateres timestamptz;

-- A release: a local tenant image tag (clawco:<sha>), the image id it pointed at when recorded (tenants run the
-- id, never the tag) and the git sha the image's /health reports. A tag that later points elsewhere is refused.
CREATE TABLE drift.udgave (
  tag text PRIMARY KEY CHECK (tag ~ '^[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9._-]+$'),
  sha text NOT NULL CHECK (sha ~ '^[0-9a-f]{7,40}$'),
  billede_id text NOT NULL CHECK (billede_id ~ '^sha256:[0-9a-f]{64}$'),
  oprettet timestamptz NOT NULL
);

CREATE TABLE drift.udrulning (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  udgave text NOT NULL REFERENCES drift.udgave(tag),
  tilstand text NOT NULL CHECK (tilstand IN ('koerer', 'standset', 'tilbagerulles', 'faerdig', 'tilbagerullet')),
  -- The cohort being rolled out now, and when its last tenant became healthy on the new sha (the soak start).
  hold text NOT NULL CHECK (hold IN ('intern', 'kanari', 'alle')),
  hold_faerdig timestamptz,
  -- Why it halted (a slug and the short error), for the operator.
  grund text,
  startet timestamptz NOT NULL,
  opdateret timestamptz NOT NULL,
  slut timestamptz,
  -- The lease of the one operator command working on it (a second one refuses until it has expired).
  laast_til timestamptz,
  laast_af text
);
CREATE UNIQUE INDEX udrulning_aktiv ON drift.udrulning ((true)) WHERE tilstand IN ('koerer', 'standset', 'tilbagerulles');

CREATE TABLE drift.udrulning_tenant (
  udrulning bigint NOT NULL REFERENCES drift.udrulning(id),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  hold text NOT NULL CHECK (hold IN ('intern', 'kanari', 'alle')),
  nr integer NOT NULL,
  tilstand text NOT NULL CHECK (tilstand IN ('venter', 'igang', 'opgraderet', 'tilbagerullet', 'fejlet', 'sprunget-over')),
  -- What it ran before (image id and the sha its /health reported): the rollback target.
  fra_billede text CHECK (fra_billede ~ '^sha256:[0-9a-f]{64}$'),
  fra_sha text,
  -- The restore point taken right before the upgrade: snapshot id, the store it is in, when it was pruned.
  genopret text CHECK (genopret ~ '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$'),
  genopret_lager text CHECK (genopret_lager IN ('r2', 'lokal')),
  genopret_ryddet timestamptz,
  startet timestamptz,
  slut timestamptz,
  fejl text,
  PRIMARY KEY (udrulning, slug)
);
