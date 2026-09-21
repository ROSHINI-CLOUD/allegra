import { cacheKey, type CacheStore } from '../../lib/cache.js';
import type { KaraokeAssetRecord } from './types.js';
import { SEPARATION_VERSION } from './types.js';

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface KaraokeAssetStore {
  get(songId: string, fingerprint: string): Promise<KaraokeAssetRecord | null>;
  /** Latest asset for a song across fingerprints (for stream route). */
  getLatest(songId: string): Promise<KaraokeAssetRecord | null>;
  save(record: KaraokeAssetRecord): Promise<void>;
  /**
   * Claim generation for a missing asset. Returns the existing record if another
   * caller already claimed, otherwise the new queued record.
   */
  claim(songId: string, fingerprint: string): Promise<{ readonly record: KaraokeAssetRecord; readonly created: boolean }>;
}

/**
 * Cache-backed karaoke asset store. Deep enough for local + Dynamo layered cache.
 * Swap later for Convex without changing KaraokeService callers.
 */
export class CacheKaraokeAssetStore implements KaraokeAssetStore {
  private readonly claims = new Map<string, Promise<{ record: KaraokeAssetRecord; created: boolean }>>();

  public constructor(private readonly cache: CacheStore) {}

  public async get(songId: string, fingerprint: string): Promise<KaraokeAssetRecord | null> {
    return this.cache.get<KaraokeAssetRecord>(assetKey(songId, fingerprint));
  }

  public async getLatest(songId: string): Promise<KaraokeAssetRecord | null> {
    const pointer = await this.cache.get<string>(latestKey(songId));
    if (!pointer) return null;
    return this.cache.get<KaraokeAssetRecord>(pointer);
  }

  public async save(record: KaraokeAssetRecord): Promise<void> {
    const key = assetKey(record.songId, record.sourceFingerprint);
    await this.cache.set(key, record, TTL_SECONDS);
    await this.cache.set(latestKey(record.songId), key, TTL_SECONDS);
  }

  public async claim(
    songId: string,
    fingerprint: string
  ): Promise<{ readonly record: KaraokeAssetRecord; readonly created: boolean }> {
    const key = assetKey(songId, fingerprint);
    const inflight = this.claims.get(key);
    if (inflight) return inflight;

    const run = (async () => {
      const existing = await this.get(songId, fingerprint);
      if (existing && existing.status !== 'failed') {
        return { record: existing, created: false };
      }
      const record: KaraokeAssetRecord = {
        songId,
        sourceFingerprint: fingerprint,
        separationVersion: SEPARATION_VERSION,
        status: 'queued',
        updatedAt: new Date().toISOString()
      };
      await this.save(record);
      return { record, created: true };
    })().finally(() => {
      this.claims.delete(key);
    });

    this.claims.set(key, run);
    return run;
  }
}

function assetKey(songId: string, fingerprint: string): string {
  return cacheKey('karaoke', 'asset', songId, fingerprint, SEPARATION_VERSION);
}

function latestKey(songId: string): string {
  return cacheKey('karaoke', 'latest', songId);
}
