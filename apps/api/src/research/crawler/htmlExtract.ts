import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

export interface ExtractedLink {
  url: string;
  text: string;
  title: string;
  context: "nav" | "header" | "footer" | "main";
}

export interface ExtractedPage {
  url: string;
  title: string;
  description: string;
  siteName: string;
  headings: string[];
  /** Structured plain text: "# Heading", paragraphs, "- list items". Inert data only. */
  text: string;
  links: ExtractedLink[];
  textTruncated: boolean;
}

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed",
  "form", "button", "input", "select", "textarea", "nav", "footer", "aside", "dialog", "video", "audio", "picture", "img", "head", "meta", "link",
]);
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "main", "header", "ul", "ol", "dl", "dt", "dd", "blockquote", "pre",
  "table", "thead", "tbody", "tr", "td", "th", "figure", "figcaption", "address", "details", "summary", "hr", "br", "body", "html",
]);
const HEADING_RE = /^h([1-6])$/;
const NOISE_SELECTORS = [
  "[aria-hidden=true]", "[hidden]", "[role=navigation]", "[role=banner] nav", "[role=contentinfo]",
  "[class*=cookie]", "[id*=cookie]", "[class*=consent]", "[class*=newsletter]", ".skip-link", ".sr-only",
];

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Parse HTML into structured, bounded text. Never executes anything — cheerio is a pure parser. */
export function extractPage(html: string, pageUrl: string, maxTextChars = 20_000): ExtractedPage {
  const $ = cheerio.load(html);
  const baseHref = $("base[href]").attr("href");
  let base = pageUrl;
  try {
    if (baseHref) base = new URL(baseHref, pageUrl).toString();
  } catch {
    /* ignore bad base */
  }

  const title = collapse($("title").first().text()) || collapse($("h1").first().text());
  const description =
    $('meta[name="description"]').attr("content")?.trim() || $('meta[property="og:description"]').attr("content")?.trim() || "";
  const siteName = $('meta[property="og:site_name"]').attr("content")?.trim() || $('meta[name="application-name"]').attr("content")?.trim() || "";

  const links = collectLinks($, base);

  // Text extraction on a pruned tree.
  $(NOISE_SELECTORS.join(",")).remove();
  const root = ($("main").first()[0] ?? $("article").first()[0] ?? $('[role="main"]').first()[0] ?? $("body")[0] ?? $.root()[0]) as AnyNode;
  const blocks: string[] = [];
  const headings: string[] = [];
  let buf = "";
  const flush = (prefix = "") => {
    const t = collapse(buf);
    buf = "";
    if (t.length > 1 && blocks[blocks.length - 1] !== prefix + t) blocks.push(prefix + t);
  };
  const walk = (node: AnyNode) => {
    const children = (node as Element).children ?? [];
    for (const child of children) {
      if (child.type === "text") {
        buf += (child as unknown as { data: string }).data;
        continue;
      }
      if (child.type !== "tag" && child.type !== "script" && child.type !== "style") continue;
      const el = child as Element;
      const tag = el.name.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      const h = HEADING_RE.exec(tag);
      if (h) {
        flush();
        const t = collapse($(el).text());
        if (t) {
          blocks.push(`${"#".repeat(Number(h[1]))} ${t}`);
          headings.push(t);
        }
      } else if (tag === "li") {
        flush();
        walk(el);
        flush("- ");
      } else if (BLOCK_TAGS.has(tag)) {
        flush();
        walk(el);
        flush();
      } else {
        walk(el);
      }
    }
  };
  // If main/article was chosen but is nearly empty, fall back to body.
  walk(root);
  flush();
  if (blocks.join(" ").length < 200 && root !== $("body")[0] && $("body")[0]) {
    blocks.length = 0;
    headings.length = 0;
    walk($("body")[0] as AnyNode);
    flush();
  }

  let text = blocks.join("\n");
  let textTruncated = false;
  if (text.length > maxTextChars) {
    text = text.slice(0, maxTextChars);
    textTruncated = true;
  }
  return { url: pageUrl, title, description, siteName, headings, text, links, textTruncated };
}

const SKIP_SCHEMES = /^(mailto|tel|javascript|data|sms|ftp|file):/i;

function collectLinks($: cheerio.CheerioAPI, base: string): ExtractedLink[] {
  const seen = new Set<string>();
  const out: ExtractedLink[] = [];
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || SKIP_SCHEMES.test(href)) return;
    let abs: URL;
    try {
      abs = new URL(href, base); // resolves relative links (./careers, ../about, /jobs)
    } catch {
      return;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return;
    abs.hash = "";
    const url = abs.toString();
    const $el = $(el);
    const context: ExtractedLink["context"] = $el.closest("nav,[role=navigation]").length
      ? "nav"
      : $el.closest("footer,[role=contentinfo]").length
        ? "footer"
        : $el.closest("header,[role=banner]").length
          ? "header"
          : "main";
    const text = collapse($el.text()) || collapse($el.attr("aria-label") ?? "") || collapse($el.find("img").attr("alt") ?? "");
    const key = `${url}|${text.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url, text: text.slice(0, 120), title: collapse($el.attr("title") ?? "").slice(0, 120), context });
  });
  return out.slice(0, 500);
}

/** Minimal sitemap parser: returns <loc> URLs. */
export function parseSitemap(xml: string, limit = 300): string[] {
  const $ = cheerio.load(xml, { xml: true });
  const urls: string[] = [];
  $("loc").each((_, el) => {
    if (urls.length < limit) urls.push($(el).text().trim());
  });
  return urls;
}
