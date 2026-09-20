import { fetchWithTimeout, isAbortError } from '../lib/fetchWithTimeout.js';

const DEFAULT_TIMEOUT_MS = 25_000;

export const BROWSER_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
} as const;

export interface SaavnAsset {
  readonly quality?: string;
  readonly url?: string;
}

export interface SaavnSong {
  readonly id?: string | number;
  readonly name?: string;
  readonly title?: string;
  readonly album?: string | { readonly name?: string };
  readonly duration?: number | string;
  readonly language?: string;
  readonly hasLyrics?: boolean;
  readonly playCount?: number | string;
  readonly play_count?: number | string;
  readonly primaryArtists?: string;
  readonly artists?: {
    readonly primary?: readonly { readonly name?: string }[];
  };
  readonly image?: readonly SaavnAsset[];
  readonly downloadUrl?: readonly SaavnAsset[];
}

export type ProviderFailureReason = 'timeout' | 'error';

export interface ProviderResult<T> {
  readonly ok: boolean;
  readonly data: T;
  readonly reason?: ProviderFailureReason;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

export interface SaavnProviderOptions {
  readonly baseUrl: string;
  readonly secondaryBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class SaavnProvider {
  private readonly baseUrls: string[];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: SaavnProviderOptions) {
    this.baseUrls = [options.baseUrl, options.secondaryBaseUrl]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.replace(/\/+$/, ''))
      .filter((value, index, values) => values.indexOf(value) === index);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async search(
    query: string,
    limit = 20,
    page = 0
  ): Promise<ProviderResult<SaavnSong[]>> {
    return this.requestResults('search/songs', {
      query,
      limit: String(limit),
      page: String(page)
    });
  }

  public async getSong(
    id: string
  ): Promise<ProviderResult<SaavnSong | null>> {
    let reason: ProviderFailureReason = 'error';
    for (const baseUrl of this.baseUrls) {
      try {
        const response = await this.request(baseUrl, `songs/${encodeURIComponent(id)}`);
        if (!response.ok) {
          continue;
        }

        const body: unknown = await response.json();
        const song = parseSongResponse(body);
        if (song) {
          return { ok: true, data: song };
        }
      } catch (error) {
        reason = isAbortError(error) ? 'timeout' : 'error';
      }
    }
    return { ok: false, data: null, reason };
  }

  public async getSuggestions(
    id: string,
    limit = 10
  ): Promise<ProviderResult<SaavnSong[]>> {
    return this.requestResults(`songs/${encodeURIComponent(id)}/suggestions`, {
      limit: String(limit)
    });
  }

  private async requestResults(
    path: string,
    params: Record<string, string>
  ): Promise<ProviderResult<SaavnSong[]>> {
    let reason: ProviderFailureReason = 'error';
    for (const baseUrl of this.baseUrls) {
      try {
        const response = await this.request(baseUrl, path, params);
        if (!response.ok) {
          continue;
        }

        const body: unknown = await response.json();
        const songs = parseResults(body);
        if (songs) {
          // A valid empty result is meaningful: the catalog owns the Gaana
          // zero-result fallback, while the secondary Saavn URL is reserved
          // for provider failures.
          return { ok: true, data: songs };
        }
      } catch (error) {
        reason = isAbortError(error) ? 'timeout' : 'error';
      }
    }
    return { ok: false, data: [], reason };
  }

  private async request(
    baseUrl: string,
    path: string,
    params?: Record<string, string>
  ): Promise<Response> {
    const url = new URL(path.replace(/^\/+/, ''), `${baseUrl}/`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    return fetchWithTimeout(
      url,
      { headers: BROWSER_HEADERS },
      this.timeoutMs,
      this.fetchImpl
    );
  }
}

function parseResults(body: unknown): SaavnSong[] | null {
  if (!isRecord(body) || body.success !== true || body.data === undefined || body.data === null) {
    return null;
  }

  const results = Array.isArray(body.data)
    ? body.data
    : isRecord(body.data) && Array.isArray(body.data.results)
      ? body.data.results
      : null;
  if (!Array.isArray(results)) {
    return null;
  }

  return results.filter(isRecord).map((result) => result as SaavnSong);
}

function parseSongResponse(body: unknown): SaavnSong | null {
  if (!isRecord(body) || body.success !== true || body.data === undefined || body.data === null) {
    return null;
  }

  if (Array.isArray(body.data)) {
    const first = body.data.find(isRecord);
    return first ? (first as SaavnSong) : null;
  }
  if (!isRecord(body.data)) {
    return null;
  }

  if (isRecord(body.data.song)) {
    return body.data.song as SaavnSong;
  }

  if (isSongRecord(body.data)) {
    return body.data as SaavnSong;
  }

  if (Array.isArray(body.data.results)) {
    const first = body.data.results.find(isRecord);
    return first ? (first as SaavnSong) : null;
  }

  return null;
}

function isSongRecord(value: JsonRecord): boolean {
  return typeof value.id === 'string' || typeof value.id === 'number';
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
