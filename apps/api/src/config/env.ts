import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

/**
 * Centralised, validated configuration. Every tunable lives here so behaviour
 * is explicit and documented in .env.example. Secrets are never logged.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");

let loaded = false;
function loadDotenv() {
  if (loaded) return;
  loaded = true;
  // Later files do not override earlier ones: process env > cwd .env > apps/api/.env > repo root .env
  for (const p of [resolve(process.cwd(), ".env"), resolve(here, "../../.env"), resolve(repoRoot, ".env")]) {
    if (existsSync(p)) dotenv.config({ path: p, quiet: true });
  }
}

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())));
const int = (d: number) => z.coerce.number().int().default(d);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: int(4000),
  MONGODB_URI: z.string().optional(),
  SESSION_SECRET: z.string().default("dev-only-insecure-session-secret-change-me"),
  SESSION_TTL_HOURS: int(24 * 7),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  BACKEND_URL: z.string().default("http://localhost:4000"),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  TRUST_PROXY: bool.default(false),

  LLM_PROVIDER: z.enum(["gemini", "groq", "openrouter", "openai", "custom"]).default("gemini"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  LLM_REASONING_EFFORT: z.string().optional(),
  LLM_TEMPERATURE: z.coerce.number().default(0.3),
  LLM_MAX_TOKENS: int(8192),
  MAX_LLM_CONCURRENCY: int(2),
  LLM_MAX_RPM: int(10),
  LLM_MAX_RETRIES: int(5),
  LLM_TIMEOUT_MS: int(120_000),

  SEARCH_PROVIDER: z.enum(["auto", "duckduckgo", "tavily", "brave", "none"]).default("auto"),
  TAVILY_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  SEARCH_MAX_RESULTS: int(6),

  MAX_CRAWL_PAGES: int(10),
  MAX_CRAWL_DEPTH: int(2),
  CRAWL_CONCURRENCY: int(2),
  CRAWL_HOST_DELAY_MS: int(250),
  REQUEST_TIMEOUT_MS: int(10_000),
  FETCH_MAX_BYTES: int(2_000_000),
  FETCH_MAX_RETRIES: int(3),
  ALLOW_PRIVATE_URLS: bool.default(false),
  RESEARCH_CACHE_TTL_HOURS: int(24),

  GENERATION_CONCURRENCY: int(2),
  EVAL_CASE_CONCURRENCY: int(2),
  EVAL_CASE_TIMEOUT_MS: int(8 * 60_000),
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  loadDotenv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production") {
    if (!cfg.MONGODB_URI) throw new Error("MONGODB_URI is required in production");
    if (cfg.SESSION_SECRET.startsWith("dev-only") || cfg.SESSION_SECRET.length < 32) {
      throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters in production");
    }
  }
  cached = cfg;
  return cfg;
}

/** Test helper: override config values. */
export function setConfigForTests(overrides: Partial<AppConfig>) {
  cached = { ...getConfig(), ...overrides };
}
