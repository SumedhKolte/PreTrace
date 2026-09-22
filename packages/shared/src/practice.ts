import type { Priority, QuestionCategory, RequirementKind } from "./kit";

export type PracticeItemType = "question" | "flashcard";

export interface PracticeItemStats {
  itemId: string;
  itemType: PracticeItemType;
  attempts: number;
  lastConfidence: number | null;
  avgConfidence: number | null;
  lastPracticedAt: string | null;
}

export type WeaknessReason =
  | "must_have"
  | "low_confidence"
  | "high_difficulty"
  | "never_practiced"
  | "insufficient_practice"
  | "stale"
  | "uncovered";

export interface RequirementReadiness {
  requirementId: string;
  text: string;
  topic: string;
  kind: RequirementKind;
  priority: Priority;
  /** 0–100: how prepared the candidate is on this requirement. */
  readiness: number;
  /** 0–100: repair priority (readiness gap scaled by priority and difficulty). */
  weakness: number;
  avgConfidence: number | null;
  avgDifficulty: number;
  itemsTotal: number;
  itemsPracticed: number;
  questionCount: number;
  lastPracticedAt: string | null;
  reasons: WeaknessReason[];
}

export interface CategoryReadiness {
  category: QuestionCategory;
  readiness: number;
  questionCount: number;
  practiced: number;
}

export interface ReadinessReport {
  overall: number;
  categories: CategoryReadiness[];
  requirements: RequirementReadiness[];
  weakSpots: RequirementReadiness[];
  strongAreas: RequirementReadiness[];
  practicedItems: number;
  totalItems: number;
  computedAt: string;
}

export interface SessionItem {
  itemId: string;
  itemType: PracticeItemType;
  score: number;
  reason: string;
  requirement_ids: string[];
  estMinutes: number;
}

export interface PracticeSessionDTO {
  id: string;
  kind: "practice" | "repair";
  items: SessionItem[];
  estMinutes: number;
  targetRequirementId?: string;
  before?: number | null;
  after?: number | null;
  followUp?: { prompt: string; answer_outline: string; source: "llm" | "question" } | null;
  status: "active" | "completed";
  createdAt: string;
  completedAt?: string;
}

export const CONFIDENCE_LABELS: Record<number, string> = {
  1: "Not confident",
  2: "Slightly confident",
  3: "Moderate",
  4: "Confident",
  5: "Very confident",
};
