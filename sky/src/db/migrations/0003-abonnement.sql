-- 0003 abonnement (KC-0191, KC-0192): the Stripe customer per account, the webhook event ledger,
-- the entitlement per account and its outbox. Not destructive (a new schema and new tables only).
-- Invariants: no card data and no Stripe object bodies are stored; only webhooks write Stripe-sourced
-- entitlements; a gift (kilde = 'gave', KC-0203) is written by an admin script only.
CREATE SCHEMA abonnement;

-- One Stripe customer per account, made on the first Checkout. No ON DELETE: an account row is a
-- tombstone, never deleted (0002), so billing can always refer to it.
CREATE TABLE abonnement.kunde (
  konto_id bigint PRIMARY KEY REFERENCES konto(id),
  stripe_kunde text NOT NULL UNIQUE,
  -- ISO 3166 code asked on the plan page (KC-0191), never guessed from an IP address.
  land text NOT NULL CHECK (land ~ '^[A-Z]{2}$'),
  -- Set once a subscription of this customer has had a trial: cancel and re-buy cannot farm trials.
  proeve_brugt boolean NOT NULL DEFAULT false,
  -- The account's newest Checkout Session; a new one expires it (two tabs, two plans → one session).
  aaben_checkout text,
  oprettet timestamptz NOT NULL
);

-- Every webhook event id seen, inserted in the same transaction as its processing (idempotency).
CREATE TABLE abonnement.stripe_haendelser (
  id text PRIMARY KEY,
  type text NOT NULL,
  modtaget timestamptz NOT NULL
);

CREATE TABLE abonnement.rettigheder (
  konto_id bigint PRIMARY KEY REFERENCES konto(id),
  kilde text NOT NULL CHECK (kilde IN ('stripe', 'gave')),
  plan text NOT NULL,
  status text NOT NULL CHECK (status IN ('proeve', 'aktiv', 'forfalden', 'pause', 'opsagt', 'ingen')),
  medlemmer_max integer NOT NULL CHECK (medlemmer_max >= 0),
  proeve_slutter timestamptz,
  periode_slutter timestamptz,
  opsiges timestamptz,
  forfalden_siden timestamptz,
  skrivebeskyttet boolean NOT NULL,
  stripe_abonnement text,
  opdateret timestamptz NOT NULL
);

-- The outbox (KC-0192): one row per change of an entitlement. Fleet (E10), KC-0196 and KC-0200 poll
-- it; billing never calls them.
CREATE TABLE abonnement.rettigheds_haendelser (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  konto_id bigint NOT NULL REFERENCES konto(id),
  fra jsonb,
  til jsonb NOT NULL,
  grund text NOT NULL,
  haendelse_id text,
  tidspunkt timestamptz NOT NULL
);
CREATE INDEX rettigheds_haendelser_konto ON abonnement.rettigheds_haendelser(konto_id);
