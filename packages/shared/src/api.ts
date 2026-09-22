import { z } from "zod";
import { QUESTION_CATEGORIES } from "./kit";

/** Request DTOs shared by the API (validation) and the web app (typing). */

export const RegisterSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(200),
});

export const JD_MIN_CHARS = 20;
export const JD_MAX_CHARS = 30_000;
export const MAX_DAYS = 60;

export const CreateKitSchema = z.object({
  jd: z
    .string()
    .trim()
    .min(JD_MIN_CHARS, `Job description must be at least ${JD_MIN_CHARS} characters`)
    .max(JD_MAX_CHARS, `Job description must be under ${JD_MAX_CHARS} characters`),
  companyUrl: z.string().trim().min(1, "Company URL is required").max(2048),
  days: z.coerce.number().int().min(1, "At least 1 day").max(MAX_DAYS, `At most ${MAX_DAYS} days`),
  /** Create a new kit even if an identical one exists. */
  force: z.boolean().optional(),
});
export type CreateKitInput = z.infer<typeof CreateKitSchema>;

export const CreateBatchSchema = z.object({
  cases: z.array(CreateKitSchema.omit({ force: true })).min(1).max(10),
});

const difficulty = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const UpdateQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(2000).optional(),
    answer_outline: z.string().trim().min(1).max(8000).optional(),
    difficulty: difficulty.optional(),
    category: z.enum(QUESTION_CATEGORIES).optional(),
    requirement_ids: z.array(z.string()).min(1).optional(),
    pinned: z.boolean().optional(),
    baseVersion: z.number().int().optional(),
  })
  .strict();

export const CreateQuestionSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  answer_outline: z.string().trim().max(8000).default(""),
  difficulty: difficulty.default(2),
  category: z.enum(QUESTION_CATEGORIES),
  requirement_ids: z.array(z.string()).min(1, "Link at least one requirement"),
});

export const ReorderSchema = z.object({ ids: z.array(z.string()).min(1) });

export const UpdateFlashcardSchema = z
  .object({
    front: z.string().trim().min(1).max(1000).optional(),
    back: z.string().trim().min(1).max(4000).optional(),
    requirement_ids: z.array(z.string()).min(1).optional(),
    pinned: z.boolean().optional(),
    baseVersion: z.number().int().optional(),
  })
  .strict();

export const CreateFlashcardSchema = z.object({
  front: z.string().trim().min(1).max(1000),
  back: z.string().trim().min(1).max(4000),
  requirement_ids: z.array(z.string()).min(1, "Link at least one requirement"),
});

export const UpdateBriefSchema = z
  .object({
    summary: z.string().trim().max(6000).optional(),
    what_they_do: z.string().trim().max(6000).optional(),
  })
  .strict();

export const UpdateScheduleDaySchema = z
  .object({
    focus: z.string().trim().min(1).max(200).optional(),
    minutes: z.number().int().min(5).max(600).optional(),
    question_ids: z.array(z.string()).optional(),
    locked: z.boolean().optional(),
  })
  .strict();

export const RegenerateSchema = z.object({
  scope: z.enum(["company", "technical", "behavioural", "system_design", "company_fit", "flashcards", "schedule"]),
  /** For schedule: discard locked (user-edited) days too. Requires explicit confirmation in UI. */
  replaceEdited: z.boolean().optional(),
});

export const PracticeEventSchema = z.object({
  sessionId: z.string().optional(),
  itemId: z.string().min(1),
  itemType: z.enum(["question", "flashcard"]),
  confidence: z.number().int().min(1).max(5),
});

export const StartPracticeSchema = z.object({
  minutes: z.number().int().min(5).max(120).default(15),
  filter: z.enum(["recommended", "weak", "unseen", "all"]).default("recommended"),
});

export const StartRepairSchema = z.object({ requirementId: z.string().min(1) });
export const CompleteRepairSchema = z.object({ confidence: z.number().int().min(1).max(5) });

export const UpdateKitSchema = z.object({
  days: z.number().int().min(1).max(MAX_DAYS),
});

export const CritiqueRequestSchema = z.discriminatedUnion("itemType", [
  z.object({ itemType: z.literal("question"), itemId: z.string().min(1), answer: z.string().trim().min(15, "Write or dictate a little more before asking for a critique").max(6000) }),
  z.object({
    itemType: z.literal("followup"),
    prompt: z.string().trim().min(5).max(1000),
    answer_outline: z.string().max(4000).default(""),
    requirementIds: z.array(z.string()).max(10).default([]),
    answer: z.string().trim().min(15, "Write or dictate a little more before asking for a critique").max(6000),
  }),
]);
