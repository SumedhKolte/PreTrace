import { createApp } from "./app";
import { getConfig } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./db/connect";
import { JobRunner } from "./jobs/jobRunner";
import { logger } from "./lib/logger";
import { MongoResearchCache } from "./research/mongoResearchCache";
import { createServices } from "./services";

async function main() {
  const cfg = getConfig();
  await connectDatabase(cfg);
  const services = createServices({ mode: "web", cache: new MongoResearchCache() });
  const runner = new JobRunner(services, cfg.GENERATION_CONCURRENCY);
  await runner.recover();
  const app = createApp(services, runner);

  if (!services.llm.available) logger.warn("LLM_API_KEY is not set — kit generation will fail until an LLM provider is configured.");
  if (services.policy.allowPrivate) logger.warn("ALLOW_PRIVATE_URLS is enabled — private/loopback company URLs are allowed (local development only).");

  const server = app.listen(cfg.PORT, () => logger.info(`API listening on http://localhost:${cfg.PORT}`, { llm: services.llm.providerName, model: services.llm.model }));

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    server.close();
    await services.close();
    await disconnectDatabase().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  logger.error("fatal startup error", { err: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
