import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJson, LlmClient } from "../src/llm/client";
import { backoffDelay } from "../src/lib/async";
import { AppError } from "../src/lib/errors";
import { ScriptedLlm } from "./support/scriptedLlm";

const opts = { concurrency: 2, maxRpm: 0, retries: 4, maxTokens: 1000, temperature: 0, sleepFn: async () => {} };
const schema = z.object({ flashcards: z.array(z.object({ front: z.string(), back: z.string(), requirement_ids: z.array(z.string()) })) });
const task = {
  task: "flashcards",
  system: "sys",
  user: `<context label="requirements">\nr1 [MUST, technical] Node.js\n</context>`,
  schema,
};

describe("LLM client resilience", () => {
  it("parses JSON wrapped in fences/prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a": [1,2]} thanks')).toEqual({ a: [1, 2] });
    expect(() => extractJson("no json here")).toThrow();
  });

  it("repairs invalid JSON with one extra round-trip", async () => {
    const llm = new ScriptedLlm();
    llm.failNext("flashcards", "invalid_json");
    const client = new LlmClient(llm, opts);
    const out = await client.json(task);
    expect(out.flashcards[0].requirement_ids).toEqual(["r1"]);
    expect(client.stats.repairs).toBe(1);
    expect(llm.calls).toHaveLength(2);
  });

  it("repairs schema mismatches (incomplete response)", async () => {
    const llm = new ScriptedLlm();
    llm.failNext("flashcards", "schema_mismatch");
    const client = new LlmClient(llm, opts);
    await expect(client.json(task)).resolves.toBeTruthy();
  });

  it("fails with LLM_INVALID_RESPONSE when the repair is also invalid", async () => {
    const llm = new ScriptedLlm();
    llm.failNext("flashcards", "invalid_json", "invalid_json");
    const err = await new LlmClient(llm, opts).json(task).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("LLM_INVALID_RESPONSE");
  });

  it("retries rate limits (429) and succeeds", async () => {
    const llm = new ScriptedLlm();
    llm.failNext("flashcards", "rate_limit", "rate_limit");
    const client = new LlmClient(llm, opts);
    await client.json(task);
    expect(client.stats.retries).toBe(2);
  });

  it("gives up after max retries with LLM_RATE_LIMITED", async () => {
    const llm = new ScriptedLlm();
    llm.failNext("flashcards", "rate_limit", "rate_limit", "rate_limit", "rate_limit", "rate_limit", "rate_limit");
    const err = await new LlmClient(llm, opts).json(task).catch((e) => e);
    expect(err.code).toBe("LLM_RATE_LIMITED");
  });

  it("retries temporary provider outages", async () => {
    const llm = new ScriptedLlm();
    llm.failNext("flashcards", "unavailable");
    await expect(new LlmClient(llm, opts).json(task)).resolves.toBeTruthy();
  });

  it("never exceeds the configured concurrency", async () => {
    const llm = new ScriptedLlm();
    llm.latencyMs = 20;
    const client = new LlmClient(llm, { ...opts, concurrency: 2 });
    await Promise.all(Array.from({ length: 8 }, () => client.json(task)));
    expect(llm.maxActive).toBe(2);
    expect(llm.calls).toHaveLength(8);
  });

  it("spaces requests to respect an RPM budget", async () => {
    const llm = new ScriptedLlm();
    const client = new LlmClient(llm, { ...opts, maxRpm: 600, sleepFn: undefined }); // 100ms spacing
    await Promise.all(Array.from({ length: 3 }, () => client.json(task)));
    const gaps = llm.calls.slice(1).map((c, i) => c.at - llm.calls[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(90);
  });

  it("reports LLM_NOT_CONFIGURED without a provider", async () => {
    const err = await new LlmClient(null, opts).json(task).catch((e) => e);
    expect(err.code).toBe("LLM_NOT_CONFIGURED");
  });

  it("backoff grows exponentially with jitter and a cap", () => {
    expect(backoffDelay(0, 1000, 60_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 60_000, () => 1)).toBe(8000);
    expect(backoffDelay(10, 1000, 60_000, () => 1)).toBe(60_000);
    expect(backoffDelay(3, 1000, 60_000, () => 0)).toBe(4000);
  });
});
