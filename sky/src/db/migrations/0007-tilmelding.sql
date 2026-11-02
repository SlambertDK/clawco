-- 0007 tilmelding (KC-0198): what sign-up asks on the account and how long it took. Not destructive (new
-- nullable columns only; existing rows keep NULL, which the flow reads as "not asked yet").
-- The account's country (drives currency and tax later, KC-0194) and language (KC-0170).
ALTER TABLE konto ADD COLUMN land text CHECK (land ~ '^[A-Z]{2}$');
ALTER TABLE konto ADD COLUMN sprog text CHECK (sprog IN ('da', 'en'));
-- The consent versions accepted (from config/samtykke.json) and when; a newer version asks again.
ALTER TABLE konto ADD COLUMN vilkaar_version text;
ALTER TABLE konto ADD COLUMN privatliv_version text;
ALTER TABLE konto ADD COLUMN samtykke_ved timestamptz;
-- Account created → its tenant klar, in milliseconds; written once, at the first klar (budget 120 s p95).
ALTER TABLE konto ADD COLUMN tilmelding_ms integer CHECK (tilmelding_ms >= 0);
