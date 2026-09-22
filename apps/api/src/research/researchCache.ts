import type { ResearchBundle } from "./researchService";

/**
 * Shared research cache. Research is derived purely from public web content, so it
 * is safe to share across users (unlike kits, which are private). Keyed by
 * SHA-256(normalised company URL | company name).
 */
export interface ResearchCache {
  get(key: string): Promise<ResearchBundle | null>;
  set(key: string, value: ResearchBundle, ttlMs: number): Promise<void>;
}

export class MemoryResearchCache implements ResearchCache {
  private map = new Map<string, { value: ResearchBundle; expires: number }>();
  async get(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return structuredClone(e.value);
  }
  async set(key: string, value: ResearchBundle, ttlMs: number) {
    this.map.set(key, { value: structuredClone(value), expires: Date.now() + ttlMs });
  }
}
