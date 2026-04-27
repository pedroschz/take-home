# AI-Driven Lead Enrichment Pipeline

Upload a CSV of companies, get an AI-enriched CSV emailed back. Built for the
Hemut AI Automation Systems take-home.

## What it does

For each row in the uploaded CSV (`Company Name`, `Website`):

1. **Website scrape** — fetches the homepage, strips chrome, extracts title +
   meta description + headings + body text.
2. **External API #1 — Tavily** — runs a web search for the company and pulls
   an AI-summarized answer plus 5 top results.
3. **External API #2 — NewsAPI.org** — pulls the most recent 5 English-language
   news articles mentioning the company.
4. **AI step 1 — profile extraction** — Claude Sonnet 4.6 turns the raw
   research bundle into a structured `CompanyProfile` (industry, sub-industry,
   product, ICP, size estimate, key offering, recent news summary). Zod
   schema validates the output.
5. **AI step 2 — sales/risk synthesis** — a second Claude call takes the
   structured profile *plus* the underlying research and generates exactly 3
   concrete sales angles and 3 risk signals, each grounded in a specific
   research signal.
6. **Email delivery** — the enriched rows are serialized to CSV and emailed
   to the recipient via Resend (as an attachment).

Concurrency: 3 companies are enriched in parallel. Per-row failures are
captured in the `Data Sources Used` column instead of aborting the batch.

## Architecture

```
                    ┌─────────────────────────────┐
   Browser ──POST──▶│  /api/enrich (Vercel Fn)    │
   form-data        │  runtime: nodejs · 300s cap │
                    └──────────────┬──────────────┘
                                   │
                  ┌────────────────┼────────────────┐
                  ▼                ▼                ▼
            scrapeWebsite    tavilySearch       fetchNews
            (cheerio)        (Tavily API)       (NewsAPI)
                  └────────────────┬────────────────┘
                                   ▼
                        extractCompanyProfile
                        (Claude · generateObject + Zod)
                                   ▼
                          generateInsights
                        (Claude · generateObject + Zod)
                                   ▼
                          buildEnrichedCsv
                                   ▼
                         sendEnrichedCsv (Resend)
```

Files:
- `src/app/page.tsx` — upload form (file + email).
- `src/app/api/enrich/route.ts` — POST handler, validates, orchestrates,
  emails. Node.js runtime, `maxDuration = 300`.
- `src/lib/scraper.ts` — fetch + cheerio website extractor.
- `src/lib/tavily.ts` — Tavily Search API client.
- `src/lib/news.ts` — NewsAPI.org client.
- `src/lib/ai-pipeline.ts` — two-step AI calls with Zod schemas.
- `src/lib/enrich.ts` — per-company orchestrator + concurrency-limited
  `enrichAll`.
- `src/lib/csv.ts` — papaparse-based input parsing + output building.
- `src/lib/email.ts` — Resend client with CSV attachment.
- `src/lib/types.ts` — `CompanyInputRow`, `EnrichedRow`, output schema.

## Quick start (local)

1. **Install**
   ```bash
   npm install
   ```

2. **Configure env** — copy `.env.example` to `.env.local` and fill in:

   | Variable             | Required | Where to get it                           |
   |----------------------|----------|-------------------------------------------|
   | `ANTHROPIC_API_KEY`  | yes      | https://console.anthropic.com/settings/keys |
   | `TAVILY_API_KEY`     | yes      | https://tavily.com (free tier)            |
   | `NEWSAPI_KEY`        | yes      | https://newsapi.org (free tier)           |
   | `RESEND_API_KEY`     | yes      | https://resend.com/api-keys               |
   | `ANTHROPIC_MODEL`    | no       | defaults to `claude-sonnet-4-6`           |
   | `RESEND_FROM`        | no       | defaults to `onboarding@resend.dev`†      |

   † With Resend's sandbox sender, emails only deliver to the address that
   owns the API key. To send to arbitrary recipients, verify a domain in
   Resend and set `RESEND_FROM` to a verified address.

3. **Run**
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000, drop in `public/template.csv` (10 sample
   companies), enter your email, click **Enrich and email**.

## Deploy to Vercel

```bash
# install CLI if needed
npm i -g vercel

# from the repo root
vercel link        # link the directory to a Vercel project
vercel env add ANTHROPIC_API_KEY    # repeat for TAVILY_API_KEY, NEWSAPI_KEY, RESEND_API_KEY
vercel deploy --prod
```

Or push to GitHub and import the repo on https://vercel.com/new — Vercel
auto-detects Next.js and you only need to add the environment variables in
the project settings.

The `/api/enrich` route declares `maxDuration = 300` (5 minutes), which is
the default Fluid Compute timeout and plenty of room for ~10 companies at 3x
concurrency.

## Input CSV format

Required headers (case-sensitive):

| Header        | Required | Notes                                             |
|---------------|----------|---------------------------------------------------|
| `Company Name`| yes      | Used as the search seed                           |
| `Website`     | yes      | `https://` prefix is added automatically if missing |

Other columns are accepted but overwritten in the output. Max 25 rows per
upload, max 1MB file size.

## Output CSV format

| Column                        | Source                                |
|-------------------------------|---------------------------------------|
| `Company Name`                | input (passthrough)                   |
| `Website`                     | input (normalized)                    |
| `Industry`                    | AI step 1                             |
| `Sub-Industry`                | AI step 1                             |
| `Primary Product / Service`   | AI step 1                             |
| `Target Customer (ICP)`       | AI step 1                             |
| `Estimated Company Size`      | AI step 1                             |
| `Recent News Summary`         | AI step 1 (grounded in NewsAPI)       |
| `Key Offering Summary`        | AI step 1                             |
| `Sales Angle 1/2/3`           | AI step 2                             |
| `Risk Signal 1/2/3`           | AI step 2                             |
| `Data Sources Used`           | semicolon-joined source tags + errors |

## Error handling

- **Invalid CSV / bad email** → 400 with a human-readable message; UI shows
  the error inline.
- **Per-row scrape/search/news failure** → that source is dropped from the
  research bundle, the AI is told it failed, and the row continues.
- **AI profile extraction failure** → row is emitted with empty enrichment
  fields and `profile-failed: <message>` in `Data Sources Used`.
- **AI insights failure** → row keeps the profile fields but leaves the sales
  angles / risk signals empty, with `insights-failed: <message>` recorded.
- **Email failure** → 500; pipeline state is unrecoverable from the user's
  perspective so they can retry.

## Limits

- Input rows capped at 25 (configurable in `src/app/api/enrich/route.ts`).
- File size capped at 1MB.
- AI concurrency capped at 3 in-flight per request.
- Total request budget = 300s on Vercel.

## Tech stack

- Next.js 16 (App Router) + React 19, TypeScript, Tailwind CSS
- Vercel AI SDK v6 (`ai` + `@ai-sdk/anthropic`) with `generateObject` + Zod
- Tavily Search API · NewsAPI.org
- Resend (email)
- Papaparse (CSV) · Cheerio (HTML extraction)
