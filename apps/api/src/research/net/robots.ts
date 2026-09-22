import robotsParser from "robots-parser";
import { logger } from "../../lib/logger";
import { FetchError, USER_AGENT, type SafeFetcher } from "./safeFetch";

type Robot = ReturnType<typeof robotsParser>;

export interface RobotsRules {
  isAllowed(url: string): boolean;
  crawlDelayMs: number;
  sitemaps: string[];
  status: "ok" | "missing" | "unavailable";
}

const ALLOW_ALL = (status: RobotsRules["status"]): RobotsRules => ({ isAllowed: () => true, crawlDelayMs: 0, sitemaps: [], status });

/**
 * robots.txt handling, cached per origin.
 * - 4xx (no robots.txt)        → everything allowed (standard behaviour)
 * - fetched                    → rules enforced for our user agent
 * - 5xx / network unavailable  → treated as allowed, logged; page fetches still fail on their own
 */
export class RobotsCache {
  private cache = new Map<string, Promise<RobotsRules>>();

  constructor(private readonly fetcher: SafeFetcher) {}

  get(pageUrl: string): Promise<RobotsRules> {
    const origin = new URL(pageUrl).origin;
    let p = this.cache.get(origin);
    if (!p) {
      p = this.load(origin);
      this.cache.set(origin, p);
    }
    return p;
  }

  private async load(origin: string): Promise<RobotsRules> {
    const robotsUrl = `${origin}/robots.txt`;
    try {
      const res = await this.fetcher.fetch(robotsUrl, { accept: "text", maxBytes: 256_000, retries: 1, timeoutMs: 6000 });
      const robot: Robot = robotsParser(robotsUrl, res.body);
      const delay = robot.getCrawlDelay(USER_AGENT) ?? robot.getCrawlDelay("*");
      return {
        isAllowed: (u) => robot.isAllowed(u, USER_AGENT) !== false,
        crawlDelayMs: delay ? Math.min(5000, delay * 1000) : 0,
        sitemaps: robot.getSitemaps(),
        status: "ok",
      };
    } catch (e) {
      if (e instanceof FetchError && e.kind === "HTTP_STATUS" && (e.status ?? 0) < 500) return ALLOW_ALL("missing");
      if (e instanceof FetchError && e.kind === "UNSUPPORTED_TYPE") return ALLOW_ALL("missing");
      logger.debug("robots.txt unavailable", { origin, err: String(e) });
      return ALLOW_ALL("unavailable");
    }
  }
}
