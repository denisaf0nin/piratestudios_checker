#!/usr/bin/env python3
"""
fetch_schedule.py - pull the full rehearsal-room schedule for every London
Pirate Studios site over a date range and save it as one JSON file that the
web app filters on the phone.

How the Pirate search API behaves (checked 2026-11-17):
  * GET https://api.pirate.com/v1/search?deck_slug=<site>&duration=1&start_time=<local time>
  * start_time is London local time. Slot times come back in London local time
    with the right offset (+00:00 in winter, +01:00 in summer).
  * Each studio returns 27 hourly slots, from start_time minus 3 hours.
    "available" is per hour and does not depend on the duration asked for.
  So one request per site per day, with start_time = <day>T03:00, covers that
  whole day (00:00 to 23:00). Requests are sent one at a time with a pause.

Usage:
  python3 scripts/fetch_schedule.py --start 2026-11-20 --end 2026-11-23
  python3 scripts/fetch_schedule.py --start 2026-11-20 --end 2026-11-20 --out /tmp/s.json

Only the Python standard library is used.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

API_URL = "https://api.pirate.com/v1/search"
USER_AGENT = "pirate-availability-personal/0.2 (personal availability tool, one request per site per day)"
TIMEOUT_SECONDS = 20
PAUSE_SECONDS = 1.5      # pause between requests, to be polite
MAX_DAYS = 14            # hard cap on range length
RETRIES = 2

ROOT = Path(__file__).resolve().parent.parent
SITES_FILE = ROOT / "data" / "london_sites.json"
DEFAULT_OUT = ROOT / "docs" / "data" / "schedule.json"
SAMPLE_OUT = ROOT / "data" / "sample_response.json"


def fetch(site, day):
    params = urllib.parse.urlencode(
        {"deck_slug": site, "duration": 1, "start_time": f"{day.isoformat()}T03:00:00"}
    )
    req = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={"Accept": "application/json", "Accept-Language": "en", "User-Agent": USER_AGENT},
    )
    last_err = None
    for attempt in range(RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e
            if isinstance(e, urllib.error.HTTPError) and e.code < 500 and e.code != 429:
                break
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{site} {day}: {last_err}")


def short_type(name):
    # "Rehearsal Lite" -> "Lite"
    return name[len("Rehearsal"):].strip() or name


def collect(entries, day, rooms, free, offsets):
    """Add one search response to the rooms / free tables."""
    day_s = day.isoformat()
    for e in entries:
        stype = (e.get("studio_type") or {})
        tname = stype.get("name") or ""
        if not tname.startswith("Rehearsal"):
            continue
        studio = e.get("studio") or {}
        site = (e.get("site") or {}).get("deck_slug")
        key = f"{site}/{studio.get('id')}"
        rooms.setdefault(key, {
            "key": key,
            "site": site,
            "studio_id": studio.get("id"),
            "name": studio.get("name"),
            "type": short_type(tname),
            "type_id": stype.get("id"),
            "capacity": studio.get("capacity"),
        })
        hours = ["."] * 24   # "1" free, "0" taken, "." not returned
        for s in e.get("slots") or []:
            t = datetime.fromisoformat(s["time"].replace("Z", "+00:00"))
            if t.date().isoformat() != day_s:
                continue
            hours[t.hour] = "1" if s.get("available") else "0"
            if t.hour == 12:
                offsets[day_s] = t.strftime("%z")[:3] + ":" + t.strftime("%z")[3:]
        free.setdefault(key, {})[day_s] = "".join(hours)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--start", required=True, help="first day, YYYY-MM-DD")
    p.add_argument("--end", required=True, help="last day, YYYY-MM-DD (inclusive)")
    p.add_argument("--out", default=str(DEFAULT_OUT))
    p.add_argument("--sites", default=str(SITES_FILE))
    args = p.parse_args()

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    if end < start:
        sys.exit("End date is before start date.")
    if (end - start).days + 1 > MAX_DAYS:
        sys.exit(f"Date range is longer than {MAX_DAYS} days.")

    sites_doc = json.loads(Path(args.sites).read_text(encoding="utf-8"))
    sites = [
        {"slug": s["deck_slug"], "name": s.get("area") or s.get("name"), "full_name": s.get("name"),
         "address": s.get("address"), "postcode": s.get("postcode")}
        for s in sites_doc["sites"]
    ]

    rooms, free, offsets, errors = {}, {}, {}, []
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    total = len(days) * len(sites)
    n = 0
    sample_saved = False
    for site in sites:
        for day in days:
            n += 1
            if n > 1:
                time.sleep(PAUSE_SECONDS)
            try:
                data = fetch(site["slug"], day)
            except RuntimeError as e:
                errors.append(str(e))
                print(f"[{n}/{total}] FAILED {e}", flush=True)
                continue
            if not isinstance(data, list):
                errors.append(f"{site['slug']} {day}: unexpected response shape")
                continue
            if not sample_saved:
                SAMPLE_OUT.parent.mkdir(parents=True, exist_ok=True)
                SAMPLE_OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
                sample_saved = True
            collect(data, day, rooms, free, offsets)
            print(f"[{n}/{total}] {site['slug']} {day}: {len(data)} studios", flush=True)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "timezone": "Europe/London",
        "utc_offsets": offsets,
        "sites": sites,
        "rooms": sorted(rooms.values(), key=lambda r: (r["site"], r["type"], r["name"] or "")),
        "free": free,
        "errors": errors,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"Saved {len(rooms)} rooms, {len(days)} days, {len(errors)} errors -> {args.out}")
    if errors and len(errors) == total:
        sys.exit("Every request failed.")


if __name__ == "__main__":
    main()
