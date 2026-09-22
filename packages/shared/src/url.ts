/**
 * URL helpers shared by client and server. These do syntactic checks only —
 * network-level SSRF checks (DNS resolution, IP ranges, redirects) live in the API.
 */

export type ParsedCompanyUrl = { ok: true; url: string } | { ok: false; message: string };

export function parseCompanyUrl(input: string): ParsedCompanyUrl {
  const raw = input.trim();
  if (!raw) return { ok: false, message: "Enter the company website URL" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, message: "Only http and https URLs are supported" };
  }
  if (u.username || u.password) return { ok: false, message: "URLs with credentials are not allowed" };
  if (!u.hostname || (!u.hostname.includes(".") && u.hostname !== "localhost" && !/^\[.*\]$/.test(u.hostname))) {
    return { ok: false, message: "Enter a full domain, e.g. acme.com" };
  }
  u.hash = "";
  return { ok: true, url: u.toString() };
}

/** Canonical form used for cache keys and duplicate detection. */
export function normalizeUrlForKey(input: string): string {
  const parsed = parseCompanyUrl(input);
  if (!parsed.ok) return input.trim().toLowerCase();
  const u = new URL(parsed.url);
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.search = "";
  let path = u.pathname.replace(/\/+$/, "");
  if (path.endsWith("/index.html")) path = path.slice(0, -"/index.html".length);
  return `${u.protocol}//${u.host}${path}`;
}

export function normalizeJdForKey(jd: string): string {
  return jd.replace(/\s+/g, " ").trim().toLowerCase();
}
