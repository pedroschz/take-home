/**
 * Eval harness for the AI pipeline.
 *
 * Runs the two structured Claude calls against a small fixture set and asserts
 * schema validity, non-empty fields, and that sales angles avoid the most
 * common generic-fluff failure modes. This is not a substitute for human
 * review of outputs, but it catches "model returned empty array", "model
 * fell back to a no-op apology", and "schema drift" automatically.
 *
 * Usage: `npm run eval`
 */

import { extractCompanyProfile, generateInsights } from "../src/lib/ai-pipeline";
import { fetchNews } from "../src/lib/news";
import { normalizeUrl, scrapeWebsite } from "../src/lib/scraper";
import { tavilySearch } from "../src/lib/tavily";

type Fixture = {
  companyName: string;
  website: string;
  expectedIndustryAny: string[];
};

const FIXTURES: Fixture[] = [
  {
    companyName: "Stripe",
    website: "stripe.com",
    expectedIndustryAny: ["fintech", "payments", "financial"],
  },
  {
    companyName: "Vercel",
    website: "vercel.com",
    expectedIndustryAny: ["devtools", "developer tools", "cloud", "platform", "saas"],
  },
  {
    companyName: "Linear",
    website: "linear.app",
    expectedIndustryAny: ["productivity", "software", "saas", "project management"],
  },
];

const GENERIC_FRAGMENTS = [
  "they care about efficiency",
  "improve productivity",
  "streamline operations",
  "drive growth",
  "leverage synergies",
];

type Failure = { fixture: string; assertion: string; detail: string };

function assert(
  failures: Failure[],
  fixture: string,
  assertion: string,
  cond: boolean,
  detail: string,
): void {
  if (!cond) failures.push({ fixture, assertion, detail });
}

async function runFixture(fixture: Fixture): Promise<Failure[]> {
  const failures: Failure[] = [];
  const website = normalizeUrl(fixture.website);

  const [scrape, tavily, news] = await Promise.all([
    scrapeWebsite(website),
    tavilySearch(`${fixture.companyName} company overview product target customers`),
    fetchNews(fixture.companyName),
  ]);

  const aiBundle = {
    companyName: fixture.companyName,
    website,
    scrape,
    tavily,
    news,
  };

  const profile = await extractCompanyProfile(aiBundle);

  assert(failures, fixture.companyName, "profile.industry non-empty",
    profile.industry.trim().length > 0,
    `industry="${profile.industry}"`);

  assert(failures, fixture.companyName, "profile.industry plausible",
    fixture.expectedIndustryAny.some((token) =>
      profile.industry.toLowerCase().includes(token) ||
      profile.subIndustry.toLowerCase().includes(token) ||
      profile.primaryProductOrService.toLowerCase().includes(token),
    ),
    `industry="${profile.industry}", subIndustry="${profile.subIndustry}", expectedAny=${fixture.expectedIndustryAny.join("|")}`,
  );

  assert(failures, fixture.companyName, "profile.targetCustomerICP non-empty",
    profile.targetCustomerICP.trim().length > 5,
    `ICP="${profile.targetCustomerICP}"`);

  assert(failures, fixture.companyName, "profile.keyOfferingSummary non-empty",
    profile.keyOfferingSummary.trim().length > 20,
    `keyOfferingSummary length=${profile.keyOfferingSummary.length}`);

  const insights = await generateInsights({ profile, ...aiBundle });

  assert(failures, fixture.companyName, "insights.salesAngles has 3",
    insights.salesAngles.length === 3,
    `got ${insights.salesAngles.length}`);

  assert(failures, fixture.companyName, "insights.riskSignals has 3",
    insights.riskSignals.length === 3,
    `got ${insights.riskSignals.length}`);

  for (const [i, angle] of insights.salesAngles.entries()) {
    assert(failures, fixture.companyName, `salesAngle[${i}] non-empty`,
      angle.trim().length > 15,
      `angle="${angle}"`);

    const angleLower = angle.toLowerCase();
    const generic = GENERIC_FRAGMENTS.find((g) => angleLower.includes(g));
    assert(failures, fixture.companyName, `salesAngle[${i}] not generic fluff`,
      !generic,
      `matched generic fragment "${generic}" in "${angle}"`);
  }

  for (const [i, risk] of insights.riskSignals.entries()) {
    assert(failures, fixture.companyName, `riskSignal[${i}] non-empty`,
      risk.trim().length > 15,
      `risk="${risk}"`);
  }

  return failures;
}

async function main(): Promise<void> {
  const required = ["GOOGLE_GENERATIVE_AI_API_KEY", "TAVILY_API_KEY", "NEWSAPI_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    console.error("Set them in .env.local or export them before running.");
    process.exit(2);
  }

  const allFailures: Failure[] = [];
  for (const fixture of FIXTURES) {
    process.stdout.write(`> ${fixture.companyName} ... `);
    try {
      const failures = await runFixture(fixture);
      if (failures.length === 0) {
        console.log("ok");
      } else {
        console.log(`${failures.length} assertion(s) failed`);
        allFailures.push(...failures);
      }
    } catch (err) {
      console.log("crashed");
      allFailures.push({
        fixture: fixture.companyName,
        assertion: "fixture executed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log("");
  if (allFailures.length === 0) {
    console.log(`PASS: ${FIXTURES.length}/${FIXTURES.length} fixtures clean.`);
    process.exit(0);
  }

  console.log(`FAIL: ${allFailures.length} assertion(s) across ${FIXTURES.length} fixtures.`);
  for (const f of allFailures) {
    console.log(`  - [${f.fixture}] ${f.assertion}: ${f.detail}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("Eval harness crashed:", err);
  process.exit(2);
});
