import { describe, expect, it } from "vitest";
import { CreateKitSchema, isProtected, itemState, normalizeJdForKey, normalizeUrlForKey, parseCompanyUrl, type ItemMeta } from "../src";

describe("company URL parsing", () => {
  it("adds https and strips fragments", () => {
    expect(parseCompanyUrl("acme.com/about#team")).toEqual({ ok: true, url: "https://acme.com/about" });
  });
  it("accepts localhost URLs (evaluation fixtures)", () => {
    expect(parseCompanyUrl("http://localhost:8099/acme/").ok).toBe(true);
  });
  it("rejects garbage, credentials and non-http schemes", () => {
    expect(parseCompanyUrl("").ok).toBe(false);
    expect(parseCompanyUrl("not a url").ok).toBe(false);
    expect(parseCompanyUrl("ftp://acme.com").ok).toBe(false);
    expect(parseCompanyUrl("https://user:pw@acme.com").ok).toBe(false);
  });
});

describe("dedupe keys", () => {
  it("normalises equivalent company URLs to one key", () => {
    const k = normalizeUrlForKey("https://acme.com");
    expect(normalizeUrlForKey("https://www.ACME.com/")).toBe(k);
    expect(normalizeUrlForKey("acme.com/index.html")).toBe(k);
    expect(normalizeUrlForKey("https://acme.com/?utm_source=x")).toBe(k);
  });
  it("normalises JD whitespace and case", () => {
    expect(normalizeJdForKey("  Senior  Engineer\n\nNode.js ")).toBe(normalizeJdForKey("senior engineer node.js"));
  });
});

describe("item state model", () => {
  const meta = (m: Partial<ItemMeta>): ItemMeta => ({
    origin: "generated", edited: false, pinned: false, deleted: false, version: 1, generation: 0, createdAt: "", updatedAt: "", ...m,
  });
  it("derives display state with the documented precedence", () => {
    expect(itemState(meta({}))).toBe("generated");
    expect(itemState(meta({ edited: true }))).toBe("edited");
    expect(itemState(meta({ origin: "manual", edited: true }))).toBe("manual");
    expect(itemState(meta({ origin: "manual", pinned: true }))).toBe("pinned");
    expect(itemState(meta({ pinned: true, deleted: true }))).toBe("deleted");
  });
  it("only untouched generated items are unprotected", () => {
    expect(isProtected(meta({}))).toBe(false);
    for (const m of [{ edited: true }, { pinned: true }, { deleted: true }, { origin: "manual" as const }]) expect(isProtected(meta(m))).toBe(true);
  });
});

describe("request validation", () => {
  it("bounds days to 1..60 and requires a meaningful JD", () => {
    expect(CreateKitSchema.safeParse({ jd: "x".repeat(40), companyUrl: "acme.com", days: 0 }).success).toBe(false);
    expect(CreateKitSchema.safeParse({ jd: "x".repeat(40), companyUrl: "acme.com", days: 61 }).success).toBe(false);
    expect(CreateKitSchema.safeParse({ jd: "short", companyUrl: "acme.com", days: 5 }).success).toBe(false);
    expect(CreateKitSchema.safeParse({ jd: "x".repeat(40), companyUrl: "acme.com", days: "5" }).success).toBe(true);
  });
});
