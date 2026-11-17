# Studio Finder (Pirate Studios, London)

A small phone app that shows free Pirate Studios rehearsal rooms in London.
Tick the studios and room types you want, pick dates, a time of day and how
many hours in a row you need, then press **Search**. Results open in the
**Results** tab, grouped by day and studio. Tap a time to open that room's
booking page on Pirate.

## How it works

1. When you search **new dates**, the app asks GitHub to run the
   *Fetch schedule* job. That job asks Pirate for every room at all 10 London
   studios, for every day in your dates (one request per studio per day, one at
   a time, with a pause between them). It takes about 2 to 6 minutes.
2. The result is saved in the repo as `docs/data/schedule.json`.
3. The app downloads that file and does all the filtering on your phone.
   Changing studios, room types, times or hours in a row is instant and does
   not fetch anything new. Only new dates trigger a new fetch.
4. Settings → *Fetch fresh data for my dates* re-fetches the same dates if you
   want up-to-date availability.

The booking link opens at the start of the free block, for the number of
hours you asked for. You can change the length on Pirate's page.

## One-time setup (Cloudflare, recommended)

With this setup anyone you share the link with can use the app. Nobody needs a
key or a passcode: the GitHub key lives hidden inside Cloudflare.

### 1. Make a GitHub key

1. Go to **https://github.com/settings/personal-access-tokens/new**.
2. **Token name:** `Studio Finder`. **Expiration:** for example 1 year (make a
   new one the same way when it runs out).
3. **Repository access:** *Only select repositories* → `piratestudios_checker`.
4. **Permissions → Repository permissions:** **Actions** *Read and write*,
   **Contents** *Read-only*. Leave everything else alone.
5. Press **Generate token** and copy it (starts with `github_pat_`).

This key can only start and read the fetch job in this one repo.

### 2. Put the app on Cloudflare

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** →
   pick `piratestudios_checker`.
2. **Build command:** leave empty. **Deploy command:** `npx wrangler deploy`.
   (The settings live in `wrangler.jsonc` in the repo.) Press **Deploy**.
3. Open the new Worker → **Settings → Variables and Secrets → Add**:
   - **Type:** Secret
   - **Variable name:** `GITHUB_TOKEN`
   - **Value:** the key from step 1
   Press **Deploy** (or **Save**).
4. The Worker's address (ending in `.workers.dev`) is the app. Share it with
   anyone. On a phone: Safari → Share → *Add to Home Screen*, or Chrome → ⋮ →
   *Install app*.

To be polite to Pirate, if someone searches dates that are already being
fetched they wait for that fetch, and at most two fetches can be running or
queued at once.

### Without Cloudflare (GitHub Pages, only for yourself)

Turn on **Settings → Pages** (branch `main`, folder `/docs`). The app then lives
at https://denisaf0nin.github.io/piratestudios_checker/ and asks for the GitHub
key in its own **Settings** tab instead. The key is stored only on that device.

## Notes

- Dates: today onwards, up to 14 days per search.
- Times are London time. The time window ends at midnight at the latest.
- Pirate's search API is public but unofficial and undocumented, so it could
  change. If the fetch fails, the app shows a link to the failed run on GitHub.
- What the API returns (checked 2026-11-17): `start_time` is London local time;
  each room comes back with 27 hourly slots starting 3 hours before
  `start_time`, with London offsets (`+00:00` in winter, `+01:00` in summer).
  `available` is per hour. A raw response is saved to
  `data/sample_response.json` on every fetch.

## Files

- `docs/` – the app (plain HTML, CSS and JavaScript, no build step)
- `worker/index.js`, `wrangler.jsonc` – the Cloudflare helper that serves the app and starts fetches with the hidden key
- `docs/data/schedule.json` – the latest fetched schedule
- `scripts/fetch_schedule.py` – pulls the schedule (Python standard library only)
- `.github/workflows/fetch-schedule.yml` – the job the app starts
- `data/london_sites.json` – the 10 London studios and their rooms
- `pirate_slots.py`, `.github/workflows/check-slots.yml` – the earlier one-site test tool

Run the fetch by hand: `python3 scripts/fetch_schedule.py --start 2026-11-20 --end 2026-11-23`
