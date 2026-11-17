/* Studio Finder - finds free Pirate Studios rehearsal rooms in London.
 *
 * Data: docs/data/schedule.json, made by scripts/fetch_schedule.py in the
 * "Fetch schedule" GitHub workflow. It holds every room at every London site
 * for a date range. All filtering (studios, room types, times, hours in a row)
 * happens here on the phone. A new fetch only runs when the dates change.
 */
(function () {
  "use strict";

  // ---- settings ----------------------------------------------------------
  var OWNER = "denisaf0nin";
  var REPO = "piratestudios_checker";
  var BRANCH = "main";
  var WORKFLOW = "fetch-schedule.yml";
  var DATA_PATH = "docs/data/schedule.json";
  var MAX_DAYS = 14;
  var POLL_MS = 10000;
  var API = "https://api.github.com/repos/" + OWNER + "/" + REPO;

  var SITES = [
    ["london-camden", "Camden"], ["london-brixton", "Brixton"],
    ["croydon-purley-way", "Croydon"], ["london-dalston", "Dalston"],
    ["london-lydden-road-earlsfield", "Earlsfield"], ["london-greenwich-bugsby-s-way", "Greenwich"],
    ["london-hackney", "Hackney"], ["london-notting-hill-the-arches", "Notting Hill"],
    ["london-tottenham", "Tottenham"], ["london-wembley-abbeydale-road", "Wembley"]
  ].sort(function (a, b) { return a[1].localeCompare(b[1]); });
  var TYPES = [["Lite", ""], ["Standard", ""], ["Pro", ""], ["Extra", "Camden"], ["Acoustic", "Dalston"]];

  // ---- small helpers -----------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hh(h) { return pad(h) + ":00"; }
  function londonNow() {
    // returns {date: "YYYY-MM-DD", hour: n} in London time
    var p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date()).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
    return { date: p.year + "-" + p.month + "-" + p.day, hour: parseInt(p.hour, 10) };
  }
  function addDays(iso, n) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 864e5); }
  function niceDate(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }); }
  function shortDate(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); }
  function ago(iso) {
    var m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 48) return h + " h ago"; return Math.round(h / 24) + " days ago";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---- state ---------------------------------------------------------------
  var data = null;        // loaded schedule.json
  var busy = false;
  var saved = {};
  try { saved = JSON.parse(store("filters") || "{}"); } catch (e) { saved = {}; }

  // ---- build the form --------------------------------------------------------
  function chip(container, name, value, label, note, on) {
    var l = document.createElement("label");
    l.className = "chip" + (on ? " on" : "");
    l.innerHTML = '<input type="checkbox" name="' + name + '" value="' + esc(value) + '"' + (on ? " checked" : "") + ">" + esc(label) + (note ? "<small>" + esc(note) + "</small>" : "");
    l.querySelector("input").addEventListener("change", function (e) { l.classList.toggle("on", e.target.checked); saveFilters(); });
    container.appendChild(l);
  }
  function buildForm() {
    var siteSel = saved.sites || SITES.map(function (s) { return s[0]; });
    SITES.forEach(function (s) { chip($("sites"), "site", s[0], s[1], "", siteSel.indexOf(s[0]) >= 0); });
    var typeSel = saved.types || ["Lite", "Standard", "Pro"];
    TYPES.forEach(function (t) { chip($("types"), "type", t[0], t[0], t[1] ? "(" + t[1] + ")" : "", typeSel.indexOf(t[0]) >= 0); });

    document.querySelectorAll("[data-all],[data-none]").forEach(function (b) {
      b.addEventListener("click", function () {
        var name = b.dataset.all || b.dataset.none, on = !!b.dataset.all;
        document.querySelectorAll('input[name="' + name + '"]').forEach(function (i) { i.checked = on; i.parentNode.classList.toggle("on", on); });
        saveFilters();
      });
    });

    for (var h = 0; h < 24; h++) $("timeFrom").add(new Option(hh(h), h));
    for (h = 1; h <= 24; h++) $("timeTo").add(new Option(h === 24 ? "24:00 (midnight)" : hh(h), h));
    $("timeFrom").value = saved.timeFrom != null ? saved.timeFrom : 10;
    $("timeTo").value = saved.timeTo != null ? saved.timeTo : 24;

    for (var n = 1; n <= 8; n++) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = n; b.dataset.v = n;
      b.addEventListener("click", function (e) { setMin(+e.target.dataset.v); saveFilters(); });
      $("minHours").appendChild(b);
    }
    setMin(saved.minHours || 2);

    var today = londonNow().date;
    $("dateFrom").min = today; $("dateTo").min = today;
    var from = saved.dateFrom && saved.dateFrom >= today ? saved.dateFrom : today;
    var to = saved.dateTo && saved.dateTo >= from ? saved.dateTo : addDays(from, 6);
    if (daysBetween(from, to) >= MAX_DAYS) to = addDays(from, MAX_DAYS - 1);
    $("dateFrom").value = from; $("dateTo").value = to;
    fixDateLimits();
    ["dateFrom", "dateTo", "timeFrom", "timeTo"].forEach(function (id) {
      $(id).addEventListener("change", function () { fixDateLimits(); saveFilters(); });
    });
  }
  function setMin(n) {
    document.querySelectorAll("#minHours button").forEach(function (b) { b.classList.toggle("on", +b.dataset.v === n); });
  }
  function fixDateLimits() {
    var today = londonNow().date, f = $("dateFrom"), t = $("dateTo");
    if (!f.value || f.value < today) f.value = today;
    t.min = f.value; t.max = addDays(f.value, MAX_DAYS - 1);
    if (!t.value || t.value < f.value) t.value = f.value;
    if (t.value > t.max) t.value = t.max;
  }
  function readFilters() {
    var picked = function (name) { return Array.prototype.map.call(document.querySelectorAll('input[name="' + name + '"]:checked'), function (i) { return i.value; }); };
    var on = document.querySelector("#minHours button.on");
    return {
      sites: picked("site"), types: picked("type"),
      dateFrom: $("dateFrom").value, dateTo: $("dateTo").value,
      timeFrom: +$("timeFrom").value, timeTo: +$("timeTo").value,
      minHours: on ? +on.dataset.v : 1
    };
  }
  function saveFilters() { store("filters", JSON.stringify(readFilters())); }

  // ---- tabs --------------------------------------------------------------------
  function showTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.toggle("active", t.id === "tab-" + name); });
    document.querySelectorAll("nav.tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("nav.tabs button").forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });

  // ---- status ------------------------------------------------------------------
  function status(html, isError) {
    var s = $("status");
    s.hidden = !html; s.innerHTML = html || ""; s.classList.toggle("error", !!isError);
  }
  function showDataInfo() {
    var line = $("dataLine"), info = $("dataInfo");
    if (!data) { line.textContent = "No studio data loaded yet."; info.textContent = "No data yet. Pick dates and press Search."; return; }
    var t = "Data for " + shortDate(data.start) + " to " + shortDate(data.end) + ", fetched " + ago(data.generated_at) + ".";
    line.textContent = t;
    info.textContent = t + " " + data.rooms.length + " rooms." + (data.errors && data.errors.length ? " " + data.errors.length + " requests failed, so some rooms may be missing." : "");
  }

  // ---- GitHub ------------------------------------------------------------------
  function token() { return store("gh_token") || ""; }
  function gh(path, opts) {
    opts = opts || {};
    var headers = { "Accept": opts.accept || "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token()) headers.Authorization = "Bearer " + token();
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store" })
      .then(function (r) {
        if (r.status === 401) throw new Error("GitHub did not accept the key. Check it in Settings.");
        if (r.status === 403 || r.status === 404) throw new Error("GitHub refused (" + r.status + "). The key may be missing the Actions permission, or the setup is not finished. See the README.");
        if (!r.ok) throw new Error("GitHub error " + r.status);
        return r.status === 204 ? null : (opts.accept && opts.accept.indexOf("raw") >= 0 ? r.text() : r.json());
      });
  }
  function loadData() {
    // Prefer the GitHub API (always the newest file); fall back to this site's copy.
    var viaApi = gh("/contents/" + DATA_PATH + "?ref=" + BRANCH + "&t=" + Date.now(), { accept: "application/vnd.github.raw+json" })
      .then(function (txt) { return JSON.parse(txt); });
    return viaApi.catch(function () {
      return fetch("data/schedule.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("no data"); return r.json(); });
    }).then(function (d) { data = d; store("schedule", JSON.stringify(d)); showDataInfo(); return d; });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function runFetch(from, to) {
    if (!token()) {
      status('New dates need new data, and that needs your GitHub key. Add it in <b>Settings</b> (one time only).', true);
      return Promise.reject(new Error("no token"));
    }
    var reqId = "app-" + Date.now().toString(36);
    var started = Date.now();
    var days = daysBetween(from, to) + 1;
    var estimate = Math.ceil((days * SITES.length * 2.2 + 60) / 60);
    function tick(msg) {
      var secs = Math.round((Date.now() - started) / 1000);
      status('<span class="spinner"></span>' + msg + " (" + Math.floor(secs / 60) + ":" + pad(secs % 60) + ", usually about " + estimate + " min). You can leave this screen open.");
    }
    tick("Asking GitHub to fetch studio data for " + days + " day" + (days > 1 ? "s" : ""));
    return gh("/actions/workflows/" + WORKFLOW + "/dispatches", { method: "POST", body: { ref: BRANCH, inputs: { start: from, end: to, request_id: reqId } } })
      .then(function () {
        var runId = null;
        function poll() {
          return sleep(POLL_MS).then(function () {
            if (!runId) {
              return gh("/actions/workflows/" + WORKFLOW + "/runs?event=workflow_dispatch&per_page=10").then(function (r) {
                var run = (r.workflow_runs || []).filter(function (x) { return (x.display_title || "").indexOf(reqId) >= 0; })[0];
                if (run) runId = run.id;
                tick(run ? "Fetching studio data" : "Waiting for GitHub to start");
                if (Date.now() - started > 3 * 60000 && !run) throw new Error("GitHub did not start the fetch. Try again in a minute.");
                return poll();
              });
            }
            return gh("/actions/runs/" + runId).then(function (run) {
              if (run.status !== "completed") { tick(run.status === "queued" ? "Waiting in GitHub's queue" : "Fetching studio data"); return poll(); }
              if (run.conclusion !== "success") throw new Error('The fetch failed on GitHub. <a href="' + esc(run.html_url) + '" target="_blank" rel="noopener">See what happened</a>.');
              tick("Loading results");
              return sleep(2000).then(loadData);
            });
          });
        }
        return poll();
      });
  }

  // ---- filtering -----------------------------------------------------------------
  function findSlots(f) {
    var now = londonNow();
    var siteName = {}; SITES.forEach(function (s) { siteName[s[0]] = s[1]; });
    var rooms = data.rooms.filter(function (r) { return f.sites.indexOf(r.site) >= 0 && f.types.indexOf(r.type) >= 0; });
    var days = [];
    for (var d = f.dateFrom; d <= f.dateTo; d = addDays(d, 1)) {
      if (d < now.date) continue;
      var bySite = {};
      rooms.forEach(function (r) {
        var hours = (data.free[r.key] || {})[d];
        if (!hours) return;
        var blocks = [], start = null;
        for (var h = f.timeFrom; h <= f.timeTo; h++) {
          var ok = h < f.timeTo && hours.charAt(h) === "1" && !(d === now.date && h <= now.hour);
          if (ok && start === null) start = h;
          if (!ok && start !== null) { if (h - start >= f.minHours) blocks.push([start, h]); start = null; }
        }
        if (!blocks.length) return;
        (bySite[r.site] = bySite[r.site] || []).push({ room: r, blocks: blocks });
      });
      var sites = Object.keys(bySite).sort(function (a, b) { return (siteName[a] || a).localeCompare(siteName[b] || b); })
        .map(function (s) { return { slug: s, name: siteName[s] || s, rooms: bySite[s] }; });
      if (sites.length) days.push({ date: d, sites: sites });
    }
    return days;
  }
  function typeOrder(t) { var i = ["Lite", "Standard", "Pro", "Extra", "Acoustic"].indexOf(t); return i < 0 ? 9 : i; }
  function bookingUrl(room, date, hour, duration) {
    var off = (data.utc_offsets && data.utc_offsets[date]) || "+00:00";
    return "https://book.pirate.com/booking/" + room.site + "/" + room.studio_id + "/" + date + "T" + hh(hour) + ":00" + off +
      "?duration=" + duration + "&studio_super_type=1&total_guests=0";
  }
  function render(f) {
    var days = findSlots(f), out = [], total = 0;
    days.forEach(function (day) {
      out.push('<h2 class="day">' + esc(niceDate(day.date)) + "</h2>");
      day.sites.forEach(function (s) {
        out.push('<div class="site-card"><h3>' + esc(s.name) + "</h3>");
        s.rooms.sort(function (a, b) { return typeOrder(a.room.type) - typeOrder(b.room.type) || a.room.name.localeCompare(b.room.name, undefined, { numeric: true }); })
          .forEach(function (x) {
            out.push('<div class="room"><div class="room-name">' + esc(x.room.name) + '<span class="type">' + esc(x.room.type) + "</span></div>");
            x.blocks.forEach(function (b) {
              total++;
              var len = b[1] - b[0];
              out.push('<a class="slot" target="_blank" rel="noopener" href="' + esc(bookingUrl(x.room, day.date, b[0], Math.min(f.minHours, len))) + '">' +
                hh(b[0]) + "–" + hh(b[1]) + "<span>" + len + "h</span></a>");
            });
            out.push("</div>");
          });
        out.push("</div>");
      });
    });
    $("results").innerHTML = out.length ? out.join("") : '<div class="empty">Nothing free that matches.<br>Try more studios, a wider time window or fewer hours in a row.</div>';
    $("resultsSummary").textContent = total + " free time block" + (total === 1 ? "" : "s") + ", " + shortDate(f.dateFrom) + " to " + shortDate(f.dateTo) + ", " + hh(f.timeFrom) + "–" + hh(f.timeTo) + ", at least " + f.minHours + "h in a row. Tap a time to book it on Pirate (starts with " + f.minHours + "h; you can change it there).";
    $("count").hidden = false; $("count").textContent = total;
  }

  // ---- search ------------------------------------------------------------------
  function covers(d, f) { return d && d.start <= f.dateFrom && d.end >= f.dateTo; }
  function search(force) {
    if (busy) return;
    fixDateLimits();
    var f = readFilters();
    saveFilters();
    if (!f.sites.length) return status("Tick at least one studio.", true);
    if (!f.types.length) return status("Tick at least one room type.", true);
    if (f.timeTo - f.timeFrom < f.minHours) return status("The time window is shorter than the hours you want in a row.", true);
    if (!force && covers(data, f)) { status(""); render(f); showTab("results"); return; }
    busy = true; $("searchBtn").disabled = true; $("refreshBtn").disabled = true;
    // Someone may already have fetched these dates: check the newest file first.
    var first = force ? Promise.resolve(null) : loadData().catch(function () { return null; });
    first.then(function (d) {
      if (!force && covers(d, f)) return d;
      return runFetch(f.dateFrom, f.dateTo);
    }).then(function () {
      status("");
      render(readFilters()); showTab("results");
    }).catch(function (e) {
      if (e.message !== "no token") status(e.message || String(e), true);
    }).then(function () { busy = false; $("searchBtn").disabled = false; $("refreshBtn").disabled = false; });
  }
  $("searchBtn").addEventListener("click", function () { search(false); });
  $("refreshBtn").addEventListener("click", function () { showTab("search"); search(true); });

  // ---- token -------------------------------------------------------------------
  function showToken() { $("tokenState").textContent = token() ? "A key is saved on this device." : "No key saved yet."; $("token").value = ""; }
  $("saveToken").addEventListener("click", function () {
    var v = $("token").value.trim();
    if (!v) return;
    store("gh_token", v); showToken();
    $("tokenState").textContent = "Checking the key…";
    gh("/actions/workflows/" + WORKFLOW).then(function () { $("tokenState").textContent = "Key saved and working."; })
      .catch(function (e) { $("tokenState").textContent = "Key saved, but: " + e.message; });
  });
  $("clearToken").addEventListener("click", function () { store("gh_token", null); showToken(); });

  // ---- start ---------------------------------------------------------------------
  buildForm();
  showToken();
  try { data = JSON.parse(store("schedule") || "null"); } catch (e) { data = null; }
  showDataInfo();
  loadData().catch(function () {});
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
