# PH News — Project Specification

**Version:** 0.1 (draft)
**Date:** 2026-06-10
**Status:** Pre-implementation. Open questions in §10 must be resolved before build.

---

## 1. Overview

A static website hosted on GitHub Pages that displays daily aggregated Philippine news. News content is produced by an existing Claude Code cloud routine, which commits one structured data file per day directly into the site's repository. The site is a pure client-side renderer of that data — no backend, no database, no build step.

The website specifications are located at `website_spec.md`, use that as reference for making the website

## 2. Goals

- Publish a daily digest of aggregated Philippine news, viewable at a stable URL.
- Fully automated pipeline: routine run → commit → live on site, with no manual step on a normal day.
- Browsable archive of all previous days.
- Failure-tolerant: a bad or missing daily file must never break the site; it degrades to the most recent good day.

## 3. Non-goals

- No user accounts, comments, search, or personalization.
- No server-side rendering or hosted backend of any kind.
- No real-time / intraday updates — one publish per day.
- The site does not perform aggregation itself; it only renders what the routine commits.

## 4. Assumptions (decisions baked into this spec — flag if wrong)

| # | Assumption | Impact if wrong |
|---|---|---|
| A1 | News is produced by a **Claude Code cloud routine** (claude.ai/code/routines), not a Cowork desktop scheduled task. | Desktop tasks only run while the machine is awake; delivery mechanism and reliability section would need rework. |
| A2 | The routine can be granted push access to this repo, with **unrestricted branch pushes enabled** so it commits to `main`. | If kept restricted to `claude/` branches, §8.2 (auto-merge Action) becomes mandatory instead of optional. |
| A3 | One publish per day, timed to Philippine mornings (e.g. 06:00 PHT / UTC+8). | Schema supports it either way, but `index.json` semantics assume one file per date. |
| A4 | Repo is public (required for GitHub Pages on free plans). | Private repo requires a paid GitHub plan for Pages. |

## 5. Architecture

```
┌─────────────────────┐     daily cron      ┌──────────────────────┐
│ Claude cloud routine │ ──────────────────▶ │ GitHub repo: ph-news │
│ (aggregates PH news) │  commit data/*.json │  main branch          │
└─────────────────────┘                     └──────────┬───────────┘
                                                       │ Pages deploy (automatic)
                                                       ▼
                                            ┌──────────────────────┐
                                            │ Static site           │
                                            │ index.html + app.js   │
                                            │ fetches data/*.json   │
                                            └──────────────────────┘
```

Single repository contains both the data and the renderer. GitHub Pages serves from `main` root. Every routine commit triggers a Pages redeploy automatically; no Actions workflow is required for deployment.

## 6. Repository structure

```
ph-news/
├── index.html              # single page; loads app.js
├── app.js                  # fetch + render logic
├── style.css
├── data/
│   ├── index.json          # manifest of available dates
│   ├── 2026-06-10.json     # one file per day
│   └── 2026-06-09.json
├── .github/
│   └── workflows/
│       └── validate.yml    # JSON schema validation on push (§8.2)
├── schema/
│   └── daily.schema.json   # JSON Schema for daily files
└── README.md
```

## 7. Data contract

This is the interface between the routine and the site. It must be treated as frozen once live; changes require a `version` bump and renderer support for both versions.

### 7.1 Daily file — `data/YYYY-MM-DD.json`

```json
{
  "version": 1,
  "date": "2026-06-10",
  "generated_at": "2026-06-10T06:00:00+08:00",
  "stories": [
    {
      "headline": "string, required, plain text, ≤200 chars",
      "summary": "string, required, plain text, 1–3 sentences, ≤600 chars",
      "source": "string, required, outlet name e.g. 'Rappler'",
      "url": "string, required, https URL to the original article",
      "category": "one of: politics | economy | metro | regions | weather | sports | world | other",
      "published_at": "ISO 8601 string, optional"
    }
  ]
}
```

Rules:
- `stories` length: minimum 3, maximum 30. Below 3, the routine must not publish (see §8.3).
- Summaries are the routine's own paraphrase — never copied article text.
- All strings plain text. No HTML, no markdown. The renderer escapes everything regardless (defense in depth — this data is injected into the DOM).
- Filename date, `date` field, and manifest entry must all agree.

### 7.2 Manifest — `data/index.json`

```json
{
  "version": 1,
  "latest": "2026-06-10",
  "dates": ["2026-06-10", "2026-06-09", "..."]
}
```

`dates` sorted descending. The site reads only this file to discover content; it never lists the directory.

## 8. Publishing pipeline

### 8.1 Routine specification

- **Trigger:** daily schedule, 06:00 PHT.
- **Repo access:** this repo attached; unrestricted branch pushes enabled (per A2).
- **Prompt requirements** (the routine prompt must instruct Claude to):
  1. Aggregate the day's Philippine news as it already does.
  2. Write `data/<today>.json` conforming exactly to §7.1, and prepend the date to `data/index.json`, updating `latest`.
  3. Validate before committing: file parses as JSON, validates against `schema/daily.schema.json`, date fields consistent, ≥3 stories.
  4. Commit with message `news: YYYY-MM-DD (<n> stories)` and push to `main`.
  5. If validation fails or fewer than 3 stories were found: do not commit anything. (Routines run unattended with no approval step — the prompt is the only pre-commit QA gate.)

### 8.2 Repo-side validation — `validate.yml`

GitHub Action on every push touching `data/`:
- Validate the changed daily file against `schema/daily.schema.json`.
- Verify `index.json` parses, `latest` exists as a file, no duplicate dates.
- On failure: the Action fails (red commit) and opens an issue. It does not revert automatically in v1.

This is the backstop for the case the routine prompt's self-validation misses something.

### 8.3 Failure modes

| Failure | Behavior |
|---|---|
| Routine run fails / finds <3 stories | No commit. Site shows previous day with a "last updated" date — this is the designed degradation, not an error state. |
| Malformed daily file slips through | `validate.yml` flags it; site renderer also catches parse errors and falls back to the next date in the manifest. |
| `index.json` corrupted | Renderer shows an error banner with the last successfully cached view (no caching in v1 → banner only). |

## 9. Site specification

### 9.1 Pages and behavior

Single page (`index.html`):
- **Header:** site title, "Updated: <latest date>" indicator. If `latest` is older than yesterday (PHT), show a subtle "no digest for today yet" note.
- **Date navigation:** previous/next arrows plus a date picker populated from `index.json.dates`. Default view = `latest`. Selected date reflected in the URL hash (`#2026-06-09`) so days are linkable.
- **Story list:** card per story — headline (links to source URL, `rel="noopener"`, new tab), summary, source name, category tag. Grouped or filterable by category (single-select filter chips; "all" default).
- **Footer:** brief disclaimer that summaries are AI-generated and link to the repo.

### 9.2 Technical constraints

- Vanilla HTML/CSS/JS only. No framework, no bundler, no npm. Rationale: the repo's only writer is an automated routine; zero build steps means zero build failures.
- All rendering via `textContent` / proper escaping — story data is treated as untrusted input.
- Mobile-first layout; the primary audience reads on phones.
- Timezone handling: all "today/yesterday" logic computed in Asia/Manila regardless of viewer's locale.
- Target: usable on a low-end connection — no web fonts required for function, total page weight (excluding data) under ~50 KB.

## 10. Open questions (resolve before implementation)

1. **Routine type confirmation** — cloud routine or Cowork desktop scheduled task? (Affects A1/A2 and §8 entirely.)
2. **Current routine output format** — what does it produce today (chat report, file, email)? Determines how much of the existing prompt is reusable vs. rewritten.
3. **Branch policy** — unrestricted push to `main` (simpler) vs. `claude/` branch + auto-merge Action (safer)? Spec assumes the former.
4. **Categories** — is the fixed list in §7.1 right for how the routine already groups stories?
5. **Repo visibility** — public acceptable?
6. **Custom domain** — `<user>.github.io/ph-news` or a custom domain (adds DNS + CNAME config)?

## 11. Out of scope for v1 / future candidates

- RSS/Atom feed generated from the daily JSON (cheap to add later).
- Category-level pages or full-text search (client-side, would need an index file).
- Migration path off routines: replace §8.1 with a GitHub Action on cron calling the Claude API — the data contract (§7) is deliberately producer-agnostic so the site never changes.
- Lightweight analytics (e.g. GoatCounter) if readership matters.

## 12. Acceptance criteria

- [ ] Routine runs on schedule and a new dated file + updated manifest appear on `main` with no manual step.
- [ ] Site shows the new digest within minutes of the commit (Pages deploy latency only).
- [ ] Any past date is reachable via picker and via direct URL hash.
- [ ] Committing a deliberately malformed daily file: Action fails, issue opened, site still renders the previous day.
- [ ] A day with no routine run leaves the site fully functional showing the prior digest.
- [ ] Site renders correctly on a ~375px-wide phone viewport.
