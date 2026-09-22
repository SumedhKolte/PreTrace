import {
  isProtected,
  type ItemMeta,
  type QuestionCategory,
  type WorkspaceFlashcard,
  type WorkspaceQuestion,
  type WorkspaceRequirement,
  type WorkspaceSchedule,
} from "@preptrace/shared";
import type { GeneratedFlashcard } from "../generation/flashcards";
import type { GeneratedQuestion } from "../generation/questions";
import { jaccard } from "../lib/text";
import { buildSchedule } from "../schedule/scheduler";

/**
 * STATE MODEL
 * -----------
 * Every question/flashcard carries `meta`:
 *   origin     generated | manual
 *   edited     user changed its content (prompt, outline, difficulty, category, requirements)
 *   pinned     user explicitly protected it
 *   deleted    tombstone — hidden, excluded from the canonical kit, ID never reused,
 *              and its text is passed to the model as "do not regenerate this"
 *   version    increments on every change (optimistic concurrency for edits)
 *
 * An item is *protected* if manual ∨ edited ∨ pinned ∨ deleted.
 * Regenerating a section only ever replaces UNPROTECTED generated items in THAT
 * section. Everything else is carried over untouched (same object).
 *
 * IDs come from monotonically increasing per-kit counters, so an ID is never reused
 * even after regeneration removes the item that had it.
 */

export interface Counters {
  question: number;
  flashcard: number;
}

export function newMeta(origin: ItemMeta["origin"], generation: number, producer: ItemMeta["producer"], now = new Date().toISOString()): ItemMeta {
  return { origin, edited: false, pinned: false, deleted: false, version: 1, generation, producer, createdAt: now, updatedAt: now };
}

export function materializeQuestions(
  gen: GeneratedQuestion[],
  counters: Counters,
  generation: number,
  startOrder: number,
): WorkspaceQuestion[] {
  return gen.map((g, i) => ({
    id: `q${++counters.question}`,
    requirement_ids: g.requirement_ids,
    category: g.category,
    prompt: g.prompt,
    answer_outline: g.answer_outline,
    difficulty: g.difficulty,
    order: startOrder + i,
    evidence: g.evidence,
    meta: newMeta("generated", generation, g.producer),
  }));
}

export function materializeFlashcards(gen: GeneratedFlashcard[], counters: Counters, generation: number, startOrder: number): WorkspaceFlashcard[] {
  return gen.map((g, i) => ({
    id: `f${++counters.flashcard}`,
    front: g.front,
    back: g.back,
    requirement_ids: g.requirement_ids,
    order: startOrder + i,
    meta: newMeta("generated", generation, g.producer === "fallback_template" ? "fallback_template" : "llm"),
  }));
}

const maxOrder = (xs: { order: number }[]) => xs.reduce((m, x) => Math.max(m, x.order), -1);

export interface MergeResult<T> {
  items: T[];
  removed: string[];
  added: string[];
  kept: string[];
}

/**
 * Scoped category regeneration merge.
 *  - Items outside `category`: untouched.
 *  - Protected items in `category`: kept verbatim, in place.
 *  - Unprotected generated items in `category`: replaced by candidates.
 *  - Candidates duplicating a kept item are dropped.
 */
export function mergeCategoryQuestions(
  current: WorkspaceQuestion[],
  category: QuestionCategory,
  candidates: GeneratedQuestion[],
  counters: Counters,
  generation: number,
): MergeResult<WorkspaceQuestion> {
  const removed: string[] = [];
  const kept: string[] = [];
  const survivors: WorkspaceQuestion[] = [];
  for (const q of current) {
    if (q.category !== category) {
      survivors.push(q);
      continue;
    }
    if (isProtected(q.meta)) {
      survivors.push(q);
      if (!q.meta.deleted) kept.push(q.id);
    } else {
      removed.push(q.id);
    }
  }
  const keptPrompts = survivors.filter((q) => q.category === category).map((q) => q.prompt);
  const fresh = candidates.filter((c) => c.category === category && !keptPrompts.some((p) => jaccard(p, c.prompt) >= 0.6));
  const added = materializeQuestions(fresh, counters, generation, maxOrder(survivors) + 1);
  return { items: [...survivors, ...added], removed, added: added.map((q) => q.id), kept };
}

export function mergeFlashcards(
  current: WorkspaceFlashcard[],
  candidates: GeneratedFlashcard[],
  counters: Counters,
  generation: number,
): MergeResult<WorkspaceFlashcard> {
  const removed: string[] = [];
  const kept: string[] = [];
  const survivors: WorkspaceFlashcard[] = [];
  for (const f of current) {
    if (isProtected(f.meta)) {
      survivors.push(f);
      if (!f.meta.deleted) kept.push(f.id);
    } else removed.push(f.id);
  }
  const keptFronts = survivors.map((f) => f.front);
  const fresh = candidates.filter((c) => !keptFronts.some((p) => jaccard(p, c.front) >= 0.7));
  const added = materializeFlashcards(fresh, counters, generation, maxOrder(survivors) + 1);
  return { items: [...survivors, ...added], removed, added: added.map((f) => f.id), kept };
}

/** Prompts of user-deleted items — sent to the model so it does not regenerate them. */
export function deletedPrompts(qs: WorkspaceQuestion[], category?: QuestionCategory): string[] {
  return qs.filter((q) => q.meta.deleted && (!category || q.category === category)).map((q) => q.prompt);
}

/**
 * Rebuild the schedule after questions changed. Locked (user-edited) days are kept;
 * unlocked days are regenerated deterministically from the live questions.
 */
export function reschedule(
  schedule: WorkspaceSchedule,
  questions: WorkspaceQuestion[],
  requirements: WorkspaceRequirement[],
  opts: { keepLocked: boolean } = { keepLocked: true },
): { schedule: WorkspaceSchedule; unscheduled: string[] } {
  const live = questions.filter((q) => !q.meta.deleted).sort((a, b) => a.order - b.order);
  const res = buildSchedule({
    days: schedule.days_available,
    questions: live,
    requirements,
    locked: opts.keepLocked ? schedule.days.filter((d) => d.locked) : [],
  });
  return {
    schedule: { days_available: schedule.days_available, days: res.days, generatedAt: new Date().toISOString() },
    unscheduled: res.unscheduled,
  };
}

// ---------------------------------------------------------------------------
// User edit application (pure) — used by the API mutation layer.
// ---------------------------------------------------------------------------

export interface QuestionPatch {
  prompt?: string;
  answer_outline?: string;
  difficulty?: 1 | 2 | 3;
  category?: QuestionCategory;
  requirement_ids?: string[];
  pinned?: boolean;
}

const CONTENT_FIELDS = ["prompt", "answer_outline", "difficulty", "category", "requirement_ids"] as const;

export function applyQuestionPatch(q: WorkspaceQuestion, patch: QuestionPatch, now = new Date().toISOString()): WorkspaceQuestion {
  const next: WorkspaceQuestion = { ...q, meta: { ...q.meta } };
  let contentChanged = false;
  for (const f of CONTENT_FIELDS) {
    const v = patch[f];
    if (v === undefined) continue;
    const same = Array.isArray(v) ? JSON.stringify(v) === JSON.stringify(q[f]) : v === q[f];
    if (!same) {
      (next as unknown as Record<string, unknown>)[f] = v;
      contentChanged = true;
    }
  }
  if (contentChanged && q.meta.origin === "generated") next.meta.edited = true;
  if (patch.pinned !== undefined) next.meta.pinned = patch.pinned;
  if (contentChanged || patch.pinned !== undefined) {
    next.meta.version = q.meta.version + 1;
    next.meta.updatedAt = now;
  }
  return next;
}
