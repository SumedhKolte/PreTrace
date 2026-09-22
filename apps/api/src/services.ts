import { getConfig, type AppConfig } from "./config/env";
import { LlmClient } from "./llm/client";
import { createProviderFromConfig } from "./llm/openaiCompatible";
import type { LlmProvider } from "./llm/provider";
import { InterviewPrepService } from "./pipeline/interviewPrepService";
import { RobotsCache } from "./research/net/robots";
import { SafeFetcher } from "./research/net/safeFetch";
import { EVALUATION_POLICY, STRICT_POLICY, type NetworkPolicy } from "./research/net/urlSafety";
import { MemoryResearchCache, type ResearchCache } from "./research/researchCache";
import { ResearchService } from "./research/researchService";
import { createSearchProvider, type SearchProvider } from "./research/search/searchProvider";

/**
 * Composition root. The web app and the batch evaluator both call this, so they
 * share one implementation of every stage. The only differences are explicit:
 *   - network policy: web = strict SSRF (unless ALLOW_PRIVATE_URLS for local dev),
 *                     evaluation = private/loopback allowed (localhost fixture sites)
 *   - research cache: Mongo (web) vs in-memory (evaluator needs no database)
 */
export type ServiceMode = "web" | "evaluation";

export interface Services {
  config: AppConfig;
  llm: LlmClient;
  research: ResearchService;
  pipeline: InterviewPrepService;
  policy: NetworkPolicy;
  close(): Promise<void>;
}

export function createServices(opts: {
  mode: ServiceMode;
  cache?: ResearchCache;
  provider?: LlmProvider | null;
  search?: SearchProvider;
  config?: AppConfig;
  sleepFn?: (ms: number) => Promise<void>;
}): Services {
  const config = opts.config ?? getConfig();
  const policy: NetworkPolicy = opts.mode === "evaluation" || config.ALLOW_PRIVATE_URLS ? EVALUATION_POLICY : STRICT_POLICY;

  const fetcherCfg = {
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    maxBytes: config.FETCH_MAX_BYTES,
    retries: config.FETCH_MAX_RETRIES,
    hostDelayMs: config.CRAWL_HOST_DELAY_MS,
    sleepFn: opts.sleepFn,
  };
  const pageFetcher = new SafeFetcher({ ...fetcherCfg, policy });
  const publicFetcher = new SafeFetcher({ ...fetcherCfg, policy: STRICT_POLICY });

  const provider = opts.provider !== undefined ? opts.provider : createProviderFromConfig(config);
  const llm = new LlmClient(provider, {
    concurrency: config.MAX_LLM_CONCURRENCY,
    maxRpm: config.LLM_MAX_RPM,
    retries: config.LLM_MAX_RETRIES,
    maxTokens: config.LLM_MAX_TOKENS,
    temperature: config.LLM_TEMPERATURE,
    sleepFn: opts.sleepFn,
  });

  const research = new ResearchService({
    llm: llm.scope(),
    pageFetcher,
    publicFetcher,
    robots: new RobotsCache(pageFetcher),
    publicRobots: new RobotsCache(publicFetcher),
    search: opts.search ?? createSearchProvider(config, publicFetcher),
    cache: opts.cache ?? new MemoryResearchCache(),
    crawl: { maxPages: config.MAX_CRAWL_PAGES, maxDepth: config.MAX_CRAWL_DEPTH, concurrency: config.CRAWL_CONCURRENCY },
    searchMaxResults: config.SEARCH_MAX_RESULTS,
    cacheTtlMs: config.RESEARCH_CACHE_TTL_HOURS * 3_600_000,
  });

  return {
    config,
    llm,
    research,
    pipeline: new InterviewPrepService({ llm, research }),
    policy,
    async close() {
      await Promise.all([pageFetcher.close(), publicFetcher.close()]);
    },
  };
}
