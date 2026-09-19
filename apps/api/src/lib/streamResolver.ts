import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Response as ExpressResponse } from 'express';

import { cacheKey, type CacheStore } from './cache.js';
import { ProviderUnavailableError } from './errors.js';
import { BROWSER_HEADERS } from '../providers/saavn.js';
import type { SaavnProvider } from '../providers/saavn.js';

export interface StreamResolverOptions {
  readonly saavn: SaavnProvider;
  readonly cache: CacheStore;
  readonly fetchImpl?: typeof fetch;
}

export class StreamResolver {
  private readonly saavn: SaavnProvider;
  private readonly cache: CacheStore;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: StreamResolverOptions) {
    this.saavn = options.saavn;
    this.cache = options.cache;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async pipe(songId: string, range: string | undefined, response: ExpressResponse): Promise<void> {
    let upstream = await this.fetchResolved(songId, range, false);
    if (upstream.status === 403 || upstream.status === 404) {
      upstream = await this.fetchResolved(songId, range, true);
    }

    response.status(upstream.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(header);
      if (value) {
        response.setHeader(header, value);
      }
    }
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (!upstream.body) {
      response.end();
      return;
    }
    Readable.fromWeb(upstream.body as NodeReadableStream<Uint8Array>).pipe(response);
  }

  private async fetchResolved(songId: string, range: string | undefined, force: boolean): Promise<Response> {
    const url = await this.resolve(songId, force);
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    if (range) {
      headers.Range = range;
    }
    try {
      return await this.fetchImpl(url, { headers });
    } catch {
      throw new ProviderUnavailableError();
    }
  }

  private async resolve(songId: string, force: boolean): Promise<string> {
    const key = cacheKey('stream', songId);
    if (!force) {
      const cached = await this.cache.get<string>(key);
      if (cached) {
        return cached;
      }
    }

    const result = await this.saavn.getSong(songId);
    const downloads = result.data?.downloadUrl ?? [];
    const url = downloads.find((asset) => asset.quality === '320kbps')?.url ?? downloads.at(-1)?.url;
    if (!result.ok || !url) {
      throw new ProviderUnavailableError();
    }
    await this.cache.set(key, url, 21_600);
    return url;
  }
}
