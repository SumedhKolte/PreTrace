import { Types } from "mongoose";
import type {
  BriefRevision,
  CompanyBrief,
  KitCoverage,
  KitInput,
  KitRole,
  KitSourceInfo,
  KitStatus,
  KitWorkspace,
  WorkspaceFlashcard,
  WorkspaceQuestion,
  WorkspaceSchedule,
} from "@preptrace/shared";
import { Kit } from "../db/models";
import { AppError } from "../lib/errors";

/** Typed view of a stored kit document. */
export interface KitRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: KitStatus;
  input: KitInput;
  inputHash: string;
  source: KitSourceInfo | null;
  companyBrief: CompanyBrief | null;
  briefRevisions: BriefRevision[];
  role: KitRole | null;
  questions: WorkspaceQuestion[];
  flashcards: WorkspaceFlashcard[];
  schedule: WorkspaceSchedule | null;
  coverage: KitCoverage | null;
  research: KitWorkspace["research"] | null;
  generation: KitWorkspace["generation"];
  counters: { question: number; flashcard: number; generation: number };
  error?: { code?: string | null; message?: string | null } | null;
  rev: number;
  lastPracticedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Sections a mutation may change. Identity/ownership/timestamps are never written by mutate(). */
const MUTABLE: (keyof KitRecord)[] = [
  "status", "input", "source", "companyBrief", "briefRevisions", "role", "questions", "flashcards",
  "schedule", "coverage", "research", "generation", "counters", "error",
];

export function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new AppError("NOT_FOUND", "Kit not found.");
  return new Types.ObjectId(id);
}

/**
 * Ownership-scoped lookup. Every kit query includes userId from the session,
 * and another user's kit is indistinguishable from a missing one (404, not 403).
 */
export async function findOwnedKit(kitId: string, userId: string): Promise<KitRecord> {
  const doc = await Kit.findOne({ _id: toObjectId(kitId), userId: toObjectId(userId) }).lean<KitRecord>();
  if (!doc) throw new AppError("NOT_FOUND", "Kit not found.");
  return doc;
}

/**
 * Optimistic-concurrency mutation: read → apply pure fn to a copy → conditional write on `rev`.
 * On a concurrent write the whole mutation is recomputed against fresh data, so a slow
 * regeneration can never overwrite an edit the user made while it was running.
 */
export async function mutateKit<T>(kitId: string, userId: string, fn: (kit: KitRecord) => T | Promise<T>, maxAttempts = 6): Promise<{ result: T; kit: KitRecord }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const current = await findOwnedKit(kitId, userId);
    const draft = structuredClone(current);
    const result = await fn(draft);
    const $set: Record<string, unknown> = {};
    for (const k of MUTABLE) $set[k] = draft[k];
    const res = await Kit.updateOne({ _id: current._id, userId: current.userId, rev: current.rev }, { $set, $inc: { rev: 1 } });
    if (res.matchedCount === 1) {
      draft.rev = current.rev + 1;
      return { result, kit: draft };
    }
  }
  throw new AppError("VERSION_CONFLICT", "The kit changed while saving. Please retry.");
}

const EMPTY_BRIEF: CompanyBrief = {
  summary: "",
  what_they_do: "",
  sources: [],
  hiring_process: { found: false, summary: "", stages: [], expectations: [] },
  public_signals: [],
  limitations: [],
  edited: false,
  version: 0,
  updatedAt: "",
};

/** API representation. Kits still generating get empty-but-typed sections. */
export function toWorkspace(k: KitRecord): KitWorkspace {
  return {
    id: k._id.toString(),
    status: k.status,
    input: k.input,
    source: k.source ?? {
      company: "",
      company_url: k.input.companyUrl,
      role: "",
      location: "",
      jd_chars: k.input.jd.length,
      researched_at: "",
      pages_used: [],
    },
    companyBrief: k.companyBrief ?? EMPTY_BRIEF,
    role: k.role ?? { title: "", seniority: "", location: "", responsibilities: [], requirements: [] },
    questions: k.questions ?? [],
    flashcards: k.flashcards ?? [],
    schedule: k.schedule ?? { days_available: k.input.days, days: [], generatedAt: "" },
    coverage: k.coverage ?? { uncovered_requirement_ids: [], passes: 0, log: [] },
    research: { sources: [], signals: [], limitations: [], ...k.research, techStack: k.research?.techStack ?? [] },
    generation: k.generation ?? { warnings: [] },
    briefRevisions: k.briefRevisions ?? [],
    error: k.error?.code ? { code: k.error.code, message: k.error.message ?? "" } : undefined,
    rev: k.rev,
    createdAt: new Date(k.createdAt).toISOString(),
    updatedAt: new Date(k.updatedAt).toISOString(),
    lastPracticedAt: k.lastPracticedAt ? new Date(k.lastPracticedAt).toISOString() : undefined,
  };
}
