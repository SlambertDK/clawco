-- 0004 fleet (KC-0182): one row per tenant (a customer's own Clawco container), its state in the
-- provisioning machine and one timestamp per step. Not destructive (a new schema and a new table only).
-- Invariants: a tenant is in exactly one state; it has exactly one slug, random and never reused (rows are
-- never deleted: a deprovisioned tenant stays as a `slettet` tombstone, which is also what proves to the
-- reconciler that leftover Docker objects with its label are ours to remove); an owner has at most one
-- live tenant.
CREATE SCHEMA flaade;

CREATE TABLE flaade.tenant (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^hus-[a-z2-7]{8}$'),
  -- No ON DELETE: an account row is a tombstone, never deleted (0002).
  ejer_konto_id bigint NOT NULL REFERENCES konto(id),
  -- The fleet driver that made it (SKY_FLAADE): lokal for the beta on kira-home, hetzner later (D18).
  driver text NOT NULL CHECK (driver IN ('lokal', 'hetzner')),
  tilstand text NOT NULL CHECK (tilstand IN ('bestilt', 'startet', 'sund', 'i-gateway', 'klar', 'afvikles', 'slettet')),
  -- One timestamp per step; the time budget (bestilt → klar under two minutes) is read from these.
  bestilt timestamptz NOT NULL,
  startet timestamptz,
  sund timestamptz,
  i_gateway timestamptz,
  klar timestamptz,
  afvikles timestamptz,
  slettet timestamptz,
  -- The tenant image it runs and the release sha its /health reported.
  billede text,
  release text,
  -- Where the edge reaches it (a private address on the tenant network; never public). NULL once deleted.
  adresse text,
  -- The last failed step's error (no secrets: Docker's and fetch's own short messages), and the count.
  fejl text,
  fejl_ved timestamptz,
  forsoeg integer NOT NULL DEFAULT 0,
  oprettet timestamptz NOT NULL,
  opdateret timestamptz NOT NULL
);
CREATE UNIQUE INDEX tenant_ejer_levende ON flaade.tenant(ejer_konto_id) WHERE tilstand <> 'slettet';
CREATE INDEX tenant_tilstand ON flaade.tenant(tilstand);
