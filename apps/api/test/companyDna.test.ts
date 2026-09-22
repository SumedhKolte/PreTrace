import { describe, expect, it } from "vitest";
import { detectTechStack, markJdOverlap } from "../src/research/techStack";
import { critiqueAnswer, outlinePoints, verdictFor } from "../src/practice/critique";
import { LlmClient } from "../src/llm/client";
import { ScriptedLlm } from "./support/scriptedLlm";

const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe("Company DNA: deterministic technology detection", () => {
  it("finds technologies the company's own pages mention, with sources", () => {
    const techs = detectTechStack([
      { url: "https://acme.test/engineering", text: "Our backend is TypeScript on Node.js, with PostgreSQL as the system of record and Kafka for event streaming. We run on Kubernetes." },
      { url: "https://acme.test/blog", text: "Why we moved payouts to Kafka. Idempotent APIs on PostgreSQL." },
    ]);
    expect(names(techs)).toEqual(expect.arrayContaining(["TypeScript", "Node.js", "PostgreSQL", "Kafka", "Kubernetes", "Idempotency"]));
    const kafka = techs.find((t) => t.name === "Kafka")!;
    expect(kafka.mentions).toBe(2);
    expect(kafka.sources).toEqual(["https://acme.test/engineering", "https://acme.test/blog"]);
    expect(techs[0].mentions).toBeGreaterThanOrEqual(techs.at(-1)!.mentions);
  });

  it("does not match ordinary English words or substrings", () => {
    const techs = detectTechStack([
      { url: "u", text: "Let's go to the store. Guard rails keep us safe. A spark of joy. Rusty gates. JavaScript developers. Postgres-free zone? A swift reply." },
    ]);
    const n = names(techs);
    expect(n).not.toContain("Go");
    expect(n).not.toContain("Ruby on Rails");
    expect(n).not.toContain("Apache Spark");
    expect(n).not.toContain("Rust");
    expect(n).not.toContain("Java"); // only JavaScript
    expect(n).not.toContain("Swift");
    expect(n).toContain("JavaScript");
  });

  it("recognises context-dependent names when used technically", () => {
    const n = names(detectTechStack([{ url: "u", text: "Services written in Go and Rust. Our Rails monolith. Apache Spark jobs nightly." }]));
    expect(n).toEqual(expect.arrayContaining(["Go", "Rust", "Ruby on Rails", "Apache Spark"]));
  });

  it("marks overlap with the job description and ranks it first", () => {
    const techs = detectTechStack([{ url: "u", text: "We use Redis, Redis, Redis and PostgreSQL." }]);
    const marked = markJdOverlap(techs, "Deep knowledge of PostgreSQL required");
    expect(marked[0]).toMatchObject({ name: "PostgreSQL", inJd: true });
    expect(marked.find((t) => t.name === "Redis")!.inJd).toBe(false);
  });
});

describe("answer critique", () => {
  it("splits an answer outline into rubric points", () => {
    expect(outlinePoints("- Context\n- Approach and trade-offs\n\n* Result\n1. Lessons")).toEqual(["Context", "Approach and trade-offs", "Result", "Lessons"]);
  });

  it("derives the verdict deterministically from covered rubric points", () => {
    expect(verdictFor(4, 5)).toBe("strong");
    expect(verdictFor(3, 5)).toBe("solid");
    expect(verdictFor(2, 6)).toBe("developing");
    expect(verdictFor(0, 4)).toBe("needs_work");
  });

  it("drops invalid rubric indices and injected instructions in model output", async () => {
    const client = new LlmClient(new ScriptedLlm(), { concurrency: 1, maxRpm: 0, retries: 0, maxTokens: 500, temperature: 0 });
    const c = await critiqueAnswer(client.scope(), {
      question: "How would you make payouts idempotent?",
      outline: "- Idempotency keys\n- Unique constraint\n- Return original response\n- Retries",
      answer: "I would store an idempotency key per request in PostgreSQL with a unique constraint.",
      requirements: [],
      seniority: "senior",
      companyName: "Acme",
      techStack: [],
      hiring: { found: false, summary: "", stages: [], expectations: [] },
    });
    expect(c.coveredPoints).toEqual([0, 1]); // 99 is out of range
    expect(c.verdict).toBe("solid");
    expect(c.gaps).toEqual(["No failure modes discussed"]);
    expect(c.followUp).toMatch(/times out/);
  });
});

describe("JD ↔ company technology links", () => {
  it("connects a JD requirement to related verified company technology", async () => {
    const { techLinks } = await import("../src/research/techStack");
    const techs = detectTechStack([{ url: "u", text: "We scale MySQL horizontally with Vitess. Mobile apps in Kotlin." }]);
    const links = techLinks([{ id: "r3", text: "Experience with MySQL at scale" }, { id: "r5", text: "Mentoring" }], techs);
    expect(links).toEqual([{ requirementId: "r3", jdTech: "MySQL", companyTech: "Vitess" }]);
  });
});
