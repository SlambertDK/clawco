-- 0013 udsendte_mails (KC-0196; shared with KC-0200's welcome mails): which scheduled mail an account has had, so a
-- stage or a day sends exactly one mail per account however often the job runs, restarts or hears the same webhook.
-- Not destructive (one new table). Invariants: one row per (account, kind, key); the row holds no address, no
-- content and no link — only the kind (a template name) and a key the sender chose (e.g. the failed payment's time).
-- A claim (paataget) whose send never finished can be taken again after a while; `sendt` is set once and never
-- cleared. A deleted account's rows go with it (konto/slet.ts).

CREATE TABLE udsendte_mails (
  -- No ON DELETE: an account row is a tombstone, never deleted (0002).
  konto_id bigint NOT NULL REFERENCES konto(id),
  slags text NOT NULL CHECK (slags ~ '^[a-z][a-z0-9-]{0,39}$'),
  noegle text NOT NULL CHECK (length(noegle) BETWEEN 1 AND 100 AND noegle !~ '[\r\n]'),
  paataget timestamptz NOT NULL,
  sendt timestamptz,
  PRIMARY KEY (konto_id, slags, noegle)
);
