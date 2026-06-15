# PH News

A daily digest of aggregated Philippine news, rendered as a static single-page
site. News content is produced by an automated Claude routine that commits one
JSON file per day into this repository; the site is a pure client-side renderer
of those files — no backend, no database, no build step.

## How it works

```
Claude routine (daily, 06:00 PHT)
        │  commits data/YYYY-MM-DD.json + updates data/index.json
        ▼
GitHub repo (main) ──▶ GitHub Pages ──▶ index.html + app.js render the data
```

- `data/index.json` is the manifest: it lists every published date and the
  latest one. The site never guesses filenames; it only trusts the manifest.
- `data/YYYY-MM-DD.json` holds one day's stories. The format is validated
  against [`schema/daily.schema.json`](schema/daily.schema.json).
- If a day's file is missing or corrupt, the site automatically falls back to
  the nearest available day and says so — a bad publish never breaks the site.

## Features

- **Date navigation** — previous/next buttons and a date picker; every day is
  directly linkable via URL hash (e.g. `#2026-06-09`).
- **Category filter** — single-select chips showing only the categories present
  in the loaded day.
- **Per-story context** — stories may carry optional "Context" and "What to
  watch for" notes alongside the summary.
- **Display preferences** — a light/dark/auto theme toggle and a text-size
  slider (80–150%, default 100%), stored in the browser's localStorage.
- **Manila time everywhere** — "today", dates, and timestamps are computed in
  Asia/Manila regardless of where the reader is.

## Data contract

Each story in a daily file:

| Field | Required | Notes |
|---|---|---|
| `headline` | yes | plain text, ≤200 chars |
| `summary` | yes | plain text, 1–3 sentences, ≤600 chars |
| `source` | yes | outlet name, e.g. "Rappler" |
| `url` | yes | https link to the original article |
| `category` | yes | `politics` `economy` `metro` `regions` `weather` `sports` `world` `other` |
| `published_at` | no | ISO 8601 |
| `context` | no | background for the story, ≤500 chars |
| `watch_for` | no | what to watch out for next, ≤500 chars |
| `updated_at` | no | ISO 8601; shown as an "Updated as of" note for developing stories |

All strings are plain text (no HTML/markdown) and are rendered exclusively via
`textContent` — story data is treated as untrusted input. Unknown categories
are bucketed as `other`; invalid URLs render the story without a link.

## Development

No tooling required. Serve the repo root and open it:

```sh
python3 -m http.server 8000
# then visit http://localhost:8000
```

The committed data files double as test fixtures: `2026-06-09` is a thin
single-category day, and `2026-06-08` is deliberately invalid JSON to exercise
the fallback path.

## Disclaimer

Summaries, context notes, and "what to watch for" notes are AI-generated
paraphrases and may contain errors. Every story links to its original source —
read the source for the full picture.
