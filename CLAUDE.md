# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Is

**Social Media AI** — a tool that helps create viral Instagram Reels by analyzing competitor content. It scrapes competitors' recent videos, identifies the most viral ones, analyzes them with AI (video understanding + content breakdown), and generates new adapted video concepts for a given brand.

---

## How to Run

```bash
cd app
npm install
npm run dev
# Open http://localhost:3000
```

**Required environment variables** (in `.env` at project root):
- `APIFY_API_TOKEN` — Apify Instagram scraper
- `GEMINI_API_KEY` — Google Gemini video analysis
- `ANTHROPIC_API_KEY` — Claude concept generation

**Deploy (Cloudflare Workers via OpenNext):** `app/wrangler.jsonc` + `app/open-next.config.ts`. Cloudflare project root dir = `app`, build command `npx opennextjs-cloudflare build`, deploy command `npx opennextjs-cloudflare deploy`. Env vars/secrets are set in the Cloudflare dashboard (not `.env`). Local Worker test: copy `.env` to `app/.dev.vars` (gitignored), then `npm run preview`. `@opennextjs/cloudflare` requires Next ≥16.3.6.

---

## Tech Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS** + **shadcn/ui** components
- **Redis (Upstash)** — stores the configs/creators/videos "CSV" data (read/written as CSV-formatted strings via `csv.ts`); chosen over CSV-on-disk/Blob for immediate read-after-write consistency on Vercel
- **Vercel Blob** — stores downloaded video thumbnails (write-once, CDN-cached)
- **Apify** — Instagram scraping (`apify~instagram-scraper` actor, used both for creator-profile feeds and direct reel/post URLs)
- **Google Gemini 3.8 Flash** — Video analysis + transcript/hook extraction (upload + multimodal)
- **Claude Sonnet** — New concept generation

---

## How The System Works

### Two Ways to Add Videos (Run page)

Both share the same per-video analysis worker (`processVideo()` in `pipeline.ts`) and land in the same `videos` store — they only differ in how the video list is sourced.

**By Creators** (`runPipeline`)
1. Select a config and parameters (max videos, top-K, days lookback)
2. Load the config's analysis prompt, new concepts prompt, and creator list
3. For each competitor creator, scrape recent Instagram Reels via Apify
4. Filter by date, sort by views, take top-K most viral per creator

**By Links** (`runPipelineFromLinks`)
1. Select a config and paste a batch of direct Instagram reel/post URLs (any accounts)
2. Scrape exactly those URLs via Apify in one batch call (`scrapeReelsByUrls`) — no creator category or ranking involved

**Then, per video (shared):**
1. Download video, upload to Gemini, analyze with the config's analysis prompt (extracts Concept, Hook, Retention, Reward, Script as one markdown blob)
2. A second, fixed-prompt Gemini call extracts a structured `transcript` and a verbatim `hook` (first 3 seconds) as separate fields — best-effort, non-fatal on failure
3. Send analysis + brand context to Claude for adapted video concepts
4. Save the video (with views/likes/comments/shares, thumbnail, analysis, concepts, transcript, hook) to the videos store, viewable in the Videos page

### Two Customizable Prompts Per Config

- **Analysis Instruction** — How Gemini should break down the video
- **New Concepts Instruction** — How Claude should adapt the reference for the brand

### Known limitations
- Instagram doesn't publicly expose share counts, so `shares` is only ever populated for Facebook links — always 0 for Instagram.
- The link-based flow supports Instagram and Facebook reel links (auto-detected by domain); TikTok isn't wired up yet. The "By Creators" flow (tracked creator profiles) is still Instagram-only.

### Videos Page: Selection, Delete, Export
The Videos page supports multi-select (hover checkbox per card, or "Select All" which respects the active config/creator filter) for two bulk actions, both single-request (not looped per-id, to avoid read-modify-write races on the Redis-backed store):
- **Delete** — `DELETE /api/videos` with `{ ids }` (or `?id=` for a single video); best-effort deletes the matching Blob thumbnails too.
- **Export** — `POST /api/videos/export` with `{ ids }` downloads a Google-Sheets-safe CSV (via `csv-stringify`, same library `csv.ts` uses, plus a UTF-8 BOM for emoji/accented text) with columns: username, link, config, views, likes, comments, shares, date posted, date added, hook, analysis, concepts, transcript.
- **`sheets-formatter.gs`** (repo root) — a standalone Google Apps Script, not part of the Next.js app. Paste into the destination Sheet's Apps Script editor after importing an export to auto-format it: styled frozen header, muted alternating row banding, wrapped/fixed-width long-text columns, clickable Link column.

---

## Workspace Structure

```
.
├── CLAUDE.md                              # This file
├── .env                                   # API keys (not committed)
├── app/                                   # Next.js application
│   ├── src/
│   │   ├── app/                           # Pages and API routes
│   │   │   ├── page.tsx                   # Dashboard
│   │   │   ├── videos/page.tsx            # Videos browser: filter/sort, thumbnails, analysis/transcript/concepts modal
│   │   │   ├── run/page.tsx               # Pipeline runner — "By Creators" / "By Links" tabs, live progress
│   │   │   ├── configs/page.tsx           # Config management
│   │   │   ├── creators/page.tsx          # Creator management
│   │   │   └── api/                       # API routes (configs, creators, videos, videos/export, pipeline, pipeline/links)
│   │   ├── lib/                           # Core logic
│   │   │   ├── pipeline.ts               # Pipeline orchestration (runPipeline + runPipelineFromLinks, shared processVideo worker)
│   │   │   ├── apify.ts                  # Apify scraper client (creator feeds + direct-URL batch scraping)
│   │   │   ├── gemini.ts                 # Gemini video analysis + transcript/hook extraction
│   │   │   ├── claude.ts                 # Claude concept generation client
│   │   │   ├── csv.ts                    # CSV-shaped read/write over Redis (see Tech Stack)
│   │   │   └── types.ts                  # TypeScript interfaces
│   │   └── components/                    # UI components (shadcn + custom)
│   └── package.json
├── data/                                  # Legacy on-disk CSV snapshots (not read at runtime — see Tech Stack)
│   ├── configs.csv                        # Pipeline configurations
│   ├── creators.csv                       # Instagram creator accounts
│   └── videos.csv                         # Analyzed video results
├── sheets-formatter.gs                    # Standalone Google Apps Script — formats an exported CSV once pasted into Google Sheets
├── context/                               # Background context for Claude
├── plans/                                 # Implementation plans
└── .claude/commands/                      # Slash commands (prime, create-plan, implement)
```

---

## App Pages

| Page | Path | Description |
|------|------|-------------|
| Dashboard | `/` | Summary stats, recent videos |
| Videos | `/videos` | Browse results with thumbnails; filter by config, search by username; sort by views/likes/comments/shares/dates; multi-select (hover checkbox / Select All) for bulk delete or CSV export; expandable analysis, transcript & concepts (with a highlighted hook + copy-concepts button) |
| Run Pipeline | `/run` | "By Creators" (config + params) or "By Links" (config + pasted reel URLs), run with live progress streaming |
| Configs | `/configs` | CRUD for pipeline configs (prompts, categories) |
| Creators | `/creators` | CRUD for competitor Instagram accounts |

---

## Commands

### /prime
Initialize a new session with full context awareness.

### /create-plan [request]
Create a detailed implementation plan in `plans/`.

### /implement [plan-path]
Execute a plan step by step.

---

## Critical Instruction: Maintain This File

After any change to the workspace, ask:
1. Does this change add new functionality?
2. Does it modify the workspace structure documented above?
3. Should a new command be listed?
4. Does context/ need updates?

If yes, update the relevant sections.

---

## Session Workflow

1. **Start**: Run `/prime` to load context
2. **Work**: Use commands or direct Claude with tasks
3. **Plan changes**: Use `/create-plan` before significant additions
4. **Execute**: Use `/implement` to execute plans
5. **Maintain**: Claude updates CLAUDE.md and context/ as the workspace evolves
