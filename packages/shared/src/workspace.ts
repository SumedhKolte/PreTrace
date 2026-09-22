import type { Difficulty, Priority, QuestionCategory, RequirementKind } from "./kit";

/**
 * Workspace model — the editable, application-side representation of a kit.
 * The canonical (evaluator) kit is *derived* from this by stripping metadata
 * and tombstones, so the contractual schema stays clean.
 */

export type ItemOrigin = "generated" | "manual";

/** Per-entity state that protects user work across regenerations. */
export interface ItemMeta {
  origin: ItemOrigin;
  /** User changed content (prompt/outline/difficulty/category/requirements). */
  edited: boolean;
  /** User explicitly protected this item. */
  pinned: boolean;
  /** Tombstone: hidden everywhere, ID never reused, content used as an "avoid" hint. */
  deleted: boolean;
  version: number;
  /** Which generation run created this item (0 = initial generation). */
  generation: number;
  /** How it was produced: llm, gap-fill pass, or deterministic fallback template. */
  producer?: "llm" | "gap_fill" | "fallback_template" | "user";
  createdAt: string;
  updatedAt: string;
}

/** Display state derived from meta. Deleted > pinned > manual > edited > generated. */
export type ItemState = "generated" | "edited" | "pinned" | "manual" | "deleted";

export function itemState(meta: ItemMeta): ItemState {
  if (meta.deleted) return "deleted";
  if (meta.pinned) return "pinned";
  if (meta.origin === "manual") return "manual";
  if (meta.edited) return "edited";
  return "generated";
}

/** An item is protected from regeneration if the user has touched it in any way. */
export function isProtected(meta: ItemMeta): boolean {
  return meta.origin === "manual" || meta.edited || meta.pinned || meta.deleted;
}

export type SourceType = "official" | "hiring" | "engineering" | "about" | "public_discussion";
export type SourceStatus = "ok" | "failed" | "skipped" | "blocked";

export interface ResearchSource {
  url: string;
  title: string;
  type: SourceType;
  status: SourceStatus;
  /** confirmed = company's own domain; inferred = name match on a third-party site. */
  relevance: "confirmed" | "inferred";
  used_for: string[];
  note?: string;
  flags?: string[];
}

/** A grounded research signal the LLM can cite by id (S1, S2…) but never invent. */
export interface ResearchSignal {
  id: string;
  kind: "company" | "hiring" | "public";
  text: string;
  quote?: string;
  source_url: string;
}

export interface EvidenceSignal {
  kind: "company" | "hiring" | "public";
  text: string;
  source_url: string;
}

export interface QuestionEvidence {
  rationale: string;
  jd_signal?: string;
  signals: EvidenceSignal[];
}

export interface WorkspaceRequirement {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: Priority;
  topic: string;
  /** Verbatim-supported quote from the JD. */
  evidence: string;
}

export interface WorkspaceQuestion {
  id: string;
  requirement_ids: string[];
  category: QuestionCategory;
  prompt: string;
  answer_outline: string;
  difficulty: Difficulty;
  order: number;
  evidence: QuestionEvidence;
  meta: ItemMeta;
}

export interface WorkspaceFlashcard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
  order: number;
  meta: ItemMeta;
}

export interface WorkspaceScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
  kind: "learn" | "review" | "mock";
  /** A user-edited day is locked: schedule regeneration keeps it verbatim. */
  locked: boolean;
}

export interface WorkspaceSchedule {
  days_available: number;
  days: WorkspaceScheduleDay[];
  generatedAt: string;
  /** Questions changed since the schedule was built; the user can rebuild (locked days are kept). */
  stale?: boolean;
}

export interface HiringProcess {
  found: boolean;
  summary: string;
  stages: { name: string; description: string; source_url: string }[];
  expectations: string[];
}

export interface CompanyBrief {
  summary: string;
  what_they_do: string;
  sources: string[];
  hiring_process: HiringProcess;
  public_signals: { text: string; source_url: string }[];
  limitations: string[];
  edited: boolean;
  version: number;
  updatedAt: string;
}

export interface CoverageLogEntry {
  pass: number;
  uncovered: string[];
  action: string;
}

export interface KitCoverage {
  uncovered_requirement_ids: string[];
  passes: number;
  log: CoverageLogEntry[];
}

export type KitStatus = "draft" | "generating" | "ready" | "partial" | "failed";

export interface KitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export interface KitSourceInfo {
  company: string;
  company_url: string;
  role: string;
  location: string;
  jd_chars: number;
  researched_at: string;
  pages_used: string[];
}

export interface KitRole {
  title: string;
  seniority: string;
  location: string;
  responsibilities: string[];
  requirements: WorkspaceRequirement[];
}

export interface KitWorkspace {
  id: string;
  status: KitStatus;
  input: KitInput;
  source: KitSourceInfo;
  companyBrief: CompanyBrief;
  role: KitRole;
  questions: WorkspaceQuestion[];
  flashcards: WorkspaceFlashcard[];
  schedule: WorkspaceSchedule;
  coverage: KitCoverage;
  research: {
    sources: ResearchSource[];
    signals: ResearchSignal[];
    limitations: string[];
  };
  generation: {
    jobId?: string;
    provider?: string;
    model?: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    llmCalls?: number;
    warnings: string[];
    systemDesignJustification?: string;
  };
  briefRevisions: BriefRevision[];
  error?: { code: string; message: string };
  rev: number;
  createdAt: string;
  updatedAt: string;
  lastPracticedAt?: string;
}

/** Previous company-brief versions, kept so regeneration is never destructive. */
export interface BriefRevision {
  summary: string;
  what_they_do: string;
  savedAt: string;
  reason: "regenerated" | "edited";
}

export interface KitSummary {
  id: string;
  status: KitStatus;
  company: string;
  role: string;
  companyUrl: string;
  days: number;
  interviewDate?: string;
  readiness: number;
  weakSpotCount: number;
  questionCount: number;
  flashcardCount: number;
  lastPracticedAt?: string;
  createdAt: string;
  updatedAt: string;
  job?: { status: JobStatus; progress: number; currentStage?: string };
}

export type JobStatus = "queued" | "running" | "completed" | "partial" | "failed";
