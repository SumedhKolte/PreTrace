import type { JobStatus } from "./workspace";

/** Ordered pipeline stages. Shared so the UI timeline mirrors the backend exactly. */
export const PIPELINE_STAGES = [
  { key: "read_jd", label: "Reading job description" },
  { key: "extract_requirements", label: "Extracting requirements" },
  { key: "discover_pages", label: "Discovering company pages" },
  { key: "extract_pages", label: "Extracting company facts" },
  { key: "hiring_process", label: "Researching hiring process" },
  { key: "public_research", label: "Searching interview experiences" },
  { key: "company_brief", label: "Writing company brief" },
  { key: "generate_questions", label: "Generating questions" },
  { key: "check_coverage", label: "Checking coverage" },
  { key: "fill_gaps", label: "Filling gaps" },
  { key: "flashcards", label: "Creating flashcards" },
  { key: "schedule", label: "Building study schedule" },
  { key: "validate", label: "Validating kit" },
] as const;

export type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];
export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface StageState {
  key: string;
  label: string;
  status: StageStatus;
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface JobEvent {
  at: string;
  stage: string;
  message: string;
  level: "info" | "warn" | "error";
}

export type JobType = "generate" | "regenerate";
export type RegenerateScope =
  | "company"
  | "technical"
  | "behavioural"
  | "system_design"
  | "company_fit"
  | "flashcards"
  | "schedule";

export interface GenerationStatus {
  jobId: string;
  kitId: string;
  type: JobType;
  scope?: RegenerateScope;
  status: JobStatus;
  progress: number;
  currentStage?: string;
  stages: StageState[];
  events: JobEvent[];
  error?: { code: string; message: string };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export const REGENERATE_STAGES: Record<RegenerateScope, { key: string; label: string }[]> = {
  company: [
    { key: "discover_pages", label: "Re-researching company site" },
    { key: "hiring_process", label: "Checking hiring process" },
    { key: "company_brief", label: "Writing company brief" },
  ],
  technical: categoryStages("technical"),
  behavioural: categoryStages("behavioural"),
  system_design: categoryStages("system design"),
  company_fit: categoryStages("company-fit"),
  flashcards: [{ key: "flashcards", label: "Regenerating flashcards" }],
  schedule: [{ key: "schedule", label: "Rebuilding study schedule" }],
};

function categoryStages(name: string) {
  return [
    { key: "generate_questions", label: `Generating ${name} questions` },
    { key: "merge", label: "Merging with your edits" },
    { key: "check_coverage", label: "Re-checking coverage" },
    { key: "schedule", label: "Updating schedule" },
  ];
}
