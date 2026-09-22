import { CanonicalKitSchema, type CanonicalKit } from "@preptrace/shared";
import { computeCoverage } from "../coverage/coverage";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function dupes(ids: string[]): string[] {
  const seen = new Set<string>();
  const d = new Set<string>();
  for (const id of ids) (seen.has(id) ? d : seen).add(id);
  return [...d];
}

/**
 * Structural (Zod) + semantic validation of a canonical kit. Run before a kit is
 * saved or emitted by the evaluator. Semantic rules:
 *  - unique IDs; every requirement_id / question_id reference resolves
 *  - schedule has exactly `days_available` (= requested) days numbered 1..N, integer minutes
 *  - coverage.uncovered_requirement_ids matches a fresh deterministic computation
 *  - every MUST requirement is covered by a question and appears in the schedule
 */
export function validateCanonicalKit(kit: unknown, expectedDays?: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = CanonicalKitSchema.safeParse(kit);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `schema: ${i.path.join(".")}: ${i.message}`),
      warnings,
    };
  }
  const k: CanonicalKit = parsed.data;
  const reqIds = new Set(k.role.requirements.map((r) => r.id));
  const qIds = new Set(k.questions.map((q) => q.id));

  for (const [label, ids] of [
    ["requirement", k.role.requirements.map((r) => r.id)],
    ["question", k.questions.map((q) => q.id)],
    ["flashcard", k.flashcards.map((f) => f.id)],
  ] as const) {
    const d = dupes(ids);
    if (d.length) errors.push(`duplicate ${label} ids: ${d.join(", ")}`);
  }

  for (const q of k.questions) {
    const bad = q.requirement_ids.filter((r) => !reqIds.has(r));
    if (bad.length) errors.push(`${q.id} references unknown requirements ${bad.join(", ")}`);
  }
  for (const f of k.flashcards) {
    const bad = f.requirement_ids.filter((r) => !reqIds.has(r));
    if (bad.length) errors.push(`${f.id} references unknown requirements ${bad.join(", ")}`);
  }

  const days = k.schedule.days;
  if (expectedDays !== undefined && k.schedule.days_available !== expectedDays) {
    errors.push(`schedule.days_available is ${k.schedule.days_available}, expected ${expectedDays}`);
  }
  if (days.length !== k.schedule.days_available) errors.push(`schedule has ${days.length} days, expected ${k.schedule.days_available}`);
  days.forEach((d, i) => {
    if (d.day !== i + 1) errors.push(`schedule day at index ${i} is numbered ${d.day}, expected ${i + 1}`);
    const bad = d.question_ids.filter((id) => !qIds.has(id));
    if (bad.length) errors.push(`day ${d.day} references unknown questions ${bad.join(", ")}`);
    if (!Number.isInteger(d.minutes)) errors.push(`day ${d.day} minutes must be an integer`);
  });

  const cov = computeCoverage(k.role.requirements, k.questions);
  const reported = [...k.coverage.uncovered_requirement_ids].sort();
  const actual = [...cov.uncovered_requirement_ids].sort();
  if (reported.join(",") !== actual.join(",")) {
    errors.push(`coverage.uncovered_requirement_ids [${reported}] does not match computed [${actual}]`);
  }
  if (actual.length) warnings.push(`must-have requirements without questions: ${actual.join(", ")}`);

  const scheduled = new Set(days.flatMap((d) => d.question_ids));
  const qById = new Map(k.questions.map((q) => [q.id, q]));
  const inSchedule = new Set([...scheduled].flatMap((id) => qById.get(id)?.requirement_ids ?? []));
  const missing = k.role.requirements.filter((r) => r.priority === "must" && cov.byRequirement[r.id].length > 0 && !inSchedule.has(r.id));
  if (missing.length) errors.push(`must-have requirements missing from schedule: ${missing.map((r) => r.id).join(", ")}`);

  const unscheduled = k.questions.filter((q) => !scheduled.has(q.id));
  if (unscheduled.length) warnings.push(`${unscheduled.length} question(s) not in the schedule`);

  return { ok: errors.length === 0, errors, warnings };
}
