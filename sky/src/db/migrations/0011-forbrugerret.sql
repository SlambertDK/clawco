-- 0011 forbrugerret (KC-0209): what a purchase recorded about the consumer's rights, the withdrawal requests
-- (Forbrugeraftaleloven § 20 a) and the refund tasks the owner works by hand. Not destructive (new tables only).
-- Invariants: no e-mail address, no card data and no free text from a person is stored here (the rows are kept
-- after an account is deleted, konto/beholdt.ts); a refund is never made by code: refusion_opgave is a to-do for
-- the owner, who refunds in Stripe himself.

-- One row per Checkout the person started from the statement page: what they were shown and what they ticked.
CREATE TABLE abonnement.bestilling (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  konto_id bigint NOT NULL REFERENCES konto(id),
  checkout_session text NOT NULL UNIQUE,
  plan text NOT NULL,
  interval text NOT NULL CHECK (interval IN ('maaned', 'aar')),
  -- The price shown on the statement, in øre (from config/priser.json), and whether the order is a free trial.
  pris_oere integer NOT NULL CHECK (pris_oere > 0),
  valuta text NOT NULL DEFAULT 'dkk',
  proeve boolean NOT NULL,
  -- The version of the terms the person accepted with the first checkbox, and when.
  vilkaar_version text NOT NULL,
  vilkaar_samtykke_ved timestamptz NOT NULL,
  -- The second checkbox: the express request to start at once, with the loss of the withdrawal right explained.
  straks_start_samtykke_ved timestamptz NOT NULL,
  sprog text NOT NULL CHECK (sprog IN ('da', 'en')),
  oprettet timestamptz NOT NULL,
  -- Set when Stripe says the Checkout completed: the subscription and the day the agreement began (the 14 days run from it).
  stripe_abonnement text,
  startet timestamptz,
  kvittering_sendt timestamptz,
  -- The period end a renewal reminder was last sent for (an annual plan), so one period gets one reminder.
  paamindet_for timestamptz
);
CREATE INDEX bestilling_konto ON abonnement.bestilling(konto_id);
CREATE INDEX bestilling_abonnement ON abonnement.bestilling(stripe_abonnement);

-- One withdrawal request per order ("Fortryd aftale"): recorded first, then the subscription is cancelled.
CREATE TABLE abonnement.fortrydelse (
  bestilling_id bigint PRIMARY KEY REFERENCES abonnement.bestilling(id),
  konto_id bigint NOT NULL REFERENCES konto(id),
  tidspunkt timestamptz NOT NULL,
  brugte_dage integer NOT NULL CHECK (brugte_dage >= 0),
  periode_dage integer NOT NULL CHECK (periode_dage > 0),
  -- The proportional amount to give back, in øre (0 for a trial: nothing was paid).
  tilbage_oere integer NOT NULL CHECK (tilbage_oere >= 0),
  opsagt_ved timestamptz,
  kvittering_sendt timestamptz
);

-- The owner's to-do: refund this order in Stripe by hand, then mark it done. Never executed by code.
CREATE TABLE abonnement.refusion_opgave (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bestilling_id bigint NOT NULL UNIQUE REFERENCES abonnement.bestilling(id),
  konto_id bigint NOT NULL REFERENCES konto(id),
  beloeb_oere integer NOT NULL CHECK (beloeb_oere > 0),
  valuta text NOT NULL DEFAULT 'dkk',
  oprettet timestamptz NOT NULL,
  -- Due: the refund is promised within 14 days of the withdrawal.
  forfald timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'aaben' CHECK (status IN ('aaben', 'udfoert')),
  udfoert_ved timestamptz
);
CREATE INDEX refusion_opgave_status ON abonnement.refusion_opgave(status);
