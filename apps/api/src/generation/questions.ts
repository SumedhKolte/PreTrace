import { z } from "zod";
import {
  CATEGORY_LABELS,
  type Difficulty,
  type CompanyTech,
  type HiringProcess,
  type QuestionCategory,
  type QuestionEvidence,
  type ResearchSignal,
  type WorkspaceRequirement,
} from "@preptrace/shared";
import type { Llm } from "../llm/client";
import { system, trusted, untrusted } from "../llm/prompt";
import { jaccard, sanitizeUntrusted } from "../lib/text";

export interface QuestionContext {
  companyName: string;
  companySummary: string;
  roleTitle: string;
  seniority: string;
  responsibilities: string[];
  requirements: WorkspaceRequirement[];
  signals: ResearchSignal[];
  hiring: HiringProcess;
  /** Verified company technologies (Company DNA). */
  techStack?: CompanyTech[];
}

export interface GeneratedQuestion {
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: Difficulty;
  evidence: QuestionEvidence;
  producer: "llm" | "gap_fill" | "fallback_template";
}

const QuestionItem = z.object({
  prompt: z.string().min(5),
  answer_outline: z.union([z.string(), z.array(z.string())]),
  difficulty: z.coerce.number().default(2),
  requirement_ids: z.array(z.string()).default([]),
  rationale: z.string().default(""),
  signal_ids: z.array(z.string()).default([]),
});
const QuestionsOut = z.object({ questions: z.array(QuestionItem).default([]) });

const SCHEMA = `{"questions": [{
  "prompt": string,                 // the interview question, as an interviewer would ask it
  "answer_outline": string,         // 3-6 lines, each starting with "- ", describing what a strong answer covers
  "difficulty": 1 | 2 | 3,          // 1 = fundamentals, 2 = applied, 3 = advanced / senior-level depth
  "requirement_ids": ["r1"],        // REQUIRED: IDs from the requirement list this question assesses
  "rationale": string,              // one sentence: why this question for this role
  "signal_ids": ["S1"]              // research signal IDs that informed the question (may be empty)
}]}`;

const CATEGORY_FOCUS: Record<QuestionCategory, string> = {
  technical: `Technical questions: implementation knowledge of the listed technologies, debugging and troubleshooting, trade-offs, testing, performance, and architecture at the code/component level. Probe real depth rather than trivia.`,
  behavioural: `Behavioural questions (STAR-style): leadership, mentoring, communication, ownership, collaboration, conflict, handling ambiguity and failure. Tie each to a requirement — behavioural requirements first, otherwise the experience a technical requirement implies (e.g. "Tell me about a time you debugged a production incident in Node.js").`,
  system_design: `System design questions: architecture, scale, reliability, data modelling, distributed systems, and trade-offs, grounded in the role's responsibilities and the company's product domain. Pitch the depth at the role's seniority.`,
  company_fit: `Company-fit questions: motivation for this company and role, how the candidate would handle situations specific to the company's product, customers and stated values, and preparation for the company's researched hiring process. Use research signals where available; if company research is thin, stay generic rather than inventing company facts.`,
};

const CATEGORY_KINDS: Record<QuestionCategory, WorkspaceRequirement["kind"][] | null> = {
  technical: ["technical", "domain"],
  behavioural: null,
  system_design: ["technical", "domain"],
  company_fit: null,
};

const SENIOR = new Set(["senior", "staff", "principal", "lead", "manager"]);
const SD_TEXT = /(system design|architect|scalab|distributed|high[- ]availability|microservice|large[- ]scale|throughput|latency|reliab|resilien|event[- ]driven|queue|kafka|design and (build|implement)|infrastructure|data pipeline)/i;

/** Deterministic decision: is a system-design section justified for this role? */
export function systemDesignJustification(ctx: Pick<QuestionContext, "seniority" | "requirements" | "responsibilities" | "hiring">): {
  justified: boolean;
  reason: string;
} {
  const reasons: string[] = [];
  if (SENIOR.has(ctx.seniority)) reasons.push(`${ctx.seniority} seniority`);
  const reqHits = ctx.requirements.filter((r) => SD_TEXT.test(r.text)).map((r) => r.id);
  if (reqHits.length) reasons.push(`requirements ${reqHits.join(", ")} mention architecture/scale`);
  if (ctx.responsibilities.some((r) => SD_TEXT.test(r))) reasons.push("responsibilities involve system design");
  if (ctx.hiring.stages.some((s) => /design|architect/i.test(`${s.name} ${s.description}`))) reasons.push("the hiring process includes a design stage");
  return reasons.length
    ? { justified: true, reason: `Generated because of ${reasons.join("; ")}.` }
    : { justified: false, reason: "Not generated: the JD, seniority and research give no evidence of a system-design round." };
}

export function targetCount(category: QuestionCategory, ctx: QuestionContext): number {
  const tech = ctx.requirements.filter((r) => r.kind !== "behavioural").length;
  const behav = ctx.requirements.filter((r) => r.kind === "behavioural").length;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  switch (category) {
    case "technical":
      return clamp(Math.round(tech * 1.3), 3, 10);
    case "behavioural":
      return clamp(behav + 2, 3, 6);
    case "system_design":
      return SENIOR.has(ctx.seniority) ? 3 : 2;
    case "company_fit":
      return ctx.hiring.found ? 4 : 3;
  }
}

function requirementBlock(reqs: WorkspaceRequirement[]): string {
  return reqs
    .map((r) => `${r.id} [${r.priority.toUpperCase()}, ${r.kind}] ${sanitizeUntrusted(r.text).text}`)
    .join("\n");
}

function signalBlock(signals: ResearchSignal[]): string {
  if (signals.length === 0) return "(no research signals available)";
  return signals
    .slice(0, 24)
    .map((s) => `${s.id} [${s.kind === "public" ? "public, unverified" : s.kind === "hiring" ? "official hiring" : "official company"}] ${s.text}`)
    .join("\n");
}

function difficultyGuide(seniority: string): string {
  if (SENIOR.has(seniority)) return "Seniority is high: most questions should be difficulty 2-3.";
  if (seniority === "junior" || seniority === "intern") return "Seniority is junior: most questions should be difficulty 1-2.";
  return "Use a spread of difficulties, mostly 2.";
}

function toOutline(v: string | string[]): string {
  const lines = (Array.isArray(v) ? v : v.split(/\n+/)).map((l) => l.trim()).filter(Boolean);
  return lines.map((l) => (l.startsWith("- ") ? l : `- ${l.replace(/^[-*•]\s*/, "")}`)).join("\n");
}

function clampDifficulty(n: number): Difficulty {
  const r = Math.round(Number.isFinite(n) ? n : 2);
  return (r <= 1 ? 1 : r >= 3 ? 3 : 2) as Difficulty;
}

/** Validate & normalise raw model questions: real requirement IDs, real signals, no duplicates. */
export function postProcessQuestions(
  raw: z.infer<typeof QuestionsOut>["questions"],
  category: QuestionCategory,
  ctx: QuestionContext,
  avoid: string[],
  producer: GeneratedQuestion["producer"],
  allowedReqIds?: Set<string>,
): GeneratedQuestion[] {
  const reqById = new Map(ctx.requirements.map((r) => [r.id, r]));
  const sigById = new Map(ctx.signals.map((s) => [s.id, s]));
  const out: GeneratedQuestion[] = [];
  const seen = [...avoid];
  for (const q of raw) {
    const prompt = sanitizeUntrusted(q.prompt).text.trim();
    if (prompt.length < 5) continue;
    const ids = [...new Set(q.requirement_ids.map((id) => id.trim()))].filter((id) => reqById.has(id) && (!allowedReqIds || allowedReqIds.has(id)));
    if (ids.length === 0) continue; // every question must reference ≥1 real requirement
    if (seen.some((s) => jaccard(s, prompt) >= 0.6)) continue;
    seen.push(prompt);
    const signals = q.signal_ids
      .map((id) => sigById.get(id.trim()))
      .filter((s): s is ResearchSignal => Boolean(s))
      .map((s) => ({ kind: s.kind, text: s.text, source_url: s.source_url }));
    const outline = toOutline(q.answer_outline);
    out.push({
      requirement_ids: ids,
      category,
      prompt,
      answer_outline: outline || "- Structure the answer around the linked requirement.",
      difficulty: clampDifficulty(q.difficulty),
      evidence: {
        rationale: sanitizeUntrusted(q.rationale).text.trim().slice(0, 400),
        jd_signal: reqById.get(ids[0])?.evidence,
        signals,
      },
      producer,
    });
  }
  return out;
}

function techBlock(ctx: QuestionContext): string {
  const techs = ctx.techStack ?? [];
  if (techs.length === 0) return "";
  const line = techs
    .slice(0, 16)
    .map((t) => `${t.name}${t.inJd ? " (also in JD)" : ""}`)
    .join(", ");
  // Names come from our own dictionary (never free text from pages), so this block is trusted.
  return trusted("company_technology", `Technologies the company's own website mentions: ${line}`);
}

function contextBlocks(ctx: QuestionContext) {
  return [
    trusted(
      "role",
      `Role: ${ctx.roleTitle}\nSeniority: ${ctx.seniority}\nCompany: ${ctx.companyName}\n${
        ctx.hiring.found ? `Official interview stages: ${ctx.hiring.stages.map((s) => s.name).join(" → ")}` : "Official interview process: not found"
      }`.replace(/[<>]/g, ""),
    ),
    untrusted("company_summary", ctx.companySummary || "(no company summary)", 1500),
    untrusted("responsibilities", ctx.responsibilities.map((r) => `- ${r}`).join("\n") || "(none listed)", 2500),
    techBlock(ctx),
  ].filter(Boolean);
}

export async function generateCategoryQuestions(
  llm: Llm,
  category: QuestionCategory,
  ctx: QuestionContext,
  opts: { count?: number; avoid?: string[]; keep?: string[] } = {},
): Promise<GeneratedQuestion[]> {
  const count = opts.count ?? targetCount(category, ctx);
  const kinds = CATEGORY_KINDS[category];
  let reqs = kinds ? ctx.requirements.filter((r) => kinds.includes(r.kind)) : ctx.requirements;
  if (reqs.length === 0) reqs = ctx.requirements;
  const avoid = [...(opts.avoid ?? []), ...(opts.keep ?? [])];

  const out = await llm.json({
    task: `questions_${category}`,
    system: system(
      "You are a senior interviewer designing a focused interview question set.",
      `Generate ${count} ${CATEGORY_LABELS[category]} interview questions for this candidate.
${CATEGORY_FOCUS[category]}
- Every question MUST list the requirement_ids it assesses, chosen only from the provided requirement list. Prioritise MUST requirements so each one is covered.
- Only reference research signals by their IDs; never invent company facts, products or interview rounds.
- Company DNA: when a "company_technology" list is provided and relevant to this category, set scenarios in that verified stack (e.g. "design idempotent payouts on PostgreSQL and Kafka"). Never mention a company technology that is not in the list.
- Do not repeat or closely paraphrase any question in the "existing_questions" list.
- ${difficultyGuide(ctx.seniority)}`,
      SCHEMA,
    ),
    user: [
      ...contextBlocks(ctx),
      trusted("requirements", requirementBlock(reqs)),
      untrusted("research_signals", signalBlock(ctx.signals), 6000),
      avoid.length ? untrusted("existing_questions", avoid.map((a) => `- ${a}`).join("\n"), 4000) : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: QuestionsOut,
    maxTokens: 6000,
    temperature: 0.5,
  });
  return postProcessQuestions(out.questions, category, ctx, avoid, "llm").slice(0, count + 2);
}

export function categoryForRequirement(r: WorkspaceRequirement): QuestionCategory {
  return r.kind === "behavioural" ? "behavioural" : "technical";
}

/**
 * Coverage gap pass: targeted questions for specific uncovered requirements.
 * `forceCategory` keeps scoped regenerations inside the category being regenerated.
 */
export async function generateGapQuestions(
  llm: Llm,
  uncovered: WorkspaceRequirement[],
  ctx: QuestionContext,
  opts: { avoid?: string[]; forceCategory?: QuestionCategory } = {},
): Promise<GeneratedQuestion[]> {
  const plan = uncovered.map((r) => `${r.id} → category ${opts.forceCategory ?? categoryForRequirement(r)}`).join("\n");
  const GapOut = z.object({
    questions: z.array(QuestionItem.extend({ category: z.string().optional() })).default([]),
  });
  const out = await llm.json({
    task: "questions_gap_fill",
    system: system(
      "You are a senior interviewer filling coverage gaps in an interview question set.",
      `The coverage check found requirements with no interview question. Write 1-2 targeted questions for EACH listed requirement.
- Each question's requirement_ids must include the uncovered requirement it targets (from the provided list only).
- Use the category assigned in the plan.
- Do not duplicate the existing questions.
- ${difficultyGuide(ctx.seniority)}`,
      SCHEMA.replace(`"prompt": string,`, `"category": "technical" | "behavioural" | "system_design" | "company_fit",\n  "prompt": string,`),
    ),
    user: [
      ...contextBlocks(ctx),
      trusted("uncovered_requirements", requirementBlock(uncovered)),
      trusted("category_plan", plan),
      untrusted("research_signals", signalBlock(ctx.signals), 4000),
      opts.avoid?.length ? untrusted("existing_questions", opts.avoid.map((a) => `- ${a}`).join("\n"), 4000) : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: GapOut,
    maxTokens: 4000,
    temperature: 0.4,
  });
  const allowed = new Set(uncovered.map((r) => r.id));
  const results: GeneratedQuestion[] = [];
  for (const r of uncovered) {
    // Assign category deterministically from the plan (not from the model).
    const cat = opts.forceCategory ?? categoryForRequirement(r);
    const mine = out.questions.filter((q) => q.requirement_ids.includes(r.id) && !results.some((x) => x.prompt === q.prompt));
    results.push(...postProcessQuestions(mine, cat, ctx, [...(opts.avoid ?? []), ...results.map((x) => x.prompt)], "gap_fill", allowed));
  }
  return results;
}

/**
 * Last-resort deterministic question when the model repeatedly fails to cover a
 * must-have requirement. It is built only from the requirement's own text (no
 * invented facts) and is labelled as a template in its evidence.
 */
export function fallbackQuestion(r: WorkspaceRequirement, category?: QuestionCategory): GeneratedQuestion {
  const behavioural = r.kind === "behavioural";
  return {
    requirement_ids: [r.id],
    category: category ?? categoryForRequirement(r),
    prompt: behavioural
      ? `Tell me about a specific time you demonstrated this: "${r.text}". What was the situation, what did you do, and what was the outcome?`
      : `Walk me through your hands-on experience with ${r.topic}. How have you applied it in a real project, and what trade-offs did you make?`,
    answer_outline: behavioural
      ? "- Situation: concrete context and stakes\n- Task: your specific responsibility\n- Action: what you did and why\n- Result: measurable outcome and what you learned"
      : `- Concrete project where you used ${r.topic}\n- Your role and key technical decisions\n- Trade-offs and alternatives considered\n- Problems encountered and how you debugged them\n- What you would do differently now`,
    difficulty: 2,
    evidence: {
      rationale: "Template question added by the deterministic coverage check because AI generation did not cover this must-have requirement.",
      jd_signal: r.evidence,
      signals: [],
    },
    producer: "fallback_template",
  };
}
