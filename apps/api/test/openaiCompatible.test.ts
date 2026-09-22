import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OpenAICompatibleProvider } from "../src/llm/openaiCompatible";
import { LlmError } from "../src/llm/provider";

let server: http.Server;
let base: string;
const bodies: Record<string, unknown>[] = [];
let mode: "reject_json" | "rate" | "auth" | "ok" = "ok";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      bodies.push(body);
      if (mode === "rate") return res.writeHead(429, { "content-type": "application/json" }).end('{"error":{"details":{"retryDelay": "7s"}}}');
      if (mode === "auth") return res.writeHead(401).end("{}");
      if (mode === "reject_json" && body.response_format) return res.writeHead(400).end('{"error":{"message":"response_format is not supported for this model"}}');
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const provider = () => new OpenAICompatibleProvider({ name: "test", apiKey: "k", baseUrl: base, model: "m", timeoutMs: 2000, reasoningEffort: "low" });
const req = { task: "t", messages: [{ role: "user" as const, content: "hi" }], json: true, maxTokens: 10, temperature: 0 };

describe("OpenAI-compatible adapter", () => {
  it("sends JSON mode + reasoning effort and returns content", async () => {
    mode = "ok";
    const r = await provider().complete(req);
    expect(r.text).toBe('{"ok":true}');
    expect(bodies.at(-1)).toMatchObject({ model: "m", response_format: { type: "json_object" }, reasoning_effort: "low" });
  });

  it("drops an unsupported optional parameter once and retries", async () => {
    mode = "reject_json";
    const p = provider();
    const r = await p.complete(req);
    expect(r.text).toBe('{"ok":true}');
    expect(bodies.at(-1)?.response_format).toBeUndefined();
    await p.complete(req); // remembered: not sent again
    expect(bodies.at(-1)?.response_format).toBeUndefined();
  });

  it("maps 429 to a retryable rate-limit error with the provider's retry hint", async () => {
    mode = "rate";
    const e = await provider().complete(req).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.kind).toBe("rate_limited");
    expect(e.retryAfterMs).toBe(7000);
  });

  it("maps 401 to a non-retryable auth error", async () => {
    mode = "auth";
    const e = await provider().complete(req).catch((x) => x);
    expect(e.kind).toBe("auth");
    expect(e.retryable).toBe(false);
  });
});
