import type { ExtractedLink } from "./htmlExtract";

/**
 * Deterministic link ranking for company discovery.
 *
 * Discovery is link-based: we score every link found on crawled pages using the
 * anchor text, URL path, title attribute and where the link sits on the page.
 * Well-known paths (/careers, /about…) are only a low-priority fallback hint.
 */

export type LinkCategory = "hiring" | "careers" | "about" | "engineering" | "product" | "other";

interface Signal {
  re: RegExp;
  weight: number;
  category: LinkCategory;
}

// Order matters only for readability; every matching signal contributes (capped per category).
const SIGNALS: Signal[] = [
  { re: /\binterview(s|ing)?\b/, weight: 14, category: "hiring" },
  { re: /\bhow we hire\b|\bhiring process\b|\bour process\b|\brecruit(ing|ment)? process\b/, weight: 14, category: "hiring" },
  { re: /\bhiring\b|\bhire\b/, weight: 10, category: "hiring" },
  { re: /\bcareers?\b/, weight: 10, category: "careers" },
  { re: /\bjobs?\b|\bopenings?\b|\bopen (roles|positions)\b|\bpositions\b|\bvacanc/, weight: 8, category: "careers" },
  { re: /\bjoin( us| the team| our team)?\b|\bwork (with|at|for) us\b|\bwe'?re hiring\b/, weight: 8, category: "careers" },
  { re: /\blife at\b|\bworking (at|here)\b|\bcandidates?\b/, weight: 7, category: "careers" },
  { re: /\babout( us)?\b|\bwho we are\b|\bour story\b/, weight: 7, category: "about" },
  { re: /\bcompany\b|\bmission\b|\bvalues\b|\bculture\b|\bprinciples\b/, weight: 6, category: "about" },
  { re: /\bteam\b|\bleadership\b|\bpeople\b/, weight: 4, category: "about" },
  { re: /\bengineering\b|\bengineers\b/, weight: 8, category: "engineering" },
  { re: /\bhandbook\b|\bplaybook\b/, weight: 7, category: "engineering" },
  { re: /\btech(nology)?\b|\barchitecture\b|\bstack\b|\binfrastructure\b|\bdevelopers?\b|\bopen source\b/, weight: 5, category: "engineering" },
  { re: /\bblog\b|\bnews\b|\bpress\b/, weight: 3, category: "engineering" },
  { re: /\bproducts?\b|\bplatform\b|\bsolutions\b|\bcustomers\b|\bwhat we do\b/, weight: 3, category: "product" },
];

const NEGATIVE: { re: RegExp; weight: number }[] = [
  { re: /\b(log ?in|sign ?in|sign ?up|register|account|password)\b/, weight: -20 },
  { re: /\b(privacy|terms|cookies?|legal|gdpr|dpa|imprint|accessibility statement)\b/, weight: -20 },
  { re: /\b(cart|checkout|shop|store|pricing|billing|download)\b/, weight: -6 },
  { re: /\b(status|support|help|faq|contact|investors?)\b/, weight: -3 },
];

const BINARY_EXT = /\.(pdf|zip|gz|tar|png|jpe?g|gif|webp|svg|ico|mp[34]|mov|avi|woff2?|ttf|css|js|json|xml|rss|dmg|exe|docx?|xlsx?|pptx?)$/i;
const SOCIAL_HOSTS = /(^|\.)(twitter|x|facebook|linkedin|instagram|youtube|tiktok|github|medium|glassdoor|discord|slack|reddit)\.com$/i;

/** Hosted applicant-tracking systems commonly linked from careers pages (followed but not expanded). */
export const ATS_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com|teamtailor\.com)$/i;

export interface ScoredLink {
  url: string;
  score: number;
  category: LinkCategory;
  signals: string[];
  external: boolean;
}

export interface CrawlScope {
  origin: string;
  host: string;
  /** Registrable-ish domain without www. used to admit subdomains (careers.acme.com). */
  siteDomain: string;
  /** Directory prefix for path-scoped sites, e.g. /acme/ on a shared host. */
  pathPrefix: string;
  isIpOrLocal: boolean;
}

export function makeScope(startUrl: string): CrawlScope {
  const u = new URL(startUrl);
  const host = u.host.toLowerCase();
  const hostname = u.hostname.toLowerCase();
  const isIpOrLocal = hostname === "localhost" || /^[\d.]+$/.test(hostname) || hostname.includes(":") || hostname.startsWith("[");
  let dir = u.pathname;
  if (!dir.endsWith("/")) dir = dir.slice(0, dir.lastIndexOf("/") + 1);
  return {
    origin: u.origin,
    host,
    siteDomain: hostname.replace(/^www\./, ""),
    pathPrefix: dir || "/",
    isIpOrLocal,
  };
}

export function inScope(url: string, scope: CrawlScope): { ok: boolean; external: boolean } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, external: false };
  }
  const hostname = u.hostname.toLowerCase();
  if (ATS_HOSTS.test(hostname)) return { ok: true, external: true };
  const sameSite = scope.isIpOrLocal
    ? u.host.toLowerCase() === scope.host
    : hostname === scope.siteDomain || hostname.endsWith(`.${scope.siteDomain}`);
  if (!sameSite) return { ok: false, external: false };
  // Path scoping only applies on the start host (a shared host serving several sites under /name/).
  if (u.host.toLowerCase() === scope.host && scope.pathPrefix !== "/" && !u.pathname.startsWith(scope.pathPrefix)) {
    return { ok: false, external: false };
  }
  return { ok: true, external: false };
}

export function normalizeCrawlUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  // Drop tracking params; keep others (some sites route by query).
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
  let s = u.toString();
  if (s.endsWith("/index.html")) s = s.slice(0, -"index.html".length);
  return s;
}

function pathWords(url: URL): string {
  return decodeURIComponent(url.pathname)
    .toLowerCase()
    .replace(/\.(html?|php|aspx?)$/, "")
    .replace(/[-_/.]+/g, " ")
    .trim();
}

function scoreText(text: string, factor: number, acc: Map<LinkCategory, number>, signals: string[], label: string) {
  if (!text) return;
  const t = text.toLowerCase();
  for (const s of SIGNALS) {
    if (s.re.test(t)) {
      acc.set(s.category, Math.max(acc.get(s.category) ?? 0, s.weight * factor));
      signals.push(`${label}:${s.re.source.slice(0, 24)}`);
    }
  }
  for (const n of NEGATIVE) if (n.re.test(t)) acc.set("other", (acc.get("other") ?? 0) + n.weight * factor);
}

/**
 * Score a link. Higher = more useful for interview prep.
 * score = max-per-category(anchor×1.0, path×0.8, title×0.6) summed across categories
 *       + context bonus − depth penalty.
 */
export function scoreLink(link: ExtractedLink, depth: number, scope: CrawlScope, parentCategory?: LinkCategory): ScoredLink | null {
  let u: URL;
  try {
    u = new URL(link.url);
  } catch {
    return null;
  }
  if (BINARY_EXT.test(u.pathname) || SOCIAL_HOSTS.test(u.hostname)) return null;
  const scopeCheck = inScope(link.url, scope);
  if (!scopeCheck.ok) return null;

  const acc = new Map<LinkCategory, number>();
  const signals: string[] = [];
  scoreText(link.text, 1.0, acc, signals, "anchor");
  scoreText(pathWords(u), 0.8, acc, signals, "path");
  scoreText(link.title, 0.6, acc, signals, "title");

  let score = 0;
  let best: LinkCategory = "other";
  let bestVal = 0;
  for (const [cat, v] of acc) {
    score += v;
    if (cat !== "other" && v > bestVal) {
      bestVal = v;
      best = cat;
    }
  }
  if (link.context === "nav" || link.context === "header") score += 1;
  if (parentCategory === "hiring" || parentCategory === "careers") {
    if (best === "hiring") score += 4;
  }
  if (scopeCheck.external) score -= 2;
  score -= depth * 1.5;
  return { url: normalizeCrawlUrl(link.url), score: Math.round(score * 10) / 10, category: best, signals, external: scopeCheck.external };
}

/** Low-priority fallback hints, used only when link discovery found nothing for a category. */
export const HINT_PATHS: { path: string; category: LinkCategory }[] = [
  { path: "careers", category: "careers" },
  { path: "jobs", category: "careers" },
  { path: "about", category: "about" },
  { path: "engineering", category: "engineering" },
];

// ---------------------------------------------------------------------------
// Page classification (content-based, after fetch)
// ---------------------------------------------------------------------------

const HIRING_TERMS = [
  /\binterview(s|ing)?\b/g, /\bon-?site\b/g, /\btake[- ]home\b/g, /\brecruiter\b/g, /\bphone screen\b/g,
  /\btechnical screen\b/g, /\bhiring process\b/g, /\bhiring manager\b/g, /\b(stage|round|step)s?\b/g,
  /\bsystem design\b/g, /\bpair(ing| programming)\b/g, /\bcoding (exercise|challenge|interview)\b/g, /\boffer\b/g,
];

export function hiringSignalCount(text: string): number {
  const t = text.toLowerCase();
  let n = 0;
  for (const re of HIRING_TERMS) n += Math.min(5, (t.match(re) ?? []).length);
  return n;
}

export function classifyPage(url: string, title: string, headings: string[], text: string): LinkCategory {
  const u = new URL(url);
  const hay = `${pathWords(u)} ${title} ${headings.slice(0, 8).join(" ")}`.toLowerCase();
  const hiring = hiringSignalCount(text);
  if (hiring >= 6 && /\binterview/.test(text.toLowerCase())) return "hiring";
  const acc = new Map<LinkCategory, number>();
  scoreText(hay, 1, acc, [], "page");
  acc.delete("other");
  let best: LinkCategory = "other";
  let bestVal = 0;
  for (const [cat, v] of acc) if (v > bestVal) [best, bestVal] = [cat, v];
  return best;
}
