# Lead Enrichment Pipeline

Upload a CSV of `Company Name, Website` pairs. Receive an enriched CSV by email: industry, sub-industry, primary product, ICP, estimated size, key offering, recent news, three sales angles, three risk signals, and source attribution.

## Pipeline

For each row, in order:

1. Website scrape (cheerio).
2. Tavily web search.
3. NewsAPI recent-headline fetch.
4. Gemini profile extraction (`generateObject` + Zod).
5. Gemini sales-angles + risk-signals synthesis (`generateObject` + Zod).

Steps 1-3 run in parallel per row. Rows are batched 5-at-a-time. Orchestrated by Vercel Workflow DevKit: each step gets durable retries, AI steps explicitly classify rate-limits as `RetryableError` (30s backoff) and auth errors as `FatalError`. After all rows complete, the enriched CSV is emailed via Resend.

The route streams `ProgressEvent`s as NDJSON; the UI consumes the stream and shows per-row, per-stage progress live.

## Stack

Next.js 16 (App Router, Node.js runtime), Vercel Workflow DevKit, AI SDK + `@ai-sdk/google` (Gemini 3.1 Flash-Lite), Zod, Cheerio, PapaParse, Resend, Tailwind v4.

## Environment

See `.env.example`. Required: `GOOGLE_GENERATIVE_AI_API_KEY`, `TAVILY_API_KEY`, `NEWSAPI_KEY`, `RESEND_API_KEY`. Optional: `RESEND_FROM` (defaults to `onboarding@resend.dev`, which only delivers to the Resend account owner — verify a domain for arbitrary recipients), `GEMINI_MODEL` (defaults to `gemini-3.1-flash-lite-preview`).

## Local dev

```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```

Open `http://localhost:3000`, upload `public/template.csv`, enter your email, submit.

## Deploy

```bash
npm i -g vercel
vercel link
vercel env add GOOGLE_GENERATIVE_AI_API_KEY      # repeat for TAVILY_API_KEY, NEWSAPI_KEY, RESEND_API_KEY
vercel deploy --prod
```

Or import the GitHub repo on https://vercel.com/new and add env vars in project settings. Route timeout is 300s; default Vercel function timeout is sufficient.

## Eval harness

```bash
npm run eval
```

Runs the two structured Gemini calls against fixture companies (Stripe, Vercel, Linear), asserts schema validity, non-empty fields, plausible industry classification, and that sales angles avoid common generic-fluff fragments. Catches "model returned empty array", schema drift, and obvious low-quality outputs. Requires `GOOGLE_GENERATIVE_AI_API_KEY`, `TAVILY_API_KEY`, `NEWSAPI_KEY`.

## Layout

```
src/
  app/
    page.tsx                 UI; consumes NDJSON progress stream.
    api/enrich/route.ts      POST handler; validates input, starts workflow, streams events.
  workflows/
    enrich-workflow.ts       Workflow + steps; bounded concurrency, retries, error classification.
  lib/
    ai-pipeline.ts           Two structured Gemini (3.1 Flash-Lite) calls + Zod schemas.
    scraper.ts               Bounded HTML fetch + cheerio extraction.
    tavily.ts                Tavily Search wrapper.
    news.ts                  NewsAPI wrapper.
    csv.ts                   Papa parse/unparse.
    email.ts                 Resend send with CSV attached.
    types.ts                 Shared row + result types.
scripts/
  eval.ts                    AI-pipeline assertions.
public/
  template.csv               10-company sample CSV.
```

## Limits

- Max 25 rows per submission.
- Max 1 MB CSV.
- Per-row HTML body capped at 2 MB (truncated, not failed).
- Workflow steps default to 3 retries; AI steps to 5, with explicit retry-after on 429/529.

## Output columns

`Company Name`, `Website`, `Industry`, `Sub-Industry`, `Primary Product / Service`, `Target Customer (ICP)`, `Estimated Company Size`, `Recent News Summary`, `Key Offering Summary`, `Sales Angle 1`, `Sales Angle 2`, `Sales Angle 3`, `Risk Signal 1`, `Risk Signal 2`, `Risk Signal 3`, `Data Sources Used`.

Per-row failures keep the row in the output with empty enrichment fields and a tagged failure note in `Data Sources Used` (`profile-failed: <message>` or `insights-failed: <message>`), so a partial batch never aborts the whole run.
