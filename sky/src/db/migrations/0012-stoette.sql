-- 0011 stoette (KC-0188, spec D15): "Lad support se med" — the only way a Clawco staff member reaches a tenant. Not
-- destructive (two new tables and one new nullable column on gateway.kode).
-- Invariants: a grant is for one tenant, made by that tenant's owner, at most 24 hours long and off unless a row
-- says otherwise (no row = off; sign-up and provisioning write none); it ends by clock or by revoke and is never
-- extended; the first staff account that opens it is the only one that may use it; every grant, session start,
-- revoke and expiry is a row in stoette_haendelse with the staff account's id (never a path, query or content).

CREATE TABLE stoette_adgang (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The tenant (flaade.tenant.slug); one grant opens this one tenant only.
  tenant_id text NOT NULL CHECK (tenant_id ~ '^hus-[a-z2-7]{8}$'),
  -- The owner who turned it on. No ON DELETE: an account row is a tombstone (0002).
  givet_af bigint NOT NULL REFERENCES konto(id),
  givet timestamptz NOT NULL,
  udloeber timestamptz NOT NULL CHECK (udloeber > givet AND udloeber <= givet + interval '24 hours'),
  tilbagekaldt timestamptz,
  -- The owner's optional one-line reason (shown to staff and in the band's card; plain text).
  grund text NOT NULL DEFAULT '' CHECK (length(grund) <= 120 AND grund !~ '[\r\n]'),
  -- The staff account bound to it at first open; NULL until then.
  personale_konto_id bigint REFERENCES konto(id),
  -- When Sky's log recorded the expiry (once).
  udloeb_logget timestamptz
);
CREATE INDEX stoette_adgang_tenant ON stoette_adgang(tenant_id);

CREATE TABLE stoette_haendelse (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  adgang_id bigint NOT NULL REFERENCES stoette_adgang(id),
  tid timestamptz NOT NULL,
  slags text NOT NULL CHECK (slags IN ('givet', 'aabnet', 'tilbagekaldt', 'udloebet')),
  -- The owner (givet, tilbagekaldt) or the staff account (aabnet); NULL for an expiry.
  konto_id bigint REFERENCES konto(id)
);
CREATE INDEX stoette_haendelse_adgang ON stoette_haendelse(adgang_id);

-- A one-time code that opens a tenant as support carries its grant; the exchange checks the grant again.
ALTER TABLE gateway.kode ADD COLUMN stoette_id bigint REFERENCES stoette_adgang(id) ON DELETE CASCADE;
