import * as cheerio from "cheerio";
import type { ScrapeResult } from "./types";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 2_000_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; LeadEnrichmentBot/1.0; +https://example.com/bot)";

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export async function scrapeWebsite(rawUrl: string): Promise<ScrapeResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) {
    return {
      url: "",
      title: "",
      description: "",
      text: "",
      ok: false,
      error: "empty url",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!res.ok) {
      return {
        url,
        title: "",
        description: "",
        text: "",
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_BODY_BYTES) {
      return {
        url,
        title: "",
        description: "",
        text: "",
        ok: false,
        error: `body too large (${declaredLength} bytes)`,
      };
    }

    const html = await readBodyCapped(res, MAX_BODY_BYTES);
    const $ = cheerio.load(html);

    $("script, style, noscript, svg, iframe").remove();

    const title = ($("title").first().text() || "").trim();
    const description = (
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      ""
    ).trim();

    const headings = $("h1, h2, h3")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, 25)
      .join("\n");

    const bodyText = $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);

    const text = [
      title && `TITLE: ${title}`,
      description && `DESCRIPTION: ${description}`,
      headings && `HEADINGS:\n${headings}`,
      bodyText && `BODY:\n${bodyText}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return { url, title, description, text, ok: true };
  } catch (err) {
    return {
      url,
      title: "",
      description: "",
      text: "",
      ok: false,
      error: err instanceof Error ? err.message : "fetch failed",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readBodyCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
      if (received >= max) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    out += decoder.decode();
  } catch {
    // partial body is still useful
  }
  return out;
}
