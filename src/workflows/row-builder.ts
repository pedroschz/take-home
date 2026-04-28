import type { CompanyInsights, CompanyProfile } from "@/lib/ai-pipeline";
import type {
  CompanyInputRow,
  EnrichedRow,
  NewsResult,
  ScrapeResult,
  TavilyResult,
} from "@/lib/types";

export function buildEnrichedRow(args: {
  input: CompanyInputRow;
  website: string;
  scrape: ScrapeResult;
  tavily: TavilyResult;
  news: NewsResult;
  profile?: CompanyProfile;
  insights?: CompanyInsights;
  failure?: string;
}): EnrichedRow {
  const { input, website, scrape, tavily, news, profile, insights, failure } =
    args;

  const sources: string[] = [];
  if (scrape.ok) sources.push(`website:${scrape.url}`);
  if (tavily.ok) sources.push("tavily-search");
  if (news.ok && news.articles.length > 0) sources.push("newsapi");
  if (failure) sources.push(failure);

  return {
    "Company Name": input.companyName,
    Website: website,
    Industry: profile?.industry ?? "",
    "Sub-Industry": profile?.subIndustry ?? "",
    "Primary Product / Service": profile?.primaryProductOrService ?? "",
    "Target Customer (ICP)": profile?.targetCustomerICP ?? "",
    "Estimated Company Size": profile?.estimatedCompanySize ?? "",
    "Recent News Summary": profile?.recentNewsSummary ?? "",
    "Key Offering Summary": profile?.keyOfferingSummary ?? "",
    "Sales Angle 1": insights?.salesAngles[0] ?? "",
    "Sales Angle 2": insights?.salesAngles[1] ?? "",
    "Sales Angle 3": insights?.salesAngles[2] ?? "",
    "Risk Signal 1": insights?.riskSignals[0] ?? "",
    "Risk Signal 2": insights?.riskSignals[1] ?? "",
    "Risk Signal 3": insights?.riskSignals[2] ?? "",
    "Data Sources Used": sources.join("; "),
  };
}
