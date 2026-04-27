import type { NewsResult } from "./types";

const NEWSAPI_ENDPOINT = "https://newsapi.org/v2/everything";

export async function fetchNews(companyName: string): Promise<NewsResult> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) {
    return { ok: false, articles: [], error: "NEWSAPI_KEY not configured" };
  }

  const query = `"${companyName.replace(/"/g, "")}"`;
  const params = new URLSearchParams({
    q: query,
    sortBy: "publishedAt",
    pageSize: "5",
    language: "en",
  });

  try {
    const res = await fetch(`${NEWSAPI_ENDPOINT}?${params.toString()}`, {
      headers: { "X-Api-Key": apiKey },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        articles: [],
        error: `NewsAPI HTTP ${res.status}: ${body.slice(0, 120)}`,
      };
    }

    const data = (await res.json()) as {
      articles?: {
        title: string;
        description: string | null;
        url: string;
        publishedAt: string;
        source: { name: string };
      }[];
    };

    return {
      ok: true,
      articles: (data.articles ?? []).map((a) => ({
        title: a.title,
        description: a.description ?? "",
        url: a.url,
        publishedAt: a.publishedAt,
        source: a.source.name,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      articles: [],
      error: err instanceof Error ? err.message : "news fetch failed",
    };
  }
}
