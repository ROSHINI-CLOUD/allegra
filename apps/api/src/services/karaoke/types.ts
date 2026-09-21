import type { KaraokePayload, KaraokeStatus } from '../../types.js';

/** Default stem identity version — bump (STEM_SEPARATION_VERSION) when the model or output layout changes. */
export const DEFAULT_SEPARATION_VERSION = 'aws-batch-htdemucs-v1';

/** Internal record — never returned raw to the browser (object keys stay server-side). */
export interface KaraokeAssetRecord {
  readonly songId: string;
  readonly sourceFingerprint: string;
  readonly separationVersion: string;
  readonly status: Exclude<KaraokeStatus, 'none'>;
  /** Private S3 key for the instrumental stem. */
  readonly instrumentalObjectKey?: string;
  /** Private S3 key for the vocals stem. */
  readonly vocalsObjectKey?: string;
  readonly separationProvider?: string;
  readonly separationModel?: string;
  readonly providerJobId?: string;
  /** Machine-facing code (SPOT_INTERRUPTION, MODEL_FAILURE, …); never shown raw. */
  readonly error?: string;
  readonly updatedAt: string;
}

export type { KaraokePayload, KaraokeStatus };

export function toKaraokePayload(record: KaraokeAssetRecord | null): KaraokePayload {
  if (!record) {
    return { status: 'none' };
  }
  if (record.status === 'ready') {
    const base = `/api/stream/karaoke/${encodeURIComponent(record.songId)}`;
    return {
      status: 'ready',
      instrumentalUrl: `${base}/instrumental`,
      vocalsUrl: `${base}/vocals`,
      separationVersion: record.separationVersion
    };
  }
  if (record.status === 'failed') {
    return { status: 'failed', retryable: true, separationVersion: record.separationVersion };
  }
  return { status: record.status, separationVersion: record.separationVersion };
}
