"""Clawco's message hook for Hermes' gateway (KC-0138, Path B).

Hermes' API server has no feed of inbound messages (findings:
docs/superpowers/specs/2026-11-01-beskeder-gateway-fund.md), so this hook writes
one trimmed JSON line per inbound Telegram, WhatsApp or Signal message to

    $CLAWCO_DATA_DIR/beskeder/indgaaende.jsonl   (rotated to .1 at 5 MB)

and, when the gateway starts, which of those channels came up:

    $CLAWCO_DATA_DIR/beskeder/status.json

Clawco reads only these two files, and only the conversations the user chose on
its Beskeder card. The log is the user's own (Clawco never deletes it); it holds
what reached Hermes, never more. The hook only reads the documented hook context
(gateway/hooks.py: platform, user_id, chat_id, chat_type, message — 500 chars);
it never sends, never calls the network and never blocks the gateway (every
error is swallowed; Hermes ignores hook errors anyway).

Install (the E6 install script runs these steps; nothing is installed by Clawco
itself — the hook lives in the user's Hermes config):

    mkdir -p ~/.hermes/hooks/clawco-beskeder
    cp deploy/hermes/beskeder-hook.py   ~/.hermes/hooks/clawco-beskeder/handler.py
    cp deploy/hermes/beskeder-hook.yaml ~/.hermes/hooks/clawco-beskeder/HOOK.yaml
    # Hermes' own env (~/.hermes/.env): the Clawco data dir, e.g.
    #   CLAWCO_DATA_DIR=/home/henrik/kontrolcenter/data
    hermes gateway restart

Without CLAWCO_DATA_DIR the hook does nothing (fails closed: it never guesses a
folder to write messages into).
"""

import json
import os
from datetime import datetime, timezone

KANALER = ("telegram", "whatsapp", "signal")
MAKS_BYTES = 5 * 1024 * 1024
MAKS_TEKST = 500


def _mappe():
    rod = os.environ.get("CLAWCO_DATA_DIR", "").strip()
    return os.path.join(rod, "beskeder") if rod else None


def _nu():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _skriv_linje(mappe, linje):
    os.makedirs(mappe, mode=0o700, exist_ok=True)
    fil = os.path.join(mappe, "indgaaende.jsonl")
    try:
        if os.path.getsize(fil) > MAKS_BYTES:
            os.replace(fil, fil + ".1")
    except OSError:
        pass
    data = (json.dumps(linje, ensure_ascii=False) + "\n").encode("utf-8")
    # One O_APPEND write per line: a reader sees a whole line or none (a partial last line is skipped by Clawco).
    fd = os.open(fil, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)


def _skriv_status(mappe, platforms):
    os.makedirs(mappe, mode=0o700, exist_ok=True)
    fil = os.path.join(mappe, "status.json")
    tmp = fil + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"platforms": [p for p in platforms if p in KANALER], "tid": _nu()}, f)
    os.replace(tmp, fil)


def _tekst(v):
    return v.strip() if isinstance(v, str) else ""


def linje_fra(context):
    """The line for one agent:start context, or None when it is not a message on a channel Clawco reads."""
    if not isinstance(context, dict):
        return None
    kanal = _tekst(context.get("platform")).lower()
    samtale = _tekst(context.get("chat_id"))
    afsender = _tekst(context.get("user_id"))
    if kanal not in KANALER or not samtale or not afsender:
        return None
    chat_type = _tekst(context.get("chat_type"))
    linje = {
        "kanal": kanal,
        "samtale": samtale,
        "gruppe": chat_type in ("group", "forum"),
        "afsender": afsender,
        "tid": _nu(),
        "tekst": (context.get("message") or "")[:MAKS_TEKST] if isinstance(context.get("message"), str) else "",
    }
    # Not in today's hook context; passed on if a later Hermes adds them (Clawco never shows an id-looking name).
    for nogle, felt in (("user_name", "afsenderNavn"), ("chat_name", "samtaleNavn")):
        navn = _tekst(context.get(nogle))
        if navn:
            linje[felt] = navn[:120]
    return linje


def handle(event_type, context):
    mappe = _mappe()
    if not mappe:
        return None
    try:
        if event_type == "agent:start":
            linje = linje_fra(context)
            if linje:
                _skriv_linje(mappe, linje)
        elif event_type == "gateway:startup" and isinstance(context, dict):
            platforms = context.get("platforms")
            if isinstance(platforms, list):
                _skriv_status(mappe, [str(p) for p in platforms])
    except Exception:  # never break the gateway
        pass
    return None
