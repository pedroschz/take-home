import { FatalError, RetryableError, getStepMetadata, getWritable } from "workflow";
import {
  extractCompanyProfile,
  generateInsights,
  type CompanyProfile,
  type CompanyInsights,
} from "@/lib/ai-pipeline";
import { buildEnrichedCsv } from "@/lib/csv";
import { sendEnrichedCsv } from "@/lib/email";
import { fetchNews } from "@/lib/news";
import { normalizeUrl, scrapeWebsite } from "@/lib/scraper";
import { tavilySearch } from "@/lib/tavily";
import type {
  CompanyInputRow,
  EnrichedRow,
  NewsResult,
  ScrapeResult,
  TavilyResult,
} from "@/lib/types";

const ROW_CONCURRENCY = 5;

function log(scope: string, msg: string, extra?: Record<string, unknown>): void {
  const tail = extra
    ? " " + Object.entries(extra)
        .map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v) : v}`)
        .join(" ")
    : "";
  console.log(`[${scope}] ${msg}${tail}`);
}

function attemptOf(): number {
  try {
    return getStepMetadata().attempt ?? 1;
  } catch {
    return 1;
  }
}

export type ProgressEvent =
  | { type: "start"; totalRows: number; companies: string[] }
  | {
      type: "stage";
      rowIdx: number;
      stage:
        | "scrape"
        | "tavily"
        | "news"
        | "profile"
        | "insights"
        | "email";
      status: "running" | "ok" | "failed";
      message?: string;
    }
  | { type: "rowDone"; rowIdx: number; success: boolean }
  | { type: "complete"; rowCount: number; emailedTo: string }
  | { type: "error"; message: string };

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

async function scrapeStep(
  rowIdx: number,
  website: string,
): Promise<ScrapeResult> {
  "use step";
  const t0 = Date.now();
  log("scrape", "start", { row: rowIdx, url: website, attempt: attemptOf() });
  const result = await scrapeWebsite(website);
  log("scrape", result.ok ? "ok" : "failed", {
    row: rowIdx,
    url: website,
    took_ms: Date.now() - t0,
    bytes: result.text.length,
    error: result.error,
  });
  return result;
}

async function tavilyStep(
  rowIdx: number,
  companyName: string,
): Promise<TavilyResult> {
  "use step";
  const t0 = Date.now();
  log("tavily", "start", { row: rowIdx, company: companyName, attempt: attemptOf() });
  const result = await tavilySearch(
    `${companyName} company overview product target customers`,
  );
  log("tavily", result.ok ? "ok" : "failed", {
    row: rowIdx,
    company: companyName,
    took_ms: Date.now() - t0,
    results: result.results.length,
    error: result.error,
  });
  return result;
}

async function newsStep(
  rowIdx: number,
  companyName: string,
): Promise<NewsResult> {
  "use step";
  const t0 = Date.now();
  log("news", "start", { row: rowIdx, company: companyName, attempt: attemptOf() });
  const result = await fetchNews(companyName);
  log("news", result.ok ? "ok" : "failed", {
    row: rowIdx,
    company: companyName,
    took_ms: Date.now() - t0,
    articles: result.articles.length,
    error: result.error,
  });
  return result;
}

function classifyAiError(err: unknown): "rate-limit" | "fatal" | "transient" {
  const status = (err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode;
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

  if (status === 429 || status === 529) return "rate-limit";
  if (
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("too many requests") ||
    msg.includes("quota exceeded") ||
    msg.includes("resource exhausted")
  ) {
    return "rate-limit";
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) return "fatal";
  if (
    msg.includes("invalid api key") ||
    msg.includes("authentication") ||
    msg.includes("api key not valid") ||
    msg.includes("api key expired") ||
    msg.includes("api_key_invalid") ||
    msg.includes("permission denied") ||
    msg.includes("renew the api key") ||
    msg.includes("billing")
  ) {
    return "fatal";
  }
  return "transient";
}

async function profileStep(args: {
  companyName: string;
  website: string;
  scrape: ScrapeResult;
  tavily: TavilyResult;
  news: NewsResult;
}): Promise<CompanyProfile> {
  "use step";
  const t0 = Date.now();
  const attempt = attemptOf();
  log("profile", "start", { company: args.companyName, attempt });
  try {
    const result = await extractCompanyProfile(args);
    log("profile", "ok", {
      company: args.companyName,
      attempt,
      took_ms: Date.now() - t0,
      industry: result.industry,
    });
    return result;
  } catch (err) {
    const kind = classifyAiError(err);
    const msg = err instanceof Error ? err.message : String(err);
    log("profile", "failed", {
      company: args.companyName,
      attempt,
      took_ms: Date.now() - t0,
      kind,
      error: msg.slice(0, 200),
    });
    if (kind === "rate-limit") {
      throw new RetryableError(`AI rate limited: ${msg}`, { retryAfter: "30s" });
    }
    if (kind === "fatal") {
      throw new FatalError(`AI auth/config error: ${msg}`);
    }
    throw err;
  }
}
profileStep.maxRetries = 5;

async function insightsStep(args: {
  profile: CompanyProfile;
  companyName: string;
  website: string;
  scrape: ScrapeResult;
  tavily: TavilyResult;
  news: NewsResult;
}): Promise<CompanyInsights> {
  "use step";
  const t0 = Date.now();
  const attempt = attemptOf();
  log("insights", "start", { company: args.companyName, attempt });
  try {
    const result = await generateInsights(args);
    log("insights", "ok", {
      company: args.companyName,
      attempt,
      took_ms: Date.now() - t0,
      angles: result.salesAngles.length,
      risks: result.riskSignals.length,
    });
    return result;
  } catch (err) {
    const kind = classifyAiError(err);
    const msg = err instanceof Error ? err.message : String(err);
    log("insights", "failed", {
      company: args.companyName,
      attempt,
      took_ms: Date.now() - t0,
      kind,
      error: msg.slice(0, 200),
    });
    if (kind === "rate-limit") {
      throw new RetryableError(`AI rate limited: ${msg}`, { retryAfter: "30s" });
    }
    if (kind === "fatal") {
      throw new FatalError(`AI auth/config error: ${msg}`);
    }
    throw err;
  }
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
  const t0 = Date.now();
  log("email", "start", {
    to: args.to,
    rows: args.rowCount,
    bytes: args.csv.length,
    attempt: attemptOf(),
  });
  try {
    await sendEnrichedCsv(args);
    log("email", "ok", { to: args.to, took_ms: Date.now() - t0 });
  } catch (err) {
    log("email", "failed", {
      to: args.to,
      took_ms: Date.now() - t0,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
    throw err;
  }
}

async function buildCsvStep(enriched: EnrichedRow[]): Promise<string> {
  "use step";
  const csv = buildEnrichedCsv(enriched);
  log("csv", "built", { rows: enriched.length, bytes: csv.length });
  return csv;
}

function buildRow(args: {
  input: CompanyInputRow;
  website: string;
  scrape: ScrapeResult;
  tavily: TavilyResult;
  news: NewsResult;
  profile: CompanyProfile;
  insights: CompanyInsights;
}): EnrichedRow {
  const sources: string[] = [];
  if (args.scrape.ok) sources.push(`website:${args.scrape.url}`);
  if (args.tavily.ok) sources.push("tavily-search");
  if (args.news.ok && args.news.articles.length > 0) sources.push("newsapi");

  return {
    "Company Name": args.input.companyName,
    Website: args.website,
    Industry: args.profile.industry,
    "Sub-Industry": args.profile.subIndustry,
    "Primary Product / Service": args.profile.primaryProductOrService,
    "Target Customer (ICP)": args.profile.targetCustomerICP,
    "Estimated Company Size": args.profile.estimatedCompanySize,
    "Recent News Summary": args.profile.recentNewsSummary,
    "Key Offering Summary": args.profile.keyOfferingSummary,
    "Sales Angle 1": args.insights.salesAngles[0] ?? "",
    "Sales Angle 2": args.insights.salesAngles[1] ?? "",
    "Sales Angle 3": args.insights.salesAngles[2] ?? "",
    "Risk Signal 1": args.insights.riskSignals[0] ?? "",
    "Risk Signal 2": args.insights.riskSignals[1] ?? "",
    "Risk Signal 3": args.insights.riskSignals[2] ?? "",
    "Data Sources Used": sources.join("; "),
  };
}

function failedRow(args: {
  input: CompanyInputRow;
  website: string;
  scrape?: ScrapeResult;
  tavily?: TavilyResult;
  news?: NewsResult;
  profile?: CompanyProfile;
  failure: string;
}): EnrichedRow {
  const sources: string[] = [];
  if (args.scrape?.ok) sources.push(`website:${args.scrape.url}`);
  if (args.tavily?.ok) sources.push("tavily-search");
  if (args.news?.ok && args.news.articles.length > 0) sources.push("newsapi");
  sources.push(args.failure);

  return {
    "Company Name": args.input.companyName,
    Website: args.website,
    Industry: args.profile?.industry ?? "",
    "Sub-Industry": args.profile?.subIndustry ?? "",
    "Primary Product / Service": args.profile?.primaryProductOrService ?? "",
    "Target Customer (ICP)": args.profile?.targetCustomerICP ?? "",
    "Estimated Company Size": args.profile?.estimatedCompanySize ?? "",
    "Recent News Summary": args.profile?.recentNewsSummary ?? "",
    "Key Offering Summary": args.profile?.keyOfferingSummary ?? "",
    "Sales Angle 1": "",
    "Sales Angle 2": "",
    "Sales Angle 3": "",
    "Risk Signal 1": "",
    "Risk Signal 2": "",
    "Risk Signal 3": "",
    "Data Sources Used": sources.join("; "),
  };
}

function trunc(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 160);
  if (typeof value === "string") return value.slice(0, 160);
  return String(value).slice(0, 160);
}

async function processRow(
  input: CompanyInputRow,
  idx: number,
): Promise<EnrichedRow> {
  const website = normalizeUrl(input.website);

  await emit({ type: "stage", rowIdx: idx, stage: "scrape", status: "running" });
  await emit({ type: "stage", rowIdx: idx, stage: "tavily", status: "running" });
  await emit({ type: "stage", rowIdx: idx, stage: "news", status: "running" });

  const [scrape, tavily, news] = await Promise.all([
    scrapeStep(idx, website),
    tavilyStep(idx, input.companyName),
    newsStep(idx, input.companyName),
  ]);

  await emit({
    type: "stage",
    rowIdx: idx,
    stage: "scrape",
    status: scrape.ok ? "ok" : "failed",
    message: scrape.error,
  });
  await emit({
    type: "stage",
    rowIdx: idx,
    stage: "tavily",
    status: tavily.ok ? "ok" : "failed",
    message: tavily.error,
  });
  await emit({
    type: "stage",
    rowIdx: idx,
    stage: "news",
    status: news.ok ? "ok" : "failed",
    message: news.error,
  });

  let profile: CompanyProfile | undefined;
  try {
    await emit({ type: "stage", rowIdx: idx, stage: "profile", status: "running" });
    profile = await profileStep({
      companyName: input.companyName,
      website,
      scrape,
      tavily,
      news,
    });
    await emit({ type: "stage", rowIdx: idx, stage: "profile", status: "ok" });
  } catch (err) {
    await emit({
      type: "stage",
      rowIdx: idx,
      stage: "profile",
      status: "failed",
      message: trunc(err),
    });
    await emit({ type: "rowDone", rowIdx: idx, success: false });
    return failedRow({
      input,
      website,
      scrape,
      tavily,
      news,
      failure: `profile-failed: ${trunc(err)}`,
    });
  }

  let insights: CompanyInsights | undefined;
  try {
    await emit({ type: "stage", rowIdx: idx, stage: "insights", status: "running" });
    insights = await insightsStep({
      profile,
      companyName: input.companyName,
      website,
      scrape,
      tavily,
      news,
    });
    await emit({ type: "stage", rowIdx: idx, stage: "insights", status: "ok" });
  } catch (err) {
    await emit({
      type: "stage",
      rowIdx: idx,
      stage: "insights",
      status: "failed",
      message: trunc(err),
    });
    await emit({ type: "rowDone", rowIdx: idx, success: false });
    return failedRow({
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
  return buildRow({
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
  for (let batchStart = 0; batchStart < rows.length; batchStart += ROW_CONCURRENCY) {
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
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  try {
    await emit({ type: "stage", rowIdx: -1, stage: "email", status: "running" });
    await emailStep({
      to: recipientEmail,
      csv,
      filename: `enriched-leads-${stamp}.csv`,
      rowCount: enriched.length,
      companyNames: enriched.map((r) => r["Company Name"]),
    });
    await emit({ type: "stage", rowIdx: -1, stage: "email", status: "ok" });
  } catch (err) {
    await emit({
      type: "stage",
      rowIdx: -1,
      stage: "email",
      status: "failed",
      message: trunc(err),
    });
    await emit({
      type: "error",
      message: `Email delivery failed: ${trunc(err)}`,
    });
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
