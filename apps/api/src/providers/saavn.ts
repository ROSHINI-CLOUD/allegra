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

export interface ProviderResult<T> {
  readonly ok: boolean;
  readonly data: T;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

export interface SaavnProviderOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class SaavnProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: SaavnProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
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
    try {
      const response = await this.request(`songs/${encodeURIComponent(id)}`);
      if (!response.ok) {
        return { ok: false, data: null };
      }

      const body: unknown = await response.json();
      const song = parseSongResponse(body);
      return song ? { ok: true, data: song } : { ok: false, data: null };
    } catch {
      return { ok: false, data: null };
    }
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
    try {
      const response = await this.request(path, params);
      if (!response.ok) {
        return { ok: false, data: [] };
      }

      const body: unknown = await response.json();
      const songs = parseResults(body);
      return songs ? { ok: true, data: songs } : { ok: false, data: [] };
    } catch {
      return { ok: false, data: [] };
    }
  }

  private async request(
    path: string,
    params?: Record<string, string>
  ): Promise<Response> {
    const url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(url, {
        headers: BROWSER_HEADERS,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseResults(body: unknown): SaavnSong[] | null {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
    return null;
  }

  const results = body.data.results;
  if (!Array.isArray(results)) {
    return null;
  }

  return results.filter(isRecord).map((result) => result as SaavnSong);
}

function parseSongResponse(body: unknown): SaavnSong | null {
  if (!isRecord(body) || body.success !== true || !isRecord(body.data)) {
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
