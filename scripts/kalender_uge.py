#!/usr/bin/env python3
"""Henriks kalender de næste 7 dage som JSON (Google Calendar, alle kalendere
Kiras Google-adgang kan se). Bruger Kiras token-script; ingen egne nøgler.

  python3 scripts/kalender_uge.py [--days 7] [--token-script PATH]

Output: {"generated": ISO, "days": [{"date": "YYYY-MM-DD", "events": [
  {"start": ISO|date, "end": ISO|date, "all_day": bool, "title": str,
   "calendar": str, "location": str|null, "creator": str|null, "id": str|null,
   "attendees": [{"name": str|null, "email": str|null, "self": bool}]}]}],
 "errors": [str]}
Kun stdlib. Ingen brødtekster, kun kalenderfelter."""
import argparse, json, os, subprocess, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Copenhagen")
TIMEOUT = 12


def token(script: str) -> str:
    r = subprocess.run([sys.executable, script, "--print-token"], capture_output=True, text=True, timeout=30)
    out = (r.stdout or "").strip()
    if r.returncode != 0 or not out:
        raise RuntimeError("no_token")
    return out.splitlines()[-1].strip()


def get(url: str, tok: str):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--token-script", default=os.path.expanduser("~/.hermes/scripts/google_token_refresh.py"))
    a = ap.parse_args()
    now = datetime.now(TZ)
    start = datetime(now.year, now.month, now.day, tzinfo=TZ)
    end = start + timedelta(days=a.days)
    out = {"generated": now.isoformat(timespec="seconds"), "days": [], "errors": []}
    days = {(start + timedelta(days=i)).date().isoformat(): [] for i in range(a.days)}
    try:
        tok = token(a.token_script)
        cals = get("https://www.googleapis.com/calendar/v3/users/me/calendarList", tok).get("items", [])
        for cal in cals:
            cid, name = cal.get("id"), cal.get("summary", cal.get("id"))
            if not cid:
                continue
            qs = urllib.parse.urlencode({"timeMin": start.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true", "orderBy": "startTime", "maxResults": "100"})
            try:
                items = get(f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(cid)}/events?{qs}", tok).get("items", [])
            except Exception as ex:  # one calendar must not kill the week
                out["errors"].append(f"{name}: {type(ex).__name__}")
                continue
            for e in items:
                st = (e.get("start") or {}); en = (e.get("end") or {})
                all_day = "date" in st
                s_raw = st.get("dateTime") or st.get("date"); e_raw = en.get("dateTime") or en.get("date")
                if not s_raw:
                    continue
                day = s_raw[:10] if all_day else datetime.fromisoformat(s_raw).astimezone(TZ).date().isoformat()
                if day not in days:
                    continue
                days[day].append({"start": s_raw, "end": e_raw, "all_day": all_day, "title": e.get("summary", "(uden titel)"), "calendar": name, "location": e.get("location"), "creator": (e.get("creator") or {}).get("email"), "id": e.get("id"), "attendees": [{"name": p.get("displayName"), "email": p.get("email"), "self": bool(p.get("self"))} for p in (e.get("attendees") or []) if not p.get("resource")]})
    except Exception as ex:
        out["errors"].append(f"{type(ex).__name__}: {ex}")
    for d, evs in days.items():
        evs.sort(key=lambda x: (not x["all_day"], x["start"]))
        out["days"].append({"date": d, "events": evs})
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
