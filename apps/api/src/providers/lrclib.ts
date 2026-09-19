import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

export interface LrclibEntry {
  readonly id?: number;
  readonly trackName?: string;
  readonly artistName?: string;
  readonly albumName?: string;
  readonly duration?: number;
  readonly instrumental?: boolean;
  readonly plainLyrics?: string | null;
  readonly syncedLyrics?: string | null;
}

export interface LrclibProviderOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export class LrclibProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: LrclibProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://lrclib.net/api').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async get(trackName: string, artistName: string, duration?: number): Promise<LrclibEntry | null> {
    try {
      const url = this.url('get', { track_name: trackName, artist_name: artistName, ...(duration ? { duration: String(duration) } : {}) });
      const response = await this.request(url);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        return null;
      }
      const body: unknown = await response.json();
      return isEntry(body) ? body : null;
    } catch {
      return null;
    }
  }

  public async search(trackName: string, artistName: string, duration?: number): Promise<LrclibEntry[]> {
    try {
      const url = this.url('search', {
        track_name: trackName,
        artist_name: artistName,
        ...(duration ? { duration: String(duration) } : {})
      });
      const response = await this.request(url);
      if (!response.ok) {
        return [];
      }
      const body: unknown = await response.json();
      return Array.isArray(body) ? body.filter(isEntry) : [];
    } catch {
      return [];
    }
  }

  private async request(url: URL): Promise<Response> {
    return fetchWithTimeout(
      url,
      { headers: { Accept: 'application/json', 'User-Agent': 'Allegra/1.0 (+https://allegra.app)' } },
      10_000,
      this.fetchImpl
    );
  }

  private url(path: string, params: Record<string, string>): URL {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url;
  }
}

function isEntry(value: unknown): value is LrclibEntry {
  return typeof value === 'object' && value !== null;
}
