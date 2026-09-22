import { describe, expect, it } from "vitest";
import { detectPriority, inferSeniority, jdLines, postProcessJd } from "../src/generation/jdAnalysis";

const JD = `Senior Backend Engineer — Acme Payments
Location: Remote (Europe)

Requirements
- 5+ years of backend development experience
- Strong experience with Node.js and TypeScript
- Deep knowledge of PostgreSQL
- Experience mentoring other engineers

Nice to have:
- Experience with Kafka
- Familiarity with Kubernetes is a plus`;

const req = (text: string, priority = "must", quote = text, kind = "technical") => ({ text, topic: null, kind, priority, evidence_quote: quote });

describe("JD analysis post-processing (grounding)", () => {
  it("drops requirements that are not supported by the JD", () => {
    const out = postProcessJd(JD, {
      company: "Acme Payments",
      role_title: "Senior Backend Engineer",
      seniority: "senior",
      location: "Remote (Europe)",
      responsibilities: [],
      requirements: [req("Deep knowledge of PostgreSQL"), req("Expert-level Rust and WebAssembly")],
    });
    expect(out.requirements.map((r) => r.text)).toEqual(["Deep knowledge of PostgreSQL"]);
    expect(out.dropped).toEqual(["Expert-level Rust and WebAssembly"]);
  });

  it("assigns sequential stable ids r1..rN", () => {
    const out = postProcessJd(JD, {
      responsibilities: [],
      requirements: [req("Strong experience with Node.js and TypeScript"), req("Deep knowledge of PostgreSQL"), req("Experience with Kafka", "nice")],
    });
    expect(out.requirements.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("corrects must/nice from JD structure, overriding the model", () => {
    const out = postProcessJd(JD, {
      responsibilities: [],
      requirements: [
        req("Experience with Kafka", "must"), // model says must, JD section says nice
        req("Deep knowledge of PostgreSQL", "nice"), // model says nice, JD section says must
        req("Familiarity with Kubernetes", "must", "Familiarity with Kubernetes is a plus"),
      ],
    });
    const byText = Object.fromEntries(out.requirements.map((r) => [r.topic || r.text, r.priority]));
    expect(out.requirements.find((r) => r.text.includes("Kafka"))!.priority).toBe("nice");
    expect(out.requirements.find((r) => r.text.includes("PostgreSQL"))!.priority).toBe("must");
    expect(out.requirements.find((r) => r.text.includes("Kubernetes"))!.priority).toBe("nice");
    expect(Object.keys(byText).length).toBe(3);
  });

  it("deduplicates near-identical requirements, keeping must priority", () => {
    const out = postProcessJd(JD, {
      responsibilities: [],
      requirements: [req("Deep knowledge of PostgreSQL", "nice"), req("Deep knowledge of PostgreSQL databases", "must", "Deep knowledge of PostgreSQL")],
    });
    expect(out.requirements).toHaveLength(1);
    expect(out.requirements[0].priority).toBe("must");
  });

  it("only keeps a company name / location that appears in the JD", () => {
    const out = postProcessJd(JD, { company: "Globex", location: "Tokyo", responsibilities: [], requirements: [req("Deep knowledge of PostgreSQL")] });
    expect(out.company).toBeNull();
    expect(out.location).toBe("Not specified");
  });

  it("thin JD: produces a thin set and never invents skills", () => {
    const thin = "Software Engineer at Initech.\nWe need someone who knows Python.";
    const out = postProcessJd(thin, { role_title: "Software Engineer", responsibilities: [], requirements: [req("Knowledge of Python", "must", "knows Python")] });
    expect(out.requirements).toHaveLength(1);
    expect(out.thin).toBe(true);
  });

  it("JD with no extractable requirements anchors on the stated role only", () => {
    const out = postProcessJd("We are hiring a Product Designer to join our team soon.", { role_title: "Product Designer", responsibilities: [], requirements: [] });
    expect(out.requirements).toHaveLength(1);
    expect(out.requirements[0].id).toBe("r1");
    expect(out.requirements[0].text).toMatch(/no explicit requirements/);
  });

  it("drops invented responsibilities", () => {
    const out = postProcessJd(JD, { responsibilities: ["Lead the company's IPO process"], requirements: [req("Deep knowledge of PostgreSQL")] });
    expect(out.responsibilities).toEqual([]);
  });
});

describe("priority + seniority heuristics", () => {
  it("section headers without colons are recognised only from a known vocabulary", () => {
    const lines = jdLines("Requirements\n- A\nExperience with Kafka preferred\n- B\nNice to have\n- C");
    expect(lines.find((l) => l.text === "- B")!.section).toBe("must");
    expect(lines.find((l) => l.text === "- C")!.section).toBe("nice");
  });

  it("inline markers win over sections", () => {
    const lines = jdLines("Requirements:\n- Go (required)\n- Rust is a plus");
    expect(detectPriority("Rust is a plus", lines, "must")).toBe("nice");
    expect(detectPriority("Go (required)", lines, "nice")).toBe("must");
  });

  it("infers seniority from the title or years of experience", () => {
    expect(inferSeniority("Staff Engineer", "")).toBe("staff");
    expect(inferSeniority("Backend Engineer", "3+ years experience")).toBe("mid");
    expect(inferSeniority("Engineer", "")).toBe("unspecified");
  });
});
