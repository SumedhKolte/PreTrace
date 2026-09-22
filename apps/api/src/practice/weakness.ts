import {
  QUESTION_CATEGORIES,
  type CategoryReadiness,
  type PracticeItemStats,
  type ReadinessReport,
  type RequirementReadiness,
  type SessionItem,
  type WeaknessReason,
  type WorkspaceFlashcard,
  type WorkspaceQuestion,
  type WorkspaceRequirement,
} from "@preptrace/shared";

/**
 * WEAK-SPOT COACH — fully deterministic; the model never judges the candidate.
 *
 * Item confidence   c  = 0.7·latest + 0.3·mean(all ratings)        (1..5)
 * Item mastery      m  = (c − 1) / 4                                (0..1, unpractised = 0)
 * Item freshness    f  = max(0, 1 − daysSinceLastPractice / 7)      (0..1, unpractised = 0)
 *
 * Requirement readiness (0–100), over the questions + flashcards linked to it:
 *   R = 100 · (0.70·mean(m) + 0.20·practisedFraction + 0.10·mean(f over practised))
 *   (no linked items → 0, reason "uncovered")
 *
 * Requirement weakness / repair priority (0–100):
 *   W = (100 − R) · priorityWeight · difficultyFactor
 *   priorityWeight   = 1.0 must, 0.6 nice
 *   difficultyFactor = 0.8 + 0.1·avgQuestionDifficulty                (0.9 … 1.1)
 *
 * Category readiness = mean item readiness of questions in the category,
 *   item readiness = 100·(0.8·m + 0.2·f), unpractised = 0.
 * Overall readiness = priority-weighted mean of requirement readiness (must ×2, nice ×1).
 */

const DAY = 86_400_000;

export function itemConfidence(s: PracticeItemStats | undefined): number | null {
  if (!s || s.attempts === 0 || s.lastConfidence === null) return null;
  return 0.7 * s.lastConfidence + 0.3 * (s.avgConfidence ?? s.lastConfidence);
}

export const mastery = (conf: number | null) => (conf === null ? 0 : Math.max(0, Math.min(1, (conf - 1) / 4)));

export function freshness(s: PracticeItemStats | undefined, now: number): number {
  if (!s?.lastPracticedAt) return 0;
  const days = (now - Date.parse(s.lastPracticedAt)) / DAY;
  return Math.max(0, Math.min(1, 1 - days / 7));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeReadiness(args: {
  requirements: WorkspaceRequirement[];
  questions: WorkspaceQuestion[];
  flashcards: WorkspaceFlashcard[];
  stats: Map<string, PracticeItemStats>;
  now?: number;
}): ReadinessReport {
  const now = args.now ?? Date.now();
  const questions = args.questions.filter((q) => !q.meta.deleted);
  const flashcards = args.flashcards.filter((f) => !f.meta.deleted);
  const key = (type: string, id: string) => `${type}:${id}`;

  const reqReports: RequirementReadiness[] = args.requirements.map((r) => {
    const qs = questions.filter((q) => q.requirement_ids.includes(r.id));
    const fs = flashcards.filter((f) => f.requirement_ids.includes(r.id));
    const items = [...qs.map((q) => key("question", q.id)), ...fs.map((f) => key("flashcard", f.id))];
    const stats = items.map((k) => args.stats.get(k));
    const practiced = stats.filter((s) => s && s.attempts > 0) as PracticeItemStats[];
    const confs = practiced.map((s) => itemConfidence(s)!).filter((c) => c !== null);
    const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
    const avgDifficulty = qs.length ? qs.reduce((s, q) => s + q.difficulty, 0) / qs.length : 2;
    const lastPracticedAt = practiced.map((s) => s.lastPracticedAt!).sort().at(-1) ?? null;

    let readiness = 0;
    if (items.length > 0) {
      const meanMastery = stats.reduce((sum, s) => sum + mastery(itemConfidence(s)), 0) / items.length;
      const practicedFraction = practiced.length / items.length;
      const meanFresh = practiced.length ? practiced.reduce((sum, s) => sum + freshness(s, now), 0) / practiced.length : 0;
      readiness = Math.round(100 * (0.7 * meanMastery + 0.2 * practicedFraction + 0.1 * meanFresh));
    }
    const priorityWeight = r.priority === "must" ? 1 : 0.6;
    const difficultyFactor = 0.8 + 0.1 * avgDifficulty;
    const weakness = Math.max(0, Math.min(100, Math.round((100 - readiness) * priorityWeight * difficultyFactor)));

    const reasons: WeaknessReason[] = [];
    if (qs.length === 0) reasons.push("uncovered");
    if (r.priority === "must") reasons.push("must_have");
    if (practiced.length === 0) reasons.push("never_practiced");
    else if (practiced.length / items.length < 0.5) reasons.push("insufficient_practice");
    if (avgConfidence !== null && avgConfidence < 3) reasons.push("low_confidence");
    if (avgDifficulty >= 2.5) reasons.push("high_difficulty");
    if (lastPracticedAt && now - Date.parse(lastPracticedAt) > 5 * DAY) reasons.push("stale");

    return {
      requirementId: r.id,
      text: r.text,
      topic: r.topic,
      kind: r.kind,
      priority: r.priority,
      readiness,
      weakness,
      avgConfidence: avgConfidence === null ? null : round1(avgConfidence),
      avgDifficulty: round1(avgDifficulty),
      itemsTotal: items.length,
      itemsPracticed: practiced.length,
      questionCount: qs.length,
      lastPracticedAt,
      reasons,
    };
  });

  const categories: CategoryReadiness[] = QUESTION_CATEGORIES.map((category) => {
    const qs = questions.filter((q) => q.category === category);
    const vals = qs.map((q) => {
      const s = args.stats.get(key("question", q.id));
      return 100 * (0.8 * mastery(itemConfidence(s)) + 0.2 * freshness(s, now));
    });
    return {
      category,
      readiness: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
      questionCount: qs.length,
      practiced: qs.filter((q) => (args.stats.get(key("question", q.id))?.attempts ?? 0) > 0).length,
    };
  }).filter((c) => c.questionCount > 0);

  let wSum = 0;
  let rSum = 0;
  for (const r of reqReports) {
    const w = r.priority === "must" ? 2 : 1;
    wSum += w;
    rSum += w * r.readiness;
  }
  const overall = wSum ? Math.round(rSum / wSum) : 0;

  const weakSpots = [...reqReports]
    .filter((r) => r.readiness < 70 && r.weakness >= 20)
    .sort((a, b) => b.weakness - a.weakness || a.requirementId.localeCompare(b.requirementId, undefined, { numeric: true }))
    .slice(0, 5);
  const strongAreas = [...reqReports].filter((r) => r.readiness >= 75).sort((a, b) => b.readiness - a.readiness).slice(0, 6);

  const allItems = [...questions.map((q) => key("question", q.id)), ...flashcards.map((f) => key("flashcard", f.id))];
  return {
    overall,
    categories,
    requirements: reqReports,
    weakSpots,
    strongAreas,
    practicedItems: allItems.filter((k) => (args.stats.get(k)?.attempts ?? 0) > 0).length,
    totalItems: allItems.length,
    computedAt: new Date(now).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Session prioritisation
// ---------------------------------------------------------------------------

/**
 * Item priority for the next practice session (deterministic):
 *   P = 0.40·(1 − mastery) + 0.20·[never practised] + 0.15·[linked to a MUST]
 *     + 0.15·difficultyNorm + 0.10·staleness
 * difficultyNorm = (difficulty − 1)/2 (flashcards: mean difficulty of questions on the same requirements)
 * staleness = min(1, daysSinceLastPractice / 7), unpractised = 1.
 * Ties break by type (questions first) then numeric id.
 */
export function prioritizeItems(args: {
  requirements: WorkspaceRequirement[];
  questions: WorkspaceQuestion[];
  flashcards: WorkspaceFlashcard[];
  stats: Map<string, PracticeItemStats>;
  now?: number;
}): SessionItem[] {
  const now = args.now ?? Date.now();
  const must = new Set(args.requirements.filter((r) => r.priority === "must").map((r) => r.id));
  const questions = args.questions.filter((q) => !q.meta.deleted);
  const reqDifficulty = new Map<string, number>();
  for (const r of args.requirements) {
    const qs = questions.filter((q) => q.requirement_ids.includes(r.id));
    reqDifficulty.set(r.id, qs.length ? qs.reduce((s, q) => s + q.difficulty, 0) / qs.length : 2);
  }
  const topicOf = new Map(args.requirements.map((r) => [r.id, r.topic]));

  const score = (type: "question" | "flashcard", id: string, reqIds: string[], difficulty: number, minutes: number): SessionItem => {
    const s = args.stats.get(`${type}:${id}`);
    const conf = itemConfidence(s);
    const never = !s || s.attempts === 0;
    const isMust = reqIds.some((r) => must.has(r));
    const diffNorm = (difficulty - 1) / 2;
    const staleness = never ? 1 : Math.min(1, (now - Date.parse(s!.lastPracticedAt!)) / (7 * DAY));
    const p = 0.4 * (1 - mastery(conf)) + 0.2 * (never ? 1 : 0) + 0.15 * (isMust ? 1 : 0) + 0.15 * diffNorm + 0.1 * staleness;
    const topic = reqIds.map((r) => topicOf.get(r)).filter(Boolean)[0] ?? "";
    let reason: string;
    if (never) reason = isMust ? `Not practised yet · must-have${topic ? ` (${topic})` : ""}` : `Not practised yet${topic ? ` · ${topic}` : ""}`;
    else if (conf !== null && conf < 3) reason = `Low confidence (${round1(conf)}/5)${topic ? ` · ${topic}` : ""}`;
    else if (staleness > 0.7) reason = `Not practised recently${topic ? ` · ${topic}` : ""}`;
    else reason = `Reinforce${topic ? ` · ${topic}` : ""}`;
    return { itemId: id, itemType: type, score: Math.round(p * 1000) / 1000, reason, requirement_ids: reqIds, estMinutes: minutes };
  };

  const items: SessionItem[] = [
    ...questions.map((q) => score("question", q.id, q.requirement_ids, q.difficulty, q.difficulty + 2)),
    ...args.flashcards
      .filter((f) => !f.meta.deleted)
      .map((f) => {
        const d = f.requirement_ids.length ? f.requirement_ids.reduce((s, r) => s + (reqDifficulty.get(r) ?? 2), 0) / f.requirement_ids.length : 2;
        return score("flashcard", f.id, f.requirement_ids, d, 1);
      }),
  ];
  const num = (id: string) => Number(id.replace(/\D/g, ""));
  return items.sort(
    (a, b) => b.score - a.score || (a.itemType === b.itemType ? 0 : a.itemType === "question" ? -1 : 1) || num(a.itemId) - num(b.itemId),
  );
}

/** Greedy pick within a time budget, keeping a mix of questions and flashcards. */
export function buildSessionItems(ranked: SessionItem[], minutes: number): SessionItem[] {
  const picked: SessionItem[] = [];
  let used = 0;
  for (const item of ranked) {
    if (used + item.estMinutes > minutes && picked.length >= 3) continue;
    picked.push(item);
    used += item.estMinutes;
    if (used >= minutes && picked.length >= 3) break;
  }
  return picked.slice(0, 20);
}
