import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

import type { UploadsConfig } from '../../config.js';
import { ProviderUnavailableError, TimeoutError } from '../../lib/errors.js';
import { fetchUntilHeaders, isAbortError } from '../../lib/fetchWithTimeout.js';
import { parsePublicHttpsUrl } from '../../lib/publicUrl.js';
import { putObjectBytes } from '../../lib/s3PutObject.js';
import type { StreamResolver } from '../../lib/streamResolver.js';
import type { KaraokePayload } from '../../types.js';
import type { KaraokeAssetStore } from './asset-store.js';
import type { KaraokeSeparationProvider } from './providers/separation-provider.js';
import { SEPARATION_VERSION, toKaraokePayload, type KaraokeAssetRecord } from './types.js';

const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_ATTEMPTS = 48; // ~2 minutes
const STREAM_HEADER_TIMEOUT_MS = 25_000;
const PASSTHROUGH_STATUSES = new Set([200, 206, 416]);

export interface KaraokeServiceOptions {
  readonly stream: StreamResolver;
  readonly store: KaraokeAssetStore;
  readonly provider?: KaraokeSeparationProvider;
  readonly uploads?: UploadsConfig;
  readonly fetchImpl?: typeof fetch;
  /** Injectable for tests — skip background timers. */
  readonly schedule?: (work: () => Promise<void>) => void;
}

/**
 * Deep karaoke module: callers only see status / request / pipeInstrumental.
 * Scarleta, cache claim races, optional S3 persist, and polling stay inside.
 */
export class KaraokeService {
  private readonly stream: StreamResolver;
  private readonly store: KaraokeAssetStore;
  private readonly provider: KaraokeSeparationProvider | undefined;
  private readonly uploads: UploadsConfig | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly schedule: (work: () => Promise<void>) => void;
  private readonly polling = new Set<string>();
  /** Dedupes concurrent request() calls for the same song+fingerprint on this process. */
  private readonly inflightRequests = new Map<string, Promise<{ payload: KaraokePayload; accepted: boolean }>>();

  public constructor(options: KaraokeServiceOptions) {
    this.stream = options.stream;
    this.store = options.store;
    this.provider = options.provider;
    this.uploads = options.uploads;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.schedule = options.schedule ?? ((work) => {
      void work();
    });
  }

  public get isAvailable(): boolean {
    return Boolean(this.provider);
  }

  public async status(songId: string): Promise<KaraokePayload> {
    const latest = await this.store.getLatest(songId);
    return toKaraokePayload(latest);
  }

  public async request(songId: string): Promise<{ readonly payload: KaraokePayload; readonly accepted: boolean }> {
    if (!this.provider) {
      throw new ProviderUnavailableError('KARAOKE_DISABLED');
    }

    // Synchronous dedupe before any await so concurrent clicks share one job.
    const existingInflight = this.inflightRequests.get(songId);
    if (existingInflight) return existingInflight;

    const work = this.requestExclusive(songId).finally(() => {
      this.inflightRequests.delete(songId);
    });
    this.inflightRequests.set(songId, work);
    return work;
  }

  private async requestExclusive(songId: string): Promise<{ readonly payload: KaraokePayload; readonly accepted: boolean }> {
    const provider = this.provider;
    if (!provider) {
      throw new ProviderUnavailableError('KARAOKE_DISABLED');
    }

    const sourceUrl = await this.stream.resolveSourceUrl(songId);
    const fingerprint = fingerprintFor(sourceUrl);
    const existing = await this.store.get(songId, fingerprint);
    if (existing?.status === 'ready') {
      return { payload: toKaraokePayload(existing), accepted: false };
    }
    if (existing?.status === 'queued' || existing?.status === 'processing') {
      this.ensurePolling(existing);
      return { payload: toKaraokePayload(existing), accepted: true };
    }

    const { record, created } = await this.store.claim(songId, fingerprint);
    if (!created) {
      this.ensurePolling(record);
      return { payload: toKaraokePayload(record), accepted: record.status !== 'ready' };
    }

    try {
      const job = await provider.createJob({ audioUrl: sourceUrl, songId, fingerprint });
      const next: KaraokeAssetRecord = {
        ...record,
        status: job.status === 'failed' ? 'failed' : 'processing',
        providerJobId: job.jobId,
        ...(job.instrumentalUrl ? { sourceInstrumentalUrl: job.instrumentalUrl } : {}),
        ...(job.status === 'failed' ? { error: job.errorCode ?? 'PROVIDER_FAILED' } : {}),
        updatedAt: new Date().toISOString()
      };
      if (job.status === 'completed' && job.instrumentalUrl) {
        const ready = await this.finalize(next, job.instrumentalUrl);
        return { payload: toKaraokePayload(ready), accepted: false };
      }
      await this.store.save(next);
      this.ensurePolling(next);
      return { payload: toKaraokePayload(next), accepted: true };
    } catch (error) {
      const failed: KaraokeAssetRecord = {
        ...record,
        status: 'failed',
        error: error instanceof ProviderUnavailableError ? error.message : 'PROVIDER_FAILED',
        updatedAt: new Date().toISOString()
      };
      await this.store.save(failed);
      return { payload: toKaraokePayload(failed), accepted: false };
    }
  }

  public async pipeInstrumental(songId: string, range: string | undefined, response: ExpressResponse): Promise<void> {
    const asset = await this.store.getLatest(songId);
    if (!asset || asset.status !== 'ready' || !asset.sourceInstrumentalUrl) {
      response.status(404).json({ success: false, data: null, error: "Karaoke isn't ready for this song yet." });
      return;
    }

    const headers: Record<string, string> = {};
    if (range) headers.Range = range;
    let upstream: { response: Response; abort: () => void };
    try {
      upstream = await fetchUntilHeaders(asset.sourceInstrumentalUrl, { headers }, STREAM_HEADER_TIMEOUT_MS, this.fetchImpl);
    } catch (error) {
      if (isAbortError(error)) throw new TimeoutError();
      throw new ProviderUnavailableError();
    }

    if (!PASSTHROUGH_STATUSES.has(upstream.response.status)) {
      upstream.abort();
      throw new ProviderUnavailableError();
    }

    response.status(upstream.response.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.response.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (!upstream.response.body) {
      response.end();
      return;
    }
    response.on('close', () => {
      if (!response.writableFinished) upstream.abort();
    });
    Readable.fromWeb(upstream.response.body as NodeReadableStream<Uint8Array>)
      .on('error', () => {
        upstream.abort();
        if (!response.headersSent) throw new ProviderUnavailableError();
        response.end();
      })
      .pipe(response);
  }

  private ensurePolling(record: KaraokeAssetRecord): void {
    if (!record.providerJobId || record.status === 'ready' || record.status === 'failed') return;
    const key = `${record.songId}:${record.sourceFingerprint}`;
    if (this.polling.has(key)) return;
    this.polling.add(key);
    this.schedule(async () => {
      try {
        await this.pollUntilDone(record);
      } finally {
        this.polling.delete(key);
      }
    });
  }

  private async pollUntilDone(seed: KaraokeAssetRecord): Promise<void> {
    if (!this.provider || !seed.providerJobId) return;
    let attempt = 0;
    while (attempt < MAX_POLL_ATTEMPTS) {
      attempt += 1;
      const current = (await this.store.get(seed.songId, seed.sourceFingerprint)) ?? seed;
      if (current.status === 'ready' || current.status === 'failed') return;
      if (!current.providerJobId) return;

      try {
        const job = await this.provider.getJob(current.providerJobId);
        if (job.status === 'completed' && job.instrumentalUrl) {
          await this.finalize(current, job.instrumentalUrl);
          return;
        }
        if (job.status === 'failed') {
          await this.store.save({
            ...current,
            status: 'failed',
            error: job.errorCode ?? 'PROVIDER_FAILED',
            updatedAt: new Date().toISOString()
          });
          return;
        }
        if (current.status === 'queued') {
          await this.store.save({ ...current, status: 'processing', updatedAt: new Date().toISOString() });
        }
      } catch (error) {
        if (error instanceof ProviderUnavailableError && error.message === 'SCARLETA_BALANCE_EXHAUSTED') {
          await this.store.save({
            ...current,
            status: 'failed',
            error: 'SCARLETA_BALANCE_EXHAUSTED',
            updatedAt: new Date().toISOString()
          });
          return;
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    await this.store.save({
      ...seed,
      status: 'failed',
      error: 'PROVIDER_TIMEOUT',
      updatedAt: new Date().toISOString()
    });
  }

  private async finalize(record: KaraokeAssetRecord, instrumentalUrl: string): Promise<KaraokeAssetRecord> {
    let storedUrl = assertHttps(instrumentalUrl);
    if (this.uploads) {
      try {
        storedUrl = await this.persistToS3(record, storedUrl);
      } catch {
        // Fall through to provider URL — still only exposed via our stream proxy.
      }
    }
    const ready: KaraokeAssetRecord = {
      songId: record.songId,
      sourceFingerprint: record.sourceFingerprint,
      separationVersion: record.separationVersion,
      status: 'ready',
      sourceInstrumentalUrl: storedUrl,
      ...(record.providerJobId ? { providerJobId: record.providerJobId } : {}),
      updatedAt: new Date().toISOString()
    };
    await this.store.save(ready);
    return ready;
  }

  private async persistToS3(record: KaraokeAssetRecord, instrumentalUrl: string): Promise<string> {
    const uploads = this.uploads;
    if (!uploads) return instrumentalUrl;
    const downloaded = await fetchUntilHeaders(instrumentalUrl, {}, STREAM_HEADER_TIMEOUT_MS, this.fetchImpl);
    if (!downloaded.response.ok || !downloaded.response.body) {
      downloaded.abort();
      throw new ProviderUnavailableError();
    }
    const bytes = new Uint8Array(await downloaded.response.arrayBuffer());
    const contentType = downloaded.response.headers.get('content-type') ?? 'audio/mpeg';
    const key = `karaoke/${record.songId}/${record.sourceFingerprint}/${SEPARATION_VERSION}.mp3`;
    await putObjectBytes({
      credentials: {
        accessKeyId: uploads.accessKeyId,
        secretAccessKey: uploads.secretAccessKey,
        ...(uploads.sessionToken ? { sessionToken: uploads.sessionToken } : {})
      },
      region: uploads.region,
      bucket: uploads.bucket,
      key,
      body: bytes,
      contentType,
      fetchImpl: this.fetchImpl
    });
    return `${uploads.publicBaseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
}

export function fingerprintFor(sourceUrl: string): string {
  return createHash('sha256').update(sourceUrl).digest('hex').slice(0, 24);
}

function assertHttps(value: string): string {
  return parsePublicHttpsUrl(value).toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
