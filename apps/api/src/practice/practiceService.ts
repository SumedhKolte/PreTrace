import { Types } from "mongoose";
import { z } from "zod";
import type { PracticeItemStats, PracticeSessionDTO, ReadinessReport, SessionItem } from "@preptrace/shared";
import { Kit, PracticeEvent, PracticeSession } from "../db/models";
import { findOwnedKit, toObjectId, type KitRecord } from "../kits/repository";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import type { LlmClient } from "../llm/client";
import { system, trusted, untrusted } from "../llm/prompt";
import { critiqueAnswer } from "./critique";
import { buildSessionItems, computeReadiness, itemConfidence, prioritizeItems } from "./weakness";

type EventRow = { itemId: string; itemType: "question" | "flashcard"; confidence: number; createdAt: Date; kitId: Types.ObjectId };

export function foldStats(events: EventRow[]): Map<string, PracticeItemStats> {
  const map = new Map<string, PracticeItemStats & { sum: number }>();
  for (const e of [...events].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))) {
    const key = `${e.itemType}:${e.itemId}`;
    const s = map.get(key) ?? { itemId: e.itemId, itemType: e.itemType, attempts: 0, lastConfidence: null, avgConfidence: null, lastPracticedAt: null, sum: 0 };
    s.attempts += 1;
    s.sum += e.confidence;
    s.lastConfidence = e.confidence;
    s.avgConfidence = s.sum / s.attempts;
    s.lastPracticedAt = new Date(e.createdAt).toISOString();
    map.set(key, s);
  }
  return map;
}

export async function loadStats(kitId: Types.ObjectId, userId: Types.ObjectId) {
  const events = await PracticeEvent.find({ kitId, userId }).sort({ createdAt: 1 }).lean<EventRow[]>();
  return foldStats(events);
}

export function readinessFor(kit: KitRecord, stats: Map<string, PracticeItemStats>): ReadinessReport {
  return computeReadiness({ requirements: kit.role?.requirements ?? [], questions: kit.questions, flashcards: kit.flashcards, stats });
}

/** Readiness for many kits with one events query (dashboard). */
export async function readinessForKits(kits: KitRecord[], userId: Types.ObjectId): Promise<Map<string, ReadinessReport>> {
  const ids = kits.map((k) => k._id);
  const events = await PracticeEvent.find({ userId, kitId: { $in: ids } }).lean<EventRow[]>();
  const byKit = new Map<string, EventRow[]>();
  for (const e of events) byKit.set(e.kitId.toString(), [...(byKit.get(e.kitId.toString()) ?? []), e]);
  const out = new Map<string, ReadinessReport>();
  for (const k of kits) if (k.role) out.set(k._id.toString(), readinessFor(k, foldStats(byKit.get(k._id.toString()) ?? [])));
  return out;
}

function toSessionDTO(s: {
  _id: Types.ObjectId;
  kind: string;
  items: unknown[];
  estMinutes?: number | null;
  targetRequirementId?: string | null;
  before?: number | null;
  after?: number | null;
  followUp?: unknown;
  status: string;
  createdAt: Date;
  completedAt?: Date | null;
}): PracticeSessionDTO {
  return {
    id: s._id.toString(),
    kind: s.kind as PracticeSessionDTO["kind"],
    items: s.items as SessionItem[],
    estMinutes: s.estMinutes ?? 0,
    targetRequirementId: s.targetRequirementId ?? undefined,
    before: s.before ?? null,
    after: s.after ?? null,
    followUp: (s.followUp as PracticeSessionDTO["followUp"]) ?? null,
    status: s.status as PracticeSessionDTO["status"],
    createdAt: new Date(s.createdAt).toISOString(),
    completedAt: s.completedAt ? new Date(s.completedAt).toISOString() : undefined,
  };
}

export class PracticeService {
  constructor(private readonly llm: LlmClient) {}

  async readiness(kitId: string, userId: string) {
    const kit = await findOwnedKit(kitId, userId);
    const stats = await loadStats(kit._id, kit.userId);
    return { kit, stats, report: readinessFor(kit, stats) };
  }

  async recommended(kitId: string, userId: string, minutes: number, filter: "recommended" | "weak" | "unseen" | "all") {
    const { kit, stats } = await this.readiness(kitId, userId);
    let ranked = prioritizeItems({ requirements: kit.role?.requirements ?? [], questions: kit.questions, flashcards: kit.flashcards, stats });
    if (filter === "unseen") ranked = ranked.filter((i) => !stats.has(`${i.itemType}:${i.itemId}`));
    if (filter === "weak") ranked = ranked.filter((i) => {
      const c = itemConfidence(stats.get(`${i.itemType}:${i.itemId}`));
      return c !== null && c < 3;
    });
    const items = filter === "all" ? ranked : buildSessionItems(ranked, minutes);
    return { kit, stats, items };
  }

  async startSession(kitId: string, userId: string, minutes: number, filter: "recommended" | "weak" | "unseen" | "all") {
    const { kit, items } = await this.recommended(kitId, userId, minutes, filter);
    if (items.length === 0) throw new AppError("INVALID_INPUT", filter === "weak" ? "No weak items yet — practise a few cards first." : "Nothing to practise in this kit yet.");
    const s = await PracticeSession.create({
      userId: kit.userId,
      kitId: kit._id,
      kind: "practice",
      items,
      estMinutes: items.reduce((a, i) => a + i.estMinutes, 0),
    });
    return toSessionDTO(s.toObject());
  }

  async recordEvent(kitId: string, userId: string, e: { sessionId?: string; itemId: string; itemType: "question" | "flashcard"; confidence: number }) {
    const kit = await findOwnedKit(kitId, userId);
    const exists =
      e.itemType === "question"
        ? kit.questions.some((q) => q.id === e.itemId && !q.meta.deleted)
        : kit.flashcards.some((f) => f.id === e.itemId && !f.meta.deleted);
    if (!exists) throw new AppError("NOT_FOUND", "Practice item not found in this kit.");
    let sessionId: Types.ObjectId | undefined;
    let mode: "practice" | "repair" = "practice";
    if (e.sessionId) {
      const s = await PracticeSession.findOne({ _id: toObjectId(e.sessionId), kitId: kit._id, userId: kit.userId }).lean();
      if (!s) throw new AppError("NOT_FOUND", "Practice session not found.");
      sessionId = s._id;
      mode = s.kind as "practice" | "repair";
    }
    await PracticeEvent.create({ userId: kit.userId, kitId: kit._id, sessionId, itemId: e.itemId, itemType: e.itemType, confidence: e.confidence, mode });
    // lastPracticedAt is activity metadata, not kit content: written directly, outside rev.
    await Kit.updateOne({ _id: kit._id }, { $set: { lastPracticedAt: new Date() } }, { timestamps: false });
    const stats = await loadStats(kit._id, kit.userId);
    return { readiness: readinessFor(kit, stats), stats: stats.get(`${e.itemType}:${e.itemId}`) };
  }

  async completeSession(kitId: string, userId: string, sessionId: string) {
    const kit = await findOwnedKit(kitId, userId);
    const s = await PracticeSession.findOneAndUpdate(
      { _id: toObjectId(sessionId), kitId: kit._id, userId: kit.userId },
      { $set: { status: "completed", completedAt: new Date() } },
      { returnDocument: "after" },
    ).lean();
    if (!s) throw new AppError("NOT_FOUND", "Practice session not found.");
    return toSessionDTO(s);
  }

  async history(kitId: string, userId: string) {
    const kit = await findOwnedKit(kitId, userId);
    const sessions = await PracticeSession.find({ kitId: kit._id, userId: kit.userId }).sort({ createdAt: -1 }).limit(20).lean();
    const events = await PracticeEvent.find({ kitId: kit._id, userId: kit.userId }).sort({ createdAt: -1 }).limit(100).lean();
    return {
      sessions: sessions.map(toSessionDTO),
      events: events.map((e) => ({ itemId: e.itemId, itemType: e.itemType, confidence: e.confidence, mode: e.mode, at: new Date(e.createdAt as Date).toISOString() })),
    };
  }

  // ---- Answer critique (advisory) ---------------------------------------------

  async critique(
    kitId: string,
    userId: string,
    req:
      | { itemType: "question"; itemId: string; answer: string }
      | { itemType: "followup"; prompt: string; answer_outline: string; requirementIds: string[]; answer: string },
  ) {
    const kit = await findOwnedKit(kitId, userId);
    if (!kit.role || !kit.companyBrief) throw new AppError("INVALID_INPUT", "This kit has not finished generating yet.");
    if (!this.llm.available) throw new AppError("LLM_NOT_CONFIGURED", "Answer critique needs an AI provider. Set LLM_API_KEY.");
    let question: string;
    let outline: string;
    let reqIds: string[];
    if (req.itemType === "question") {
      const q = kit.questions.find((x) => x.id === req.itemId && !x.meta.deleted);
      if (!q) throw new AppError("NOT_FOUND", "Question not found in this kit.");
      [question, outline, reqIds] = [q.prompt, q.answer_outline, q.requirement_ids];
    } else {
      [question, outline, reqIds] = [req.prompt, req.answer_outline, req.requirementIds];
    }
    return critiqueAnswer(this.llm.scope(), {
      question,
      outline,
      answer: req.answer,
      requirements: kit.role.requirements.filter((r) => reqIds.includes(r.id)),
      seniority: kit.role.seniority,
      companyName: kit.source?.company ?? "",
      techStack: kit.research?.techStack ?? [],
      hiring: kit.companyBrief.hiring_process,
    });
  }

  // ---- Repair sessions (Weak-Spot Coach) ------------------------------------

  /**
   * Targeted repair for one requirement:
   *   1. concept flashcard (lowest-confidence card on the requirement)
   *   2. interview question (weakest, hardest question on the requirement)
   *   3. follow-up question (LLM-generated probe; falls back to another linked question)
   *   4. confidence reassessment → before/after comparison
   */
  async startRepair(kitId: string, userId: string, requirementId: string) {
    const { kit, stats, report } = await this.readiness(kitId, userId);
    const req = kit.role?.requirements.find((r) => r.id === requirementId);
    if (!req) throw new AppError("NOT_FOUND", "Requirement not found.");
    const rr = report.requirements.find((r) => r.requirementId === requirementId)!;
    const conf = (type: string, id: string) => itemConfidence(stats.get(`${type}:${id}`)) ?? 0;

    const cards = kit.flashcards.filter((f) => !f.meta.deleted && f.requirement_ids.includes(requirementId)).sort((a, b) => conf("flashcard", a.id) - conf("flashcard", b.id));
    const questions = kit.questions
      .filter((q) => !q.meta.deleted && q.requirement_ids.includes(requirementId))
      .sort((a, b) => conf("question", a.id) - conf("question", b.id) || b.difficulty - a.difficulty);
    if (cards.length === 0 && questions.length === 0) throw new AppError("INVALID_INPUT", "This requirement has no questions or flashcards to practise yet.");

    const items: SessionItem[] = [];
    if (cards[0]) items.push({ itemId: cards[0].id, itemType: "flashcard", score: 1, reason: "Concept refresher", requirement_ids: cards[0].requirement_ids, estMinutes: 1 });
    if (questions[0]) items.push({ itemId: questions[0].id, itemType: "question", score: 1, reason: "Interview question", requirement_ids: questions[0].requirement_ids, estMinutes: questions[0].difficulty + 2 });

    let followUp: PracticeSessionDTO["followUp"] = null;
    const base = questions[0];
    if (base && this.llm.available) {
      try {
        const out = await this.llm.scope().json({
          task: "repair_follow_up",
          system: system(
            "You are an interviewer probing deeper after a candidate's answer.",
            "Write ONE follow-up question an interviewer would ask next to test deeper understanding of the requirement, plus a short answer outline (3-5 lines starting with \"- \"). Stay within the requirement; do not invent company facts.",
            `{"prompt": string, "answer_outline": string}`,
          ),
          user: [trusted("requirement", `${req.id}: ${req.topic}`), untrusted("requirement_text", req.text, 500), untrusted("original_question", base.prompt, 1000)].join("\n\n"),
          schema: z.object({ prompt: z.string().min(5), answer_outline: z.union([z.string(), z.array(z.string())]) }),
          maxTokens: 800,
          temperature: 0.5,
        });
        followUp = {
          prompt: out.prompt.trim(),
          answer_outline: Array.isArray(out.answer_outline) ? out.answer_outline.map((l) => `- ${l.replace(/^[-*]\s*/, "")}`).join("\n") : out.answer_outline,
          source: "llm",
        };
      } catch (e) {
        logger.warn("repair follow-up generation failed", { err: String(e) });
      }
    }
    if (!followUp && questions[1]) followUp = { prompt: questions[1].prompt, answer_outline: questions[1].answer_outline, source: "question" };

    const s = await PracticeSession.create({
      userId: kit.userId,
      kitId: kit._id,
      kind: "repair",
      items,
      estMinutes: items.reduce((a, i) => a + i.estMinutes, 0) + (followUp ? 3 : 0),
      targetRequirementId: requirementId,
      before: rr.avgConfidence,
      beforeReadiness: rr.readiness,
      followUp,
    });
    return { session: toSessionDTO(s.toObject()), requirement: rr };
  }

  async completeRepair(kitId: string, userId: string, sessionId: string, confidence: number) {
    const kit = await findOwnedKit(kitId, userId);
    const s = await PracticeSession.findOne({ _id: toObjectId(sessionId), kitId: kit._id, userId: kit.userId, kind: "repair" });
    if (!s) throw new AppError("NOT_FOUND", "Repair session not found.");
    s.after = confidence;
    s.status = "completed";
    s.completedAt = new Date();
    await s.save();
    const stats = await loadStats(kit._id, kit.userId);
    const report = readinessFor(kit, stats);
    const rr = report.requirements.find((r) => r.requirementId === s.targetRequirementId);
    return {
      session: toSessionDTO(s.toObject()),
      before: { confidence: s.before ?? null, readiness: s.beforeReadiness ?? 0 },
      after: { confidence, readiness: rr?.readiness ?? 0, avgConfidence: rr?.avgConfidence ?? null },
      requirement: rr,
      readiness: report,
    };
  }
}

export { toObjectId };
