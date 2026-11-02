# Hermes on the host: what Clawco needs

Two things in Hermes' own setup make the messages work. Clawco installs neither; the host's owner (or the E6 install
script) does, and nothing here is needed for the rest of Clawco.

## Inbound messages (KC-0138, Path B)

The gateway hook `beskeder-hook.py` + `beskeder-hook.yaml` writes what reaches Hermes on Telegram, WhatsApp and
Signal to `$CLAWCO_DATA_DIR/beskeder/indgaaende.jsonl`. Install steps are in the hook's own docstring.

## The go-between's Send (KC-0153)

A request in Husstanden can go to a household member as a message on her channel. Clawco runs, once per human tap:

    $KC_HERMES_CLI send --to <telegram|whatsapp|signal>:<id> --file - --json --quiet   # the text on stdin

No model is involved (findings: `docs/superpowers/specs/2026-11-01-beskeder-gateway-fund.md` §5). On kira-home:

1. Clawco's env file (`~/kontrolcenter/.env`), two keys — the systemd unit's PATH lacks `~/.local/bin`:

       KC_KANAL=hermes
       KC_HERMES_CLI=/home/henrik/.local/bin/hermes

   (`KC_KANAL` already defaults to `hermes` beside `KC_AGENT=hermes-http`; `fra` turns Send off.)
2. Check the CLI as the service user, without sending anything: `~/.local/bin/hermes send --list telegram`.
3. The member must be allowed to write to Hermes, or her replies never reach the hook:
   Telegram `TELEGRAM_ALLOWED_USERS` (her numeric user id), WhatsApp in `bot` mode `WHATSAPP_DM_POLICY`/allowlist
   (the default `self-chat` mode drops her), Signal `SIGNAL_ALLOWED_USERS`. These live in Hermes' own env; edit them
   with `hermes config` or by hand — Clawco never reads that file.
4. WhatsApp sends through the gateway's running bridge; Telegram and Signal do not need the gateway to run.
5. `systemctl --user restart kontrolcenter`, then `/health`.

Her handle (a Telegram chat id or an E.164 number) is stored on her member in Husstanden; until she has answered
"ja" to the invitation (KC-0154) nothing else is sent, and "stop" ends it.

Known limits (follow-ups): Hermes also starts its own agent turn on her reply and may answer her; on WhatsApp the
sender can arrive as a privacy `@lid` id that does not match her number.
