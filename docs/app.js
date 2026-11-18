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
  var MAX_DAYS = 14;
  var POLL_MS = 8000;
  var SECS_PER_REQUEST = 2.6;   // measured on GitHub, including the 1.5 s pause

  var SITES = [
    ["london-camden", "Camden"], ["london-brixton", "Brixton"],
    ["croydon-purley-way", "Croydon"], ["london-dalston", "Dalston"],
    ["london-lydden-road-earlsfield", "Earlsfield"], ["london-greenwich-bugsby-s-way", "Greenwich"],
    ["london-hackney", "Hackney"], ["london-notting-hill-the-arches", "Notting Hill"],
    ["london-wembley-abbeydale-road", "Wembley"]
  ].sort(function (a, b) { return a[1].localeCompare(b[1]); });
  // Same order as data/london_sites.json, which is the order the fetch script uses.
  var FETCH_ORDER = [
    ["london-camden", "Camden"], ["croydon-purley-way", "Croydon"], ["london-dalston", "Dalston"],
    ["london-lydden-road-earlsfield", "Earlsfield"], ["london-greenwich-bugsby-s-way", "Greenwich"],
    ["london-hackney", "Hackney"], ["london-notting-hill-the-arches", "Notting Hill"],
    ["london-wembley-abbeydale-road", "Wembley"], ["london-brixton", "Brixton"]
  ];
  // Where each studio sits on the drawn map: x and y in % of the map, label side.
  var PINS = {
    "london-wembley-abbeydale-road": [7, 18, "r"], "london-notting-hill-the-arches": [16, 38, "r"],
    "london-camden": [37, 15, "r"], "london-dalston": [60, 12, "r"], "london-hackney": [70, 32, "r"],
    "london-greenwich-bugsby-s-way": [93, 70, "l"], "london-brixton": [42, 66, "r"],
    "london-lydden-road-earlsfield": [10, 72, "r"], "croydon-purley-way": [50, 82, "r"]
  };
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
    if (m < 1) return "just now"; if (m < 120) return m + " min ago";
    var h = Math.round(m / 60); if (h < 48) return h + " h ago"; return Math.round(h / 24) + " days ago";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---- state ---------------------------------------------------------------
  var data = null;        // loaded schedule.json
  var busy = false;
  var saved = {};
  try { saved = JSON.parse(store("filters") || "{}"); } catch (e) { saved = {}; }

  // ---- build the form --------------------------------------------------------
  function chip(container, cls, name, value, label, note, on) {
    var l = document.createElement("label");
    l.className = cls + (on ? " on" : "");
    l.innerHTML = '<input type="checkbox" name="' + name + '" value="' + esc(value) + '"' + (on ? " checked" : "") + ">" +
      (cls.indexOf("pin") === 0 ? "<i></i><span>" + esc(label) + "</span>" : esc(label) + (note ? "<small>" + esc(note) + "</small>" : ""));
    l.querySelector("input").addEventListener("change", function (e) { l.classList.toggle("on", e.target.checked); saveFilters(); });
    container.appendChild(l);
    return l;
  }
  function buildForm() {
    var siteSel = saved.sites || SITES.map(function (s) { return s[0]; });
    SITES.forEach(function (s) {
      var p = PINS[s[0]] || [50, 50, "r"], l = p[2] === "l";
      var pin = chip($("sites"), "pin" + (l ? " l" : ""), "site", s[0], s[1], "", siteSel.indexOf(s[0]) >= 0);
      // the marker square sits on the spot; the name tag hangs off to one side
      pin.style.left = p[0] + "%"; pin.style.top = p[1] + "%";
      pin.style.transform = "translate(" + (l ? "calc(-100% + 13px)" : "-13px") + ", -50%)";
    });
    var typeSel = saved.types || ["Lite", "Standard", "Pro"];
    TYPES.forEach(function (t) { chip($("types"), "tag", "type", t[0], t[0], t[1] ? t[1] + " only" : "", typeSel.indexOf(t[0]) >= 0); });

    document.querySelectorAll("[data-all],[data-none]").forEach(function (b) {
      b.addEventListener("click", function () {
        var name = b.dataset.all || b.dataset.none, on = !!b.dataset.all;
        document.querySelectorAll('input[name="' + name + '"]').forEach(function (i) { i.checked = on; i.parentNode.classList.toggle("on", on); });
        saveFilters();
      });
    });

    for (var h = 0; h < 24; h++) $("timeFrom").add(new Option(hh(h), h));
    for (h = 1; h <= 24; h++) $("timeTo").add(new Option(hh(h), h));
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
  function saveFilters() {
    var f = readFilters();
    store("filters", JSON.stringify(f));
    $("siteCount").textContent = f.sites.length;
    updateHint();
  }

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
    var line = $("dataLine");
    var stamp = $("stamp");
    if (!data) { line.textContent = "No studio data loaded yet."; stamp.hidden = true; return; }
    stamp.hidden = false;
    stamp.textContent = "Data " + ago(data.generated_at).replace(" ago", " old").replace("just now", "fresh");
    var n = fetchedSites(data).length;
    line.textContent = "Data for " + shortDate(data.start) + " to " + shortDate(data.end) + ", " + n + " studio" + (n > 1 ? "s" : "") + ", pulled " + ago(data.generated_at) + "." +
      (data.errors && data.errors.length ? " " + data.errors.length + " requests failed, so some rooms may be missing." : "");
  }

  // ---- data + fetching (through the Cloudflare helper) -----------------------
  function loadData() {
    // Newest file via the helper; fall back to the copy deployed with the app.
    return fetch("api/data?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("no data"); return r.json(); })
      .catch(function () {
        return fetch("data/schedule.json?t=" + Date.now(), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("no data"); return r.json(); });
      })
      .then(function (d) { if (!d || !d.rooms || !d.rooms.length) throw new Error("empty data"); data = d; store("schedule", JSON.stringify(d)); showDataInfo(); updateHint(); return d; });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function api(path, body) {
    return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } : { cache: "no-store" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ("Error " + r.status)); return j; }); });
  }
  function mmss(secs) { secs = Math.max(0, Math.round(secs)); return Math.floor(secs / 60) + ":" + pad(secs % 60); }
  function left(secs) { return secs < 50 ? "under a minute left" : "about " + Math.max(1, Math.round(secs / 60)) + " min left"; }

  // Progress is an estimate: the fetch script goes through the studios in
  // FETCH_ORDER, one request per studio per day, about SECS_PER_REQUEST each
  // (measured on GitHub). GitHub tells us when the pull step starts and ends.
  function progressText(days, pullStart, order) {
    var total = days * order.length;
    var done = Math.min(total - 1, Math.floor((Date.now() - pullStart) / 1000 / SECS_PER_REQUEST));
    var site = Math.floor(done / days), day = done % days + 1;
    var name = order[site][1];
    var remaining = (total - done) * SECS_PER_REQUEST + 5;
    return {
      text: "Pulling " + name + " (studio " + (site + 1) + " of " + order.length + ")" +
        (days > 1 ? ", day " + day + " of " + days : "") + " · " + left(remaining),
      short: name + " " + (site + 1) + "/" + order.length + " · " + short(remaining),
      frac: done / total
    };
  }
  function short(secs) { return secs < 50 ? "<1 min" : "~" + Math.max(1, Math.round(secs / 60)) + " min"; }
  // The striped strip along the bottom of the Find rooms button.
  function strip(frac, text) {
    var on = frac != null;
    $("searchBtn").classList.toggle("busy", on); $("goProg").hidden = !on;
    if (!on) { $("goFill").style.width = "0"; return; }
    $("goFill").style.width = Math.round(Math.max(.04, Math.min(1, frac)) * 100) + "%";
    $("goText").textContent = text;
  }

  function runFetch(from, to, sites) {
    var started = Date.now(), days = daysBetween(from, to) + 1;
    var order = FETCH_ORDER.filter(function (s) { return sites.indexOf(s[0]) >= 0; });
    var total = days * order.length;
    var id = null, run = { status: "starting" }, timer = null, finished = false;
    function draw() {
      var msg, p;
      if (run.pull_started_at) { p = progressText(days, Date.parse(run.pull_started_at), order); msg = p.text; strip(p.frac, "Pulling fresh data · " + p.short); }
      else if (run.status === "queued") { msg = "Waiting in GitHub's queue"; strip(0, "Waiting in the queue"); }
      else { msg = "Starting up (about 30 s) · then " + total + " requests, " + left(total * SECS_PER_REQUEST + 30); strip(0, "Starting up · " + short(total * SECS_PER_REQUEST + 30)); }
      status(esc(msg) + '<div class="sub">Elapsed ' + mmss((Date.now() - started) / 1000) + ". You can leave this screen open.</div>");
    }
    draw();
    $("status").scrollIntoView({ behavior: "smooth", block: "center" });
    timer = setInterval(function () { if (!finished) draw(); }, 1000);
    function stop() { finished = true; clearInterval(timer); strip(null); }
    return api("api/fetch", { start: from, end: to, sites: sites }).then(function (r) {
      id = r.id;
      function poll() {
        return sleep(POLL_MS).then(function () { return api("api/run?id=" + encodeURIComponent(id)); }).then(function (x) {
          run = x;
          if (run.status === "starting" && Date.now() - started > 3 * 60000) throw new Error("GitHub did not start the fetch. Try again in a minute.");
          if (run.status !== "completed") return poll();
          if (run.conclusion !== "success") throw new Error('The fetch failed on GitHub.' + (run.url ? ' <a href="' + esc(run.url) + '" target="_blank" rel="noopener">See what happened</a>.' : ""));
          stop();
          status("Done. Loading results…");
          return sleep(1500).then(loadData);
        });
      }
      return poll();
    }).then(function (d) { stop(); return d; }, function (e) { stop(); throw e; });
  }

  // ---- results ---------------------------------------------------------------------
  var shownDay = null;
  function typeOrder(t) { var i = ["Lite", "Standard", "Pro", "Extra", "Acoustic"].indexOf(t); return i < 0 ? 9 : i; }
  function bookingUrl(room, date, hour, duration) {
    var off = (data.utc_offsets && data.utc_offsets[date]) || "+00:00";
    return "https://book.pirate.com/booking/" + room.site + "/" + room.studio_id + "/" + date + "T" + hh(hour) + ":00" + off +
      "?duration=" + duration + "&studio_super_type=1&total_guests=0";
  }
  // For each day: studios -> rooms that have at least minHours free in a row
  // inside the time window. Each room keeps its hour-by-hour state for the grid.
  function findRooms(f) {
    var now = londonNow();
    var siteName = {}; SITES.forEach(function (s) { siteName[s[0]] = s[1]; });
    var rooms = data.rooms.filter(function (r) { return f.sites.indexOf(r.site) >= 0 && f.types.indexOf(r.type) >= 0; });
    var days = [];
    for (var d = f.dateFrom; d <= f.dateTo; d = addDays(d, 1)) {
      if (d < now.date) continue;
      var bySite = {}, count = 0;
      rooms.forEach(function (r) {
        var hours = (data.free[r.key] || {})[d];
        if (!hours) return;
        var cells = [], firstStart = null, run = 0;
        for (var h = f.timeFrom; h < f.timeTo; h++) {
          var past = d === now.date && h <= now.hour;
          var state = past ? "past" : hours.charAt(h) === "1" ? "free" : hours.charAt(h) === "0" ? "booked" : "unknown";
          cells.push({ h: h, state: state });
        }
        // mark free hours that belong to a long-enough run
        for (var i = 0; i <= cells.length; i++) {
          if (i < cells.length && cells[i].state === "free") { run++; continue; }
          if (run >= f.minHours) {
            for (var k = i - run; k < i; k++) cells[k].fits = true;
            cells[i - run].runLen = run;
            if (firstStart === null) firstStart = cells[i - run].h;
          }
          run = 0;
        }
        if (firstStart === null) return;
        count++;
        (bySite[r.site] = bySite[r.site] || []).push({ room: r, cells: cells, firstStart: firstStart });
      });
      var sites = Object.keys(bySite).sort(function (a, b) { return (siteName[a] || a).localeCompare(siteName[b] || b); })
        .map(function (s) {
          return { slug: s, name: siteName[s] || s, rooms: bySite[s].sort(function (a, b) {
            return typeOrder(a.room.type) - typeOrder(b.room.type) || a.room.name.localeCompare(b.room.name, undefined, { numeric: true });
          }) };
        });
      days.push({ date: d, sites: sites, count: count });
    }
    return days;
  }
  function render(f) {
    var days = findRooms(f), total = 0;
    days.forEach(function (d) { total += d.count; });
    if (!days.some(function (d) { return d.date === shownDay; })) {
      var firstWith = days.filter(function (d) { return d.count; })[0] || days[0];
      shownDay = firstWith ? firstWith.date : null;
    }
    // day tabs
    $("dayTabs").innerHTML = days.map(function (d) {
      var dt = new Date(d.date + "T12:00:00Z");
      return '<button class="dt' + (d.date === shownDay ? " on" : "") + (d.count ? "" : " none") + '" data-day="' + d.date + '">' +
        "<i>" + dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }) + "</i><b>" + dt.getUTCDate() + "</b>" +
        "<s>" + d.count + " room" + (d.count === 1 ? "" : "s") + "</s></button>";
    }).join("");
    $("dayTabs").querySelectorAll(".dt").forEach(function (b) {
      b.addEventListener("click", function () { shownDay = b.dataset.day; render(readFilters()); });
    });
    var on = $("dayTabs").querySelector(".dt.on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });

    var day = days.filter(function (d) { return d.date === shownDay; })[0];
    var logo = (document.querySelector(".brand .logo") || {}).outerHTML || "";
    var out = [];
    if (day && day.count) {
      day.sites.forEach(function (s) {
        out.push('<div class="st"><div class="top"><h3>' + esc(s.name) + "</h3><span>" + s.rooms.length + " free</span></div>");
        s.rooms.forEach(function (x) {
          var href = bookingUrl(x.room, day.date, x.firstStart, f.minHours);
          out.push('<div class="rm"><a class="rl" target="_blank" rel="noopener" href="' + esc(href) + '"><b>' +
            esc(x.room.name) + "</b><em>" + esc(x.room.type) + '</em><span class="bk">Book ' + hh(x.firstStart) + " →</span></a>");
          out.push('<div class="g" style="--n:' + x.cells.length + '">');
          x.cells.forEach(function (c) {
            var run = c.runLen ? '<span class="run">' + c.runLen + "H</span>" : "";
            if (c.state === "free") {
              out.push('<a class="c free' + (c.fits ? " fit" : "") + (c.runLen ? " rs" : "") + '" target="_blank" rel="noopener" title="Book from ' + hh(c.h) + '" href="' +
                esc(bookingUrl(x.room, day.date, c.h, f.minHours)) + '">' + run + pad(c.h) + "</a>");
            } else {
              out.push('<span class="c ' + c.state + '" data-h="' + pad(c.h) + '" title="' + (c.state === "booked" ? "Booked " : c.state === "past" ? "Past " : "No data ") + hh(c.h) + '">' + pad(c.h) + "</span>");
            }
          });
          out.push("</div></div>");
        });
        out.push("</div>");
      });
    } else if (day) {
      out.push('<div class="empty">' + logo + "Nothing free that matches on " + esc(niceDate(day.date)) + ".<br>Try another day, more studios, a wider time window or fewer hours in a row.</div>");
    } else {
      out.push('<div class="empty">' + logo + "No days to show.</div>");
    }
    $("results").innerHTML = out.join("");
    $("resultsSummary").innerHTML = (day ? esc(niceDate(day.date)) + "<br>" : "") + pad(f.timeFrom) + "–" + pad(f.timeTo) + " · " + f.minHours + "h+ in a row · tap a room to book<br>" +
      '<span class="key"><i class="k-fit"></i>fits</span><span class="key"><i></i>free</span><span class="key"><i class="k-bk"></i>booked</span>';
    $("count").hidden = false; $("count").textContent = total;
  }

  // ---- search ------------------------------------------------------------------
  // Data only counts if it has the chosen dates AND every ticked studio.
  // Unticking a studio just filters; ticking one that isn't in the data means a new pull.
  function fetchedSites(d) { return (d && d.fetched_sites) || FETCH_ORDER.map(function (s) { return s[0]; }); }
  function missingSites(d, f) { return f.sites.filter(function (s) { return fetchedSites(d).indexOf(s) < 0; }); }
  // Data older than this is stale: the next Search pulls again.
  var MAX_AGE_MS = 60 * 60 * 1000;
  function isStale(d) { return !d || !d.generated_at || Date.now() - new Date(d.generated_at) > MAX_AGE_MS; }
  function covers(d, f) { return d && !isStale(d) && d.start <= f.dateFrom && d.end >= f.dateTo && !missingSites(d, f).length; }
  function siteNames(slugs) {
    var n = {}; SITES.forEach(function (s) { n[s[0]] = s[1]; });
    var names = slugs.map(function (x) { return n[x] || x; });
    return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
  }
  // Tell the user, before they press Search, whether it will need a new pull and why.
  function updateHint() {
    var f = readFilters(), h = $("pullHint");
    if (!h) return;
    var msg = "";
    if (data && f.sites.length) {
      var miss = missingSites(data, f);
      var datesOk = data.start <= f.dateFrom && data.end >= f.dateTo;
      if (!datesOk) msg = "New dates: Search will pull fresh data for the " + f.sites.length + " ticked studio" + (f.sites.length > 1 ? "s" : "") + ".";
      else if (isStale(data)) msg = "The data was pulled " + ago(data.generated_at) + " (more than 1 hour), so Search will pull fresh data for the " + f.sites.length + " ticked studio" + (f.sites.length > 1 ? "s" : "") + ".";
      else if (miss.length) msg = siteNames(miss) + (miss.length > 1 ? " aren't" : " isn't") + " in the current data, so Search will pull all " + f.sites.length + " ticked studios again.";
    }
    h.textContent = msg; h.hidden = !msg;
  }
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
      return runFetch(f.dateFrom, f.dateTo, f.sites);
    }).then(function () {
      status("");
      render(readFilters()); showTab("results");
    }).catch(function (e) {
      status(e.message || String(e), true);
    }).then(function () { busy = false; $("searchBtn").disabled = false; $("refreshBtn").disabled = false; });
  }
  $("searchBtn").addEventListener("click", function () { search(false); });
  $("refreshBtn").addEventListener("click", function () { search(true); });

  // ---- start ---------------------------------------------------------------------
  buildForm();
  $("siteCount").textContent = readFilters().sites.length;
  try { data = JSON.parse(store("schedule") || "null"); } catch (e) { data = null; }
  showDataInfo();
  updateHint();
  setInterval(function () { showDataInfo(); updateHint(); }, 60000);
  loadData().catch(function () {});
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
})();
