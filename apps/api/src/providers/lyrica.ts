import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

const DEFAULT_TIMEOUT_MS = 45_000;

export interface LyricaProviderOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface LyricaTrack {
  readonly lyrics: string;
  readonly source: string;
}

export class LyricaProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: LyricaProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async find(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricaTrack | null> {
    const strategies = syncedOnly
      ? [{ timestamps: true, fast: false, label: 'synced-slow' }, { timestamps: true, fast: true, label: 'synced-fast' }]
      : [
          { timestamps: true, fast: false, label: 'synced-slow' },
          { timestamps: true, fast: true, label: 'synced-fast' },
          { timestamps: false, fast: false, label: 'plain' }
        ];

    for (const strategy of strategies) {
      try {
        const url = new URL(`${this.baseUrl}/`);
        url.searchParams.set('artist', artist);
        url.searchParams.set('song', title);
        url.searchParams.set('timestamps', String(strategy.timestamps));
        url.searchParams.set('fast', String(strategy.fast));
        url.searchParams.set('metadata', 'true');
        if (duration !== undefined && Number.isFinite(duration)) {
          url.searchParams.set('duration', String(Math.floor(duration)));
        }

        const response = await fetchWithTimeout(
          url,
          { headers: { Accept: 'application/json', 'User-Agent': 'Allegra/1.0' } },
          this.timeoutMs,
          this.fetchImpl
        );
        if (!response.ok) {
          continue;
        }
        const body: unknown = await response.json();
        const lyrics = extractLyrics(body);
        if (lyrics) {
          return { lyrics, source: `Lyrica(${strategy.label})` };
        }
      } catch {
        // This provider is optional. LRCLIB remains the reliable next tier.
      }
    }

    return null;
  }
}

function extractLyrics(value: unknown): string | null {
  if (!isRecord(value) || value.status !== 'success' || !isRecord(value.data)) {
    return null;
  }

  const data = value.data;
  let lyrics = typeof data.lyrics === 'string' ? data.lyrics : '';
  if (!lyrics && typeof data.timestamped === 'string') {
    lyrics = data.timestamped;
  }
  if (!lyrics && Array.isArray(data.timed_lyrics)) {
    lyrics = formatTimedLines(data.timed_lyrics);
  }
  if (lyrics.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(lyrics);
      if (Array.isArray(parsed)) {
        lyrics = formatTimedLines(parsed);
      }
    } catch {
      // A normal LRC string also starts with `[`. Keep it unchanged.
    }
  }

  if (!lyrics.trim() || /<div|<html|<!doctype/i.test(lyrics)) {
    return null;
  }
  return lyrics.trim();
}

function formatTimedLines(value: unknown[]): string {
  return value
    .filter(isRecord)
    .map((line) => {
      const milliseconds = Number(line.start_time ?? 0);
      const safeMilliseconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
      const minutes = Math.floor(safeMilliseconds / 60_000);
      const seconds = Math.floor((safeMilliseconds % 60_000) / 1_000);
      const centiseconds = Math.floor((safeMilliseconds % 1_000) / 10);
      const text = typeof line.text === 'string' ? line.text : '';
      return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}] ${text}`;
    })
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
