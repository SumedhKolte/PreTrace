import { describe, expect, it } from "vitest";
import type { PracticeItemStats, WorkspaceFlashcard, WorkspaceQuestion, WorkspaceRequirement } from "@preptrace/shared";
import { newMeta } from "../src/kits/state";
import { buildSessionItems, computeReadiness, itemConfidence, prioritizeItems } from "../src/practice/weakness";
import { foldStats } from "../src/practice/practiceService";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const DAY = 86_400_000;

const reqs: WorkspaceRequirement[] = [
  { id: "r1", text: "Node.js", topic: "Node.js", kind: "technical", priority: "must", evidence: "" },
  { id: "r2", text: "System design", topic: "System design", kind: "technical", priority: "must", evidence: "" },
  { id: "r3", text: "Kafka", topic: "Kafka", kind: "technical", priority: "nice", evidence: "" },
];
const q = (id: string, rid: string, difficulty: 1 | 2 | 3, category: WorkspaceQuestion["category"] = "technical"): WorkspaceQuestion => ({
  id, requirement_ids: [rid], category, prompt: id, answer_outline: "-", difficulty, order: 0, evidence: { rationale: "", signals: [] }, meta: newMeta("generated", 0, "llm"),
});
const f = (id: string, rid: string): WorkspaceFlashcard => ({ id, front: id, back: id, requirement_ids: [rid], order: 0, meta: newMeta("generated", 0, "llm") });

const questions = [q("q1", "r1", 1), q("q2", "r2", 3, "system_design"), q("q3", "r3", 2)];
const flashcards = [f("f1", "r1"), f("f2", "r2")];

function stat(itemType: "question" | "flashcard", itemId: string, confs: number[], daysAgo = 0): [string, PracticeItemStats] {
  return [
    `${itemType}:${itemId}`,
    {
      itemId, itemType, attempts: confs.length, lastConfidence: confs.at(-1)!, avgConfidence: confs.reduce((a, b) => a + b, 0) / confs.length,
      lastPracticedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    },
  ];
}

describe("weakness / readiness scoring (deterministic)", () => {
  it("everything is 0% ready before practice; weak spots rank must + hard first", () => {
    const r = computeReadiness({ requirements: reqs, questions, flashcards, stats: new Map(), now: NOW });
    expect(r.overall).toBe(0);
    expect(r.weakSpots.map((w) => w.requirementId)).toEqual(["r2", "r1", "r3"]); // r2: must + difficulty 3
    expect(r.weakSpots[0].reasons).toEqual(expect.arrayContaining(["must_have", "never_practiced", "high_difficulty"]));
  });

  it("matches the documented formula", () => {
    // r1: q1 conf 5 today, f1 unpractised → mean mastery 0.5, practised 0.5, fresh 1 → 100*(0.35+0.1+0.1) = 55
    const stats = new Map([stat("question", "q1", [5])]);
    const r = computeReadiness({ requirements: reqs, questions, flashcards, stats, now: NOW });
    const r1 = r.requirements.find((x) => x.requirementId === "r1")!;
    expect(r1.readiness).toBe(55);
    expect(r1.weakness).toBe(Math.round(45 * 1 * 0.9));
    expect(r1.reasons).not.toContain("never_practiced"); // 1 of 2 items practised = exactly half, not "insufficient"
  });

  it("confidence blends latest (70%) with history (30%)", () => {
    expect(itemConfidence({ itemId: "x", itemType: "question", attempts: 2, lastConfidence: 5, avgConfidence: 3, lastPracticedAt: "" })).toBeCloseTo(4.4);
  });

  it("stale practice lowers readiness and adds a reason", () => {
    const fresh = computeReadiness({ requirements: reqs, questions, flashcards, stats: new Map([stat("question", "q2", [4]), stat("flashcard", "f2", [4])]), now: NOW });
    const stale = computeReadiness({ requirements: reqs, questions, flashcards, stats: new Map([stat("question", "q2", [4], 10), stat("flashcard", "f2", [4], 10)]), now: NOW });
    const a = fresh.requirements.find((x) => x.requirementId === "r2")!;
    const b = stale.requirements.find((x) => x.requirementId === "r2")!;
    expect(b.readiness).toBeLessThan(a.readiness);
    expect(b.reasons).toContain("stale");
  });

  it("category readiness and strong areas", () => {
    const stats = new Map([stat("question", "q1", [5]), stat("flashcard", "f1", [5])]);
    const r = computeReadiness({ requirements: reqs, questions, flashcards, stats, now: NOW });
    expect(r.categories.find((c) => c.category === "technical")!.readiness).toBe(50); // q1=100, q3=0
    expect(r.strongAreas.map((s) => s.requirementId)).toEqual(["r1"]);
    expect(r.weakSpots.map((s) => s.requirementId)).not.toContain("r1");
  });

  it("session prioritisation puts never-practised must/hard items first and low confidence above mastered", () => {
    const stats = new Map([stat("question", "q1", [5]), stat("flashcard", "f1", [1])]);
    const ranked = prioritizeItems({ requirements: reqs, questions, flashcards, stats, now: NOW });
    expect(ranked[0].itemId).toBe("q2"); // never practised, must, difficulty 3
    const pos = (id: string) => ranked.findIndex((i) => i.itemId === id);
    expect(pos("f1")).toBeLessThan(pos("q1")); // low confidence before mastered
    expect(ranked.find((i) => i.itemId === "f1")!.reason).toMatch(/Low confidence/);
    const session = buildSessionItems(ranked, 5);
    expect(session.length).toBeGreaterThanOrEqual(3);
  });

  it("foldStats aggregates events in time order", () => {
    const kitId = {} as never;
    const s = foldStats([
      { itemId: "q1", itemType: "question", confidence: 2, createdAt: new Date(NOW - DAY), kitId },
      { itemId: "q1", itemType: "question", confidence: 4, createdAt: new Date(NOW), kitId },
    ]);
    expect(s.get("question:q1")).toMatchObject({ attempts: 2, lastConfidence: 4, avgConfidence: 3 });
  });
});
