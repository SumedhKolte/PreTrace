import { describe, expect, it } from "vitest";
import type { WorkspaceQuestion, WorkspaceRequirement, WorkspaceSchedule } from "@preptrace/shared";
import type { GeneratedQuestion } from "../src/generation/questions";
import { reorder } from "../src/kits/editing";
import { applyQuestionPatch, materializeQuestions, mergeCategoryQuestions, reschedule, type Counters } from "../src/kits/state";

const reqs: WorkspaceRequirement[] = [
  { id: "r1", text: "Node.js", topic: "Node.js", kind: "technical", priority: "must", evidence: "Node.js" },
  { id: "r2", text: "Mentoring", topic: "Mentoring", kind: "behavioural", priority: "must", evidence: "Mentoring" },
];

const gen = (prompt: string, category: GeneratedQuestion["category"] = "technical", rid = "r1"): GeneratedQuestion => ({
  prompt,
  category,
  requirement_ids: [rid],
  answer_outline: "- a",
  difficulty: 2,
  evidence: { rationale: "", signals: [] },
  producer: "llm",
});

function setup() {
  const counters: Counters = { question: 0, flashcard: 0 };
  const qs = materializeQuestions(
    [
      gen("How does the Node.js event loop schedule timers?"),
      gen("Explain backpressure in Node.js streams"),
      gen("Describe clustering strategies for Node.js servers"),
      gen("Tell me about mentoring a junior engineer", "behavioural", "r2"),
    ],
    counters,
    0,
    0,
  );
  return { counters, qs };
}

describe("state model: scoped regeneration never destroys user work", () => {
  it("edited, pinned and manual questions survive regenerating their category", () => {
    const { counters, qs } = setup();
    qs[0] = applyQuestionPatch(qs[0], { prompt: "My own rewrite of the event loop question" });
    qs[1] = applyQuestionPatch(qs[1], { pinned: true });
    const manual: WorkspaceQuestion = { ...qs[2], id: "q99", meta: { ...qs[2].meta, origin: "manual" }, prompt: "Manual question about Node.js worker threads" };
    const current = [...qs, manual];

    const merged = mergeCategoryQuestions(current, "technical", [gen("Brand new question about Node.js error handling")], counters, 1);
    const ids = merged.items.map((q) => q.id);
    expect(ids).toContain("q1"); // edited
    expect(ids).toContain("q2"); // pinned
    expect(ids).toContain("q99"); // manual
    expect(ids).not.toContain("q3"); // unprotected generated → replaced
    expect(merged.removed).toEqual(["q3"]);
    expect(merged.items.find((q) => q.id === "q1")!.prompt).toBe("My own rewrite of the event loop question");
  });

  it("does not touch other categories (same object identity)", () => {
    const { counters, qs } = setup();
    const merged = mergeCategoryQuestions(qs, "technical", [gen("Something new about Node.js")], counters, 1);
    expect(merged.items.find((q) => q.id === "q4")).toBe(qs[3]);
  });

  it("never reuses ids and keeps tombstones of deleted questions", () => {
    const { counters, qs } = setup();
    qs[2] = { ...qs[2], meta: { ...qs[2].meta, deleted: true } };
    const merged = mergeCategoryQuestions(qs, "technical", [gen("Fresh question A about Node.js"), gen("Fresh question B about caching")], counters, 1);
    expect(merged.items.find((q) => q.id === "q3")?.meta.deleted).toBe(true);
    expect(merged.added).toEqual(["q5", "q6"]);
  });

  it("drops candidates that duplicate a kept question", () => {
    const { counters, qs } = setup();
    qs[0] = applyQuestionPatch(qs[0], { pinned: true });
    const merged = mergeCategoryQuestions(qs, "technical", [gen("How does the Node.js event loop schedule timers?")], counters, 1);
    expect(merged.added).toEqual([]);
  });

  it("applyQuestionPatch marks content edits as edited and bumps version; pin alone does not mark edited", () => {
    const { qs } = setup();
    const pinned = applyQuestionPatch(qs[0], { pinned: true });
    expect(pinned.meta.edited).toBe(false);
    expect(pinned.meta.pinned).toBe(true);
    expect(pinned.meta.version).toBe(2);
    const moved = applyQuestionPatch(qs[0], { category: "system_design" });
    expect(moved.meta.edited).toBe(true);
    const noop = applyQuestionPatch(qs[0], { prompt: qs[0].prompt });
    expect(noop.meta.version).toBe(1);
  });

  it("reschedule keeps locked days and rebuilds the rest", () => {
    const { qs } = setup();
    const schedule: WorkspaceSchedule = {
      days_available: 3,
      generatedAt: "",
      days: [
        { day: 1, focus: "Custom focus", question_ids: ["q2"], minutes: 99, kind: "learn", locked: true },
        { day: 2, focus: "x", question_ids: [], minutes: 15, kind: "learn", locked: false },
        { day: 3, focus: "y", question_ids: [], minutes: 15, kind: "learn", locked: false },
      ],
    };
    const { schedule: next } = reschedule(schedule, qs, reqs);
    expect(next.days).toHaveLength(3);
    expect(next.days[0]).toEqual(schedule.days[0]);
    expect(next.days.slice(1).flatMap((d) => d.question_ids)).not.toContain("q2");
  });

  it("reorder redistributes only the listed items' slots", () => {
    const { qs } = setup();
    const out = reorder(qs, ["q3", "q1"]);
    const order = (id: string) => out.find((q) => q.id === id)!.order;
    expect(order("q3")).toBeLessThan(order("q1"));
    expect(order("q2")).toBe(qs[1].order);
    expect(order("q4")).toBe(qs[3].order);
  });
});
