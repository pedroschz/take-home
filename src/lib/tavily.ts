import type { TavilyResult } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

const TAVILY_TIMEOUT_MS = 15_000;

export async function tavilySearch(query: string): Promise<TavilyResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { ok: false, results: [], error: "TAVILY_API_KEY not configured" };
  }

  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: 5,
      }),
      signal: AbortSignal.timeout(TAVILY_TIMEOUT_MS),
    });

    if (!res.ok) {
      return {
        ok: false,
        results: [],
        error: `Tavily HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      answer?: string;
      results?: { title: string; url: string; content: string }[];
    };

    return {
      ok: true,
      answer: data.answer,
      results: (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      results: [],
      error: err instanceof Error ? err.message : "tavily failed",
    };
  }
}
