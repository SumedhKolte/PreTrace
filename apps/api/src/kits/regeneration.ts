import { CATEGORY_LABELS, isProtected, type QuestionCategory, type RegenerateScope } from "@preptrace/shared";
import { computeCoverage, runCoverageLoop } from "../coverage/coverage";
import { generateCompanyBrief } from "../generation/companyBrief";
import { fallbackFlashcards, flashcardTarget, generateFlashcards } from "../generation/flashcards";
import {
  fallbackQuestion,
  generateCategoryQuestions,
  generateGapQuestions,
  targetCount,
  type GeneratedQuestion,
  type QuestionContext,
} from "../generation/questions";
import { AppError } from "../lib/errors";
import type { ProgressReporter } from "../pipeline/interviewPrepService";
import type { Services } from "../services";
import { recomputeCoverage } from "./editing";
import { findOwnedKit, mutateKit, type KitRecord } from "./repository";
import { deletedPrompts, materializeFlashcards, mergeCategoryQuestions, mergeFlashcards, reschedule } from "./state";

/**
 * Scoped, non-destructive regeneration.
 *
 * Invariants (all covered by tests):
 *  - Regenerating a question category replaces only UNPROTECTED generated questions in
 *    that category. Edited, pinned, manual and deleted (tombstoned) items survive.
 *  - Other categories, flashcards and the company brief are not touched.
 *  - The schedule is rebuilt around the change but user-locked days are kept verbatim.
 *  - Regenerating the company brief touches only the brief + research, and the previous
 *    brief is saved as a revision so it can be restored.
 *  - Slow LLM work runs outside the write; the merge runs inside mutateKit() against the
 *    latest document, so edits made mid-regeneration are preserved too.
 */

const CATEGORY_SCOPES = new Set<RegenerateScope>(["technical", "behavioural", "system_design", "company_fit"]);

function ctxFromKit(kit: KitRecord): QuestionContext {
  if (!kit.role || !kit.companyBrief || !kit.research || !kit.source) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
  return {
    companyName: kit.source.company,
    companySummary: kit.companyBrief.summary,
    roleTitle: kit.role.title,
    seniority: kit.role.seniority,
    responsibilities: kit.role.responsibilities,
    requirements: kit.role.requirements,
    signals: kit.research.signals,
    hiring: kit.companyBrief.hiring_process,
  };
}

export async function runRegeneration(
  services: Services,
  kitId: string,
  userId: string,
  scope: RegenerateScope,
  report: ProgressReporter,
  options: { replaceEdited?: boolean } = {},
): Promise<{ summary: string }> {
  const llm = services.llm.scope();

  if (scope === "schedule") {
    report("schedule", "running", "Rebuilding deterministically");
    const { result } = await mutateKit(kitId, userId, (kit) => {
      if (!kit.schedule || !kit.role) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
      const locked = kit.schedule.days.filter((d) => d.locked).length;
      const { schedule, unscheduled } = reschedule(kit.schedule, kit.questions, kit.role.requirements, { keepLocked: !options.replaceEdited });
      kit.schedule = schedule;
      return { locked: options.replaceEdited ? 0 : locked, unscheduled };
    });
    const msg = `Schedule rebuilt${result.locked ? `, ${result.locked} edited day(s) kept` : ""}${result.unscheduled.length ? ` — ${result.unscheduled.length} question(s) could not be placed (all days locked)` : ""}`;
    report("schedule", "done", msg);
    return { summary: msg };
  }

  if (scope === "company") {
    const kit = await findOwnedKit(kitId, userId);
    if (!kit.role || !kit.source) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
    const research = await services.research.research(kit.input.companyUrl, kit.source.company, (s, st, d) => report(s, st, d), { useCache: false, llm });
    report("company_brief", "running", "Writing a fresh brief from verified facts");
    const brief = await generateCompanyBrief(llm, { ...research, companyName: kit.source.company }, kit.role.title);
    await mutateKit(kitId, userId, (k) => {
      if (k.companyBrief) {
        k.briefRevisions = [
          { summary: k.companyBrief.summary, what_they_do: k.companyBrief.what_they_do, savedAt: new Date().toISOString(), reason: "regenerated" as const },
          ...k.briefRevisions,
        ].slice(0, 10);
      }
      k.companyBrief = { ...brief, version: (k.companyBrief?.version ?? 0) + 1 };
      k.research = { sources: research.sources, signals: research.signals, limitations: research.limitations };
      if (k.source) k.source = { ...k.source, researched_at: research.researchedAt, pages_used: research.pagesUsed };
      // Questions, flashcards and schedule are intentionally untouched.
    });
    report("company_brief", "done", `Brief grounded in ${brief.sources.length} source(s); previous version saved`);
    return { summary: "Company brief regenerated (previous version kept in history)." };
  }

  if (scope === "flashcards") {
    const kit = await findOwnedKit(kitId, userId);
    if (!kit.role) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
    const protectedCount = kit.flashcards.filter((f) => !f.meta.deleted && isProtected(f.meta)).length;
    report("flashcards", "running", protectedCount ? `Keeping ${protectedCount} edited/pinned/manual card(s)` : "Generating cards");
    const live = kit.questions.filter((q) => !q.meta.deleted);
    const cards = await generateFlashcards(llm, {
      roleTitle: kit.role.title,
      requirements: kit.role.requirements,
      questions: live,
      count: Math.max(3, flashcardTarget(kit.role.requirements.length) - protectedCount),
      avoid: kit.flashcards.filter((f) => isProtected(f.meta)).map((f) => f.front),
    });
    const { result } = await mutateKit(kitId, userId, (k) => {
      k.counters.generation += 1;
      const merged = mergeFlashcards(k.flashcards, cards, k.counters, k.counters.generation);
      const liveCards = merged.items.filter((f) => !f.meta.deleted);
      const backstop = fallbackFlashcards(k.role!.requirements, liveCards, k.questions.filter((q) => !q.meta.deleted));
      k.flashcards = [...merged.items, ...materializeFlashcards(backstop, k.counters, k.counters.generation, merged.items.length)];
      return merged;
    });
    const msg = `${result.added.length} new card(s), ${result.kept.length} of yours kept, ${result.removed.length} replaced`;
    report("flashcards", "done", msg);
    return { summary: msg };
  }

  if (!CATEGORY_SCOPES.has(scope)) throw new AppError("INVALID_INPUT", "Unknown regeneration scope.");
  const category = scope as QuestionCategory;
  const label = CATEGORY_LABELS[category];

  // 1) Generate candidates outside the write.
  const kit = await findOwnedKit(kitId, userId);
  const ctx = ctxFromKit(kit);
  const inCat = kit.questions.filter((q) => q.category === category);
  const keep = inCat.filter((q) => !q.meta.deleted && isProtected(q.meta));
  const avoid = [
    ...deletedPrompts(kit.questions, category),
    ...kit.questions.filter((q) => !q.meta.deleted && q.category !== category).map((q) => q.prompt),
  ];
  const count = Math.max(1, targetCount(category, ctx) - keep.length);
  report("generate_questions", "running", keep.length ? `Keeping ${keep.length} of your ${label.toLowerCase()} question(s); generating ${count} more` : `Generating ${count} ${label.toLowerCase()} questions`);
  const candidates = await generateCategoryQuestions(llm, category, ctx, { count, avoid, keep: keep.map((q) => q.prompt) });
  report("generate_questions", "done", `${candidates.length} candidate question(s)`);

  // 2) Coverage gap candidates, restricted to this category (other categories are never modified).
  report("merge", "running", "Merging with your edits");
  const survivorsPreview = kit.questions.filter((q) => q.category !== category || isProtected(q.meta));
  const previewCoverage = computeCoverage(kit.role!.requirements, [
    ...survivorsPreview.map((q) => ({ requirement_ids: q.requirement_ids, deleted: q.meta.deleted })),
    ...candidates,
  ]);
  let gapQuestions: GeneratedQuestion[] = [];
  let passes = 1;
  const log: { pass: number; uncovered: string[]; action: string }[] = [];
  if (previewCoverage.uncovered_requirement_ids.length > 0) {
    report("check_coverage", "running", `Coverage gap after merge: ${previewCoverage.uncovered_requirement_ids.join(", ")}`);
    const loop = await runCoverageLoop<GeneratedQuestion>({
      requirements: kit.role!.requirements,
      questions: [...survivorsPreview.map((q) => ({ ...q, producer: "llm" as const, deleted: q.meta.deleted })), ...candidates],
      generateGaps: (uncovered) => generateGapQuestions(llm, uncovered, ctx, { avoid: [...avoid, ...candidates.map((c) => c.prompt)], forceCategory: category }),
      fallback: (r) => fallbackQuestion(r, category),
    });
    gapQuestions = loop.added.filter((q) => "producer" in q && q.category === category) as GeneratedQuestion[];
    passes = loop.passes;
    log.push(...loop.log);
  }

  // 3) Merge against the *latest* document, recompute coverage, reschedule around locked days.
  const { result } = await mutateKit(kitId, userId, (k) => {
    k.counters.generation += 1;
    const merged = mergeCategoryQuestions(k.questions, category, [...candidates, ...gapQuestions], k.counters, k.counters.generation);
    k.questions = merged.items;
    recomputeCoverage(k);
    k.coverage!.passes = passes;
    k.coverage!.log = [...log, { pass: passes, uncovered: k.coverage!.uncovered_requirement_ids, action: `${label} regenerated` }].slice(-20);
    const locked = k.schedule!.days.filter((d) => d.locked).length;
    const res = reschedule(k.schedule!, k.questions, k.role!.requirements, { keepLocked: true });
    k.schedule = res.schedule;
    return { ...merged, locked };
  });
  report("merge", "done", `${result.kept.length} of your question(s) kept, ${result.removed.length} replaced, ${result.added.length} added`);
  report("check_coverage", "done", "Coverage re-checked");
  report("schedule", "done", result.locked ? `Schedule updated; ${result.locked} edited day(s) kept` : "Schedule updated");
  return { summary: `${label}: ${result.added.length} new, ${result.kept.length} kept, ${result.removed.length} replaced.` };
}
