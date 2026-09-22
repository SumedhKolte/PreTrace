import type { CoverageLogEntry, WorkspaceRequirement } from "@preptrace/shared";

/**
 * Deterministic requirement coverage. No model is consulted.
 * A requirement is covered iff at least one live (non-deleted) question lists its ID
 * in requirement_ids. Only MUST requirements count toward `uncovered_requirement_ids`.
 */

export interface CoverableQuestion {
  id?: string;
  requirement_ids: string[];
  deleted?: boolean;
}

export interface CoverageReport {
  uncovered_requirement_ids: string[];
  uncovered_nice_ids: string[];
  byRequirement: Record<string, string[]>;
  coveredMust: number;
  totalMust: number;
}

export function computeCoverage(requirements: Pick<WorkspaceRequirement, "id" | "priority">[], questions: CoverableQuestion[]): CoverageReport {
  const byRequirement: Record<string, string[]> = {};
  for (const r of requirements) byRequirement[r.id] = [];
  questions.forEach((q, i) => {
    if (q.deleted) return;
    for (const rid of new Set(q.requirement_ids)) {
      if (byRequirement[rid]) byRequirement[rid].push(q.id ?? `#${i}`);
    }
  });
  const must = requirements.filter((r) => r.priority === "must");
  const uncovered = must.filter((r) => byRequirement[r.id].length === 0).map((r) => r.id);
  const uncoveredNice = requirements.filter((r) => r.priority === "nice" && byRequirement[r.id].length === 0).map((r) => r.id);
  return {
    uncovered_requirement_ids: uncovered,
    uncovered_nice_ids: uncoveredNice,
    byRequirement,
    coveredMust: must.length - uncovered.length,
    totalMust: must.length,
  };
}

export const MAX_LLM_GAP_PASSES = 2;

export interface CoverageLoopResult<Q> {
  added: Q[];
  passes: number;
  log: CoverageLogEntry[];
  uncovered: string[];
  usedFallback: string[];
}

/**
 * Coverage loop:
 *   check → (gaps? LLM gap pass → re-check) × up to MAX_LLM_GAP_PASSES
 *   → if still uncovered, deterministic template question per requirement → final check.
 * `passes` = number of coverage checks performed (reported in the kit).
 * Gap generation failures are logged and do not abort the run.
 */
export async function runCoverageLoop<Q extends CoverableQuestion>(args: {
  requirements: WorkspaceRequirement[];
  questions: Q[];
  generateGaps: (uncovered: WorkspaceRequirement[], pass: number) => Promise<Q[]>;
  fallback: (r: WorkspaceRequirement) => Q;
  maxLlmPasses?: number;
  onCheck?: (pass: number, uncovered: string[]) => void;
  onGap?: (pass: number, uncovered: WorkspaceRequirement[]) => void;
}): Promise<CoverageLoopResult<Q>> {
  const maxLlm = args.maxLlmPasses ?? MAX_LLM_GAP_PASSES;
  const added: Q[] = [];
  const log: CoverageLogEntry[] = [];
  const reqById = new Map(args.requirements.map((r) => [r.id, r]));
  let passes = 0;
  const check = () => {
    passes++;
    const u = computeCoverage(args.requirements, [...args.questions, ...added]).uncovered_requirement_ids;
    args.onCheck?.(passes, u);
    return u;
  };

  let uncovered = check();
  let llmRounds = 0;
  while (uncovered.length > 0 && llmRounds < maxLlm) {
    llmRounds++;
    const reqs = uncovered.map((id) => reqById.get(id)!).filter(Boolean);
    args.onGap?.(passes, reqs);
    let action: string;
    try {
      const gaps = await args.generateGaps(reqs, passes);
      added.push(...gaps);
      action = `gap pass generated ${gaps.length} question(s)`;
    } catch (e) {
      action = `gap pass failed: ${(e as Error).message}`;
    }
    log.push({ pass: passes, uncovered, action });
    uncovered = check();
  }

  const usedFallback: string[] = [];
  if (uncovered.length > 0) {
    for (const id of uncovered) {
      const r = reqById.get(id);
      if (!r) continue;
      added.push(args.fallback(r));
      usedFallback.push(id);
    }
    log.push({ pass: passes, uncovered, action: `deterministic template question added for ${usedFallback.join(", ")}` });
    uncovered = check();
  }
  log.push({ pass: passes, uncovered, action: uncovered.length === 0 ? "all must-have requirements covered" : "unresolved requirements remain" });
  return { added, passes, log, uncovered, usedFallback };
}
