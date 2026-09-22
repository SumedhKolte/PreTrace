import {
  CATEGORY_LABELS,
  parseCompanyUrl,
  type CanonicalKit,
  type KitWorkspace,
  type PipelineStageKey,
  type QuestionCategory,
  type StageStatus,
  type WorkspaceQuestion,
} from "@preptrace/shared";
import { runCoverageLoop } from "../coverage/coverage";
import { generateCompanyBrief } from "../generation/companyBrief";
import { fallbackFlashcards, generateFlashcards, type GeneratedFlashcard } from "../generation/flashcards";
import { analyzeJobDescription } from "../generation/jdAnalysis";
import {
  fallbackQuestion,
  generateCategoryQuestions,
  generateGapQuestions,
  systemDesignJustification,
  type GeneratedQuestion,
  type QuestionContext,
} from "../generation/questions";
import { toCanonicalKit } from "../kits/canonical";
import { materializeFlashcards, materializeQuestions, type Counters } from "../kits/state";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { LlmClient } from "../llm/client";
import type { ResearchBundle, ResearchService } from "../research/researchService";
import { buildSchedule } from "../schedule/scheduler";
import { markJdOverlap } from "../research/techStack";
import { validateCanonicalKit } from "../validation/kitValidator";

export interface PipelineInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export type ProgressReporter = (stage: PipelineStageKey | string, status: StageStatus, detail?: string) => void;

export type KitParts = Omit<KitWorkspace, "id" | "status" | "input" | "rev" | "createdAt" | "updatedAt" | "lastPracticedAt" | "briefRevisions" | "error">;

export interface PipelineOutput {
  parts: KitParts;
  counters: Counters;
  canonical: CanonicalKit;
  research: ResearchBundle;
  warnings: string[];
  partial: boolean;
}

export const MAX_PIPELINE_DAYS = 365;

/**
 * The deliberate multi-stage pipeline. Each stage is a separate, validated step:
 *
 *   JD analysis (LLM + deterministic grounding)
 *   → company discovery / page extraction / hiring process / public research
 *   → company brief (LLM, grounded facts only)
 *   → per-category question generation (4 separate LLM calls)
 *   → deterministic coverage check → targeted gap generation → re-check
 *   → flashcards (LLM + deterministic backstop)
 *   → deterministic schedule → schema + semantic validation
 *
 * Used identically by the web job runner and the batch evaluator.
 */
export class InterviewPrepService {
  constructor(
    private readonly deps: {
      llm: LlmClient;
      research: ResearchService;
    },
  ) {}

  validateInput(input: PipelineInput): PipelineInput {
    const jd = (input.jd ?? "").trim();
    if (jd.length < 20) throw new AppError("INVALID_INPUT", "The job description is too short to analyse (minimum 20 characters).");
    const days = Number(input.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_PIPELINE_DAYS) {
      throw new AppError("INVALID_INPUT", `days must be an integer between 1 and ${MAX_PIPELINE_DAYS}.`);
    }
    const url = parseCompanyUrl(input.companyUrl ?? "");
    if (!url.ok) throw new AppError("INVALID_URL", `Invalid company URL: ${url.message}.`);
    return { jd, companyUrl: url.url, days };
  }

  async generate(rawInput: PipelineInput, report: ProgressReporter = () => {}): Promise<PipelineOutput> {
    const started = Date.now();
    const input = this.validateInput(rawInput);
    if (!this.deps.llm.available) {
      throw new AppError("LLM_NOT_CONFIGURED", "No LLM provider is configured. Set LLM_API_KEY (see .env.example).");
    }
    const llm = this.deps.llm.scope();
    const warnings: string[] = [];
    const counters: Counters = { question: 0, flashcard: 0 };

    // ---- Stage 1: JD analysis ---------------------------------------------------
    report("read_jd", "done", `${input.jd.length.toLocaleString()} characters, ${input.jd.split(/\n+/).filter(Boolean).length} lines`);
    report("extract_requirements", "running", "Identifying requirements supported by the job description");
    const jd = await analyzeJobDescription(llm, input.jd);
    const mustCount = jd.requirements.filter((r) => r.priority === "must").length;
    if (jd.dropped.length) warnings.push(`Dropped ${jd.dropped.length} requirement(s) not supported by the JD text.`);
    if (jd.thin) warnings.push("The job description is thin; the kit is intentionally small.");
    report(
      "extract_requirements",
      "done",
      `Identified ${mustCount} must-have and ${jd.requirements.length - mustCount} nice-to-have requirements${jd.thin ? " (thin JD)" : ""}`,
    );

    // ---- Stages 2–5: research ----------------------------------------------------
    const research = await this.deps.research.research(input.companyUrl, jd.company, (stage, status, detail) => report(stage, status, detail), { llm });
    const companyName = jd.company ?? research.companyName;
    const techStack = markJdOverlap(research.techStack ?? [], input.jd);

    // ---- Stage 6: company brief --------------------------------------------------
    report("company_brief", "running", `Summarising verified facts about ${companyName}`);
    let companyBrief;
    try {
      companyBrief = await generateCompanyBrief(llm, { ...research, companyName }, jd.title);
    } catch (e) {
      if (e instanceof AppError && e.code === "LLM_NOT_CONFIGURED") throw e;
      warnings.push("Company brief generation failed; a limited brief was used.");
      companyBrief = await generateCompanyBrief(llm, { ...research, companyName, signals: [] }, jd.title);
    }
    report("company_brief", "done", companyBrief.sources.length ? `Brief grounded in ${companyBrief.sources.length} source(s)` : "Limited public information was available");

    // ---- Stage 7: category-specific question generation -------------------------
    const ctx: QuestionContext = {
      companyName,
      companySummary: companyBrief.summary,
      roleTitle: jd.title,
      seniority: jd.seniority,
      responsibilities: jd.responsibilities,
      requirements: jd.requirements,
      signals: research.signals,
      hiring: research.hiring,
      techStack,
    };
    const sd = systemDesignJustification(ctx);
    const categories: QuestionCategory[] = ["technical", "behavioural", ...(sd.justified ? (["system_design"] as const) : []), "company_fit"];
    report("generate_questions", "running", `Generating ${categories.map((c) => CATEGORY_LABELS[c]).join(", ")} questions separately`);
    const perCategory = await Promise.all(
      categories.map(async (c) => {
        try {
          const qs = await generateCategoryQuestions(llm, c, ctx);
          report("generate_questions", "running", `${CATEGORY_LABELS[c]}: ${qs.length} questions`);
          return qs;
        } catch (e) {
          if (e instanceof AppError && e.code === "LLM_NOT_CONFIGURED") throw e;
          logger.warn("category generation failed", { category: c, err: String(e) });
          warnings.push(`${CATEGORY_LABELS[c]} question generation failed (${(e as AppError).code ?? "error"}).`);
          return [] as GeneratedQuestion[];
        }
      }),
    );
    let generated: GeneratedQuestion[] = perCategory.flat();
    if (generated.length === 0 && perCategory.every((p) => p.length === 0) && warnings.some((w) => w.includes("generation failed"))) {
      throw new AppError("GENERATION_FAILED", "Question generation failed for every category.");
    }
    report("generate_questions", "done", `Generated ${generated.length} questions across ${categories.length} categories`);

    // ---- Coverage: deterministic check → gap generation → re-check ---------------
    report("check_coverage", "running", "Checking every must-have requirement has a question");
    let gapRounds = 0;
    const loop = await runCoverageLoop<GeneratedQuestion>({
      requirements: jd.requirements,
      questions: generated,
      generateGaps: async (uncovered) => {
        gapRounds++;
        report("fill_gaps", "running", `Generating targeted questions for ${uncovered.map((r) => r.topic).join(", ")}…`);
        return generateGapQuestions(llm, uncovered, ctx, { avoid: generated.map((q) => q.prompt) });
      },
      fallback: (r) => fallbackQuestion(r),
      onCheck: (pass, uncovered) =>
        report(
          "check_coverage",
          "running",
          uncovered.length ? `Coverage check ${pass} found ${uncovered.length} gap${uncovered.length > 1 ? "s" : ""} (${uncovered.join(", ")})` : `Coverage check ${pass}: all must-haves covered`,
        ),
    });
    generated = [...generated, ...loop.added];
    if (loop.usedFallback.length) warnings.push(`Template questions were used for ${loop.usedFallback.join(", ")} after ${gapRounds} gap pass(es).`);
    report("fill_gaps", gapRounds || loop.usedFallback.length ? "done" : "skipped", gapRounds ? `Added ${loop.added.length} targeted question(s)` : "No gaps to fill");
    report("check_coverage", "done", loop.uncovered.length ? `${loop.uncovered.length} requirement(s) unresolved` : `Coverage complete — ${mustCount}/${mustCount} must-haves covered in ${loop.passes} pass${loop.passes > 1 ? "es" : ""}`);

    const questions: WorkspaceQuestion[] = materializeQuestions(generated, counters, 0, 0);

    // ---- Flashcards ------------------------------------------------------------
    report("flashcards", "running", "Creating concept flashcards");
    let cards: GeneratedFlashcard[] = [];
    try {
      cards = await generateFlashcards(llm, { roleTitle: jd.title, requirements: jd.requirements, questions });
    } catch (e) {
      if (e instanceof AppError && e.code === "LLM_NOT_CONFIGURED") throw e;
      warnings.push("Flashcard generation failed; cards were derived from question outlines.");
    }
    cards = [...cards, ...fallbackFlashcards(jd.requirements, cards, questions)];
    const flashcards = materializeFlashcards(cards, counters, 0, 0);
    report("flashcards", "done", `${flashcards.length} flashcards`);

    // ---- Deterministic schedule -------------------------------------------------
    report("schedule", "running", `Allocating ${questions.length} questions across ${input.days} day${input.days > 1 ? "s" : ""}`);
    const sched = buildSchedule({ days: input.days, questions, requirements: jd.requirements });
    report("schedule", "done", `${input.days}-day plan, ${sched.days.reduce((s, d) => s + d.minutes, 0)} minutes total`);

    // ---- Assemble + validate ----------------------------------------------------
    report("validate", "running", "Validating structure and references");
    const now = new Date().toISOString();
    const parts: KitParts = {
      source: {
        company: companyName,
        company_url: input.companyUrl,
        role: jd.title,
        location: jd.location,
        jd_chars: input.jd.length,
        researched_at: research.researchedAt,
        pages_used: research.pagesUsed,
      },
      companyBrief,
      role: { title: jd.title, seniority: jd.seniority, location: jd.location, responsibilities: jd.responsibilities, requirements: jd.requirements },
      questions,
      flashcards,
      schedule: { days_available: input.days, days: sched.days, generatedAt: now },
      coverage: { uncovered_requirement_ids: loop.uncovered, passes: loop.passes, log: loop.log },
      research: { sources: research.sources, signals: research.signals, limitations: research.limitations, techStack },
      generation: {
        provider: llm.providerName,
        model: llm.model,
        startedAt: new Date(started).toISOString(),
        completedAt: now,
        durationMs: Date.now() - started,
        llmCalls: llm.stats.calls,
        warnings,
        systemDesignJustification: sd.reason,
      },
    };
    const canonical = toCanonicalKit(parts);
    const v = validateCanonicalKit(canonical, input.days);
    if (!v.ok) {
      logger.error("kit validation failed", { errors: v.errors });
      throw new AppError("KIT_VALIDATION_FAILED", "The generated kit failed validation.", { details: v.errors });
    }
    warnings.push(...v.warnings);
    report("validate", "done", `Valid kit: ${questions.length} questions, ${flashcards.length} flashcards, ${input.days} days`);

    const partial = loop.uncovered.length > 0 || warnings.some((w) => w.includes("generation failed"));
    return { parts, counters, canonical, research, warnings, partial };
  }
}
