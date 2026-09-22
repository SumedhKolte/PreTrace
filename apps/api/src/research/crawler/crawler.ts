import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { sha256 } from "../../lib/text";
import type { RobotsCache } from "../net/robots";
import { FetchError, type SafeFetcher } from "../net/safeFetch";
import { extractPage, parseSitemap, type ExtractedPage } from "./htmlExtract";
import {
  classifyPage,
  engineeringHints,
  HINT_PATHS,
  hiringSignalCount,
  inScope,
  makeScope,
  normalizeCrawlUrl,
  scoreLink,
  type CrawlScope,
  type LinkCategory,
} from "./linkRanker";

export interface CrawledPage extends ExtractedPage {
  depth: number;
  category: LinkCategory;
  hiringSignals: number;
  discoveredVia: "start" | "link" | "sitemap" | "hint";
  score: number;
}

export interface CrawlAttempt {
  url: string;
  status: "ok" | "failed" | "blocked" | "skipped";
  reason?: string;
  category: LinkCategory;
}

export interface CrawlResult {
  startUrl: string;
  finalUrl: string;
  homepage: CrawledPage | null;
  pages: CrawledPage[];
  attempts: CrawlAttempt[];
  robotsBlockedHomepage: boolean;
}

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  onProgress?: (msg: string) => void;
}

interface Candidate {
  url: string;
  score: number;
  depth: number;
  category: LinkCategory;
  via: CrawledPage["discoveredVia"];
  external: boolean;
}

const MIN_LINK_SCORE = 3;

/** Map a homepage fetch failure to a structured, user-safe error. */
function homepageError(e: unknown): AppError {
  if (e instanceof FetchError) {
    switch (e.kind) {
      case "INVALID_URL":
        return new AppError("INVALID_URL", "The company URL is not valid.");
      case "BLOCKED":
        return new AppError("URL_NOT_ALLOWED", "That company URL points to a private or disallowed network address.");
      case "HTTP_STATUS":
        if (e.status === 404 || e.status === 410) return new AppError("COMPANY_404", `Company site returned ${e.status} (not found).`);
        return new AppError("COMPANY_UNREACHABLE", `Company site unreachable after retries (HTTP ${e.status}).`);
      case "UNSUPPORTED_TYPE":
        return new AppError("UNSUPPORTED_CONTENT", "The company URL did not return a web page.");
      case "TOO_MANY_REDIRECTS":
        return new AppError("COMPANY_UNREACHABLE", "Company site redirected too many times.");
      default:
        return new AppError("COMPANY_UNREACHABLE", "Company site unreachable after 3 retries.");
    }
  }
  return new AppError("COMPANY_UNREACHABLE", "Company site unreachable.");
}

/**
 * Best-first crawl of a company site.
 * 1. robots.txt for the origin is honoured for every URL.
 * 2. The homepage must load (with retries) — otherwise the run fails with a structured error.
 * 3. Links are scored (anchor/path/title/context) and the best in-scope links are fetched
 *    in score order up to maxPages / maxDepth, with bounded concurrency.
 * 4. Sitemaps (from robots.txt or /sitemap.xml) add URL-only candidates; common paths are
 *    tried only as a last-resort hint when no careers/about link was discovered.
 * Individual page failures are recorded and skipped, never fatal.
 */
export async function crawlCompanySite(
  startUrl: string,
  deps: { fetcher: SafeFetcher; robots: RobotsCache },
  opts: CrawlOptions,
): Promise<CrawlResult> {
  const { fetcher, robots } = deps;
  const attempts: CrawlAttempt[] = [];
  const say = (m: string) => opts.onProgress?.(m);

  const startRules = await robots.get(startUrl);
  if (!startRules.isAllowed(startUrl)) {
    attempts.push({ url: startUrl, status: "blocked", reason: "Disallowed by robots.txt", category: "other" });
    return { startUrl, finalUrl: startUrl, homepage: null, pages: [], attempts, robotsBlockedHomepage: true };
  }

  let home;
  try {
    home = await fetcher.fetch(startUrl, { accept: "html", oversize: "truncate" });
  } catch (e) {
    throw homepageError(e);
  }
  const finalUrl = home.url;
  const scope: CrawlScope = makeScope(finalUrl);
  const homeExtract = extractPage(home.body, finalUrl);
  const homepage: CrawledPage = {
    ...homeExtract,
    depth: 0,
    category: "other",
    hiringSignals: hiringSignalCount(homeExtract.text),
    discoveredVia: "start",
    score: 100,
  };
  attempts.push({ url: finalUrl, status: "ok", category: "other" });
  say(`Loaded homepage — ${homeExtract.links.length} links found`);

  const visited = new Set<string>([normalizeCrawlUrl(startUrl), normalizeCrawlUrl(finalUrl)]);
  const contentHashes = new Set<string>([sha256(homeExtract.text)]);
  const queue = new Map<string, Candidate>();

  const enqueue = (c: Candidate) => {
    if (visited.has(c.url) || c.depth > opts.maxDepth) return;
    const existing = queue.get(c.url);
    if (!existing || existing.score < c.score) queue.set(c.url, c);
  };
  const enqueueLinks = (page: CrawledPage) => {
    if (page.depth >= opts.maxDepth) return;
    for (const link of page.links) {
      const s = scoreLink(link, page.depth + 1, scope, page.category);
      if (s && s.score >= MIN_LINK_SCORE) {
        enqueue({ url: s.url, score: s.score, depth: page.depth + 1, category: s.category, via: "link", external: s.external });
      }
    }
  };
  enqueueLinks(homepage);

  // Sitemap URLs (URL-path scoring only) supplement link discovery.
  await addSitemapCandidates(fetcher, startRules.sitemaps, scope, enqueue).catch(() => {});

  // Last-resort hints only for categories that link discovery did not surface at all.
  const haveCat = (cats: LinkCategory[]) => [...queue.values()].some((c) => cats.includes(c.category));
  const discoveredEngineering = haveCat(["engineering"]); // measured before any hints are queued
  for (const hint of HINT_PATHS) {
    const cats: LinkCategory[] = hint.category === "careers" ? ["careers", "hiring"] : [hint.category];
    if (haveCat(cats)) continue;
    const url = normalizeCrawlUrl(new URL(hint.path, scope.origin + scope.pathPrefix).toString());
    enqueue({ url, score: MIN_LINK_SCORE, depth: 1, category: hint.category, via: "hint", external: false });
  }
  if (!discoveredEngineering) {
    for (const url of engineeringHints(scope)) {
      enqueue({ url: normalizeCrawlUrl(url), score: MIN_LINK_SCORE, depth: 1, category: "engineering", via: "hint", external: !inScope(url, scope).ok || inScope(url, scope).external });
    }
  }

  const pages: CrawledPage[] = [];
  const maxPages = Math.max(0, opts.maxPages - 1); // homepage counts toward the budget
  // Hard cap on fetches (including failed/empty ones) so JS-heavy sites can't burn time.
  const maxFetches = opts.maxPages * 3;
  let fetches = 0;

  while (pages.length < maxPages && queue.size > 0 && fetches < maxFetches) {
    const batch = [...queue.values()]
      .sort((a, b) => b.score - a.score || a.depth - b.depth || a.url.localeCompare(b.url))
      .slice(0, Math.min(opts.concurrency, maxPages - pages.length));
    for (const c of batch) {
      queue.delete(c.url);
      visited.add(c.url);
    }
    fetches += batch.length;

    const results = await Promise.all(
      batch.map(async (c): Promise<CrawledPage | null> => {
        const rules = await robots.get(c.url);
        if (!rules.isAllowed(c.url)) {
          attempts.push({ url: c.url, status: "blocked", reason: "Disallowed by robots.txt", category: c.category });
          return null;
        }
        try {
          const res = await fetcher.fetch(c.url, { accept: "html", oversize: "truncate", retries: 1 });
          const normFinal = normalizeCrawlUrl(res.url);
          if (normFinal !== c.url && visited.has(normFinal)) {
            attempts.push({ url: c.url, status: "skipped", reason: "Redirected to an already visited page", category: c.category });
            return null;
          }
          if (!inScope(res.url, scope).ok) {
            attempts.push({ url: c.url, status: "skipped", reason: "Redirected outside the company site", category: c.category });
            return null;
          }
          visited.add(normFinal);
          const ex = extractPage(res.body, res.url);
          const hash = sha256(ex.text);
          if (contentHashes.has(hash) || ex.text.length < 80) {
            attempts.push({ url: c.url, status: "skipped", reason: "Duplicate or empty content", category: c.category });
            return null;
          }
          contentHashes.add(hash);
          const category = classifyPage(res.url, ex.title, ex.headings, ex.text);
          attempts.push({ url: res.url, status: "ok", category });
          return {
            ...ex,
            depth: c.depth,
            category: category === "other" ? c.category : category,
            hiringSignals: hiringSignalCount(ex.text),
            discoveredVia: c.via,
            score: c.score,
          };
        } catch (e) {
          const reason = e instanceof FetchError ? (e.kind === "HTTP_STATUS" ? `HTTP ${e.status}` : e.kind.toLowerCase().replace(/_/g, " ")) : "error";
          attempts.push({ url: c.url, status: c.via === "hint" ? "skipped" : "failed", reason, category: c.category });
          logger.debug("crawl page failed", { url: c.url, reason });
          return null;
        }
      }),
    );

    for (const p of results) {
      if (!p) continue;
      pages.push(p);
      if (!inScope(p.url, scope).external) enqueueLinks(p); // ATS pages are read but not expanded
    }
    if (startRules.crawlDelayMs > 0) await new Promise((r) => setTimeout(r, startRules.crawlDelayMs));
  }

  const hiringPages = pages.filter((p) => p.category === "hiring").length;
  say(`Read ${pages.length + 1} company pages${hiringPages ? ` — ${hiringPages} with hiring information` : ""}`);
  return { startUrl, finalUrl, homepage, pages, attempts, robotsBlockedHomepage: false };
}

async function addSitemapCandidates(
  fetcher: SafeFetcher,
  declared: string[],
  scope: CrawlScope,
  enqueue: (c: Candidate) => void,
) {
  const sitemapUrl = declared.find((s) => inScope(s, scope).ok) ?? `${scope.origin}${scope.pathPrefix}sitemap.xml`;
  let body: string;
  try {
    body = (await fetcher.fetch(sitemapUrl, { accept: "xml", maxBytes: 1_000_000, retries: 0, timeoutMs: 5000 })).body;
  } catch {
    return;
  }
  for (const loc of parseSitemap(body)) {
    const s = scoreLink({ url: loc, text: "", title: "", context: "main" }, 1, scope);
    if (s && s.score >= MIN_LINK_SCORE + 2) {
      enqueue({ url: s.url, score: s.score - 1, depth: 1, category: s.category, via: "sitemap", external: s.external });
    }
  }
}
