import { cacheKey, type CacheStore } from '../../lib/cache.js';
import type { KaraokeAssetRecord } from './types.js';

/** Stems are immutable once ready, so a long TTL is safe. */
const READY_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Read-through cache of *ready* stem records so a warm instance skips the AWS
 * round trip. It is an optimisation only: the provider (S3 manifest + Batch) is
 * the source of truth, which is what lets stateless serverless instances agree.
 */
export interface KaraokeAssetStore {
  get(songId: string, fingerprint: string): Promise<KaraokeAssetRecord | null>;
  save(record: KaraokeAssetRecord): Promise<void>;
}

export class CacheKaraokeAssetStore implements KaraokeAssetStore {
  public constructor(
    private readonly cache: CacheStore,
    private readonly separationVersion: string
  ) {}

  public async get(songId: string, fingerprint: string): Promise<KaraokeAssetRecord | null> {
    return this.cache.get<KaraokeAssetRecord>(this.key(songId, fingerprint));
  }

  public async save(record: KaraokeAssetRecord): Promise<void> {
    if (record.status !== 'ready') return;
    await this.cache.set(this.key(record.songId, record.sourceFingerprint), record, READY_TTL_SECONDS);
  }

  private key(songId: string, fingerprint: string): string {
    return cacheKey('karaoke', 'asset', songId, fingerprint, this.separationVersion);
  }
}
