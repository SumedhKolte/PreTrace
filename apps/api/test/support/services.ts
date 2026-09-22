import { getConfig } from "../../src/config/env";
import type { SearchProvider, SearchResult } from "../../src/research/search/searchProvider";
import { createServices, type ServiceMode } from "../../src/services";
import { ScriptedLlm } from "./scriptedLlm";

/** Canned public search results (no network in tests). */
export class FakeSearch implements SearchProvider {
  readonly name = "fake";
  queries: string[] = [];
  constructor(private readonly results: SearchResult[] = []) {}
  async search(q: string): Promise<SearchResult[]> {
    this.queries.push(q);
    return this.results;
  }
}

export function testServices(opts: { mode?: ServiceMode; llm?: ScriptedLlm; search?: SearchProvider } = {}) {
  const llm = opts.llm ?? new ScriptedLlm();
  const config = {
    ...getConfig(),
    CRAWL_HOST_DELAY_MS: 0,
    REQUEST_TIMEOUT_MS: 3000,
    FETCH_MAX_RETRIES: 1,
    FETCH_MAX_BYTES: 1_000_000,
    LLM_MAX_RPM: 0,
    MAX_CRAWL_PAGES: 10,
    MAX_CRAWL_DEPTH: 2,
  };
  const services = createServices({
    mode: opts.mode ?? "evaluation",
    provider: llm,
    search: opts.search ?? new FakeSearch(),
    config,
    sleepFn: async () => {},
  });
  return { services, llm };
}
