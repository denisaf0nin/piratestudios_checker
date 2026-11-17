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

## One-time setup

You only do this once.

### 1. Turn on the website (GitHub Pages)

1. Open the repo on GitHub, then **Settings → Pages**.
2. Under *Build and deployment*, set **Source** to *Deploy from a branch*.
3. Set **Branch** to `main` and the folder to `/docs`, then **Save**.
4. After a minute or two the page shows your app address, which will be
   **https://denisaf0nin.github.io/piratestudios_checker/**

### 2. Make a key so the app can start the fetch

1. Go to **https://github.com/settings/personal-access-tokens/new**
   (GitHub → your photo → Settings → Developer settings → Personal access
   tokens → *Fine-grained tokens* → *Generate new token*).
2. **Token name:** `Studio Finder`. **Expiration:** pick what you like
   (for example 1 year). You will need a new key when it expires.
3. **Repository access:** *Only select repositories* → `piratestudios_checker`.
4. **Permissions → Repository permissions:**
   - **Actions:** *Read and write*
   - **Contents:** *Read-only*
   (Metadata: Read-only is added automatically.) Leave everything else as
   *No access*.
5. Press **Generate token** and copy it (it starts with `github_pat_`).

This key can only start and read the fetch job and read files in this one
repo. It cannot change code or touch your other repos.

### 3. Put it on your phone

1. Open the app address on your phone.
2. **Add it to your home screen**: on iPhone, Safari → Share → *Add to Home
   Screen*. On Android, Chrome → ⋮ → *Install app* / *Add to Home screen*.
3. Open the app, go to **Settings**, paste the key and press **Save**. It should
   say *Key saved and working*. The key is stored only on that phone.

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
- `docs/data/schedule.json` – the latest fetched schedule
- `scripts/fetch_schedule.py` – pulls the schedule (Python standard library only)
- `.github/workflows/fetch-schedule.yml` – the job the app starts
- `data/london_sites.json` – the 10 London studios and their rooms
- `pirate_slots.py`, `.github/workflows/check-slots.yml` – the earlier one-site test tool

Run the fetch by hand: `python3 scripts/fetch_schedule.py --start 2026-11-20 --end 2026-11-23`
