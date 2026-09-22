import { CATEGORY_LABELS, type QuestionCategory, type WorkspaceScheduleDay } from "@preptrace/shared";

/**
 * Deterministic study-schedule allocation. The LLM never allocates days.
 *
 * 1. Score each question:
 *      score = 6·[covers a MUST]  + 3·difficulty + 1.5·min(#MUST reqs, 3) + 2·[sole coverer of a MUST]
 *    Ties: difficulty ↓, category order, original order, numeric id.
 * 2. Day structure for N days:
 *      N = 1  → one learning day with everything.
 *      N = 2  → two learning days.
 *      N ≥ 3  → L learning days, then spaced review days, then a final mock-interview day,
 *               where L = min(N − 1, ⌈Q / 2⌉) (at least two new questions per learning day).
 * 3. Learning days receive contiguous slices of the score-sorted list, balanced by
 *    estimated minutes, so hard / must-have material lands earliest and every
 *    question (hence every MUST requirement) is scheduled before the final day.
 * 4. Review days rotate through the score-sorted list; the mock day greedily covers
 *    every MUST requirement first, then adds top-scored questions.
 * All minutes are integers (rounded to 5, min 15).
 */

export interface SchedQuestion {
  id: string;
  requirement_ids: string[];
  category: QuestionCategory;
  difficulty: number;
}

export interface SchedRequirement {
  id: string;
  priority: "must" | "nice";
  topic: string;
}

export const LEARN_MINUTES: Record<number, number> = { 1: 10, 2: 15, 3: 20 };
const REVIEW_MINUTES_PER_Q = 5;
const MOCK_MINUTES_PER_Q = 8;
const REVIEW_SIZE = 4;
const MOCK_SIZE = 6;
const CATEGORY_ORDER: QuestionCategory[] = ["system_design", "technical", "behavioural", "company_fit"];

const qNum = (id: string) => Number(id.replace(/\D/g, "")) || 0;
const roundMinutes = (m: number) => Math.max(15, Math.round(m / 5) * 5);

export interface ScoredQuestion extends SchedQuestion {
  score: number;
  coversMust: boolean;
  index: number;
}

export function scoreQuestions(questions: SchedQuestion[], requirements: SchedRequirement[]): ScoredQuestion[] {
  const must = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const coverers = new Map<string, string[]>();
  for (const q of questions) for (const rid of q.requirement_ids) if (must.has(rid)) coverers.set(rid, [...(coverers.get(rid) ?? []), q.id]);

  return questions
    .map((q, index) => {
      const mustIds = q.requirement_ids.filter((r) => must.has(r));
      const sole = mustIds.some((r) => (coverers.get(r) ?? []).length === 1);
      const score = 6 * (mustIds.length > 0 ? 1 : 0) + 3 * q.difficulty + 1.5 * Math.min(mustIds.length, 3) + 2 * (sole ? 1 : 0);
      return { ...q, score, coversMust: mustIds.length > 0, index };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.difficulty - a.difficulty ||
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.index - b.index ||
        qNum(a.id) - qNum(b.id),
    );
}

/** Split an ordered list into exactly `k` non-empty contiguous chunks balanced by weight. */
export function balancedPartition<T>(items: T[], k: number, weight: (t: T) => number): T[][] {
  if (k <= 0) return [];
  if (items.length === 0) return Array.from({ length: k }, () => []);
  const n = items.length;
  const chunks: T[][] = [[]];
  const total = items.reduce((s, t) => s + weight(t), 0);
  const target = total / Math.min(k, n);
  let acc = 0;
  items.forEach((item, i) => {
    const cur = chunks[chunks.length - 1];
    const remainingItems = n - i;
    const chunksAfterCurrent = Math.min(k, n) - chunks.length;
    const w = weight(item);
    const overTarget = acc + w / 2 > target * chunks.length;
    if (cur.length > 0 && chunksAfterCurrent > 0 && (overTarget || remainingItems <= chunksAfterCurrent)) chunks.push([]);
    chunks[chunks.length - 1].push(item);
    acc += w;
  });
  while (chunks.length < k) chunks.push([]);
  return chunks;
}

function topicsFor(qs: SchedQuestion[], reqById: Map<string, SchedRequirement>, max = 2): string[] {
  const count = new Map<string, number>();
  for (const q of qs) {
    for (const rid of q.requirement_ids) {
      const r = reqById.get(rid);
      if (!r || !r.topic) continue;
      count.set(r.topic, (count.get(r.topic) ?? 0) + (r.priority === "must" ? 2 : 1));
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([t]) => t);
}

function dominantCategory(qs: SchedQuestion[]): QuestionCategory | null {
  const m = new Map<QuestionCategory, number>();
  for (const q of qs) m.set(q.category, (m.get(q.category) ?? 0) + LEARN_MINUTES[q.difficulty]);
  let best: QuestionCategory | null = null;
  let bestV = -1;
  for (const c of CATEGORY_ORDER) if ((m.get(c) ?? 0) > bestV && m.has(c)) [best, bestV] = [c, m.get(c)!];
  return best;
}

function learnFocus(qs: SchedQuestion[], reqById: Map<string, SchedRequirement>): string {
  const cat = dominantCategory(qs);
  const topics = topicsFor(qs, reqById);
  const label = cat ? CATEGORY_LABELS[cat] : "Study";
  return topics.length ? `${label} — ${topics.join(", ")}` : label;
}

/** Greedy set cover over MUST requirements, then top-scored fill. Deterministic. */
function mockSelection(sorted: ScoredQuestion[], requirements: SchedRequirement[], size: number): ScoredQuestion[] {
  const uncovered = new Set(requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const chosen: ScoredQuestion[] = [];
  while (uncovered.size > 0 && chosen.length < size) {
    let best: ScoredQuestion | null = null;
    let bestGain = 0;
    for (const q of sorted) {
      if (chosen.includes(q)) continue;
      const gain = q.requirement_ids.filter((r) => uncovered.has(r)).length;
      if (gain > bestGain) [best, bestGain] = [q, gain];
    }
    if (!best) break;
    chosen.push(best);
    for (const r of best.requirement_ids) uncovered.delete(r);
  }
  for (const q of sorted) {
    if (chosen.length >= size) break;
    if (!chosen.includes(q)) chosen.push(q);
  }
  return chosen;
}

type PlannedDay = Omit<WorkspaceScheduleDay, "day" | "locked">;

/** Plan `n` consecutive days for the given questions (no locks). */
export function planDays(n: number, questions: SchedQuestion[], requirements: SchedRequirement[]): PlannedDay[] {
  if (n <= 0) return [];
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const sorted = scoreQuestions(questions, requirements);
  const Q = sorted.length;

  if (Q === 0) {
    return Array.from({ length: n }, () => ({ kind: "review" as const, focus: "Review role requirements", question_ids: [], minutes: 30 }));
  }

  const hasMock = n >= 3;
  const learnDays = n <= 2 ? n : Math.max(1, Math.min(n - 1, Math.ceil(Q / 2)));
  const reviewDays = n - learnDays - (hasMock ? 1 : 0);
  const effectiveLearn = Math.min(learnDays, Q);

  const days: PlannedDay[] = [];
  const chunks = balancedPartition(sorted, effectiveLearn, (q) => LEARN_MINUTES[q.difficulty] ?? 15);
  for (const chunk of chunks) {
    days.push({
      kind: "learn",
      focus: learnFocus(chunk, reqById),
      question_ids: chunk.map((q) => q.id),
      minutes: roundMinutes(chunk.reduce((s, q) => s + (LEARN_MINUTES[q.difficulty] ?? 15), 0)),
    });
  }
  // n ≤ 2 with a single question: extra learning slots become reviews.
  for (let i = effectiveLearn; i < learnDays; i++) days.push(reviewDay(sorted, i - effectiveLearn, reqById));

  for (let k = 0; k < reviewDays; k++) days.push(reviewDay(sorted, k, reqById));

  if (hasMock) {
    const pick = mockSelection(sorted, requirements, Math.min(MOCK_SIZE, Q));
    days.push({
      kind: "mock",
      focus: "Mock interview & final review",
      question_ids: pick.map((q) => q.id),
      minutes: roundMinutes(pick.length * MOCK_MINUTES_PER_Q + 15),
    });
  }
  return days;
}

function reviewDay(sorted: ScoredQuestion[], k: number, reqById: Map<string, SchedRequirement>): PlannedDay {
  const size = Math.min(REVIEW_SIZE, sorted.length);
  const ids: ScoredQuestion[] = [];
  for (let j = 0; j < size; j++) {
    const q = sorted[(k * size + j) % sorted.length];
    if (!ids.includes(q)) ids.push(q);
  }
  const topics = topicsFor(ids, reqById);
  return {
    kind: "review",
    focus: topics.length ? `Review — ${topics.join(", ")}` : "Spaced review",
    question_ids: ids.map((q) => q.id),
    minutes: roundMinutes(ids.length * REVIEW_MINUTES_PER_Q + 10),
  };
}

export interface BuildScheduleResult {
  days: WorkspaceScheduleDay[];
  /** Questions that could not be placed because every day is locked. */
  unscheduled: string[];
}

/**
 * Build exactly `n` days. Locked (user-edited) days are kept verbatim at their day
 * numbers; remaining questions are planned onto the free days in order.
 */
export function buildSchedule(args: {
  days: number;
  questions: SchedQuestion[];
  requirements: SchedRequirement[];
  locked?: WorkspaceScheduleDay[];
}): BuildScheduleResult {
  const n = Math.max(1, Math.floor(args.days));
  const live = new Set(args.questions.map((q) => q.id));
  const locked = new Map<number, WorkspaceScheduleDay>();
  for (const d of args.locked ?? []) {
    if (d.locked && d.day >= 1 && d.day <= n) locked.set(d.day, { ...d, question_ids: d.question_ids.filter((id) => live.has(id)) });
  }
  const scheduledInLocked = new Set([...locked.values()].flatMap((d) => d.question_ids));
  const remaining = args.questions.filter((q) => !scheduledInLocked.has(q.id));
  const freeDayNumbers = Array.from({ length: n }, (_, i) => i + 1).filter((d) => !locked.has(d));

  // If only review capacity is left (all questions sit in locked days), plan reviews over everything.
  const plan = planDays(freeDayNumbers.length, remaining.length ? remaining : args.questions, args.requirements);
  const days: WorkspaceScheduleDay[] = [];
  let p = 0;
  for (let d = 1; d <= n; d++) {
    const l = locked.get(d);
    if (l) days.push(l);
    else days.push({ day: d, locked: false, ...plan[p++] });
  }
  const unscheduled = freeDayNumbers.length === 0 ? remaining.map((q) => q.id) : [];
  return { days, unscheduled };
}
