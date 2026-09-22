import { z } from "zod";

/**
 * Canonical kit schema — the contractual output shape (Appendix B `kit`).
 * Field names here MUST NOT be renamed. Extra optional fields are allowed
 * (e.g. `topic`, `hiring_process`) but every required field is present.
 */

export const REQUIREMENT_KINDS = ["technical", "behavioural", "domain"] as const;
export const PRIORITIES = ["must", "nice"] as const;
export const QUESTION_CATEGORIES = ["technical", "behavioural", "system_design", "company_fit"] as const;

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<QuestionCategory, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  system_design: "System Design",
  company_fit: "Company Fit",
};

const idPattern = (prefix: string) => new RegExp(`^${prefix}[1-9][0-9]*$`);

export const RequirementSchema = z.object({
  id: z.string().regex(idPattern("r"), "requirement id must look like r1"),
  text: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
  priority: z.enum(PRIORITIES),
  topic: z.string().optional(),
});

export const QuestionSchema = z.object({
  id: z.string().regex(idPattern("q"), "question id must look like q1"),
  requirement_ids: z.array(z.string()).min(1),
  category: z.enum(QUESTION_CATEGORIES),
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
});

export const FlashcardSchema = z.object({
  id: z.string().regex(idPattern("f"), "flashcard id must look like f1"),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()).min(1),
});

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string().min(1),
  question_ids: z.array(z.string()),
  minutes: z.number().int().min(1),
});

export const HiringStageSchema = z.object({
  name: z.string(),
  description: z.string(),
  source_url: z.string(),
});

export const CanonicalKitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().min(0),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
    hiring_process: z
      .object({
        found: z.boolean(),
        summary: z.string(),
        stages: z.array(HiringStageSchema),
      })
      .optional(),
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(RequirementSchema),
  }),
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: z.object({
    days_available: z.number().int().min(1),
    days: z.array(ScheduleDaySchema),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int().min(0),
  }),
});

export type Requirement = z.infer<typeof RequirementSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Flashcard = z.infer<typeof FlashcardSchema>;
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;
export type HiringStage = z.infer<typeof HiringStageSchema>;
export type CanonicalKit = z.infer<typeof CanonicalKitSchema>;
export type Difficulty = 1 | 2 | 3;

/** Appendix B batch output. */
export const BatchErrorSchema = z.object({ code: z.string(), message: z.string() });
export const BatchKitEntrySchema = z.discriminatedUnion("status", [
  z.object({ id: z.string(), status: z.literal("ok"), kit: CanonicalKitSchema, error: z.null() }),
  z.object({ id: z.string(), status: z.literal("failed"), kit: z.null(), error: BatchErrorSchema }),
]);
export const BatchOutputSchema = z.object({
  version: z.literal("1.0"),
  generated_at: z.string(),
  kits: z.array(BatchKitEntrySchema),
});
export type BatchOutput = z.infer<typeof BatchOutputSchema>;
export type BatchKitEntry = z.infer<typeof BatchKitEntrySchema>;

export const BatchCaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int(),
});
export type BatchCase = z.infer<typeof BatchCaseSchema>;
