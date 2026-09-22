import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SafeFetcher, FetchError } from "../src/research/net/safeFetch";
import { assertUrlSyntaxAllowed, makeGuardedLookup, EVALUATION_POLICY, isIpAllowed, STRICT_POLICY, BlockedUrlError } from "../src/research/net/urlSafety";

describe("SSRF: IP policy", () => {
  it.each([
    ["127.0.0.1", false],
    ["10.1.2.3", false],
    ["172.16.0.5", false],
    ["192.168.1.1", false],
    ["169.254.169.254", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["fe80::1", false],
    ["fd00::1", false],
    ["::ffff:127.0.0.1", false],
    ["100.64.0.1", false],
    ["224.0.0.1", false],
    ["8.8.8.8", true],
    ["2606:4700:4700::1111", true],
  ])("strict policy: %s allowed=%s", (ip, allowed) => {
    expect(isIpAllowed(ip, STRICT_POLICY)).toBe(allowed);
  });

  it("evaluation policy allows loopback/private but NEVER link-local metadata", () => {
    expect(isIpAllowed("127.0.0.1", EVALUATION_POLICY)).toBe(true);
    expect(isIpAllowed("::1", EVALUATION_POLICY)).toBe(true);
    expect(isIpAllowed("10.0.0.8", EVALUATION_POLICY)).toBe(true);
    expect(isIpAllowed("169.254.169.254", EVALUATION_POLICY)).toBe(false);
    expect(isIpAllowed("0.0.0.0", EVALUATION_POLICY)).toBe(false);
  });
});

describe("SSRF: URL checks", () => {
  const blocked = (u: string, p = STRICT_POLICY) => expect(() => assertUrlSyntaxAllowed(u, p)).toThrow(BlockedUrlError);
  it("rejects non-http protocols, credentials and internal names", () => {
    blocked("file:///etc/passwd");
    blocked("gopher://example.com/");
    blocked("http://user:pass@example.com/");
    blocked("http://localhost/");
    blocked("http://metadata.google.internal/");
    blocked("http://printer.local/");
    blocked("http://127.0.0.1/");
    blocked("http://[::1]/");
    blocked("http://169.254.169.254/latest/meta-data/");
    blocked("http://example.com:6379/"); // non-standard port in strict mode
  });

  it("allows normal public URLs", () => {
    expect(assertUrlSyntaxAllowed("https://example.com/careers", STRICT_POLICY).hostname).toBe("example.com");
  });

  it("evaluation mode allows localhost with any port", () => {
    expect(assertUrlSyntaxAllowed("http://localhost:8099/acme/", EVALUATION_POLICY).port).toBe("8099");
    expect(() => assertUrlSyntaxAllowed("http://169.254.169.254/", EVALUATION_POLICY)).toThrow(BlockedUrlError);
  });

  it("connect-time DNS guard blocks names resolving to loopback (DNS-rebinding defence)", async () => {
    const lookup = makeGuardedLookup(STRICT_POLICY);
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => lookup("localhost", { all: true }, (e) => resolve(e)));
    expect(err?.code).toBe("EBLOCKED");
    const ok = await new Promise<NodeJS.ErrnoException | null>((resolve) => makeGuardedLookup(EVALUATION_POLICY)("localhost", { all: true }, (e) => resolve(e)));
    expect(ok).toBeNull();
  });
});

// ---------------------------------------------------------------------------

let server: http.Server;
let base: string;
const hits: Record<string, number> = {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const p = req.url ?? "/";
    hits[p] = (hits[p] ?? 0) + 1;
    if (p === "/ok") return res.writeHead(200, { "content-type": "text/html" }).end("<p>hello</p>");
    if (p === "/404") return res.writeHead(404).end();
    if (p === "/pdf") return res.writeHead(200, { "content-type": "application/pdf" }).end("%PDF");
    if (p === "/big") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("x".repeat(300_000));
    }
    if (p === "/slow") return void setTimeout(() => res.writeHead(200).end("late"), 3000);
    if (p === "/redirect-internal") return res.writeHead(302, { location: "http://169.254.169.254/latest/" }).end();
    if (p === "/redirect-ok") return res.writeHead(301, { location: "/ok" }).end();
    if (p === "/loop") return res.writeHead(302, { location: "/loop" }).end();
    if (p === "/flaky") {
      if (hits[p] < 3) return res.writeHead(503, { "retry-after": "0" }).end();
      return res.writeHead(200, { "content-type": "text/html" }).end("<p>recovered</p>");
    }
    res.writeHead(500).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const fetcher = (policy = EVALUATION_POLICY, extra = {}) =>
  new SafeFetcher({ policy, timeoutMs: 1000, maxBytes: 100_000, retries: 3, hostDelayMs: 0, sleepFn: async () => {}, ...extra });

describe("SafeFetcher", () => {
  it("fetches text in evaluation mode", async () => {
    const r = await fetcher().fetch(`${base}/ok`);
    expect(r.body).toContain("hello");
  });

  it("blocks loopback in strict (production) mode before connecting", async () => {
    await expect(fetcher(STRICT_POLICY).fetch(`${base}/ok`)).rejects.toMatchObject({ kind: "BLOCKED" });
  });

  it("re-validates redirects: redirect to cloud metadata is blocked", async () => {
    await expect(fetcher().fetch(`${base}/redirect-internal`)).rejects.toMatchObject({ kind: "BLOCKED" });
  });

  it("follows safe relative redirects", async () => {
    const r = await fetcher().fetch(`${base}/redirect-ok`);
    expect(r.url).toBe(`${base}/ok`);
    expect(r.redirects).toHaveLength(1);
  });

  it("stops redirect loops", async () => {
    await expect(fetcher().fetch(`${base}/loop`)).rejects.toMatchObject({ kind: "TOO_MANY_REDIRECTS" });
  });

  it("reports 404 without retrying", async () => {
    const before = hits["/404"] ?? 0;
    await expect(fetcher().fetch(`${base}/404`)).rejects.toMatchObject({ kind: "HTTP_STATUS", status: 404 });
    expect(hits["/404"] - before).toBe(1);
  });

  it("rejects unsupported content types", async () => {
    await expect(fetcher().fetch(`${base}/pdf`)).rejects.toMatchObject({ kind: "UNSUPPORTED_TYPE" });
  });

  it("truncates or fails oversized bodies", async () => {
    const r = await fetcher().fetch(`${base}/big`, { oversize: "truncate" });
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(100_000);
    await expect(fetcher().fetch(`${base}/big`, { oversize: "fail" })).rejects.toMatchObject({ kind: "TOO_LARGE" });
  });

  it("times out slow responses", async () => {
    await expect(fetcher(EVALUATION_POLICY, { retries: 0 }).fetch(`${base}/slow`)).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("retries transient 5xx with backoff and recovers", async () => {
    const r = await fetcher().fetch(`${base}/flaky`);
    expect(r.body).toContain("recovered");
    expect(hits["/flaky"]).toBe(3);
  });

  it("classifies connection refused as a retryable network error", async () => {
    const err = await fetcher(EVALUATION_POLICY, { retries: 1 }).fetch("http://127.0.0.1:1/").catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err.kind).toBe("NETWORK");
  });
});
