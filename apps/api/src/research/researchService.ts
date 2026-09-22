import { z } from "zod";
import { normalizeUrlForKey, type HiringProcess, type ResearchSignal, type ResearchSource, type SourceType } from "@preptrace/shared";
import type { Llm } from "../llm/client";
import { system, untrusted } from "../llm/prompt";
import { logger } from "../lib/logger";
import { detectInjection, normalizeText, quoteSupported, sha256, tokens } from "../lib/text";
import { crawlCompanySite, type CrawledPage, type CrawlResult } from "./crawler/crawler";
import { extractPage } from "./crawler/htmlExtract";
import type { LinkCategory } from "./crawler/linkRanker";
import type { RobotsCache } from "./net/robots";
import type { SafeFetcher } from "./net/safeFetch";
import type { SearchProvider, SearchResult } from "./search/searchProvider";
import type { ResearchCache } from "./researchCache";

export interface ResearchBundle {
  companyUrl: string;
  finalUrl: string;
  researchedAt: string;
  companyName: string;
  siteDescription: string;
  pagesUsed: string[];
  sources: ResearchSource[];
  signals: ResearchSignal[];
  hiring: HiringProcess;
  limitations: string[];
  robotsBlocked: boolean;
  /** Condensed page text kept for later brief regeneration (bounded). */
  pageDigests: { url: string; title: string; category: LinkCategory; excerpt: string }[];
}

export type ResearchStage = "discover_pages" | "extract_pages" | "hiring_process" | "public_research";
export type StageReporter = (stage: ResearchStage, status: "running" | "done" | "skipped", detail?: string) => void;

export interface ResearchDeps {
  llm: Llm;
  pageFetcher: SafeFetcher; // policy depends on mode (strict vs evaluation)
  publicFetcher: SafeFetcher; // always strict: search results are arbitrary internet URLs
  robots: RobotsCache;
  publicRobots: RobotsCache;
  search: SearchProvider;
  cache?: ResearchCache;
  crawl: { maxPages: number; maxDepth: number; concurrency: number };
  searchMaxResults: number;
  cacheTtlMs: number;
}

// ---------------------------------------------------------------------------
// LLM schemas
// ---------------------------------------------------------------------------

const FactsOut = z.object({
  company_name: z.string().nullish(),
  facts: z
    .array(z.object({ text: z.string(), category: z.string().default("other"), page_id: z.string(), quote: z.string().nullish() }))
    .default([]),
});

const HiringOut = z.object({
  found: z.boolean().default(false),
  stages: z
    .array(z.object({ name: z.string(), description: z.string().default(""), page_id: z.string(), quote: z.string().nullish() }))
    .default([]),
  expectations: z.array(z.object({ text: z.string(), page_id: z.string(), quote: z.string().nullish() })).default([]),
});

const PublicOut = z.object({
  signals: z.array(z.object({ text: z.string(), result_id: z.string(), quote: z.string().nullish() })).default([]),
});

// ---------------------------------------------------------------------------

const EMPTY_HIRING: HiringProcess = {
  found: false,
  summary: "No official hiring process information was discovered.",
  stages: [],
  expectations: [],
};

function sourceTypeFor(cat: LinkCategory): SourceType {
  if (cat === "hiring" || cat === "careers") return "hiring";
  if (cat === "engineering") return "engineering";
  if (cat === "about") return "about";
  return "official";
}

export function cleanSiteName(page: { siteName: string; title: string } | null, url: string): string {
  if (page?.siteName) return page.siteName.trim();
  if (page?.title) {
    const parts = page.title.split(/\s[|–—\-:·]\s/).map((s) => s.trim()).filter(Boolean);
    const candidate = parts.sort((a, b) => a.length - b.length)[0];
    if (candidate && candidate.length <= 40 && !/^(home|welcome)$/i.test(candidate)) return candidate;
  }
  const host = new URL(url).hostname.replace(/^www\./, "");
  const label = host.split(".")[0];
  return label === "localhost" ? new URL(url).pathname.split("/").filter(Boolean)[0] ?? "Company" : label.charAt(0).toUpperCase() + label.slice(1);
}

export class ResearchService {
  constructor(private readonly deps: ResearchDeps) {}

  cacheKey(companyUrl: string, companyName: string | null) {
    return sha256(`${normalizeUrlForKey(companyUrl)}|${normalizeText(companyName ?? "")}`);
  }

  async research(
    companyUrl: string,
    companyNameHint: string | null,
    report: StageReporter,
    opts: { useCache?: boolean; llm?: Llm } = {},
  ): Promise<ResearchBundle> {
    const llm = opts.llm ?? this.deps.llm;
    const key = this.cacheKey(companyUrl, companyNameHint);
    if (opts.useCache !== false && this.deps.cache) {
      const hit = await this.deps.cache.get(key).catch(() => null);
      if (hit) {
        const when = new Date(hit.researchedAt).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
        report("discover_pages", "done", `Reused cached research (${hit.pagesUsed.length} pages, ${when})`);
        report("extract_pages", "done", `${hit.signals.filter((s) => s.kind === "company").length} grounded company facts (cached)`);
        report("hiring_process", "done", hit.hiring.found ? `Hiring process: ${hit.hiring.stages.length} stages (cached)` : "No official hiring process found (cached)");
        report("public_research", "done", `${hit.signals.filter((s) => s.kind === "public").length} public signals (cached)`);
        return hit;
      }
    }

    // Stage 2 — discovery
    report("discover_pages", "running", "Fetching homepage and robots.txt");
    const crawl = await crawlCompanySite(companyUrl, { fetcher: this.deps.pageFetcher, robots: this.deps.robots }, {
      ...this.deps.crawl,
      onProgress: (m) => report("discover_pages", "running", m),
    });
    const limitations: string[] = [];
    const sources = this.crawlSources(crawl);

    const allPages = crawl.homepage ? [crawl.homepage, ...crawl.pages] : [];
    const companyName = companyNameHint ?? cleanSiteName(crawl.homepage, crawl.finalUrl);
    if (crawl.robotsBlockedHomepage) {
      limitations.push("The company website disallows automated access (robots.txt), so it was not crawled.");
      report("discover_pages", "done", "Site disallows crawling via robots.txt — skipped");
    } else {
      const counts = countBy(crawl.pages.map((p) => p.category));
      const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`);
      report("discover_pages", "done", `Found ${allPages.length} relevant company pages${parts.length ? ` (${parts.join(", ")})` : ""}`);
    }

    // Flag and record prompt-injection attempts in crawled content.
    for (const p of allPages) {
      if (detectInjection(p.text)) {
        const src = sources.find((s) => s.url === p.url);
        if (src) src.flags = [...(src.flags ?? []), "suspicious_instructions_ignored"];
        limitations.push(`Instruction-like text on ${new URL(p.url).pathname} was treated as data and ignored.`);
      }
    }

    // Stage 3 — page extraction (grounded company facts)
    const signals: ResearchSignal[] = [];
    let n = 0;
    const nextId = () => `S${++n}`;
    let extractedName: string | null = null;
    if (allPages.length > 0) {
      report("extract_pages", "running", `Extracting facts from ${Math.min(allPages.length, 6)} pages`);
      try {
        const res = await this.extractFacts(allPages, llm);
        extractedName = res.name;
        for (const f of res.facts) signals.push({ id: nextId(), kind: "company", text: f.text, quote: f.quote, source_url: f.url });
        report("extract_pages", "done", `${res.facts.length} grounded company facts extracted`);
      } catch (e) {
        logger.warn("fact extraction failed", { err: String(e) });
        limitations.push("Company facts could not be extracted from the website.");
        report("extract_pages", "done", "Fact extraction failed — continuing with limited company context");
      }
    } else {
      report("extract_pages", "skipped", "No company pages available");
    }
    if (signals.length === 0) limitations.push("Limited public information was available about the company.");

    // Stage 4 — hiring process discovery (never assume a hiring page exists)
    let hiring = EMPTY_HIRING;
    const hiringCandidates = allPages
      .filter((p) => p.hiringSignals >= 4 && /\binterview/i.test(p.text))
      .sort((a, b) => Number(b.category === "hiring") - Number(a.category === "hiring") || b.hiringSignals - a.hiringSignals)
      .slice(0, 2);
    if (hiringCandidates.length === 0) {
      report("hiring_process", "done", "No official hiring process information was discovered");
      limitations.push("No official hiring process information was discovered.");
    } else {
      report("hiring_process", "running", `Reading ${hiringCandidates.map((p) => new URL(p.url).pathname).join(", ")}`);
      try {
        hiring = await this.extractHiring(hiringCandidates, llm);
        for (const s of hiring.stages) signals.push({ id: nextId(), kind: "hiring", text: `${s.name}: ${s.description}`.trim(), source_url: s.source_url });
        for (const e of hiring.expectations) signals.push({ id: nextId(), kind: "hiring", text: e, source_url: hiringCandidates[0].url });
        report("hiring_process", "done", hiring.found ? `Found a hiring process page — ${hiring.stages.length} stages` : "Hiring pages found, but no explicit interview stages");
        if (!hiring.found) limitations.push("No official hiring process information was discovered.");
      } catch (e) {
        logger.warn("hiring extraction failed", { err: String(e) });
        report("hiring_process", "done", "Could not extract the hiring process");
      }
    }

    // Stage 5 — public interview research (clearly labelled as unverified)
    report("public_research", "running", `Searching for "${companyName} interview process"`);
    const pub = await this.publicResearch(companyName, crawl.finalUrl).catch((e) => {
      logger.warn("public research failed", { err: String(e) });
      return { results: [] as (SearchResult & { relevance: "confirmed" | "inferred"; official: boolean; body?: string })[], unavailable: true };
    });
    if (pub.unavailable) limitations.push("Public web search was unavailable, so no public interview discussions were used.");
    if (pub.results.length > 0) {
      try {
        const publicSignals = await this.summarizePublic(companyName, pub.results, llm);
        for (const s of publicSignals) signals.push({ id: nextId(), kind: "public", text: s.text, quote: s.quote, source_url: s.url });
      } catch (e) {
        logger.warn("public summarisation failed", { err: String(e) });
      }
      for (const r of pub.results) {
        sources.push({
          url: r.url,
          title: r.title || r.url,
          type: r.official ? "official" : "public_discussion",
          status: "ok",
          relevance: r.relevance,
          used_for: [],
          note: r.official ? undefined : "Public discussion — unverified, not official company policy",
        });
      }
    }
    const publicCount = signals.filter((s) => s.kind === "public").length;
    if (!pub.unavailable && publicCount === 0) limitations.push("No public interview-process discussion was found.");
    report("public_research", pub.unavailable ? "skipped" : "done", pub.unavailable ? "Public search unavailable — skipped" : `${pub.results.length} public sources, ${publicCount} usable signals`);

    // Mark which sources fed which signals.
    for (const s of signals) {
      const src = sources.find((x) => x.url === s.source_url);
      if (src && !src.used_for.includes(s.kind === "hiring" ? "hiring process" : s.kind === "public" ? "interview research" : "company brief")) {
        src.used_for.push(s.kind === "hiring" ? "hiring process" : s.kind === "public" ? "interview research" : "company brief");
      }
    }

    const bundle: ResearchBundle = {
      companyUrl,
      finalUrl: crawl.finalUrl,
      researchedAt: new Date().toISOString(),
      companyName: companyNameHint ?? extractedName ?? companyName,
      siteDescription: crawl.homepage?.description ?? "",
      pagesUsed: allPages.map((p) => p.url),
      sources,
      signals,
      hiring,
      limitations: [...new Set(limitations)],
      robotsBlocked: crawl.robotsBlockedHomepage,
      pageDigests: allPages.slice(0, 8).map((p) => ({ url: p.url, title: p.title, category: p.category, excerpt: p.text.slice(0, 1500) })),
    };
    if (this.deps.cache) await this.deps.cache.set(key, bundle, this.deps.cacheTtlMs).catch(() => {});
    return bundle;
  }

  private crawlSources(crawl: CrawlResult): ResearchSource[] {
    const byUrl = new Map<string, CrawledPage>();
    for (const p of [crawl.homepage, ...crawl.pages]) if (p) byUrl.set(p.url, p);
    return crawl.attempts
      .filter((a) => a.status !== "skipped")
      .map((a) => {
        const page = byUrl.get(a.url);
        return {
          url: a.url,
          title: page?.title || new URL(a.url).pathname,
          type: a.url === crawl.finalUrl ? "official" : sourceTypeFor(page?.category ?? a.category),
          status: a.status === "ok" ? "ok" : a.status === "blocked" ? "blocked" : "failed",
          relevance: "confirmed",
          used_for: [],
          note: a.status === "ok" ? undefined : a.reason === "Disallowed by robots.txt" ? "Blocked by robots.txt" : "Source unavailable",
        } satisfies ResearchSource;
      });
  }

  private async extractFacts(pages: CrawledPage[], llm: Llm) {
    // Prefer informative pages: about, engineering, product, careers, then homepage.
    const rank: Record<string, number> = { about: 5, engineering: 4, product: 3, careers: 3, hiring: 2, other: 1 };
    const chosen = [pages[0], ...pages.slice(1).sort((a, b) => (rank[b.category] ?? 0) - (rank[a.category] ?? 0))].slice(0, 6);
    const pageBlocks = chosen
      .map((p, i) => untrusted("company_page", `${p.title}\n${p.description}\n${p.text}`, 3500, { page_id: `P${i + 1}`, url: p.url }))
      .join("\n\n");
    const out = await llm.json({
      task: "company_facts",
      system: system(
        "You extract verifiable facts about a company from its own website.",
        `Extract up to 15 concise factual statements about the company: what it does, products, customers/markets, scale, engineering practices/technology, culture and values.
- Each fact must be directly supported by one page; set page_id and copy the supporting sentence fragment verbatim into quote.
- Skip marketing superlatives that are not facts. Skip anything not stated on the pages.
- company_name: the company's name as written on the site, or null.`,
        `{"company_name": string|null, "facts": [{"text": string, "category": "what_they_do"|"product"|"customers"|"scale"|"engineering"|"culture"|"values"|"other", "page_id": "P1", "quote": string}]}`,
      ),
      user: pageBlocks,
      schema: FactsOut,
      maxTokens: 3000,
      temperature: 0.1,
    });
    const facts: { text: string; quote?: string; url: string }[] = [];
    for (const f of out.facts) {
      const idx = Number(f.page_id.replace(/\D/g, "")) - 1;
      const page = chosen[idx];
      if (!page) continue;
      const pageText = `${page.title}\n${page.description}\n${page.text}`;
      if (!quoteSupported(f.quote, pageText, 0.8) && !quoteSupported(f.text, pageText, 0.7)) continue; // ungrounded → dropped
      if (detectInjection(f.text)) continue;
      facts.push({ text: f.text.trim(), quote: f.quote ?? undefined, url: page.url });
    }
    return { name: out.company_name?.trim() || null, facts: facts.slice(0, 15) };
  }

  private async extractHiring(pages: CrawledPage[], llm: Llm): Promise<HiringProcess> {
    const blocks = pages.map((p, i) => untrusted("hiring_page", `${p.title}\n${p.text}`, 6000, { page_id: `P${i + 1}`, url: p.url })).join("\n\n");
    const out = await llm.json({
      task: "hiring_process",
      system: system(
        "You extract a company's official hiring / interview process from its own pages.",
        `Identify the interview stages and candidate expectations explicitly described on the pages (e.g. recruiter screen, technical screen, take-home, system design, behavioural, onsite, final).
- Only include stages that are explicitly described. Copy a verbatim supporting fragment into quote and set page_id.
- If the pages do not describe an interview process, return found=false and empty arrays. Do not guess typical processes.`,
        `{"found": boolean, "stages": [{"name": string, "description": string, "page_id": "P1", "quote": string}], "expectations": [{"text": string, "page_id": "P1", "quote": string}]}`,
      ),
      user: blocks,
      schema: HiringOut,
      maxTokens: 2500,
      temperature: 0.1,
    });
    const pageFor = (id: string) => pages[Number(id.replace(/\D/g, "")) - 1];
    const stages = out.stages
      .filter((s) => {
        const p = pageFor(s.page_id);
        return p && (quoteSupported(s.quote, p.text, 0.8) || quoteSupported(`${s.name} ${s.description}`, p.text, 0.7));
      })
      .slice(0, 10)
      .map((s) => ({ name: s.name.trim(), description: s.description.trim(), source_url: pageFor(s.page_id)!.url }));
    const expectations = out.expectations
      .filter((e) => {
        const p = pageFor(e.page_id);
        return p && (quoteSupported(e.quote, p.text, 0.8) || quoteSupported(e.text, p.text, 0.7));
      })
      .map((e) => e.text.trim())
      .slice(0, 8);
    if (stages.length === 0) return { ...EMPTY_HIRING, expectations };
    return {
      found: true,
      summary: `The company describes a ${stages.length}-stage process: ${stages.map((s) => s.name).join(" → ")}.`,
      stages,
      expectations,
    };
  }

  private async publicResearch(companyName: string, companyUrl: string) {
    const queries = [
      `"${companyName}" interview process`,
      `"${companyName}" engineering interview`,
      `"${companyName}" technical interview`,
      `"${companyName}" interview experience`,
    ];
    const siteHost = new URL(companyUrl).hostname.replace(/^www\./, "");
    const nameTokens = tokens(companyName).filter((t) => !["inc", "ltd", "llc", "corp", "corporation", "gmbh", "co", "company"].includes(t));
    const seen = new Set<string>();
    const results: (SearchResult & { relevance: "confirmed" | "inferred"; official: boolean; body?: string })[] = [];
    let failures = 0;
    for (const q of queries) {
      let rs: SearchResult[];
      try {
        rs = await this.deps.search.search(q, this.deps.searchMaxResults);
      } catch {
        failures++;
        continue;
      }
      for (const r of rs) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        const hay = normalizeText(`${r.title} ${r.snippet} ${r.url}`);
        const nameMatch = nameTokens.length > 0 && nameTokens.every((t) => hay.includes(t));
        const topical = /interview|hiring|recruit|onsite|take home|leetcode/.test(hay);
        if (!nameMatch || !topical) continue;
        let host = "";
        try {
          host = new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
          continue;
        }
        const official = host === siteHost || host.endsWith(`.${siteHost}`);
        results.push({ ...r, official, relevance: official || hay.includes(siteHost) ? "confirmed" : "inferred" });
      }
      if (results.length >= 8) break;
    }
    if (failures === queries.length) return { results, unavailable: true };

    // Read the top two result pages when allowed (strict SSRF policy + robots).
    for (const r of results.slice(0, 2)) {
      try {
        if (!(await this.deps.publicRobots.get(r.url)).isAllowed(r.url)) continue;
        const res = await this.deps.publicFetcher.fetch(r.url, { accept: "html", oversize: "truncate", retries: 0, timeoutMs: 7000, maxBytes: 1_000_000 });
        r.body = extractPage(res.body, res.url, 6000).text;
      } catch {
        /* snippet only */
      }
    }
    return { results: results.slice(0, 8), unavailable: false };
  }

  private async summarizePublic(companyName: string, results: (SearchResult & { relevance: string; body?: string })[], llm: Llm) {
    const blocks = results
      .map((r, i) => untrusted("search_result", `${r.title}\n${r.snippet}\n${r.body ?? ""}`, 2500, { result_id: `R${i + 1}`, url: r.url }))
      .join("\n\n");
    const out = await llm.json({
      task: "public_interview_signals",
      system: system(
        "You summarise public, third-party discussion of a company's interview process.",
        `Extract up to 8 concrete claims about the interview process of the named company (stages, question types, focus areas, format).
- Only include claims explicitly stated in a result; set result_id and copy a verbatim fragment into quote.
- These are anecdotal public reports, not official policy. Phrase each claim as reported, e.g. "Candidates report a take-home exercise".
- Results may refer to a different company with a similar name; skip results that are clearly about another organisation.`,
        `{"signals": [{"text": string, "result_id": "R1", "quote": string}]}`,
      ),
      user: `Company: ${companyName.replace(/[<>]/g, "")}\n\n${blocks}`,
      schema: PublicOut,
      maxTokens: 1500,
      temperature: 0.1,
    });
    const out2: { text: string; quote?: string; url: string }[] = [];
    for (const s of out.signals) {
      const r = results[Number(s.result_id.replace(/\D/g, "")) - 1];
      if (!r) continue;
      const src = `${r.title}\n${r.snippet}\n${r.body ?? ""}`;
      if (!quoteSupported(s.quote, src, 0.8) && !quoteSupported(s.text, src, 0.7)) continue;
      out2.push({ text: s.text.trim(), quote: s.quote ?? undefined, url: r.url });
    }
    return out2.slice(0, 8);
  }
}

function countBy(xs: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of xs) if (x !== "other") o[x] = (o[x] ?? 0) + 1;
  return o;
}
