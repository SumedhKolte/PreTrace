import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";

/**
 * Collections
 *  users              accounts (scrypt password hash)
 *  sessions           hashed session tokens, TTL-expired
 *  kits               private per-user kit workspace (canonical kit is derived from it)
 *  generation_jobs    generation / regeneration job progress
 *  research_cache     shared public research keyed by company URL (TTL)
 *  practice_sessions  practice + repair sessions
 *  practice_events    one row per confidence rating
 *
 * Kit sections are stored as Mixed: their shape is owned by the shared TypeScript
 * types and validated in code (Zod + semantic validation), and every mutation goes
 * through KitRepository.mutate() with optimistic concurrency on `rev`.
 */

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true },
);

const SessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String },
  },
  { timestamps: true },
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const KitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: ["draft", "generating", "ready", "partial", "failed"], default: "draft" },
    input: { jd: String, companyUrl: String, days: Number },
    inputHash: { type: String, index: true },
    source: { type: Schema.Types.Mixed, default: null },
    companyBrief: { type: Schema.Types.Mixed, default: null },
    briefRevisions: { type: [Schema.Types.Mixed], default: [] },
    role: { type: Schema.Types.Mixed, default: null },
    questions: { type: [Schema.Types.Mixed], default: [] },
    flashcards: { type: [Schema.Types.Mixed], default: [] },
    schedule: { type: Schema.Types.Mixed, default: null },
    coverage: { type: Schema.Types.Mixed, default: null },
    research: { type: Schema.Types.Mixed, default: null },
    generation: { type: Schema.Types.Mixed, default: { warnings: [] } },
    counters: { question: { type: Number, default: 0 }, flashcard: { type: Number, default: 0 }, generation: { type: Number, default: 0 } },
    error: { code: String, message: String },
    rev: { type: Number, default: 0 },
    lastPracticedAt: { type: Date },
  },
  { timestamps: true, minimize: false },
);
KitSchema.index({ userId: 1, inputHash: 1 });
KitSchema.index({ userId: 1, updatedAt: -1 });

const JobSchema = new Schema(
  {
    kitId: { type: Schema.Types.ObjectId, ref: "Kit", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["generate", "regenerate"], required: true },
    scope: { type: String },
    options: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["queued", "running", "completed", "partial", "failed"], default: "queued", index: true },
    progress: { type: Number, default: 0 },
    currentStage: { type: String },
    stages: { type: [Schema.Types.Mixed], default: [] },
    events: { type: [Schema.Types.Mixed], default: [] },
    error: { code: String, message: String },
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true, minimize: false },
);

const ResearchCacheSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
});
ResearchCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const PracticeSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    kitId: { type: Schema.Types.ObjectId, required: true, index: true },
    kind: { type: String, enum: ["practice", "repair"], required: true },
    items: { type: [Schema.Types.Mixed], default: [] },
    estMinutes: Number,
    targetRequirementId: String,
    before: { type: Number, default: null },
    beforeReadiness: { type: Number, default: null },
    after: { type: Number, default: null },
    followUp: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: ["active", "completed"], default: "active" },
    completedAt: Date,
  },
  { timestamps: true },
);

const PracticeEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    kitId: { type: Schema.Types.ObjectId, required: true },
    sessionId: { type: Schema.Types.ObjectId },
    itemId: { type: String, required: true },
    itemType: { type: String, enum: ["question", "flashcard"], required: true },
    confidence: { type: Number, min: 1, max: 5, required: true },
    mode: { type: String, enum: ["practice", "repair"], default: "practice" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
PracticeEventSchema.index({ kitId: 1, userId: 1, createdAt: 1 });

export const User = mongoose.model("User", UserSchema, "users");
export const Session = mongoose.model("Session", SessionSchema, "sessions");
export const Kit = mongoose.model("Kit", KitSchema, "kits");
export const GenerationJob = mongoose.model("GenerationJob", JobSchema, "generation_jobs");
export const ResearchCacheEntry = mongoose.model("ResearchCacheEntry", ResearchCacheSchema, "research_cache");
export const PracticeSession = mongoose.model("PracticeSession", PracticeSessionSchema, "practice_sessions");
export const PracticeEvent = mongoose.model("PracticeEvent", PracticeEventSchema, "practice_events");

export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export type KitDoc = InferSchemaType<typeof KitSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
export type JobDoc = InferSchemaType<typeof JobSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
