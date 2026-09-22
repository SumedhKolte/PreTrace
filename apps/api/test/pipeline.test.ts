import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BatchOutputSchema, type BatchCase } from "@preptrace/shared";
import { startFixtureServer } from "../src/cli/fixtureServer";
import { runEvaluation } from "../src/evaluation/runEvaluation";
import { validateCanonicalKit } from "../src/validation/kitValidator";
import { computeCoverage } from "../src/coverage/coverage";
import { FakeSearch, testServices } from "./support/services";

let site: Awaited<ReturnType<typeof startFixtureServer>>;
let cases: BatchCase[];

beforeAll(async () => {
  site = await startFixtureServer(0);
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/cases.json"), "utf8")) as BatchCase[];
  cases = raw.map((c) => ({ ...c, company_url: c.company_url.replace("http://localhost:8099", site.url) }));
});
afterAll(async () => site.close());

describe("InterviewPrepService end-to-end (scripted LLM, real crawler)", () => {
  it("builds a valid, grounded kit with a coverage second pass", async () => {
    const { services, llm } = testServices();
    const stages: string[] = [];
    const out = await services.pipeline.generate({ jd: cases[0].jd, companyUrl: cases[0].company_url, days: 5 }, (s, st) => {
      if (st === "done") stages.push(s);
    });
    const kit = out.canonical;
    expect(validateCanonicalKit(kit, 5)).toMatchObject({ ok: true });

    // Stage 1: grounding dropped the invented requirement, kept must/nice split
    expect(kit.role.requirements.some((r) => /Rust/.test(r.text))).toBe(false);
    expect(kit.role.requirements.find((r) => /Kafka/.test(r.text))?.priority).toBe("nice");
    expect(kit.role.seniority).toBe("senior");

    // Research: hiring process found on "Life at Acme"; invented take-home stage dropped
    const hp = kit.company_brief.hiring_process!;
    expect(hp.found).toBe(true);
    expect(hp.stages.map((s) => s.name)).toContain("System design interview");
    expect(hp.stages.some((s) => /take-home/i.test(s.name))).toBe(false);
    expect(kit.source.pages_used.some((u) => u.endsWith("/people/life.html"))).toBe(true);
    expect(kit.source.pages_used.some((u) => u.includes("/internal/"))).toBe(false);
    expect(kit.company_brief.sources.length).toBeGreaterThan(0);
    expect(kit.company_brief.summary).not.toMatch(/Google|1,000,000/);

    // Prompt injection on the about page was flagged as data
    expect(out.parts.research.sources.find((s) => s.url.endsWith("about.html"))?.flags).toContain("suspicious_instructions_ignored");

    // Category-specific generation: separate calls per category (not one prompt)
    const tasks = llm.calls.map((c) => c.task);
    for (const t of ["questions_technical", "questions_behavioural", "questions_system_design", "questions_company_fit"]) expect(tasks).toContain(t);
    expect(new Set(kit.questions.map((q) => q.category))).toEqual(new Set(["technical", "behavioural", "system_design", "company_fit"]));

    // Coverage: the scripted model leaves a gap → gap pass → re-check
    expect(tasks).toContain("questions_gap_fill");
    expect(kit.coverage.passes).toBe(2);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(computeCoverage(kit.role.requirements, kit.questions).uncovered_requirement_ids).toEqual([]);

    // Only real requirement ids survive (scripted model also emits r999)
    const reqIds = new Set(kit.role.requirements.map((r) => r.id));
    expect(kit.questions.every((q) => q.requirement_ids.every((id) => reqIds.has(id)))).toBe(true);
    // Evidence only cites real signals (S404 dropped)
    expect(out.parts.questions.every((q) => q.evidence.signals.every((s) => s.source_url.startsWith("http")))).toBe(true);

    // Company DNA: technologies from the company's own pages, JD overlap marked
    const dna = out.parts.research.techStack;
    expect(dna.map((t) => t.name)).toEqual(expect.arrayContaining(["TypeScript", "Node.js", "PostgreSQL", "Kafka", "Kubernetes"]));
    expect(dna.find((t) => t.name === "PostgreSQL")?.inJd).toBe(true);
    expect(dna.some((t) => t.name === "Vitess")).toBe(false);

    // Deterministic schedule
    expect(kit.schedule.days).toHaveLength(5);
    expect(kit.flashcards.length).toBeGreaterThan(0);
    expect(stages).toContain("validate");
  });

  it("company without a hiring page → honest gap, still ok", async () => {
    const { services } = testServices();
    const out = await services.pipeline.generate({ jd: cases[1].jd, companyUrl: cases[1].company_url, days: 3 });
    expect(out.canonical.company_brief.hiring_process?.found).toBe(false);
    expect(out.canonical.company_brief.hiring_process?.summary).toBe("No official hiring process information was discovered.");
    expect(out.parts.research.limitations).toContain("No official hiring process information was discovered.");
    expect(out.canonical.schedule.days).toHaveLength(3);
    // Junior/mid frontend role with no design evidence → no system-design section
    expect(out.canonical.questions.some((q) => q.category === "system_design")).toBe(false);
    expect(out.parts.generation.systemDesignJustification).toMatch(/Not generated/);
  });

  it("thin two-line JD → thin kit, 1-day schedule", async () => {
    const { services } = testServices();
    const out = await services.pipeline.generate({ jd: cases[2].jd, companyUrl: cases[2].company_url, days: 1 });
    expect(out.canonical.role.requirements).toHaveLength(1);
    expect(out.canonical.role.requirements[0].text).toMatch(/Python/);
    expect(out.canonical.schedule.days).toHaveLength(1);
    expect(out.warnings.join()).toMatch(/thin/);
  });

  it("uses public search results only when they mention the company, and labels them", async () => {
    const search = new FakeSearch([
      { title: "Acme Payments interview process (2025)", url: "https://forum.example/acme-payments-interview", snippet: "Acme Payments interview had a system design round about payouts." },
      { title: "Unrelated company interview", url: "https://forum.example/other", snippet: "Globex interview was easy." },
    ]);
    const { services } = testServices({ search });
    const out = await services.pipeline.generate({ jd: cases[0].jd, companyUrl: cases[0].company_url, days: 2 });
    const pub = out.parts.research.sources.filter((s) => s.type === "public_discussion");
    expect(pub.map((s) => s.url)).toEqual(["https://forum.example/acme-payments-interview"]);
    expect(pub[0].relevance).toBe("inferred");
    expect(pub[0].note).toMatch(/unverified/);
    expect(search.queries.some((q) => /interview process/.test(q))).toBe(true);
  });

  it("reuses cached research for the same company (no re-crawl, fewer LLM calls)", async () => {
    const { services, llm } = testServices();
    await services.pipeline.generate({ jd: cases[1].jd, companyUrl: cases[1].company_url, days: 2 });
    const first = llm.calls.filter((c) => c.task === "company_facts").length;
    await services.pipeline.generate({ jd: cases[1].jd, companyUrl: cases[1].company_url, days: 2 });
    expect(llm.calls.filter((c) => c.task === "company_facts").length).toBe(first);
  });

  it("a category failing (invalid JSON twice) degrades gracefully; coverage still completes", async () => {
    const { services, llm } = testServices();
    llm.failNext("questions_behavioural", "invalid_json", "invalid_json");
    const out = await services.pipeline.generate({ jd: cases[0].jd, companyUrl: cases[0].company_url, days: 4 });
    expect(out.warnings.join()).toMatch(/Behavioural question generation failed/);
    expect(out.canonical.coverage.uncovered_requirement_ids).toEqual([]);
    expect(out.partial).toBe(true);
  });
});

describe("batch evaluator", () => {
  it("processes every case through the same pipeline, continues after failures, writes Appendix B", async () => {
    const { services } = testServices();
    const logs: string[] = [];
    const out = await runEvaluation([...cases, { id: "case-bad", jd: "", company_url: "not a url", days: 0 }], services, {
      caseConcurrency: 2,
      caseTimeoutMs: 60_000,
      log: (l) => logs.push(l),
    });
    expect(BatchOutputSchema.safeParse(out).success).toBe(true);
    expect(out.version).toBe("1.0");
    expect(out.kits.map((k) => k.id)).toEqual(["case-01", "case-02", "case-03", "case-04", "case-05", "case-bad"]);
    const byId = Object.fromEntries(out.kits.map((k) => [k.id, k]));
    for (const id of ["case-01", "case-02", "case-03", "case-05"]) {
      expect(byId[id].status).toBe("ok");
      const k = byId[id].kit!;
      expect(k.schedule.days).toHaveLength(cases.find((c) => c.id === id)!.days);
      expect(k.coverage.uncovered_requirement_ids).toEqual([]);
    }
    expect(byId["case-04"]).toMatchObject({ status: "failed", kit: null, error: { code: "COMPANY_UNREACHABLE" } });
    expect(byId["case-bad"]).toMatchObject({ status: "failed", error: { code: "INVALID_INPUT" } });
    expect(byId["case-05"].kit!.schedule.days).toHaveLength(60);
  }, 120_000);

  it("fails every case cleanly when no LLM is configured", async () => {
    const { services } = testServices();
    (services.llm as unknown as { provider: null }).provider = null;
    const out = await runEvaluation([cases[0]], services, { caseConcurrency: 1, caseTimeoutMs: 10_000 });
    expect(out.kits[0]).toMatchObject({ status: "failed", error: { code: "LLM_NOT_CONFIGURED" } });
  });
});
