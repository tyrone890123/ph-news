"use strict";

/* ---------- constants ---------- */

const DATA_DIR = "data/";
const MAX_FALLBACK_ATTEMPTS = 3;

const CATEGORY_LABELS = {
  politics: "Politics",
  economy: "Economy",
  metro: "Metro",
  regions: "Regions",
  weather: "Weather",
  sports: "Sports",
  world: "World",
  other: "Other",
};

const els = {
  masthead: document.getElementById("masthead-date"),
  updated: document.getElementById("updated"),
  prev: document.getElementById("prev-day"),
  next: document.getElementById("next-day"),
  select: document.getElementById("date-select"),
  main: document.getElementById("main"),
  notice: document.getElementById("notice"),
  filters: document.getElementById("filters"),
  stories: document.getElementById("stories"),
  live: document.getElementById("live-region"),
};

/* ---------- state ---------- */

const state = {
  manifest: null,
  currentDate: null,
  currentDay: null,
  filter: "all",
};

let loadSeq = 0;

/* ---------- date helpers (all Manila-anchored) ---------- */

function manilaTodayString() {
  // en-CA formats as YYYY-MM-DD, so it compares directly with data date strings.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
}

function datePartGetter(dateStr) {
  // Anchor at midnight +08:00 so the calendar date never shifts in any viewer locale.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(new Date(dateStr + "T00:00:00+08:00"));
  return (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : "";
  };
}

function longDate(dateStr) {
  const get = datePartGetter(dateStr);
  return `${get("weekday")}, ${get("day")} ${get("month")} ${get("year")}`;
}

function shortDate(dateStr) {
  const get = datePartGetter(dateStr);
  return `${get("day")} ${get("month")} ${get("year")}`;
}

function manilaTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/* ---------- data helpers ---------- */

function safeHttpsUrl(raw) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeStories(stories) {
  if (!Array.isArray(stories)) return [];
  return stories.map((s) => ({
    headline: typeof s.headline === "string" ? s.headline : "",
    summary: typeof s.summary === "string" ? s.summary : "",
    source: typeof s.source === "string" ? s.source : "",
    url: safeHttpsUrl(s.url),
    category: Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, s.category)
      ? s.category
      : "other",
    publishedAt: typeof s.published_at === "string" ? s.published_at : null,
  }));
}

function visibleStories() {
  if (!state.currentDay) return [];
  return state.currentDay.stories.filter(
    (s) => state.filter === "all" || s.category === state.filter
  );
}

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

/* ---------- render ---------- */

function renderUpdated() {
  const latest = state.manifest.latest;
  els.updated.textContent =
    latest < manilaTodayString()
      ? `Updated: ${shortDate(latest)} — no digest yet for today.`
      : `Updated: ${shortDate(latest)}`;
}

function populateSelect() {
  for (const date of state.manifest.dates) {
    const opt = document.createElement("option");
    opt.value = date;
    opt.textContent = longDate(date);
    els.select.appendChild(opt);
  }
  els.select.disabled = false;
}

function updateNav(dateStr) {
  const dates = state.manifest.dates; // descending: index 0 is newest
  const i = dates.indexOf(dateStr);
  els.next.disabled = i <= 0;
  els.prev.disabled = i < 0 || i >= dates.length - 1;
  els.select.value = dateStr;
}

function renderFilters() {
  els.filters.replaceChildren();
  if (!state.currentDay || state.currentDay.stories.length === 0) return;
  const present = new Set(state.currentDay.stories.map((s) => s.category));
  const options = ["all", ...Object.keys(CATEGORY_LABELS).filter((c) => present.has(c))];
  for (const cat of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.textContent = cat === "all" ? "All" : CATEGORY_LABELS[cat];
    btn.setAttribute("aria-pressed", String(cat === state.filter));
    btn.addEventListener("click", () => {
      if (state.filter === cat) return;
      state.filter = cat;
      for (const b of els.filters.children) b.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-pressed", "true");
      renderStories();
      announce();
    });
    els.filters.appendChild(btn);
  }
}

function storyNode(story) {
  const article = document.createElement("article");
  article.className = "story";

  const h2 = document.createElement("h2");
  h2.className = "story-headline";
  h2.textContent = story.headline;
  article.appendChild(h2);

  if (story.summary) {
    const p = document.createElement("p");
    p.className = "story-summary";
    p.textContent = story.summary;
    article.appendChild(p);
  }

  const metaParts = [CATEGORY_LABELS[story.category]];
  const time = story.publishedAt ? manilaTime(story.publishedAt) : null;
  if (time) metaParts.push(time);
  const footer = document.createElement("p");
  footer.className = "story-footer";
  if (story.url) {
    footer.append("Read at ");
    const a = document.createElement("a");
    a.href = story.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = story.source || "source";
    // Source names repeat across stories; tie each link to its headline for screen readers.
    a.setAttribute("aria-label", `Read at ${story.source || "the source"}: ${story.headline}`);
    footer.appendChild(a);
    footer.append(` · ${metaParts.join(" · ")}`);
  } else {
    footer.textContent = [story.source, ...metaParts].filter(Boolean).join(" · ");
  }
  article.appendChild(footer);

  return article;
}

function renderStories() {
  els.stories.replaceChildren();
  if (!state.currentDay) return;
  if (state.currentDay.stories.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No stories for this day.";
    els.stories.appendChild(p);
    return;
  }
  for (const story of visibleStories()) {
    els.stories.appendChild(storyNode(story));
  }
}

function announce() {
  const n = visibleStories().length;
  els.live.textContent = `Showing ${n} ${n === 1 ? "story" : "stories"} for ${shortDate(state.currentDate)}`;
}

function fadeIn() {
  for (const el of [els.masthead, els.main]) {
    el.classList.remove("day-enter");
    void el.offsetWidth; // restart the animation
    el.classList.add("day-enter");
  }
}

function renderDay(failedDate) {
  els.masthead.textContent = longDate(state.currentDate);
  document.title = `PH News — ${shortDate(state.currentDate)}`;
  updateNav(state.currentDate);
  if (failedDate) {
    els.notice.textContent = `Showing ${shortDate(state.currentDate)} — ${shortDate(failedDate)} couldn't be loaded.`;
    els.notice.hidden = false;
  } else {
    els.notice.textContent = "";
    els.notice.hidden = true;
  }
  renderFilters();
  renderStories();
  announce();
  fadeIn();
}

function showLoading() {
  els.notice.textContent = "";
  els.notice.hidden = true;
  els.filters.replaceChildren();
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = "Loading…";
  els.stories.replaceChildren(p);
}

function renderLoadFailure(dateStr) {
  state.currentDate = dateStr;
  state.currentDay = null;
  els.masthead.textContent = longDate(dateStr);
  document.title = `PH News — ${shortDate(dateStr)}`;
  updateNav(dateStr);
  els.filters.replaceChildren();
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = `Couldn't load the digest for ${shortDate(dateStr)}. Try reloading.`;
  els.stories.replaceChildren(p);
  els.live.textContent = p.textContent;
}

function showFatal() {
  const main = document.createElement("main");
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = "Couldn't load the digest index. Try reloading.";
  main.appendChild(p);
  document.body.replaceChildren(main);
}

/* ---------- controller ---------- */

async function loadDate(requestedDate) {
  const seq = ++loadSeq;
  const dates = state.manifest.dates;
  showLoading();
  // Fallback candidates: next (older) dates in the manifest first; if the
  // requested date is at the old end, walk toward newer dates instead.
  const idx = dates.indexOf(requestedDate);
  const candidates = [requestedDate]
    .concat(dates.slice(idx + 1))
    .concat(dates.slice(0, idx).reverse())
    .slice(0, 1 + MAX_FALLBACK_ATTEMPTS);
  let failed = null;
  for (const date of candidates) {
    try {
      const day = await fetchJson(`${DATA_DIR}${date}.json`);
      if (seq !== loadSeq) return;
      if (day.version !== 1) {
        console.warn(`Daily file ${date} has version ${day.version}; renderer expects 1.`);
      }
      state.currentDate = date;
      state.currentDay = { ...day, stories: normalizeStories(day.stories) };
      state.filter = "all";
      renderDay(failed);
      if (failed) history.replaceState(null, "", `#${date}`);
      return;
    } catch (err) {
      if (seq !== loadSeq) return;
      console.warn(`Failed to load ${date}:`, err);
      if (failed === null) failed = requestedDate;
    }
  }
  if (seq === loadSeq) renderLoadFailure(requestedDate);
}

function onHashChange() {
  const dates = state.manifest.dates;
  const fromHash = decodeURIComponent(location.hash.slice(1));
  let target = dates.includes(fromHash) ? fromHash : null;
  if (!target) {
    target = state.manifest.latest;
    if (fromHash) history.replaceState(null, "", `#${target}`);
  }
  if (target !== state.currentDate) loadDate(target);
}

function navigateTo(dateStr) {
  if (location.hash === `#${dateStr}`) {
    // Hash already matches (e.g. retrying a failed day), so no hashchange will fire.
    loadDate(dateStr);
  } else {
    location.hash = dateStr;
  }
}

function step(delta) {
  const dates = state.manifest.dates;
  const target = dates[dates.indexOf(state.currentDate) + delta];
  if (target) navigateTo(target);
}

async function init() {
  let manifest;
  try {
    manifest = await fetchJson(`${DATA_DIR}index.json`);
    if (
      !manifest ||
      typeof manifest.latest !== "string" ||
      !Array.isArray(manifest.dates) ||
      manifest.dates.length === 0
    ) {
      throw new Error("Manifest is missing required fields");
    }
  } catch (err) {
    console.warn("Failed to load data/index.json:", err);
    showFatal();
    return;
  }
  if (manifest.version !== 1) {
    console.warn(`index.json has version ${manifest.version}; renderer expects 1.`);
  }
  state.manifest = manifest;

  renderUpdated();
  populateSelect();

  els.prev.addEventListener("click", () => step(1));
  els.next.addEventListener("click", () => step(-1));
  els.select.addEventListener("change", () => navigateTo(els.select.value));
  window.addEventListener("hashchange", onHashChange);

  onHashChange();
}

init();
