import { describe, expect, it } from "vitest";
import { BatchOutputSchema, type CanonicalKit } from "@preptrace/shared";
import { validateCanonicalKit } from "../src/validation/kitValidator";

export function sampleKit(): CanonicalKit {
  return {
    source: {
      company: "Acme",
      company_url: "http://localhost:8099/acme/",
      role: "Senior Backend Engineer",
      location: "Remote",
      jd_chars: 1200,
      researched_at: "2026-09-22T10:00:00.000Z",
      pages_used: ["http://localhost:8099/acme/"],
    },
    company_brief: { summary: "Acme builds payments.", what_they_do: "Payments APIs.", sources: ["http://localhost:8099/acme/"] },
    role: {
      title: "Senior Backend Engineer",
      seniority: "senior",
      responsibilities: ["Build services"],
      requirements: [
        { id: "r1", text: "Node.js", kind: "technical", priority: "must" },
        { id: "r2", text: "Mentoring", kind: "behavioural", priority: "must" },
        { id: "r3", text: "Kafka", kind: "technical", priority: "nice" },
      ],
    },
    questions: [
      { id: "q1", requirement_ids: ["r1"], category: "technical", prompt: "Explain the event loop.", answer_outline: "- phases", difficulty: 2 },
      { id: "q2", requirement_ids: ["r2"], category: "behavioural", prompt: "Mentoring story?", answer_outline: "- STAR", difficulty: 1 },
    ],
    flashcards: [{ id: "f1", front: "Event loop?", back: "Phases...", requirement_ids: ["r1"] }],
    schedule: {
      days_available: 2,
      days: [
        { day: 1, focus: "Technical", question_ids: ["q1"], minutes: 30 },
        { day: 2, focus: "Behavioural", question_ids: ["q2"], minutes: 20 },
      ],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("kit structure validation", () => {
  it("accepts a valid kit", () => {
    const v = validateCanonicalKit(sampleKit(), 2);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("rejects a missing required field", () => {
    const k = sampleKit() as unknown as Record<string, unknown>;
    delete k.coverage;
    const v = validateCanonicalKit(k);
    expect(v.ok).toBe(false);
    expect(v.errors.join()).toMatch(/coverage/);
  });

  it("rejects difficulty outside 1..3", () => {
    const k = sampleKit();
    (k.questions[0] as { difficulty: number }).difficulty = 4;
    expect(validateCanonicalKit(k).ok).toBe(false);
  });

  it("rejects bad enums", () => {
    const k = sampleKit();
    (k.role.requirements[0] as { kind: string }).kind = "soft";
    expect(validateCanonicalKit(k).ok).toBe(false);
  });

  it("rejects non-integer minutes", () => {
    const k = sampleKit();
    k.schedule.days[0].minutes = 30.5;
    expect(validateCanonicalKit(k).ok).toBe(false);
  });

  it("rejects schedule referencing a non-existent question", () => {
    const k = sampleKit();
    k.schedule.days[1].question_ids.push("q99");
    const v = validateCanonicalKit(k);
    expect(v.errors.join()).toMatch(/unknown questions q99/);
  });

  it("rejects wrong number of days vs requested", () => {
    expect(validateCanonicalKit(sampleKit(), 3).errors.join()).toMatch(/expected 3/);
    const k = sampleKit();
    k.schedule.days.pop();
    expect(validateCanonicalKit(k).errors.join()).toMatch(/schedule has 1 days/);
  });

  it("rejects mis-numbered days", () => {
    const k = sampleKit();
    k.schedule.days[1].day = 3;
    expect(validateCanonicalKit(k).ok).toBe(false);
  });

  it("rejects questions referencing unknown requirements", () => {
    const k = sampleKit();
    k.questions[0].requirement_ids = ["r42"];
    expect(validateCanonicalKit(k).errors.join()).toMatch(/unknown requirements r42/);
  });

  it("rejects duplicate ids", () => {
    const k = sampleKit();
    k.questions[1].id = "q1";
    expect(validateCanonicalKit(k).errors.join()).toMatch(/duplicate question ids/);
  });

  it("rejects coverage that does not match the questions", () => {
    const k = sampleKit();
    k.questions = k.questions.filter((q) => q.id !== "q2");
    k.schedule.days[1].question_ids = [];
    const v = validateCanonicalKit(k);
    expect(v.errors.join()).toMatch(/does not match computed \[r2\]/);
  });

  it("rejects a must requirement missing from the schedule", () => {
    const k = sampleKit();
    k.schedule.days[1].question_ids = [];
    expect(validateCanonicalKit(k).errors.join()).toMatch(/missing from schedule: r2/);
  });

  it("Appendix B output schema accepts ok and failed entries", () => {
    const out = {
      version: "1.0",
      generated_at: new Date().toISOString(),
      kits: [
        { id: "case-01", status: "ok", kit: sampleKit(), error: null },
        { id: "case-04", status: "failed", kit: null, error: { code: "COMPANY_UNREACHABLE", message: "Company site unreachable after 3 retries." } },
      ],
    };
    expect(BatchOutputSchema.safeParse(out).success).toBe(true);
    expect(BatchOutputSchema.safeParse({ ...out, kits: [{ id: "x", status: "ok", kit: null, error: null }] }).success).toBe(false);
  });
});
