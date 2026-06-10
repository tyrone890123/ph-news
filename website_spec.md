# PH News — Website Build Specification

**Version:** 0.1 (draft)
**Date:** 2026-06-10
**Audience:** the agent implementing the site. This document is self-contained: everything needed to build is here, including test fixtures. Where it conflicts with the companion docs (`ph-news-spec.md`, `ph-news-routine-spec.md`), the companion docs win on the data contract; this doc wins on rendering behavior and design.

---

## 1. What you are building

A minimalist, static, single-page website that renders a daily Philippine news digest from JSON files committed to the same repository. Served by GitHub Pages from the `main` branch root. No build step, no framework, no dependencies, no network calls except fetching the repo's own `data/*.json` files.

The site has exactly one job: show the selected day's stories clearly, defaulting to the latest day.

## 2. Deliverables

```
index.html      # complete document; references app.js and style.css
app.js          # all logic; ES2020+, single file, no modules required
style.css       # all styles; single file
data/           # use the fixtures in §10 during development
  index.json
  2026-06-10.json
  2026-06-09.json
  2026-06-08.json
schema/daily.schema.json   # copy from §3, used by the validation Action (separate task; do not build the Action here)
```

Hard constraints:
- **No** npm, bundlers, frameworks, CSS preprocessors, or CDN-loaded libraries.
- **No** service workers, localStorage/sessionStorage, cookies, or analytics.
- **No** modification of anything under `data/` semantics — the renderer adapts to data, never rewrites it.
- Total weight of `index.html + app.js + style.css` under 50 KB uncompressed. Web fonts, if used at all, must be progressive enhancement — the page must be fully usable with system fonts.

## 3. Input data contract (what the renderer consumes)

### `data/index.json`
```json
{ "version": 1, "latest": "2026-06-10", "dates": ["2026-06-10", "2026-06-09", "2026-06-08"] }
```
`dates` is descending, no duplicates. Trust it as the only source of truth for what days exist — never probe for files by guessing dates.

### `data/YYYY-MM-DD.json`
```json
{
  "version": 1,
  "date": "2026-06-10",
  "generated_at": "2026-06-10T06:02:11+08:00",
  "stories": [
    {
      "headline": "string ≤200 chars",
      "summary": "string ≤600 chars",
      "source": "string",
      "url": "https://...",
      "category": "politics|economy|metro|regions|weather|sports|world|other",
      "published_at": "ISO 8601, OPTIONAL — may be absent"
    }
  ]
}
```

**Treat every string as untrusted.** It is produced by an automated pipeline. All rendering must use `textContent` or equivalent escaping — never `innerHTML` with interpolated data. URLs must be validated as `https:` before being used in an `href`; if invalid, render the story without a link rather than dropping it.

Renderer tolerance rules (be liberal in what you accept):
- Unknown `category` value → bucket as `other`, don't crash.
- Missing optional fields → omit from display.
- `version` ≠ 1 → render anyway, log a console warning.
- Strings exceeding stated max lengths → render, CSS-clamp if needed.

## 4. Functional requirements

### 4.1 Load flow
1. Fetch `data/index.json`.
2. Determine target date: URL hash `#YYYY-MM-DD` if present **and** in `dates`; otherwise `latest`.
3. Fetch the daily file, render.
4. While fetching: show a minimal loading state (text "Loading…" is sufficient; no spinners or skeletons).

### 4.2 Date navigation
- Prev/next controls stepping through `dates` (next disabled on latest, prev disabled on oldest).
- A `<select>` (or native `<input type="date">` constrained to available dates — `<select>` is simpler and preferred) listing all dates, newest first.
- Selecting a date updates the URL hash via `history.replaceState`-equivalent hash assignment, so any day is directly linkable. Hash changes from the back button must also drive navigation (`hashchange` listener).
- Display dates in long form, e.g. "Tuesday, 10 June 2026". Date math/labels computed in **Asia/Manila** via `Intl.DateTimeFormat` with `timeZone: "Asia/Manila"`, regardless of viewer locale.

### 4.3 Staleness indicator
- Header shows "Updated: <latest date>".
- If `latest` is before "today" in Asia/Manila, append a quiet note: "No digest yet for today." Computing "today in Manila": format `new Date()` with `timeZone: "Asia/Manila"` and compare date strings — do not do manual offset arithmetic.

### 4.4 Category filter
- One row of filter controls: "All" + only the categories actually present in the loaded day (don't show empty categories).
- Single-select. Filtering hides non-matching stories; it never refetches. Filter resets to "All" on date change.
- Implement as real `<button>`s with `aria-pressed`.

### 4.5 Story rendering
Each story, in the order given by the file (do not re-sort):
- Headline as a link to `url`, `target="_blank" rel="noopener noreferrer"`.
- Summary.
- Meta line: source name · category label · `published_at` time (Manila, "3:45 PM" style) if present.
- No images, no favicons, no share buttons.

### 4.6 Failure states (all must be implemented)
| Condition | Behavior |
|---|---|
| `index.json` fetch fails / unparseable | Full-page message: "Couldn't load the digest index. Try reloading." Nothing else. |
| Daily file fetch fails / unparseable | Inline error for that day + automatically attempt the next date in `dates`; show "Showing <date> — <failed date> couldn't be loaded." Stop after 3 fallback attempts. |
| `stories` empty | "No stories for this day." with nav still functional. |
| Hash references a date not in `dates` | Silently fall back to `latest`; replace the hash. |

Error copy is directive and unapologetic — say what happened and what to do, per the failure-state rules above. No "Oops" or "Sorry".

## 5. Design specification

Direction: **type-led minimalism**. The digest's identity is the date and the words — there is no imagery, so typography does all the work. Minimal means precise, not bare: spacing and hierarchy must be exact.

### 5.1 Tokens
```css
:root {
  --bg:        #FFFFFF;
  --ink:       #1A1A1A;   /* body text */
  --ink-soft:  #6B6B6B;   /* meta lines, disabled, notes */
  --accent:    #0038A8;   /* PH-flag blue: links, active filter, focus */
  --rule:      #E5E5E5;   /* hairline separators */
  --max-width: 40rem;     /* single column, centered */
}
```
Dark mode via `prefers-color-scheme`: invert bg/ink (`#121212` / `#EDEDED`), lighten accent to `#7AA2E8`, keep everything else structural. No theme toggle UI.

### 5.2 Type
- System stack only: `font-family: ui-serif, Georgia, serif` for headlines and the masthead date; `system-ui, -apple-system, sans-serif` for summaries, meta, and controls. The serif/sans split is the entire visual pairing — no font files.
- Scale: masthead date ~2.5rem/700; story headlines 1.25rem/650; body 1rem/400, line-height 1.6; meta 0.8125rem, `--ink-soft`.

### 5.3 Layout and signature
- Single centered column, `max-width: var(--max-width)`, generous side padding on mobile (≥1.25rem).
- **Signature element — the date is the masthead.** The page's largest element is the long-form date of the digest being viewed, with the site name above it as a small uppercase eyebrow ("PH NEWS DIGEST", letter-spaced, `--ink-soft`). When the user changes the date, the masthead changes — the date *is* the title of the page. Also reflect it in `document.title`: "PH News — 10 June 2026".
- Stories separated by a single hairline rule (`--rule`), not boxed cards, no shadows, no border-radius decoration.
- Category filter row sits between masthead and stories; active filter is solid `--accent` with white text, inactive is text-only.
- Motion: none, except a single ~150ms opacity fade on day change. Respect `prefers-reduced-motion` (disable the fade).

### 5.4 What "minimalist" forbids here
No hero sections, no gradient accents, no icons (text labels only), no card grids, no sticky headers, no infinite scroll, no skeleton loaders, no emoji in UI copy.

## 6. Accessibility (quality floor, not optional)

- Semantic structure: `<header>`, `<nav>` for date controls, `<main>`, one `<article>` per story, `<h1>` = masthead date, `<h2>` per headline.
- All interactive elements are native `<button>`/`<a>`/`<select>` — no div-buttons.
- Visible keyboard focus on everything interactive (`outline` in `--accent`, never `outline: none` without replacement).
- Day-change and filter-change announce via a polite `aria-live` region (e.g. "Showing 12 stories for 9 June 2026").
- Color contrast ≥ 4.5:1 for all text including meta lines (the tokens above pass; keep them).

## 7. Performance budget

- ≤ 50 KB total for html+js+css; zero external requests beyond same-origin `data/`.
- First render (loading state) must not wait on JS beyond parsing — structure lives in `index.html`, JS fills it.
- Don't fetch more than one daily file at a time; no prefetching in v1.

## 8. Explicitly out of scope — do not build

Search, RSS output, pagination, multiple-day views, service-worker offline support, share buttons, comments, settings, i18n framework (UI copy is English, hardcoded), any build tooling, any GitHub Action (the validation Action is a separate task).

If something in this spec seems to require one of these, stop and flag it instead of building it.

## 9. Implementation notes for the agent

- Single `app.js` organized as: constants → state (`{ manifest, currentDate, currentDay, filter }`) → pure render functions → fetch/controller functions → event wiring. No classes needed.
- Render by clearing and rebuilding the story list node with `document.createElement` + `textContent`. This is the escaping strategy — there must be no code path that assigns untrusted strings via `innerHTML`.
- Keep date strings as strings (`"2026-06-10"`) for identity/comparison; only construct `Date` objects for formatting.
- Comments only where the *why* is non-obvious (e.g. the Manila-timezone comparison trick); no narration comments.

## 10. Development fixtures

Create exactly these so the site is testable before the routine exists. They deliberately include the edge cases.

`data/index.json`
```json
{ "version": 1, "latest": "2026-06-10", "dates": ["2026-06-10", "2026-06-09", "2026-06-08"] }
```

`data/2026-06-10.json` — normal day: 6 stories spanning ≥4 categories, one story **without** `published_at`, one story with an unknown category value `"showbiz"` (must bucket to `other`), one headline containing `<b>&"'` characters (must render literally, proving escaping).

`data/2026-06-09.json` — thin day: exactly 3 stories, single category, to verify the filter row collapses sensibly.

`data/2026-06-08.json` — deliberately **invalid JSON** (truncate the file), to exercise §4.6 fallback: selecting it must show the fallback message and land on 2026-06-09.

Author realistic-but-fictional story content for fixtures (plausible PH-style headlines, clearly invented specifics). Do not copy real article text.

## 11. Acceptance tests

Manual checklist; all must pass on a 375px viewport and a desktop viewport, in light and dark mode:

- [ ] Fresh load shows 2026-06-10 with masthead date, 6 stories, filter row showing only present categories.
- [ ] `#2026-06-09` direct load shows that day; back button after navigating returns correctly.
- [ ] `#2031-01-01` falls back to latest and corrects the hash.
- [ ] Selecting 2026-06-08 (corrupt fixture) shows the fallback notice and 2026-06-09's stories.
- [ ] The `<b>&"'` headline renders as literal text, not markup.
- [ ] The `showbiz` story appears and is reachable via the `other` filter.
- [ ] Filter to a category, change day → filter is reset to All.
- [ ] With system clock such that Manila "today" > latest, the "No digest yet for today" note appears (test by temporarily editing `latest` to a past date).
- [ ] Keyboard-only: tab through nav → filters → headlines with visible focus throughout; prev/next operable with Enter/Space.
- [ ] Lighthouse (or equivalent): accessibility ≥ 95; total transfer of own assets ≤ 50 KB.
- [ ] `prefers-reduced-motion: reduce` → no fade animation.

## 12. Definition of done

All §11 checks pass; no console errors on any fixture day; no `innerHTML` with data-derived strings anywhere in `app.js`; file set matches §2 exactly with nothing extra committed.
