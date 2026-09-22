import type { CanonicalKit, KitWorkspace, WorkspaceFlashcard, WorkspaceQuestion } from "@preptrace/shared";
import { computeCoverage } from "../coverage/coverage";

export type KitParts = Pick<KitWorkspace, "source" | "companyBrief" | "role" | "questions" | "flashcards" | "schedule" | "coverage">;

export const liveQuestions = (qs: WorkspaceQuestion[]) => qs.filter((q) => !q.meta.deleted).sort((a, b) => a.order - b.order);
export const liveFlashcards = (fs: WorkspaceFlashcard[]) => fs.filter((f) => !f.meta.deleted).sort((a, b) => a.order - b.order);

/**
 * Project the editable workspace onto the contractual kit schema:
 * strips item metadata, tombstones and app-only fields; recomputes
 * uncovered_requirement_ids from live questions so it can never drift.
 */
export function toCanonicalKit(w: KitParts): CanonicalKit {
  const questions = liveQuestions(w.questions);
  const live = new Set(questions.map((q) => q.id));
  const coverage = computeCoverage(w.role.requirements, questions);
  return {
    source: {
      company: w.source.company,
      company_url: w.source.company_url,
      role: w.source.role,
      location: w.source.location,
      jd_chars: w.source.jd_chars,
      researched_at: w.source.researched_at,
      pages_used: [...w.source.pages_used],
    },
    company_brief: {
      summary: w.companyBrief.summary,
      what_they_do: w.companyBrief.what_they_do,
      sources: [...w.companyBrief.sources],
      hiring_process: {
        found: w.companyBrief.hiring_process.found,
        summary: w.companyBrief.hiring_process.summary,
        stages: w.companyBrief.hiring_process.stages.map((s) => ({ ...s })),
      },
    },
    role: {
      title: w.role.title,
      seniority: w.role.seniority,
      responsibilities: [...w.role.responsibilities],
      requirements: w.role.requirements.map((r) => ({ id: r.id, text: r.text, kind: r.kind, priority: r.priority, topic: r.topic })),
    },
    questions: questions.map((q) => ({
      id: q.id,
      requirement_ids: [...q.requirement_ids],
      category: q.category,
      prompt: q.prompt,
      answer_outline: q.answer_outline,
      difficulty: q.difficulty,
    })),
    flashcards: liveFlashcards(w.flashcards).map((f) => ({ id: f.id, front: f.front, back: f.back, requirement_ids: [...f.requirement_ids] })),
    schedule: {
      days_available: w.schedule.days_available,
      days: w.schedule.days.map((d) => ({
        day: d.day,
        focus: d.focus,
        question_ids: d.question_ids.filter((id) => live.has(id)),
        minutes: Math.round(d.minutes),
      })),
    },
    coverage: {
      uncovered_requirement_ids: coverage.uncovered_requirement_ids,
      passes: w.coverage.passes,
    },
  };
}
