-- 0001 grundlag (KC-0176): the migration ledger. Not destructive.
-- Every later migration starts with a header like this one; a destructive one (drop, delete,
-- narrowing a type) says "DESTRUCTIVE — Henrik said yes on <date>" or it is not merged.
CREATE TABLE schema_version (
  version integer PRIMARY KEY,
  navn text NOT NULL,
  anvendt timestamptz NOT NULL DEFAULT now()
);
