import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

import { cacheKey, type CacheStore } from './cache.js';
import { ProviderUnavailableError, TimeoutError } from './errors.js';
import { fetchUntilHeaders, isAbortError } from './fetchWithTimeout.js';
import { parsePublicHttpsUrl } from './publicUrl.js';
import { BROWSER_HEADERS } from '../providers/saavn.js';
import type { SaavnProvider } from '../providers/saavn.js';

const STREAM_HEADER_TIMEOUT_MS = 25_000;
const PASSTHROUGH_STATUSES = new Set([200, 206, 416]);

export interface StreamResolverOptions {
  readonly saavn: SaavnProvider;
  readonly cache: CacheStore;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class StreamResolver {
  private readonly saavn: SaavnProvider;
  private readonly cache: CacheStore;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: StreamResolverOptions) {
    this.saavn = options.saavn;
    this.cache = options.cache;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? STREAM_HEADER_TIMEOUT_MS;
  }

  public async pipe(songId: string, range: string | undefined, response: ExpressResponse): Promise<void> {
    let upstream = await this.fetchResolved(songId, range, false);
    if (upstream.response.status === 403 || upstream.response.status === 404) {
      upstream.abort();
      upstream = await this.fetchResolved(songId, range, true);
    }

    if (!PASSTHROUGH_STATUSES.has(upstream.response.status)) {
      upstream.abort();
      throw new ProviderUnavailableError();
    }

    response.status(upstream.response.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.response.headers.get(header);
      if (value) {
        response.setHeader(header, value);
      }
    }
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!upstream.response.body) {
      response.end();
      return;
    }

    const onClose = (): void => {
      if (!response.writableFinished) {
        upstream.abort();
      }
    };
    response.on('close', onClose);
    Readable.fromWeb(upstream.response.body as NodeReadableStream<Uint8Array>)
      .on('error', () => {
        upstream.abort();
        if (!response.headersSent) {
          throw new ProviderUnavailableError();
        }
        response.end();
      })
      .pipe(response);
  }

  private async fetchResolved(
    songId: string,
    range: string | undefined,
    force: boolean
  ): Promise<{ response: Response; abort: () => void }> {
    const url = await this.resolve(songId, force);
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    if (range) {
      headers.Range = range;
    }
    try {
      return await fetchUntilHeaders(url, { headers }, this.timeoutMs, this.fetchImpl);
    } catch (error) {
      if (isAbortError(error)) {
        throw new TimeoutError();
      }
      throw new ProviderUnavailableError();
    }
  }

  private async resolve(songId: string, force: boolean): Promise<string> {
    const key = cacheKey('stream', songId);
    if (!force) {
      const cached = await this.cache.get<string>(key);
      if (cached) {
        return assertStreamUrl(cached);
      }
    }

    const result = await this.saavn.getSong(songId);
    const downloads = result.data?.downloadUrl ?? [];
    const url = downloads.find((asset) => asset.quality === '320kbps')?.url ?? downloads.at(-1)?.url;
    if (!result.ok || !url) {
      throw result.reason === 'timeout' ? new TimeoutError() : new ProviderUnavailableError();
    }
    const safeUrl = assertStreamUrl(url);
    await this.cache.set(key, safeUrl, 3600);
    return safeUrl;
  }
}

function assertStreamUrl(value: string): string {
  try {
    return parsePublicHttpsUrl(value).toString();
  } catch {
    throw new ProviderUnavailableError();
  }
}
