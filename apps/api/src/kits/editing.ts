import type { QuestionCategory, WorkspaceFlashcard, WorkspaceQuestion } from "@preptrace/shared";
import { computeCoverage } from "../coverage/coverage";
import { AppError } from "../lib/errors";
import type { KitRecord } from "./repository";
import { applyQuestionPatch, newMeta, type QuestionPatch } from "./state";

/**
 * User edit operations. Each is a pure function over a kit draft, executed inside
 * mutateKit() (optimistic concurrency). Edits mark items as edited/pinned/manual/deleted
 * so later regenerations preserve them.
 */

function requireReady(kit: KitRecord) {
  if (!kit.role || !kit.schedule || !kit.coverage) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
  return { role: kit.role, schedule: kit.schedule, coverage: kit.coverage };
}

function assertRequirementIds(kit: KitRecord, ids: string[] | undefined) {
  if (!ids) return;
  const valid = new Set(kit.role?.requirements.map((r) => r.id));
  const bad = ids.filter((id) => !valid.has(id));
  if (bad.length) throw new AppError("INVALID_INPUT", `Unknown requirement id(s): ${bad.join(", ")}`);
}

export function recomputeCoverage(kit: KitRecord) {
  const { role, coverage } = requireReady(kit);
  coverage.uncovered_requirement_ids = computeCoverage(
    role.requirements,
    kit.questions.map((q) => ({ id: q.id, requirement_ids: q.requirement_ids, deleted: q.meta.deleted })),
  ).uncovered_requirement_ids;
}

/** Remove references to deleted questions from every day (a dangling ID is never valid). */
function pruneSchedule(kit: KitRecord, ids: string[]) {
  const { schedule } = requireReady(kit);
  const drop = new Set(ids);
  for (const d of schedule.days) d.question_ids = d.question_ids.filter((id) => !drop.has(id));
}

function findQuestion(kit: KitRecord, id: string): WorkspaceQuestion {
  const q = kit.questions.find((x) => x.id === id);
  if (!q || q.meta.deleted) throw new AppError("NOT_FOUND", "Question not found.");
  return q;
}

function findCard(kit: KitRecord, id: string): WorkspaceFlashcard {
  const f = kit.flashcards.find((x) => x.id === id);
  if (!f || f.meta.deleted) throw new AppError("NOT_FOUND", "Flashcard not found.");
  return f;
}

function checkVersion(current: number, base?: number) {
  if (base !== undefined && base !== current) {
    throw new AppError("VERSION_CONFLICT", "This item was changed elsewhere. Reload to see the latest version.", { details: { currentVersion: current } });
  }
}

// ---- Questions --------------------------------------------------------------

export function updateQuestion(kit: KitRecord, id: string, patch: QuestionPatch & { baseVersion?: number }): WorkspaceQuestion {
  requireReady(kit);
  const q = findQuestion(kit, id);
  checkVersion(q.meta.version, patch.baseVersion);
  assertRequirementIds(kit, patch.requirement_ids);
  const next = applyQuestionPatch(q, patch);
  kit.questions = kit.questions.map((x) => (x.id === id ? next : x));
  if (patch.requirement_ids || patch.category || patch.difficulty) {
    recomputeCoverage(kit);
    kit.schedule!.stale = true;
  }
  return next;
}

export function createQuestion(
  kit: KitRecord,
  input: { prompt: string; answer_outline: string; difficulty: 1 | 2 | 3; category: QuestionCategory; requirement_ids: string[] },
): WorkspaceQuestion {
  requireReady(kit);
  assertRequirementIds(kit, input.requirement_ids);
  kit.counters.question += 1;
  const maxOrder = kit.questions.reduce((m, x) => Math.max(m, x.order), -1);
  const q: WorkspaceQuestion = {
    id: `q${kit.counters.question}`,
    requirement_ids: [...new Set(input.requirement_ids)],
    category: input.category,
    prompt: input.prompt,
    answer_outline: input.answer_outline || "- (add your answer outline)",
    difficulty: input.difficulty,
    order: maxOrder + 1,
    evidence: { rationale: "Added manually by you.", jd_signal: undefined, signals: [] },
    meta: newMeta("manual", kit.counters.generation, "user"),
  };
  kit.questions.push(q);
  recomputeCoverage(kit);
  kit.schedule!.stale = true;
  return q;
}

export function deleteQuestion(kit: KitRecord, id: string) {
  const q = findQuestion(kit, id);
  q.meta = { ...q.meta, deleted: true, version: q.meta.version + 1, updatedAt: new Date().toISOString() };
  pruneSchedule(kit, [id]);
  recomputeCoverage(kit);
}

export function restoreQuestion(kit: KitRecord, id: string): WorkspaceQuestion {
  requireReady(kit);
  const q = kit.questions.find((x) => x.id === id && x.meta.deleted);
  if (!q) throw new AppError("NOT_FOUND", "Deleted question not found.");
  q.meta = { ...q.meta, deleted: false, version: q.meta.version + 1, updatedAt: new Date().toISOString() };
  recomputeCoverage(kit);
  kit.schedule!.stale = true;
  return q;
}

/**
 * Reorder a subset (e.g. one category tab): the listed items keep the same set of
 * order slots, redistributed in the new sequence. Items not listed don't move.
 */
export function reorder<T extends { id: string; order: number; meta: { deleted: boolean } }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.filter((i) => !i.meta.deleted).map((i) => [i.id, i]));
  const unique = [...new Set(ids)];
  if (unique.some((id) => !byId.has(id))) throw new AppError("INVALID_INPUT", "Reorder list contains unknown items.");
  const slots = unique.map((id) => byId.get(id)!.order).sort((a, b) => a - b);
  const newOrder = new Map(unique.map((id, i) => [id, slots[i]]));
  return items.map((i) => (newOrder.has(i.id) ? { ...i, order: newOrder.get(i.id)! } : i));
}

// ---- Flashcards -------------------------------------------------------------

export function updateFlashcard(
  kit: KitRecord,
  id: string,
  patch: { front?: string; back?: string; requirement_ids?: string[]; pinned?: boolean; baseVersion?: number },
): WorkspaceFlashcard {
  const f = findCard(kit, id);
  checkVersion(f.meta.version, patch.baseVersion);
  assertRequirementIds(kit, patch.requirement_ids);
  const next: WorkspaceFlashcard = { ...f, meta: { ...f.meta } };
  let changed = false;
  if (patch.front !== undefined && patch.front !== f.front) [next.front, changed] = [patch.front, true];
  if (patch.back !== undefined && patch.back !== f.back) [next.back, changed] = [patch.back, true];
  if (patch.requirement_ids && JSON.stringify(patch.requirement_ids) !== JSON.stringify(f.requirement_ids)) {
    [next.requirement_ids, changed] = [[...new Set(patch.requirement_ids)], true];
  }
  if (changed && f.meta.origin === "generated") next.meta.edited = true;
  if (patch.pinned !== undefined) next.meta.pinned = patch.pinned;
  if (changed || patch.pinned !== undefined) {
    next.meta.version += 1;
    next.meta.updatedAt = new Date().toISOString();
  }
  kit.flashcards = kit.flashcards.map((x) => (x.id === id ? next : x));
  return next;
}

export function createFlashcard(kit: KitRecord, input: { front: string; back: string; requirement_ids: string[] }): WorkspaceFlashcard {
  requireReady(kit);
  assertRequirementIds(kit, input.requirement_ids);
  kit.counters.flashcard += 1;
  const f: WorkspaceFlashcard = {
    id: `f${kit.counters.flashcard}`,
    front: input.front,
    back: input.back,
    requirement_ids: [...new Set(input.requirement_ids)],
    order: kit.flashcards.reduce((m, x) => Math.max(m, x.order), -1) + 1,
    meta: newMeta("manual", kit.counters.generation, "user"),
  };
  kit.flashcards.push(f);
  return f;
}

export function deleteFlashcard(kit: KitRecord, id: string) {
  const f = findCard(kit, id);
  f.meta = { ...f.meta, deleted: true, version: f.meta.version + 1, updatedAt: new Date().toISOString() };
}

// ---- Company brief ----------------------------------------------------------

export function updateBrief(kit: KitRecord, patch: { summary?: string; what_they_do?: string }) {
  const brief = kit.companyBrief;
  if (!brief) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
  if (!brief.edited) {
    // Keep the generated version so the user can always revert.
    kit.briefRevisions = [{ summary: brief.summary, what_they_do: brief.what_they_do, savedAt: new Date().toISOString(), reason: "edited" as const }, ...kit.briefRevisions].slice(0, 10);
  }
  if (patch.summary !== undefined) brief.summary = patch.summary;
  if (patch.what_they_do !== undefined) brief.what_they_do = patch.what_they_do;
  brief.edited = true;
  brief.version += 1;
  brief.updatedAt = new Date().toISOString();
  return brief;
}

export function restoreBriefRevision(kit: KitRecord, index: number) {
  const brief = kit.companyBrief;
  const rev = kit.briefRevisions[index];
  if (!brief || !rev) throw new AppError("NOT_FOUND", "Revision not found.");
  kit.briefRevisions = [
    { summary: brief.summary, what_they_do: brief.what_they_do, savedAt: new Date().toISOString(), reason: "edited" as const },
    ...kit.briefRevisions.filter((_, i) => i !== index),
  ].slice(0, 10);
  brief.summary = rev.summary;
  brief.what_they_do = rev.what_they_do;
  brief.version += 1;
  brief.updatedAt = new Date().toISOString();
  return brief;
}

// ---- Schedule ---------------------------------------------------------------

export function updateScheduleDay(kit: KitRecord, day: number, patch: { focus?: string; minutes?: number; question_ids?: string[]; locked?: boolean }) {
  const { schedule } = requireReady(kit);
  const d = schedule.days.find((x) => x.day === day);
  if (!d) throw new AppError("NOT_FOUND", `Day ${day} does not exist.`);
  if (patch.question_ids) {
    const live = new Set(kit.questions.filter((q) => !q.meta.deleted).map((q) => q.id));
    const bad = patch.question_ids.filter((id) => !live.has(id));
    if (bad.length) throw new AppError("INVALID_INPUT", `Unknown question id(s): ${bad.join(", ")}`);
    d.question_ids = [...new Set(patch.question_ids)];
  }
  if (patch.focus !== undefined) d.focus = patch.focus;
  if (patch.minutes !== undefined) d.minutes = Math.round(patch.minutes);
  // Any content edit locks the day; an explicit locked flag wins.
  const contentEdit = patch.question_ids !== undefined || patch.focus !== undefined || patch.minutes !== undefined;
  d.locked = patch.locked ?? (contentEdit ? true : d.locked);
  return d;
}
