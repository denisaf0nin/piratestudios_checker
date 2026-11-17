#!/usr/bin/env python3
"""
pirate_slots.py - personal test tool: print free Pirate Studios rehearsal times.

Makes ONE request to Pirate's public (unofficial, undocumented) search API and
prints the free hour ranges for each matching studio at one site.

Usage:
  python3 pirate_slots.py <site-slug> <YYYY-MM-DD> <start-hour> <duration-hours> [--type Rehearsal]

Examples:
  python3 pirate_slots.py london-wembley-abbeydale-road 2026-11-30 18 2
  python3 pirate_slots.py london-hackney 2026-11-30 18 3 --type "Rehearsal Pro"
  python3 pirate_slots.py london-hackney 2026-11-30 18 3 --type ""        # all studio types
  python3 pirate_slots.py x 2026-11-30 18 2 --from-file sample_response.json   # offline test

Only the Python standard library is used (Python 3.8+).
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

API_URL = "https://api.pirate.com/v1/search"
USER_AGENT = "pirate-slots-personal-test/0.1 (personal availability test script)"
TIMEOUT_SECONDS = 15


def fetch(site, start_iso, duration):
    params = urllib.parse.urlencode(
        {"deck_slug": site, "duration": duration, "start_time": start_iso}
    )
    req = urllib.request.Request(
        f"{API_URL}?{params}",
        headers={
            "Accept": "application/json",
            "Accept-Language": "en",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        sys.exit(f"API returned HTTP {e.code} {e.reason}.\nResponse start: {body}")
    except urllib.error.URLError as e:
        sys.exit(f"Could not reach {API_URL}: {e.reason}")
    except TimeoutError:
        sys.exit(f"Request timed out after {TIMEOUT_SECONDS}s.")
    except json.JSONDecodeError:
        sys.exit("API response was not valid JSON.")


def parse_time(s):
    # Handles "2026-11-30T18:00:00+00:00" and a trailing "Z".
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def free_ranges(slots):
    """Merge consecutive available slots into (start, end) ranges.

    Slot length is inferred from the gap between slot times (usually 1 hour).
    """
    times = sorted((parse_time(s["time"]), bool(s.get("available"))) for s in slots)
    if not times:
        return []
    step = timedelta(hours=1)
    if len(times) > 1:
        step = min(b[0] - a[0] for a, b in zip(times, times[1:]) if b[0] > a[0])

    ranges = []
    start = prev = None
    for t, ok in times:
        if ok and start is not None and t - prev == step:
            prev = t
        elif ok:
            if start is not None:
                ranges.append((start, prev + step))
            start = prev = t
        else:
            if start is not None:
                ranges.append((start, prev + step))
            start = prev = None
    if start is not None:
        ranges.append((start, prev + step))
    return ranges


def fmt_range(a, b):
    if a.date() == b.date() or b == datetime.combine(b.date(), datetime.min.time(), b.tzinfo):
        return f"{a:%a %d %b} {a:%H:%M}-{b:%H:%M}"
    return f"{a:%a %d %b %H:%M} - {b:%a %d %b %H:%M}"


def main():
    p = argparse.ArgumentParser(description="Print free Pirate Studios times for one site.")
    p.add_argument("site", help="site slug, e.g. london-wembley-abbeydale-road")
    p.add_argument("date", help="date, YYYY-MM-DD")
    p.add_argument("hour", type=int, help="start hour, 0-23 (local time)")
    p.add_argument("duration", type=int, help="session length in hours")
    p.add_argument("--type", default="Rehearsal",
                   help='studio type filter, case-insensitive substring (default "Rehearsal"; "" = all)')
    p.add_argument("--from-file", help="read a saved JSON response instead of calling the API")
    args = p.parse_args()

    try:
        start = datetime.strptime(args.date, "%Y-%m-%d").replace(hour=args.hour)
    except ValueError as e:
        sys.exit(f"Bad date/hour: {e}")
    start_iso = start.strftime("%Y-%m-%dT%H:%M:%S")

    if args.from_file:
        with open(args.from_file, encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = fetch(args.site, start_iso, args.duration)

    if not isinstance(data, list):
        sys.exit(f"Unexpected response shape (expected a list): {str(data)[:300]}")

    wanted = args.type.lower()
    print(f"{args.site}  |  searched {start_iso}, {args.duration}h  |  type filter: {args.type or 'all'}\n")
    shown = 0
    for entry in data:
        studio = (entry.get("studio") or {}).get("name", "?")
        stype = (entry.get("studio_type") or {}).get("name", "?")
        if wanted and wanted not in stype.lower():
            continue
        shown += 1
        price = (entry.get("price") or {}).get("amount")
        price_txt = f"  £{price}" if price is not None else ""
        print(f"{studio}  [{stype}]{price_txt}")
        ranges = free_ranges(entry.get("slots") or [])
        if not ranges:
            print("    no free slots")
        for a, b in ranges:
            print(f"    free {fmt_range(a, b)}")
        print()
    if not shown:
        types = sorted({(e.get("studio_type") or {}).get("name", "?") for e in data})
        print(f"No studios matched type filter {args.type!r}. Types in response: {', '.join(types) or 'none'}")


if __name__ == "__main__":
    main()
