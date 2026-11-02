# Sky's master key (KC-0181)

Sky holds one **master key** (`SKY_MASTERNOEGLE` in `/srv/sky/.env`). It locks every customer's own
key, and those lock each customer's model keys, disk and backups. Without the master key Sky does
not start, and no customer's data or backup can be opened again — not even by us. So there must be
one sealed copy outside the server.

The key is made on the server and never shown to an agent (`sky/scripts/ny-masternoegle.sh` prints
its name and length only). Only Henrik ever sees it, once, for the copy below.

## Henrik's one step (once, and again after every rotation)

In the terminal on the Mac, run:

```bash
ssh -t -i ~/.ssh/kira-home henrik@kira-home "sudo -u sky grep '^SKY_MASTERNOEGLE' /srv/sky/.env"
```

Copy the line(s) it prints into a new Bitwarden item named **Clawco Sky masternøgle** (with today's
date and the `SKY_MASTERNOEGLE_VERSION` number), print the item once and put the paper somewhere
safe, then close the terminal window. Never paste it into a chat.

## For the agent

- **First time:** `sky/scripts/ny-masternoegle.sh` (refuses if a key exists), restart Sky, ask
  Henrik for the step above.
- **Rotation** (a suspected leak, or yearly): `ny-masternoegle.sh --roter` → restart Sky →
  `node --env-file=/srv/sky/.env sky/scripts/roter-masternoegle.ts` on the host (one transaction;
  a crash changes nothing; rerun until it says 0 left) → `ny-masternoegle.sh --afslut` → restart →
  Henrik's step again. Keep the old copy for 30 days: backups of Sky's own database from before
  the rotation hold the customers' keys locked with the old master key.
- **Restore from the escrow copy:** `sky/scripts/saet-hemmelighed.sh SKY_MASTERNOEGLE` (Henrik
  pastes it into the hidden prompt), the same for `SKY_MASTERNOEGLE_VERSION`, restart Sky.
- Never print, grep or log the key; scripts say name and length only (AGENTS §9).
