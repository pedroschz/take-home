import { extractCompanyProfile, generateInsights } from "./ai-pipeline";
import { fetchNews } from "./news";
import { normalizeUrl, scrapeWebsite } from "./scraper";
import { tavilySearch } from "./tavily";
import type { CompanyInputRow, EnrichedRow } from "./types";

export async function enrichCompany(
  input: CompanyInputRow,
): Promise<EnrichedRow> {
  const website = normalizeUrl(input.website);

  const [scrape, tavily, news] = await Promise.all([
    scrapeWebsite(website),
    tavilySearch(
      `${input.companyName} company overview product target customers`,
    ),
    fetchNews(input.companyName),
  ]);

  const sources: string[] = [];
  if (scrape.ok) sources.push(`website:${scrape.url}`);
  if (tavily.ok) sources.push("tavily-search");
  if (news.ok && news.articles.length > 0) sources.push("newsapi");

  const aiBundle = {
    companyName: input.companyName,
    website,
    scrape,
    tavily,
    news,
  };

  let profile;
  let insights;
  try {
    profile = await extractCompanyProfile(aiBundle);
  } catch (err) {
    return failedRow(input, website, sources, err, "profile");
  }

  try {
    insights = await generateInsights({ profile, ...aiBundle });
  } catch (err) {
    return {
      "Company Name": input.companyName,
      Website: website,
      Industry: profile.industry,
      "Sub-Industry": profile.subIndustry,
      "Primary Product / Service": profile.primaryProductOrService,
      "Target Customer (ICP)": profile.targetCustomerICP,
      "Estimated Company Size": profile.estimatedCompanySize,
      "Recent News Summary": profile.recentNewsSummary,
      "Key Offering Summary": profile.keyOfferingSummary,
      "Sales Angle 1": "",
      "Sales Angle 2": "",
      "Sales Angle 3": "",
      "Risk Signal 1": "",
      "Risk Signal 2": "",
      "Risk Signal 3": "",
      "Data Sources Used": `${sources.join("; ")} | insights-failed: ${errMsg(err)}`,
    };
  }

  return {
    "Company Name": input.companyName,
    Website: website,
    Industry: profile.industry,
    "Sub-Industry": profile.subIndustry,
    "Primary Product / Service": profile.primaryProductOrService,
    "Target Customer (ICP)": profile.targetCustomerICP,
    "Estimated Company Size": profile.estimatedCompanySize,
    "Recent News Summary": profile.recentNewsSummary,
    "Key Offering Summary": profile.keyOfferingSummary,
    "Sales Angle 1": insights.salesAngles[0] ?? "",
    "Sales Angle 2": insights.salesAngles[1] ?? "",
    "Sales Angle 3": insights.salesAngles[2] ?? "",
    "Risk Signal 1": insights.riskSignals[0] ?? "",
    "Risk Signal 2": insights.riskSignals[1] ?? "",
    "Risk Signal 3": insights.riskSignals[2] ?? "",
    "Data Sources Used": sources.join("; "),
  };
}

function failedRow(
  input: CompanyInputRow,
  website: string,
  sources: string[],
  err: unknown,
  stage: string,
): EnrichedRow {
  return {
    "Company Name": input.companyName,
    Website: website,
    Industry: "",
    "Sub-Industry": "",
    "Primary Product / Service": "",
    "Target Customer (ICP)": "",
    "Estimated Company Size": "",
    "Recent News Summary": "",
    "Key Offering Summary": "",
    "Sales Angle 1": "",
    "Sales Angle 2": "",
    "Sales Angle 3": "",
    "Risk Signal 1": "",
    "Risk Signal 2": "",
    "Risk Signal 3": "",
    "Data Sources Used": `${sources.join("; ")} | ${stage}-failed: ${errMsg(err)}`,
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 160);
  return String(err).slice(0, 160);
}

export async function enrichAll(
  rows: CompanyInputRow[],
  concurrency = 3,
): Promise<EnrichedRow[]> {
  const results: EnrichedRow[] = rows.map((r) =>
    failedRow(
      r,
      safeNormalize(r.website),
      [],
      new Error("pipeline did not run"),
      "pipeline",
    ),
  );
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= rows.length) return;
      try {
        results[idx] = await enrichCompany(rows[idx]);
      } catch (err) {
        try {
          results[idx] = failedRow(
            rows[idx],
            safeNormalize(rows[idx].website),
            [],
            err,
            "pipeline",
          );
        } catch {
          // results[idx] is already a defaulted failure row
        }
      }
    }
  }

  const workerCount = Math.min(concurrency, Math.max(rows.length, 1));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function safeNormalize(website: unknown): string {
  if (typeof website !== "string") return "";
  try {
    return normalizeUrl(website);
  } catch {
    return "";
  }
}
