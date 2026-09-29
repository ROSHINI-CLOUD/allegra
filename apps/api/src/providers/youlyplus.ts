import { fetchBodyWithTimeout } from '../lib/fetchWithTimeout.js';
import { isRecord, looksLikeHtml, lrcStamp, type LyricsCandidate } from './lyricsCandidate.js';

/**
 * Community instances of the open-source LyricsPlus backend (the YouLyPlus extension's KPoe
 * servers). Instances come and go; the dead ones fail fast, so they are raced rather than tried
 * in turn.
 */
export const DEFAULT_YOULYPLUS_SERVERS = [
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one'
] as const;

const DEFAULT_TIMEOUT_MS = 8_000;

export interface YouLyPlusProviderOptions {
  readonly servers?: readonly string[];
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** LyricsPlus (`GET /v2/lyrics/get`): Apple, Musixmatch and other sources behind one API, often word-timed. */
export class YouLyPlusProvider {
  private readonly servers: readonly string[];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  /** The instance that answered last, raced first next time. */
  private lastWorking: string | null = null;

  public constructor(options: YouLyPlusProviderOptions = {}) {
    this.servers = (options.servers ?? DEFAULT_YOULYPLUS_SERVERS).map((server) => server.replace(/\/+$/, ''));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async find(title: string, artist: string, duration: number | undefined): Promise<LyricsCandidate | null> {
    const ordered = this.lastWorking ? [this.lastWorking, ...this.servers.filter((server) => server !== this.lastWorking)] : [...this.servers];
    try {
      // The first instance with usable lyrics wins; the rest are left to their own timeouts.
      return await Promise.any(
        ordered.map(async (server) => {
          const found = await this.fromServer(server, title, artist, duration);
          if (!found) throw new Error('no lyrics');
          this.lastWorking = server;
          return found;
        })
      );
    } catch {
      return null;
    }
  }

  private async fromServer(server: string, title: string, artist: string, duration: number | undefined): Promise<LyricsCandidate | null> {
    try {
      const url = new URL(`${server}/v2/lyrics/get`);
      url.searchParams.set('title', title);
      url.searchParams.set('artist', artist);
      if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
        url.searchParams.set('duration', String(Math.round(duration)));
      }
      const response = await fetchBodyWithTimeout(url, { headers: { Accept: 'application/json', 'User-Agent': 'Allegra/1.0' } }, this.timeoutMs, this.fetchImpl);
      if (!response.ok) return null;
      return toCandidate(JSON.parse(response.body));
    } catch {
      return null;
    }
  }
}

function toCandidate(body: unknown): LyricsCandidate | null {
  if (!isRecord(body) || !Array.isArray(body.lyrics)) {
    return null;
  }
  const lines = body.lyrics.filter(isRecord).map((line) => ({
    time: typeof line.time === 'number' ? line.time : null,
    text: typeof line.text === 'string' ? line.text.trim() : ''
  }));
  if (lines.length === 0) {
    return null;
  }
  // "None" (or no times at all) is unsynced text.
  const synced = body.type !== 'None' && lines.some((line) => line.time !== null && line.time > 0);
  const lyrics = lines.map((line) => (synced ? `${lrcStamp(line.time ?? 0)} ${line.text}` : line.text)).join('\n').trim();
  if (!lyrics || looksLikeHtml(lyrics)) {
    return null;
  }
  const metadata = isRecord(body.metadata) ? body.metadata : {};
  const source = typeof metadata.source === 'string' && metadata.source ? `LyricsPlus(${metadata.source.replace(/^q/, '')})` : 'LyricsPlus';
  const filedAs = [metadata.artist, metadata.title].filter((part): part is string => typeof part === 'string' && part.length > 0).join(' — ');
  return filedAs ? { lyrics, source, filedAs } : { lyrics, source };
}
