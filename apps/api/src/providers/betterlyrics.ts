import { decodeHtml } from '../lib/decodeHtml.js';
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

const DEFAULT_BASE_URL = 'https://lyrics-api.boidu.dev';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface BetterLyricsProviderOptions {
  readonly baseUrl?: string;
  /**
   * Cached songs are served without a key; uncached lookups need `X-API-Key`.
   * Without a key this provider still works for anything already cached.
   */
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface BetterLyricsTrack {
  /** LRC text: one `[mm:ss.xx] line` per lyric line. */
  readonly lyrics: string;
  readonly source: string;
}

/** Better Lyrics API (YouTube Music extension backend). Returns Apple-style TTML with word timing. */
export class BetterLyricsProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: BetterLyricsProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = options.apiKey?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async find(title: string, artist: string, duration: number | undefined): Promise<BetterLyricsTrack | null> {
    try {
      const url = new URL(`${this.baseUrl}/getLyrics`);
      url.searchParams.set('s', title);
      url.searchParams.set('a', artist);
      if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
        url.searchParams.set('d', String(Math.round(duration)));
      }
      const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Allegra/1.0' };
      if (this.apiKey) {
        headers['X-API-Key'] = this.apiKey;
      }
      const response = await fetchWithTimeout(url, { headers }, this.timeoutMs, this.fetchImpl);
      if (!response.ok) {
        // 401 = uncached song and no key configured; 404 = unknown song. Both just mean "next provider".
        return null;
      }
      const body: unknown = await response.json();
      const lyrics = extractLrc(body);
      return lyrics ? { lyrics, source: 'BetterLyrics' } : null;
    } catch {
      // Optional tier: never let it break the cascade.
      return null;
    }
  }
}

function extractLrc(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.ttml === 'string') {
    return ttmlToLrc(record.ttml);
  }
  if (typeof record.lyrics === 'string' && /\[\d+:\d{2}/.test(record.lyrics) && !/<div|<html|<!doctype/i.test(record.lyrics)) {
    return record.lyrics.trim();
  }
  return null;
}

/**
 * Flattens TTML to line-level LRC. Word/syllable spans are joined back into text and
 * translation / romanisation spans are dropped, so the UI shows the original lyric.
 */
export function ttmlToLrc(ttml: string): string | null {
  const lines: string[] = [];
  for (const match of ttml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const attributes = match[1] ?? '';
    const inner = match[2] ?? '';
    const begin = attributes.match(/\bbegin="([^"]+)"/i)?.[1];
    const seconds = begin ? parseClock(begin) : null;
    if (seconds === null) {
      continue;
    }
    const withoutExtras = inner.replace(/<span\b[^>]*\bttm:role="x-(?:translation|roman)"[^>]*>[\s\S]*?<\/span>/gi, '');
    const text = decodeHtml(withoutExtras.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!text) {
      continue;
    }
    lines.push(`${formatLrcTime(seconds)} ${text}`);
  }
  return lines.length >= 2 ? lines.join('\n') : null;
}

/** "11.180", "1:11.18", "00:01:11.180" and "11.18s" all resolve to seconds. */
function parseClock(value: string): number | null {
  const parts = value.trim().replace(/s$/i, '').split(':').map(Number);
  if (parts.length === 0 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function formatLrcTime(totalSeconds: number): string {
  const centiseconds = Math.round(totalSeconds * 100);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const hundredths = centiseconds % 100;
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`;
}
