import { ResearchCacheEntry } from "../db/models";
import type { ResearchCache } from "./researchCache";
import type { ResearchBundle } from "./researchService";

/** Shared (cross-user) research cache in MongoDB with TTL expiry. Contains public data only. */
export class MongoResearchCache implements ResearchCache {
  async get(key: string): Promise<ResearchBundle | null> {
    const e = await ResearchCacheEntry.findOne({ key, expiresAt: { $gt: new Date() } }).lean<{ value: ResearchBundle }>();
    return e?.value ?? null;
  }
  async set(key: string, value: ResearchBundle, ttlMs: number): Promise<void> {
    await ResearchCacheEntry.updateOne({ key }, { $set: { value, expiresAt: new Date(Date.now() + ttlMs) } }, { upsert: true });
  }
}
