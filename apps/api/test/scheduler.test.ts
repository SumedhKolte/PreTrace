import { describe, expect, it } from "vitest";
import type { WorkspaceScheduleDay } from "@preptrace/shared";
import { balancedPartition, buildSchedule, planDays, scoreQuestions, type SchedQuestion, type SchedRequirement } from "../src/schedule/scheduler";

const reqs: SchedRequirement[] = [
  { id: "r1", priority: "must", topic: "Node.js" },
  { id: "r2", priority: "must", topic: "PostgreSQL" },
  { id: "r3", priority: "must", topic: "System design" },
  { id: "r4", priority: "must", topic: "Mentoring" },
  { id: "r5", priority: "nice", topic: "Kafka" },
];

function makeQuestions(n: number): SchedQuestion[] {
  const cats = ["technical", "system_design", "behavioural", "company_fit"] as const;
  return Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    requirement_ids: [reqs[i % reqs.length].id],
    category: cats[i % cats.length],
    difficulty: ((i % 3) + 1) as 1 | 2 | 3,
  }));
}

function mustRequirementsInSchedule(days: WorkspaceScheduleDay[], qs: SchedQuestion[]) {
  const byId = new Map(qs.map((q) => [q.id, q]));
  return new Set(days.flatMap((d) => d.question_ids).flatMap((id) => byId.get(id)?.requirement_ids ?? []));
}

function assertValid(days: WorkspaceScheduleDay[], n: number, qs: SchedQuestion[]) {
  expect(days).toHaveLength(n);
  days.forEach((d, i) => {
    expect(d.day).toBe(i + 1);
    expect(Number.isInteger(d.minutes)).toBe(true);
    expect(d.minutes).toBeGreaterThan(0);
    expect(d.focus.length).toBeGreaterThan(0);
    expect(Array.isArray(d.question_ids)).toBe(true);
  });
  const ids = new Set(qs.map((q) => q.id));
  for (const d of days) for (const id of d.question_ids) expect(ids.has(id)).toBe(true);
  const covered = mustRequirementsInSchedule(days, qs);
  const coverable = new Set(qs.flatMap((q) => q.requirement_ids));
  for (const r of reqs.filter((r) => r.priority === "must" && coverable.has(r.id))) expect(covered.has(r.id)).toBe(true);
}

describe("deterministic scheduler", () => {
  it("produces exactly 1 day containing every question", () => {
    const qs = makeQuestions(12);
    const { days } = buildSchedule({ days: 1, questions: qs, requirements: reqs });
    assertValid(days, 1, qs);
    expect(days[0].question_ids).toHaveLength(12);
  });

  it("produces exactly 2 learning days with no dedicated mock day", () => {
    const qs = makeQuestions(9);
    const { days } = buildSchedule({ days: 2, questions: qs, requirements: reqs });
    assertValid(days, 2, qs);
    expect(days.every((d) => d.kind === "learn")).toBe(true);
    expect(days.flatMap((d) => d.question_ids).sort()).toEqual(qs.map((q) => q.id).sort());
  });

  it("5 days with more questions than days: all learned before the final mock day", () => {
    const qs = makeQuestions(17);
    const { days } = buildSchedule({ days: 5, questions: qs, requirements: reqs });
    assertValid(days, 5, qs);
    expect(days[4].kind).toBe("mock");
    const learned = new Set(days.slice(0, 4).flatMap((d) => d.question_ids));
    expect(learned.size).toBe(17);
    // Mock day covers every must requirement.
    const mockReqs = mustRequirementsInSchedule([days[4]], qs);
    for (const r of ["r1", "r2", "r3", "r4"]) expect(mockReqs.has(r)).toBe(true);
  });

  it("60 days with fewer questions than days: every day has work, spaced review fills the gap", () => {
    const qs = makeQuestions(8);
    const { days } = buildSchedule({ days: 60, questions: qs, requirements: reqs });
    assertValid(days, 60, qs);
    expect(days.every((d) => d.question_ids.length > 0)).toBe(true);
    expect(days.filter((d) => d.kind === "learn")).toHaveLength(4); // ceil(8/2)
    expect(days.filter((d) => d.kind === "review")).toHaveLength(55);
    expect(days[59].kind).toBe("mock");
  });

  it("puts harder / must-have material earlier", () => {
    const qs = makeQuestions(20);
    const { days } = buildSchedule({ days: 6, questions: qs, requirements: reqs });
    const scored = new Map(scoreQuestions(qs, reqs).map((q) => [q.id, q.score]));
    const learn = days.filter((d) => d.kind === "learn");
    const avg = (d: WorkspaceScheduleDay) => d.question_ids.reduce((s, id) => s + scored.get(id)!, 0) / d.question_ids.length;
    for (let i = 1; i < learn.length; i++) expect(avg(learn[i - 1])).toBeGreaterThanOrEqual(avg(learn[i]));
    const hardest = scoreQuestions(qs, reqs)[0].id;
    expect(days[0].question_ids).toContain(hardest);
  });

  it("does not leave must-have topics until the final day", () => {
    const qs = makeQuestions(10);
    const { days } = buildSchedule({ days: 4, questions: qs, requirements: reqs });
    const beforeLast = mustRequirementsInSchedule(days.slice(0, -1), qs);
    for (const r of ["r1", "r2", "r3", "r4"]) expect(beforeLast.has(r)).toBe(true);
  });

  it("is deterministic", () => {
    const qs = makeQuestions(14);
    const a = buildSchedule({ days: 7, questions: qs, requirements: reqs });
    const b = buildSchedule({ days: 7, questions: [...qs], requirements: [...reqs] });
    expect(a).toEqual(b);
  });

  it("handles a single question over many days", () => {
    const qs = makeQuestions(1);
    const { days } = buildSchedule({ days: 3, questions: qs, requirements: reqs });
    assertValid(days, 3, qs);
    expect(days.every((d) => d.question_ids.includes("q1"))).toBe(true);
  });

  it("handles zero questions without crashing", () => {
    const days = planDays(3, [], reqs);
    expect(days).toHaveLength(3);
    expect(days.every((d) => Number.isInteger(d.minutes))).toBe(true);
  });

  it("keeps locked (user-edited) days verbatim and plans around them", () => {
    const qs = makeQuestions(12);
    const locked: WorkspaceScheduleDay = { day: 2, focus: "My custom day", question_ids: ["q3", "q7"], minutes: 42, kind: "learn", locked: true };
    const { days } = buildSchedule({ days: 5, questions: qs, requirements: reqs, locked: [locked] });
    assertValid(days, 5, qs);
    expect(days[1]).toEqual(locked);
    const elsewhere = days.filter((d) => d.day !== 2 && d.kind === "learn").flatMap((d) => d.question_ids);
    expect(elsewhere).not.toContain("q3");
    expect(elsewhere).not.toContain("q7");
  });

  it("prunes deleted questions from locked days", () => {
    const qs = makeQuestions(6).filter((q) => q.id !== "q2");
    const locked: WorkspaceScheduleDay = { day: 1, focus: "Mine", question_ids: ["q1", "q2"], minutes: 30, kind: "learn", locked: true };
    const { days } = buildSchedule({ days: 3, questions: qs, requirements: reqs, locked: [locked] });
    expect(days[0].question_ids).toEqual(["q1"]);
  });

  it("balancedPartition returns exactly k non-empty chunks in order", () => {
    const items = Array.from({ length: 11 }, (_, i) => i);
    const chunks = balancedPartition(items, 4, () => 1);
    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.length > 0)).toBe(true);
    expect(chunks.flat()).toEqual(items);
  });
});
