import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

import { ProviderUnavailableError } from '../../lib/errors.js';
import type { StreamResolver } from '../../lib/streamResolver.js';
import type { KaraokePayload } from '../../types.js';
import type { KaraokeAssetStore } from './asset-store.js';
import type { KaraokeSeparationProvider, SeparationJobResult } from './providers/separation-provider.js';
import { toKaraokePayload, type KaraokeAssetRecord } from './types.js';

const PASSTHROUGH_STATUSES = new Set([200, 206, 416]);

export type KaraokeStem = 'instrumental' | 'vocals';

export interface KaraokeServiceOptions {
  readonly stream: StreamResolver;
  readonly store: KaraokeAssetStore;
  readonly provider?: KaraokeSeparationProvider;
}

/**
 * Deep karaoke module: callers only see status / request / pipeStem.
 *
 * Stateless by design — the API runs as serverless functions that freeze after
 * responding, so there is no background polling. Every status() call reconciles
 * with the provider (S3 + Batch), and the provider guarantees a single job per
 * song identity across all instances.
 */
export class KaraokeService {
  private readonly stream: StreamResolver;
  private readonly store: KaraokeAssetStore;
  private readonly provider: KaraokeSeparationProvider | undefined;
  /** Coalesces concurrent identical work on one instance (cross-instance dedupe is the provider's job). */
  private readonly inflight = new Map<string, Promise<unknown>>();

  public constructor(options: KaraokeServiceOptions) {
    this.stream = options.stream;
    this.store = options.store;
    this.provider = options.provider;
  }

  public get isAvailable(): boolean {
    return Boolean(this.provider);
  }

  public async status(songId: string): Promise<KaraokePayload> {
    const provider = this.requireProvider();
    const fingerprint = fingerprintFor(await this.stream.resolveSourceUrl(songId));
    const record = await this.reconcile(provider, songId, fingerprint);
    return toKaraokePayload(record);
  }

  public async request(songId: string): Promise<{ readonly payload: KaraokePayload; readonly accepted: boolean }> {
    const provider = this.requireProvider();
    return this.coalesce(`request:${songId}`, async () => {
      const sourceUrl = await this.stream.resolveSourceUrl(songId);
      const fingerprint = fingerprintFor(sourceUrl);

      const existing = await this.reconcile(provider, songId, fingerprint);
      if (existing && existing.status !== 'failed') {
        return { payload: toKaraokePayload(existing), accepted: existing.status !== 'ready' };
      }

      try {
        const job = await provider.createJob({ audioUrl: sourceUrl, songId, fingerprint });
        const record = await this.persist(provider, songId, fingerprint, job);
        return { payload: toKaraokePayload(record), accepted: record.status !== 'ready' };
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
        return { payload: toKaraokePayload(failedRecord(provider, songId, fingerprint, error.message)), accepted: false };
      }
    });
  }

  /** Streams one stem with Range passthrough (206 stays 206). */
  public async pipeStem(
    songId: string,
    stem: KaraokeStem,
    range: string | undefined,
    response: ExpressResponse
  ): Promise<void> {
    const provider = this.requireProvider();
    const fingerprint = fingerprintFor(await this.stream.resolveSourceUrl(songId));
    const record = await this.reconcile(provider, songId, fingerprint);
    const objectKey = stem === 'vocals' ? record?.vocalsObjectKey : record?.instrumentalObjectKey;
    if (record?.status !== 'ready' || !objectKey || !provider.openStem) {
      response.status(404).json({ success: false, data: null, error: "Sing isn't ready for this song yet." });
      return;
    }

    let upstream;
    try {
      upstream = await provider.openStem(objectKey, range);
    } catch {
      throw new ProviderUnavailableError();
    }
    if (!PASSTHROUGH_STATUSES.has(upstream.status)) {
      upstream.abort();
      throw new ProviderUnavailableError();
    }

    response.status(upstream.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!upstream.body) {
      response.end();
      return;
    }
    response.on('close', () => {
      if (!response.writableFinished) upstream.abort();
    });
    Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>)
      .on('error', () => {
        upstream.abort();
        response.end();
      })
      .pipe(response);
  }

  private requireProvider(): KaraokeSeparationProvider {
    if (!this.provider) throw new ProviderUnavailableError('KARAOKE_DISABLED');
    return this.provider;
  }

  /** Cache hit for ready stems, otherwise ask the provider what AWS says right now. */
  private async reconcile(
    provider: KaraokeSeparationProvider,
    songId: string,
    fingerprint: string
  ): Promise<KaraokeAssetRecord | null> {
    const cached = await this.store.get(songId, fingerprint);
    if (cached?.status === 'ready') return cached;

    return this.coalesce(`reconcile:${songId}:${fingerprint}`, async () => {
      const job = await provider.findJob({ songId, fingerprint });
      return job ? this.persist(provider, songId, fingerprint, job) : null;
    });
  }

  private async persist(
    provider: KaraokeSeparationProvider,
    songId: string,
    fingerprint: string,
    job: SeparationJobResult
  ): Promise<KaraokeAssetRecord> {
    const complete = job.status === 'completed' && job.instrumentalObjectKey && job.vocalsObjectKey;
    const record: KaraokeAssetRecord = {
      songId,
      sourceFingerprint: fingerprint,
      separationVersion: provider.separationVersion,
      status: complete ? 'ready' : job.status === 'failed' ? 'failed' : job.status === 'completed' ? 'processing' : job.status,
      separationProvider: provider.name,
      ...(provider.separationModel ? { separationModel: provider.separationModel } : {}),
      providerJobId: job.jobId,
      ...(complete ? { instrumentalObjectKey: job.instrumentalObjectKey, vocalsObjectKey: job.vocalsObjectKey } : {}),
      ...(job.status === 'failed' ? { error: job.errorCode ?? 'PROVIDER_FAILED' } : {}),
      updatedAt: new Date().toISOString()
    };
    await this.store.save(record);
    return record;
  }

  private coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const run = work().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }
}

function failedRecord(
  provider: KaraokeSeparationProvider,
  songId: string,
  fingerprint: string,
  error: string
): KaraokeAssetRecord {
  return {
    songId,
    sourceFingerprint: fingerprint,
    separationVersion: provider.separationVersion,
    status: 'failed',
    separationProvider: provider.name,
    error,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Stable per source audio. Query strings are dropped so a re-signed CDN URL for
 * the same file does not trigger a second (paid) separation.
 */
export function fingerprintFor(sourceUrl: string): string {
  let identity = sourceUrl;
  try {
    const parsed = new URL(sourceUrl);
    identity = `${parsed.origin}${parsed.pathname}`;
  } catch {
    // Non-URL input: hash as-is.
  }
  return createHash('sha256').update(identity).digest('hex').slice(0, 24);
}
