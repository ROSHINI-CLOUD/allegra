import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

interface ItunesResult {
  readonly artworkUrl100?: string;
}

interface ItunesResponse {
  readonly results?: ItunesResult[];
}

export interface ItunesProviderOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export class ItunesProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: ItunesProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'https://itunes.apple.com/search';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async search(term: string, limit = 5): Promise<string[]> {
    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('term', term);
      url.searchParams.set('media', 'music');
      url.searchParams.set('entity', 'song');
      url.searchParams.set('limit', String(limit));
      const response = await fetchWithTimeout(
        url,
        { headers: { Accept: 'application/json' } },
        20_000,
        this.fetchImpl
      );
      if (!response.ok) {
        return [];
      }
      const body: unknown = await response.json();
      if (!isItunesResponse(body)) {
        return [];
      }
      return body.results
        .map((item) => item.artworkUrl100?.replace('100x100bb', '1000x1000bb'))
        .filter((url): url is string => Boolean(url));
    } catch {
      return [];
    }
  }
}

function isItunesResponse(value: unknown): value is ItunesResponse & { results: ItunesResult[] } {
  if (typeof value !== 'object' || value === null || !('results' in value)) {
    return false;
  }
  const results = value.results;
  return Array.isArray(results) && results.every((item) => typeof item === 'object' && item !== null);
}
