import { fetchBodyWithTimeout } from '../lib/fetchWithTimeout.js';
import { ttmlToLrc } from './betterlyrics.js';
import { isRecord, looksLikeHtml, type LyricsCandidate } from './lyricsCandidate.js';

const DEFAULT_BASE_URL = 'https://unison.boidu.dev';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_SEARCH_RESULTS = 5;

export interface UnisonProviderOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Unison: a community-submitted, vote-ranked lyrics database (LRC or TTML per entry). */
export class UnisonProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: UnisonProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The best-ranked entry for the song, or null. */
  public async find(title: string, artist: string, duration: number | undefined): Promise<LyricsCandidate | null> {
    const body = await this.get('lyrics', title, artist, duration);
    return isRecord(body) && body.success === true ? toCandidate(body.data) : null;
  }

  /** Every ranked entry for the song (up to five), for the "Other lyrics" picker. */
  public async search(title: string, artist: string, duration: number | undefined): Promise<LyricsCandidate[]> {
    const body = await this.get('lyrics/search', title, artist, duration);
    if (!isRecord(body) || body.success !== true || !Array.isArray(body.data)) {
      return [];
    }
    return body.data
      .map(toCandidate)
      .filter((candidate): candidate is LyricsCandidate => candidate !== null)
      .slice(0, MAX_SEARCH_RESULTS);
  }

  private async get(path: string, title: string, artist: string, duration: number | undefined): Promise<unknown> {
    try {
      const url = new URL(`${this.baseUrl}/${path}`);
      url.searchParams.set('song', title);
      url.searchParams.set('artist', artist);
      if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
        url.searchParams.set('duration', String(Math.round(duration)));
      }
      const response = await fetchBodyWithTimeout(url, { headers: { Accept: 'application/json', 'User-Agent': 'Allegra/1.0' } }, this.timeoutMs, this.fetchImpl);
      // 404 is Unison's "no entry for this song"; either way, the next provider.
      return response.ok ? JSON.parse(response.body) : null;
    } catch {
      return null;
    }
  }
}

function toCandidate(entry: unknown): LyricsCandidate | null {
  if (!isRecord(entry) || typeof entry.lyrics !== 'string' || !entry.lyrics.trim()) {
    return null;
  }
  const format = typeof entry.format === 'string' ? entry.format.toLowerCase() : '';
  const lyrics = format.includes('ttml') ? ttmlToLrc(entry.lyrics) : entry.lyrics.trim();
  if (!lyrics || looksLikeHtml(lyrics)) {
    return null;
  }
  const filedAs = [entry.artist, entry.song].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' — ');
  return filedAs ? { lyrics, source: 'Unison', filedAs } : { lyrics, source: 'Unison' };
}
