import * as cheerio from "cheerio";
import { withRetry } from "../../lib/async";
import type { AppConfig } from "../../config/env";
import type { SafeFetcher } from "../net/safeFetch";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Replaceable web-search abstraction used for public interview research. */
export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

export class SearchUnavailableError extends Error {}

export class NoSearchProvider implements SearchProvider {
  readonly name = "none";
  async search(): Promise<SearchResult[]> {
    throw new SearchUnavailableError("Public search is disabled");
  }
}

/**
 * DuckDuckGo HTML endpoint — keyless, so the app works out of the box.
 * Goes through the SafeFetcher (strict SSRF policy, timeouts, retries).
 * DDG may throttle automated traffic; failures are handled as "unavailable".
 */
export class DuckDuckGoSearch implements SearchProvider {
  readonly name = "duckduckgo";
  constructor(private readonly fetcher: SafeFetcher) {}

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await this.fetcher.fetch(url, { accept: "html", retries: 1, timeoutMs: 8000 });
    const $ = cheerio.load(res.body);
    if (/anomaly|captcha|unusual traffic/i.test($("title").text() + $(".anomaly-modal").text())) {
      throw new SearchUnavailableError("Search provider throttled the request");
    }
    const out: SearchResult[] = [];
    $(".result").each((_, el) => {
      if (out.length >= limit) return;
      const a = $(el).find("a.result__a").first();
      let href = a.attr("href") ?? "";
      const m = /[?&]uddg=([^&]+)/.exec(href);
      if (m) href = decodeURIComponent(m[1]);
      if (href.startsWith("//")) href = `https:${href}`;
      if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js/.test(href)) return; // skip ads
      out.push({ title: a.text().trim(), url: href, snippet: $(el).find(".result__snippet").text().trim() });
    });
    return out;
  }
}

async function jsonRequest(url: string, init: RequestInit): Promise<unknown> {
  return withRetry(
    async () => {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`search HTTP ${res.status}`), { retryable: true });
      if (!res.ok) throw new SearchUnavailableError(`search HTTP ${res.status}`);
      return res.json();
    },
    { retries: 2, baseDelayMs: 500, maxDelayMs: 4000, shouldRetry: (e) => Boolean((e as { retryable?: boolean }).retryable) },
  );
}

export class TavilySearch implements SearchProvider {
  readonly name = "tavily";
  constructor(private readonly apiKey: string) {}
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const data = (await jsonRequest("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: limit, search_depth: "basic" }),
    })) as { results?: { title: string; url: string; content: string }[] };
    return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 600) ?? "" }));
  }
}

export class BraveSearch implements SearchProvider {
  readonly name = "brave";
  constructor(private readonly apiKey: string) {}
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const data = (await jsonRequest(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
      headers: { accept: "application/json", "x-subscription-token": this.apiKey },
    })) as { web?: { results?: { title: string; url: string; description: string }[] } };
    return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description?.replace(/<[^>]+>/g, "") ?? "" }));
  }
}

export function createSearchProvider(cfg: AppConfig, strictFetcher: SafeFetcher): SearchProvider {
  const choice = cfg.SEARCH_PROVIDER;
  if (choice === "none") return new NoSearchProvider();
  if ((choice === "tavily" || choice === "auto") && cfg.TAVILY_API_KEY) return new TavilySearch(cfg.TAVILY_API_KEY);
  if ((choice === "brave" || choice === "auto") && cfg.BRAVE_SEARCH_API_KEY) return new BraveSearch(cfg.BRAVE_SEARCH_API_KEY);
  if (choice === "tavily" || choice === "brave") return new NoSearchProvider(); // requested but no key
  return new DuckDuckGoSearch(strictFetcher);
}
