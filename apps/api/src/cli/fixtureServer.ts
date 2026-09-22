import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Local static server for the fixture company websites in /fixtures/sites.
 * Used by tests and for demoing the evaluator against localhost URLs, like the
 * assessment's hidden cases. Adds a few adversarial routes under /stress/.
 */

export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/sites");

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };

export function startFixtureServer(port = 0, root = FIXTURES_DIR): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);

    // --- adversarial routes -------------------------------------------------
    if (path === "/stress/huge.html") {
      res.writeHead(200, { "content-type": "text/html" });
      const para = "<p>Stressco is a logistics data company. " + "lorem ipsum dolor sit amet ".repeat(40) + "</p>\n";
      res.end(`<html><head><title>About Stressco</title></head><body><h1>About</h1>${para.repeat(4000)}</body></html>`); // ~4.5MB
      return;
    }
    if (path === "/stress/slow.html") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<html><body><h1>Careers</h1><p>Too slow.</p></body></html>");
      }, 30_000).unref();
      return;
    }
    if (path === "/stress/brochure.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.4 fake");
      return;
    }
    if (path === "/stress/redirect-out") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (path === "/stress/flaky.html") {
      const n = Number(url.searchParams.get("n") ?? "0");
      res.writeHead(n < 1 ? 503 : 200, { "content-type": "text/html" });
      res.end("<html><body><p>ok</p></body></html>");
      return;
    }

    // --- static files -------------------------------------------------------
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });

  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      const addr = server.address() as { port: number };
      resolvePromise({
        url: `http://localhost:${addr.port}`,
        port: addr.port,
        close: () => new Promise<void>((r) => {
          server.closeAllConnections?.();
          server.close(() => r());
        }),
      });
    });
  });
}
