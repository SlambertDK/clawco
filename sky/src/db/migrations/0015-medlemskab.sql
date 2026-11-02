-- 0015 medlemskab (KC-0184, spec D12): household members by invitation. Not destructive (two new tables only).
-- Invariants: only the tenant's owner creates, cancels, changes or removes a membership (the owner is
-- flaade.tenant.ejer_konto_id and never a row here); a membership exists only after the invited address was
-- verified (the accepting account's email equals the invitation's); an invitation token is stored as SHA-256 only,
-- lives 7 days and is spent once; an account belongs to at most one household (multi-household is out of scope).

CREATE TABLE medlemskab (
  -- No ON DELETE: an account row is a tombstone, never deleted (0002); deletion removes the membership itself.
  konto_id bigint NOT NULL REFERENCES konto(id),
  tenant_id text NOT NULL CHECK (tenant_id ~ '^hus-[a-z2-7]{8}$'),
  rolle text NOT NULL CHECK (rolle IN ('medlem', 'barn', 'gaest')),
  -- The name the household knows the person by (husstand.json's navn): one line, at most 80 characters.
  navn text NOT NULL CHECK (length(navn) BETWEEN 1 AND 80 AND navn !~ '[\r\n]'),
  oprettet timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, konto_id),
  UNIQUE (konto_id)
);

CREATE TABLE invitation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SHA-256 hex of the 32 random bytes in the link; the link itself is never stored.
  hash text NOT NULL UNIQUE CHECK (hash ~ '^[0-9a-f]{64}$'),
  tenant_id text NOT NULL CHECK (tenant_id ~ '^hus-[a-z2-7]{8}$'),
  -- The owner who wrote it.
  inviteret_af bigint NOT NULL REFERENCES konto(id),
  email text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  navn text NOT NULL CHECK (length(navn) BETWEEN 1 AND 80 AND navn !~ '[\r\n]'),
  rolle text NOT NULL CHECK (rolle IN ('medlem', 'barn', 'gaest')),
  -- The owner's name as the mail shows it ("<inviterer> har inviteret dig").
  inviterer text NOT NULL CHECK (length(inviterer) BETWEEN 1 AND 80 AND inviterer !~ '[\r\n]'),
  oprettet timestamptz NOT NULL,
  -- NULL while it is a draft the owner is looking at; set by the owner's own click on Send.
  sendt timestamptz,
  udloeber timestamptz NOT NULL CHECK (udloeber > oprettet),
  brugt timestamptz,
  brugt_af bigint REFERENCES konto(id),
  annulleret timestamptz,
  -- A resend: the invitation this one replaces (cancelled when this one is sent).
  erstatter bigint REFERENCES invitation(id) ON DELETE SET NULL,
  CHECK ((brugt IS NULL) = (brugt_af IS NULL))
);
CREATE INDEX invitation_tenant ON invitation(tenant_id);
CREATE INDEX invitation_email ON invitation(email);
