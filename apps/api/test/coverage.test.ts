import { describe, expect, it } from "vitest";
import type { WorkspaceRequirement } from "@preptrace/shared";
import { computeCoverage, runCoverageLoop } from "../src/coverage/coverage";

const R = (id: string, priority: "must" | "nice" = "must", topic = id): WorkspaceRequirement => ({
  id,
  text: topic,
  topic,
  kind: "technical",
  priority,
  evidence: topic,
});

const requirements = [R("r1", "must", "React"), R("r2", "must", "Node.js"), R("r3", "must", "PostgreSQL"), R("r4", "must", "Mentoring"), R("r5", "nice", "Kafka")];

describe("computeCoverage (deterministic)", () => {
  it("finds the uncovered must requirement from the spec example", () => {
    const qs = [
      { id: "q1", requirement_ids: ["r1"] },
      { id: "q2", requirement_ids: ["r2"] },
      { id: "q3", requirement_ids: ["r4"] },
    ];
    const c = computeCoverage(requirements, qs);
    expect(c.uncovered_requirement_ids).toEqual(["r3"]);
    expect(c.uncovered_nice_ids).toEqual(["r5"]);
    expect(c.byRequirement.r1).toEqual(["q1"]);
    expect(c.coveredMust).toBe(3);
    expect(c.totalMust).toBe(4);
  });

  it("nice-to-have requirements never count as uncovered", () => {
    const c = computeCoverage([R("r1", "nice")], []);
    expect(c.uncovered_requirement_ids).toEqual([]);
  });

  it("ignores deleted questions and unknown requirement ids", () => {
    const c = computeCoverage(requirements.slice(0, 2), [
      { id: "q1", requirement_ids: ["r1"], deleted: true },
      { id: "q2", requirement_ids: ["r2", "r999"] },
    ]);
    expect(c.uncovered_requirement_ids).toEqual(["r1"]);
  });

  it("a question covering several requirements counts for each", () => {
    const c = computeCoverage(requirements.slice(0, 3), [{ id: "q1", requirement_ids: ["r1", "r2", "r3"] }]);
    expect(c.uncovered_requirement_ids).toEqual([]);
  });
});

describe("runCoverageLoop", () => {
  const fallback = (r: WorkspaceRequirement): { requirement_ids: string[]; template?: boolean } => ({ requirement_ids: [r.id], template: true });

  it("triggers a gap pass for uncovered requirements and re-checks (passes = 2)", async () => {
    const asked: string[][] = [];
    const res = await runCoverageLoop({
      requirements,
      questions: [{ requirement_ids: ["r1"] }, { requirement_ids: ["r2"] }, { requirement_ids: ["r4"] }],
      generateGaps: async (uncovered) => {
        asked.push(uncovered.map((r) => r.id));
        return uncovered.map((r) => ({ requirement_ids: [r.id] }));
      },
      fallback,
    });
    expect(asked).toEqual([["r3"]]);
    expect(res.passes).toBe(2);
    expect(res.uncovered).toEqual([]);
    expect(res.usedFallback).toEqual([]);
  });

  it("does nothing extra when everything is covered on the first check", async () => {
    let called = false;
    const res = await runCoverageLoop({
      requirements: requirements.slice(0, 2),
      questions: [{ requirement_ids: ["r1", "r2"] }],
      generateGaps: async () => {
        called = true;
        return [];
      },
      fallback,
    });
    expect(called).toBe(false);
    expect(res.passes).toBe(1);
  });

  it("stops after the maximum LLM passes and falls back deterministically", async () => {
    let calls = 0;
    const res = await runCoverageLoop({
      requirements,
      questions: [{ requirement_ids: ["r1"] }],
      generateGaps: async () => {
        calls++;
        return []; // model keeps failing to cover
      },
      fallback,
    });
    expect(calls).toBe(2);
    expect(res.usedFallback.sort()).toEqual(["r2", "r3", "r4"]);
    expect(res.uncovered).toEqual([]);
    expect(res.passes).toBe(4); // check, gap, check, gap, check, fallback, check
  });

  it("survives a gap-generation exception", async () => {
    const res = await runCoverageLoop({
      requirements: requirements.slice(0, 2),
      questions: [{ requirement_ids: ["r1"] }],
      generateGaps: async () => {
        throw new Error("LLM down");
      },
      fallback,
    });
    expect(res.log.some((l) => l.action.includes("gap pass failed"))).toBe(true);
    expect(res.uncovered).toEqual([]);
  });

  it("only counts gap questions that actually reference the requirement", async () => {
    const res = await runCoverageLoop({
      requirements: requirements.slice(0, 3),
      questions: [{ requirement_ids: ["r1"] }, { requirement_ids: ["r2"] }],
      generateGaps: async () => [{ requirement_ids: ["r1"] }], // wrong requirement
      fallback,
      maxLlmPasses: 1,
    });
    expect(res.usedFallback).toEqual(["r3"]);
  });
});
