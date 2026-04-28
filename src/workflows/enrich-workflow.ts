import { getWritable } from "workflow";
import {
  buildResearchContext,
  extractCompanyProfile,
  generateInsights,
  type CompanyInsights,
  type CompanyProfile,
} from "@/lib/ai-pipeline";
import { buildEnrichedCsv } from "@/lib/csv";
import { sendEnrichedCsv } from "@/lib/email";
import { fetchNews } from "@/lib/news";
import type { ProgressEvent, StageName } from "@/lib/progress";
import { normalizeUrl, scrapeWebsite } from "@/lib/scraper";
import { tavilySearch } from "@/lib/tavily";
import type {
  CompanyInputRow,
  EnrichedRow,
  NewsResult,
  ScrapeResult,
  TavilyResult,
} from "@/lib/types";
import { log, timed, timedAi, trunc } from "./instrumentation";
import { buildEnrichedRow } from "./row-builder";

export type { ProgressEvent } from "@/lib/progress";

const ROW_CONCURRENCY = 5;

async function emit(event: ProgressEvent): Promise<void> {
  "use step";
  const writer = getWritable<ProgressEvent>().getWriter();
  try {
    await writer.write(event);
  } finally {
    writer.releaseLock();
  }
}

async function closeStream(): Promise<void> {
  "use step";
  await getWritable<ProgressEvent>().close();
}

async function emitStage(
  rowIdx: number,
  stage: StageName,
  status: "running" | "ok" | "failed",
  message?: string,
): Promise<void> {
  await emit({ type: "stage", rowIdx, stage, status, message });
}

async function scrapeStep(
  rowIdx: number,
  website: string,
): Promise<ScrapeResult> {
  "use step";
  return timed(
    "scrape",
    { row: rowIdx, url: website },
    () => scrapeWebsite(website),
    (r) => ({ ok: r.ok, extra: { bytes: r.text.length, error: r.error } }),
  );
}

async function tavilyStep(
  rowIdx: number,
  companyName: string,
): Promise<TavilyResult> {
  "use step";
  return timed(
    "tavily",
    { row: rowIdx, company: companyName },
    () =>
      tavilySearch(`${companyName} company overview product target customers`),
    (r) => ({ ok: r.ok, extra: { results: r.results.length, error: r.error } }),
  );
}

async function newsStep(
  rowIdx: number,
  companyName: string,
): Promise<NewsResult> {
  "use step";
  return timed(
    "news",
    { row: rowIdx, company: companyName },
    () => fetchNews(companyName),
    (r) => ({
      ok: r.ok,
      extra: { articles: r.articles.length, error: r.error },
    }),
  );
}

async function profileStep(args: {
  companyName: string;
  context: string;
}): Promise<CompanyProfile> {
  "use step";
  return timedAi(
    "profile",
    { company: args.companyName },
    () => extractCompanyProfile(args),
    (r) => ({ industry: r.industry }),
  );
}
profileStep.maxRetries = 5;

async function insightsStep(args: {
  companyName: string;
  profile: CompanyProfile;
  context: string;
}): Promise<CompanyInsights> {
  "use step";
  return timedAi(
    "insights",
    { company: args.companyName },
    () => generateInsights(args),
    (r) => ({ angles: r.salesAngles.length, risks: r.riskSignals.length }),
  );
}
insightsStep.maxRetries = 5;

async function emailStep(args: {
  to: string;
  csv: string;
  filename: string;
  rowCount: number;
  companyNames: string[];
}): Promise<void> {
  "use step";
  await timed(
    "email",
    { to: args.to, rows: args.rowCount, bytes: args.csv.length },
    () => sendEnrichedCsv(args).then(() => ({ ok: true as const })),
    (r) => ({ ok: r.ok }),
  );
}

async function buildCsvStep(enriched: EnrichedRow[]): Promise<string> {
  "use step";
  const csv = buildEnrichedCsv(enriched);
  log("csv", "built", { rows: enriched.length, bytes: csv.length });
  return csv;
}

async function processRow(
  input: CompanyInputRow,
  idx: number,
): Promise<EnrichedRow> {
  const website = normalizeUrl(input.website);

  await emitStage(idx, "scrape", "running");
  await emitStage(idx, "tavily", "running");
  await emitStage(idx, "news", "running");

  const [scrape, tavily, news] = await Promise.all([
    scrapeStep(idx, website),
    tavilyStep(idx, input.companyName),
    newsStep(idx, input.companyName),
  ]);

  await emitStage(idx, "scrape", scrape.ok ? "ok" : "failed", scrape.error);
  await emitStage(idx, "tavily", tavily.ok ? "ok" : "failed", tavily.error);
  await emitStage(idx, "news", news.ok ? "ok" : "failed", news.error);

  const context = buildResearchContext({
    companyName: input.companyName,
    website,
    scrape,
    tavily,
    news,
  });

  let profile: CompanyProfile;
  try {
    await emitStage(idx, "profile", "running");
    profile = await profileStep({ companyName: input.companyName, context });
    await emitStage(idx, "profile", "ok");
  } catch (err) {
    await emitStage(idx, "profile", "failed", trunc(err));
    await emit({ type: "rowDone", rowIdx: idx, success: false });
    return buildEnrichedRow({
      input,
      website,
      scrape,
      tavily,
      news,
      failure: `profile-failed: ${trunc(err)}`,
    });
  }

  let insights: CompanyInsights;
  try {
    await emitStage(idx, "insights", "running");
    insights = await insightsStep({
      companyName: input.companyName,
      profile,
      context,
    });
    await emitStage(idx, "insights", "ok");
  } catch (err) {
    await emitStage(idx, "insights", "failed", trunc(err));
    await emit({ type: "rowDone", rowIdx: idx, success: false });
    return buildEnrichedRow({
      input,
      website,
      scrape,
      tavily,
      news,
      profile,
      failure: `insights-failed: ${trunc(err)}`,
    });
  }

  await emit({ type: "rowDone", rowIdx: idx, success: true });
  return buildEnrichedRow({
    input,
    website,
    scrape,
    tavily,
    news,
    profile,
    insights,
  });
}

export async function enrichWorkflow(
  rows: CompanyInputRow[],
  recipientEmail: string,
): Promise<{ rowCount: number; emailedTo: string }> {
  "use workflow";

  log("workflow", "start", { rows: rows.length, email: recipientEmail });

  await emit({
    type: "start",
    totalRows: rows.length,
    companies: rows.map((r) => r.companyName),
  });

  const enriched: EnrichedRow[] = new Array(rows.length);
  for (
    let batchStart = 0;
    batchStart < rows.length;
    batchStart += ROW_CONCURRENCY
  ) {
    const batch = rows.slice(batchStart, batchStart + ROW_CONCURRENCY);
    log("workflow", "batch_start", {
      from: batchStart,
      to: Math.min(batchStart + batch.length, rows.length) - 1,
      size: batch.length,
    });
    const batchResults = await Promise.all(
      batch.map((row, j) => processRow(row, batchStart + j)),
    );
    for (let j = 0; j < batchResults.length; j++) {
      enriched[batchStart + j] = batchResults[j];
    }
    log("workflow", "batch_done", { from: batchStart, size: batch.length });
  }

  const csv = await buildCsvStep(enriched);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  try {
    await emit({ type: "email", status: "running" });
    await emailStep({
      to: recipientEmail,
      csv,
      filename: `enriched-leads-${stamp}.csv`,
      rowCount: enriched.length,
      companyNames: enriched.map((r) => r["Company Name"]),
    });
    await emit({ type: "email", status: "ok" });
  } catch (err) {
    await emit({ type: "email", status: "failed", message: trunc(err) });
    await emit({ type: "error", message: `Email delivery failed: ${trunc(err)}` });
    await closeStream();
    throw err;
  }

  await emit({
    type: "complete",
    rowCount: enriched.length,
    emailedTo: recipientEmail,
  });
  await closeStream();

  log("workflow", "complete", { rows: enriched.length, email: recipientEmail });
  return { rowCount: enriched.length, emailedTo: recipientEmail };
}
