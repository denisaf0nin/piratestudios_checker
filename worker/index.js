/**
 * Studio Finder helper (Cloudflare Worker).
 *
 * Serves the app (the docs/ folder) and three small endpoints, so people can
 * use the app without their own GitHub key:
 *   GET  /api/health            -> {ok: true}
 *   POST /api/fetch             -> body {start, end}; starts the GitHub fetch job
 *   GET  /api/run?id=<request>  -> {status, conclusion, url} of that job
 *   GET  /api/data              -> latest docs/data/schedule.json from GitHub
 *
 * Secret (Cloudflare dashboard -> this Worker -> Settings -> Variables and Secrets):
 *   GITHUB_TOKEN  fine-grained token, this repo only, Actions read/write + Contents read
 *
 * No passcode: anyone with the link can fetch. To stay polite to Pirate, a
 * request for dates already being fetched joins that run, and at most
 * MAX_ACTIVE fetches can be running or waiting at once.
 */
const OWNER = "denisaf0nin";
const REPO = "piratestudios_checker";
const BRANCH = "main";
const WORKFLOW = "fetch-schedule.yml";
const DATA_PATH = "docs/data/schedule.json";
const MAX_DAYS = 14;
const MAX_ACTIVE = 2;
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function gh(env, path, init = {}) {
  return fetch(API + path, {
    ...init,
    headers: {
      Accept: init.accept || "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "studio-finder-worker",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

function londonToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
}
function dayDiff(a, b) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
}
const RUN_TITLE = /^Fetch (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}) (\S+)$/;

async function startFetch(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const { start, end } = body;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start || "") || !re.test(end || "")) return json({ error: "Bad dates." }, 400);
  if (start < londonToday()) return json({ error: "Dates must be today or later." }, 400);
  if (end < start || dayDiff(start, end) + 1 > MAX_DAYS) return json({ error: `Pick up to ${MAX_DAYS} days.` }, 400);

  // If someone already started a fetch that covers these dates, join it instead of starting another.
  let active = 0;
  for (const status of ["in_progress", "queued"]) {
    const r = await gh(env, `/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=20`);
    if (!r.ok) continue;
    for (const run of (await r.json()).workflow_runs || []) {
      active++;
      const m = RUN_TITLE.exec(run.display_title || "");
      if (m && m[1] <= start && m[2] >= end) return json({ id: m[3], joined: true });
    }
  }
  if (active >= MAX_ACTIVE) return json({ error: "Other people are fetching right now. Try again in a few minutes." }, 429);

  const id = "web-" + crypto.randomUUID().slice(0, 8);
  const r = await gh(env, `/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: BRANCH, inputs: { start, end, request_id: id } }),
  });
  if (r.status !== 204) return json({ error: `GitHub refused to start the fetch (${r.status}). The helper's key may be wrong or expired.` }, 502);
  return json({ id });
}

async function runStatus(url, env) {
  const id = url.searchParams.get("id") || "";
  if (!/^[\w-]{1,40}$/.test(id)) return json({ error: "Bad id." }, 400);
  const r = await gh(env, `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`);
  if (!r.ok) return json({ error: `GitHub error ${r.status}` }, 502);
  const run = ((await r.json()).workflow_runs || []).find((x) => (x.display_title || "").endsWith(" " + id));
  if (!run) return json({ status: "starting" });
  // When the "Pull schedule" step started, so the app can estimate progress.
  let pull_started_at = null;
  if (run.status === "in_progress") {
    const j = await gh(env, `/actions/runs/${run.id}/jobs`);
    if (j.ok) {
      for (const job of (await j.json()).jobs || []) {
        const step = (job.steps || []).find((st) => /^Pull schedule/.test(st.name));
        if (step && step.started_at) pull_started_at = step.started_at;
      }
    }
  }
  return json({ status: run.status, conclusion: run.conclusion, url: run.html_url, pull_started_at });
}

async function latestData(env) {
  const r = await gh(env, `/contents/${DATA_PATH}?ref=${BRANCH}`, { accept: "application/vnd.github.raw+json" });
  if (!r.ok) return json({ error: `GitHub error ${r.status}` }, 502);
  return new Response(r.body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!env.GITHUB_TOKEN) return json({ error: "The helper is missing its GitHub key. See the README." }, 500);
      try {
        if (url.pathname === "/api/health") return json({ ok: true });
        if (url.pathname === "/api/fetch" && request.method === "POST") return await startFetch(request, env);
        if (url.pathname === "/api/run") return await runStatus(url, env);
        if (url.pathname === "/api/data") return await latestData(env);
      } catch (e) {
        return json({ error: "Helper error: " + e.message }, 500);
      }
      return json({ error: "Not found" }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};
