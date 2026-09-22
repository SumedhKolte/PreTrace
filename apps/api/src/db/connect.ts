import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import type { AppConfig } from "../config/env";
import { logger } from "../lib/logger";

let memoryServer: { stop: () => Promise<boolean> } | null = null;

/**
 * Connect to MongoDB.
 * - If MONGODB_URI is set, use it (required in production).
 * - Otherwise (development only) start an embedded MongoDB via mongodb-memory-server,
 *   persisted under .data/mongo, so the app runs from a clean clone without installing Mongo.
 */
export async function connectDatabase(cfg: AppConfig): Promise<string> {
  mongoose.set("strictQuery", true);
  let uri = cfg.MONGODB_URI;
  if (!uri) {
    if (cfg.NODE_ENV === "production") throw new Error("MONGODB_URI is required in production");
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const dbPath = resolve(repoRoot, ".data/mongo");
    mkdirSync(dbPath, { recursive: true });
    logger.info("MONGODB_URI not set — starting embedded MongoDB (first run downloads a mongod binary)", { dbPath });
    const server = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: "wiredTiger", port: 27027 } });
    memoryServer = server;
    uri = server.getUri("preptrace");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info("connected to MongoDB");
  return uri;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  memoryServer = null;
}
