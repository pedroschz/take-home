import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";
import type { NewsResult, ScrapeResult, TavilyResult } from "./types";

const MODEL = google(
  process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview",
);

const profileSchema = z.object({
  industry: z
    .string()
    .describe("Top-level industry, e.g. 'Logistics', 'Fintech', 'Healthcare'"),
  subIndustry: z
    .string()
    .describe(
      "More specific category, e.g. 'Freight Forwarding Software', 'Embedded Payments'",
    ),
  primaryProductOrService: z
    .string()
    .describe("Concise description of what they sell, in one sentence"),
  targetCustomerICP: z
    .string()
    .describe(
      "Their ideal customer profile: company type, size, role of buyer",
    ),
  estimatedCompanySize: z
    .string()
    .describe(
      "Best estimate of headcount range, e.g. '1-10', '11-50', '51-200', '201-1000', '1000+'. Use 'unknown' if unclear.",
    ),
  keyOfferingSummary: z
    .string()
    .describe(
      "2-3 sentence value-prop summary of the company's core offering",
    ),
  recentNewsSummary: z
    .string()
    .describe(
      "1-2 sentence summary of any noteworthy recent news, funding, launches, or hiring. Use 'No recent news available' if none.",
    ),
});

export type CompanyProfile = z.infer<typeof profileSchema>;

const insightsSchema = z.object({
  salesAngles: z
    .array(z.string())
    .length(3)
    .describe(
      "Exactly 3 concrete, specific outbound sales angles tailored to this company. Each should be one sentence and cite a real signal from the research.",
    ),
  riskSignals: z
    .array(z.string())
    .length(3)
    .describe(
      "Exactly 3 concrete risk signals or objections a sales rep should anticipate when prospecting this company. Each should be one sentence.",
    ),
});

export type CompanyInsights = z.infer<typeof insightsSchema>;

function buildResearchContext(args: {
  companyName: string;
  website: string;
  scrape: ScrapeResult;
  tavily: TavilyResult;
  news: NewsResult;
}): string {
  const { companyName, website, scrape, tavily, news } = args;

  const sections: string[] = [
    `Company name: ${companyName}`,
    `Website: ${website}`,
  ];

  if (scrape.ok && scrape.text) {
    sections.push(`--- Website content ---\n${scrape.text}`);
  } else if (scrape.error) {
    sections.push(`--- Website content ---\n(scrape failed: ${scrape.error})`);
  }

  if (tavily.ok) {
    const block = [
      tavily.answer && `Web summary: ${tavily.answer}`,
      tavily.results.length > 0 &&
        `Top results:\n${tavily.results
          .map(
            (r, i) =>
              `${i + 1}. ${r.title} (${r.url})\n   ${r.content.slice(0, 400)}`,
          )
          .join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (block) sections.push(`--- Web search (Tavily) ---\n${block}`);
  } else if (tavily.error) {
    sections.push(`--- Web search (Tavily) ---\n(failed: ${tavily.error})`);
  }

  if (news.ok && news.articles.length > 0) {
    const block = news.articles
      .map(
        (a, i) =>
          `${i + 1}. [${a.source} · ${a.publishedAt.slice(0, 10)}] ${a.title}\n   ${a.description}`,
      )
      .join("\n");
    sections.push(`--- Recent news (NewsAPI) ---\n${block}`);
  } else if (news.error) {
    sections.push(`--- Recent news (NewsAPI) ---\n(failed: ${news.error})`);
  } else {
    sections.push(`--- Recent news (NewsAPI) ---\n(no articles found)`);
  }

  return sections.join("\n\n");
}

export async function extractCompanyProfile(args: {
  companyName: string;
  website: string;
  scrape: ScrapeResult;
  tavily: TavilyResult;
  news: NewsResult;
}): Promise<CompanyProfile> {
  const context = buildResearchContext(args);

  const { object } = await generateObject({
    model: MODEL,
    schema: profileSchema,
    system:
      "You are a B2B sales research analyst. From the supplied raw research, extract a clean, factual structured profile of the company. Never invent facts: if the research does not support a field, return a short conservative best-guess and mark uncertainty in the value (e.g. 'likely SaaS — unconfirmed'). Keep each field tight.",
    prompt: `Research bundle for ${args.companyName}:\n\n${context}`,
    abortSignal: AbortSignal.timeout(60_000),
  });

  return object;
}

export async function generateInsights(args: {
  profile: CompanyProfile;
  companyName: string;
  website: string;
  scrape: ScrapeResult;
  tavily: TavilyResult;
  news: NewsResult;
}): Promise<CompanyInsights> {
  const context = buildResearchContext({
    companyName: args.companyName,
    website: args.website,
    scrape: args.scrape,
    tavily: args.tavily,
    news: args.news,
  });

  const { object } = await generateObject({
    model: MODEL,
    schema: insightsSchema,
    system:
      "You are a senior outbound sales strategist. Given a structured company profile and the underlying research, produce concrete sales angles and risk signals. Each angle must reference something specific (a product, a recent move, an audience pain). Each risk must be a real reason a rep should hesitate or prepare an objection. Avoid generic statements like 'they care about efficiency'.",
    prompt: `Structured profile:\n${JSON.stringify(args.profile, null, 2)}\n\nUnderlying research:\n${context}`,
    abortSignal: AbortSignal.timeout(60_000),
  });

  return object;
}
