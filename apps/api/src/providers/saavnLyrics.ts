import { decodeHtml } from '../lib/decodeHtml.js';
import { stripTags } from '../lib/htmlText.js';
import { fetchBodyWithTimeout } from '../lib/fetchWithTimeout.js';
import type { LyricsCandidate } from './lyricsCandidate.js';

const DEFAULT_BASE_URL = 'https://www.jiosaavn.com/api.php';
const DEFAULT_TIMEOUT_MS = 6_000;
/** Saavn song ids are short base64url-ish strings ("_GIuQbB_"); anything else is not one. */
const SAAVN_ID = /^[A-Za-z0-9_-]{1,32}$/;

export interface SaavnLyricsProviderOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * JioSaavn's own lyrics for a song in its catalog, asked by the song's id: plain text, one line per
 * `<br>`, for exactly the recording we stream. Catalog rows say whether it exists (`hasLyrics`);
 * when it does not, the endpoint answers `{ status: "failure" }`.
 */
export class SaavnLyricsProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: SaavnLyricsProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async find(songId: string): Promise<LyricsCandidate | null> {
    if (!SAAVN_ID.test(songId)) {
      return null;
    }
    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('__call', 'lyrics.getLyrics');
      url.searchParams.set('ctx', 'web6dot0');
      url.searchParams.set('api_version', '4');
      url.searchParams.set('_format', 'json');
      url.searchParams.set('_marker', '0');
      url.searchParams.set('lyrics_id', songId);
      const response = await fetchBodyWithTimeout(
        url,
        { headers: { Accept: 'application/json', 'User-Agent': 'Allegra/1.0' } },
        this.timeoutMs,
        this.fetchImpl
      );
      if (!response.ok) {
        return null;
      }
      const body: unknown = JSON.parse(response.body);
      const raw = typeof body === 'object' && body !== null && 'lyrics' in body ? body.lyrics : null;
      const lyrics = typeof raw === 'string' ? saavnLyricsText(raw) : '';
      return lyrics ? { lyrics, source: 'JioSaavn' } : null;
    } catch {
      // Optional tier: never let it break the cascade.
      return null;
    }
  }
}

/** JioSaavn's `line<br>line` as plain text: one lyric per line, entities decoded, tags dropped. */
export function saavnLyricsText(raw: string): string {
  return decodeHtml(stripTags(raw.replace(/<br\s*\/?>/gi, '\n')))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
