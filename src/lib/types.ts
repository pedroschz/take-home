export type CompanyInputRow = {
  companyName: string;
  website: string;
};

export type EnrichedRow = {
  "Company Name": string;
  Website: string;
  Industry: string;
  "Sub-Industry": string;
  "Primary Product / Service": string;
  "Target Customer (ICP)": string;
  "Estimated Company Size": string;
  "Recent News Summary": string;
  "Key Offering Summary": string;
  "Sales Angle 1": string;
  "Sales Angle 2": string;
  "Sales Angle 3": string;
  "Risk Signal 1": string;
  "Risk Signal 2": string;
  "Risk Signal 3": string;
  "Data Sources Used": string;
};

export const ENRICHED_HEADERS: (keyof EnrichedRow)[] = [
  "Company Name",
  "Website",
  "Industry",
  "Sub-Industry",
  "Primary Product / Service",
  "Target Customer (ICP)",
  "Estimated Company Size",
  "Recent News Summary",
  "Key Offering Summary",
  "Sales Angle 1",
  "Sales Angle 2",
  "Sales Angle 3",
  "Risk Signal 1",
  "Risk Signal 2",
  "Risk Signal 3",
  "Data Sources Used",
];

export type ScrapeResult = {
  url: string;
  title: string;
  description: string;
  text: string;
  ok: boolean;
  error?: string;
};

export type TavilyResult = {
  ok: boolean;
  answer?: string;
  results: { title: string; url: string; content: string }[];
  error?: string;
};

export type NewsResult = {
  ok: boolean;
  articles: { title: string; description: string; url: string; publishedAt: string; source: string }[];
  error?: string;
};
