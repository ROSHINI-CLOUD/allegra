import type { KaraokePayload, KaraokeStatus } from '../../types.js';

export const SEPARATION_VERSION = 'scarleta-v1';

/** Internal durable record — never returned raw to the browser. */
export interface KaraokeAssetRecord {
  readonly songId: string;
  readonly sourceFingerprint: string;
  readonly separationVersion: string;
  readonly status: Exclude<KaraokeStatus, 'none'>;
  /** Upstream instrumental bytes URL (S3 public or Scarleta result). Piped by our stream route. */
  readonly sourceInstrumentalUrl?: string;
  readonly providerJobId?: string;
  readonly error?: string;
  readonly updatedAt: string;
}

export type { KaraokePayload, KaraokeStatus };

export function toKaraokePayload(record: KaraokeAssetRecord | null): KaraokePayload {
  if (!record) {
    return { status: 'none' };
  }
  if (record.status === 'ready') {
    return {
      status: 'ready',
      instrumentalUrl: `/api/stream/karaoke/${encodeURIComponent(record.songId)}`,
      separationVersion: record.separationVersion
    };
  }
  if (record.status === 'failed') {
    return {
      status: 'failed',
      retryable: true,
      separationVersion: record.separationVersion
    };
  }
  return {
    status: record.status,
    separationVersion: record.separationVersion
  };
}
