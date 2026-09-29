import { fetchBodyWithTimeout } from '../lib/fetchWithTimeout.js';
import { isRecord, looksLikeHtml, type LyricsCandidate } from './lyricsCandidate.js';

const DEFAULT_BASE_URL = 'https://lyrics.kugou.com';
const DEFAULT_TIMEOUT_MS = 8_000;
/** Seconds a candidate may differ from the song; past that it is likely another recording. */
const DURATION_TOLERANCE_SECONDS = 8;
/** Credit lines ("Lyrics by：…") are only trimmed from this far into either end. */
const CREDIT_SCAN_LINES = 30;
const TIMED_LINE = /^\[\d{2}:\d{2}\.\d{2,3}\].*/;
// A credit's colon: KuGou's full-width one, or "… by:". A lyric with a plain colon is not a credit.
const CREDIT_LINE = /\][^\]]{0,60}(?:：|\bby\s*:)/i;

export interface KuGouProviderOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface KuGouCandidate {
  readonly id: string;
  readonly accessKey: string;
  readonly duration?: number;
}

/** KuGou's lyric search: a large, mostly Chinese and Western catalogue of synced LRC. */
export class KuGouProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: KuGouProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async find(title: string, artist: string, duration: number | undefined): Promise<LyricsCandidate | null> {
    return (await this.findAll(title, artist, duration, 1))[0] ?? null;
  }

  /** Up to `limit` candidates' lyrics, best first. */
  public async findAll(title: string, artist: string, duration: number | undefined, limit = 3): Promise<LyricsCandidate[]> {
    const candidates = (await this.search(title, artist, duration)).slice(0, limit);
    const downloaded = await Promise.all(candidates.map((candidate) => this.download(candidate)));
    return downloaded.filter((lyrics): lyrics is string => lyrics !== null).map((lyrics) => ({ lyrics, source: 'KuGou' }));
  }

  private async search(title: string, artist: string, duration: number | undefined): Promise<KuGouCandidate[]> {
    try {
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set('ver', '1');
      url.searchParams.set('man', 'yes');
      url.searchParams.set('client', 'pc');
      url.searchParams.set('keyword', `${normalizeTitle(title)} - ${normalizeArtist(artist)}`);
      if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
        url.searchParams.set('duration', String(Math.round(duration * 1000)));
      }
      const response = await fetchBodyWithTimeout(url, { headers: { Accept: 'application/json' } }, this.timeoutMs, this.fetchImpl);
      if (!response.ok) return [];
      const body: unknown = JSON.parse(response.body);
      if (!isRecord(body) || !Array.isArray(body.candidates)) return [];
      return body.candidates
        .filter(isRecord)
        .map((candidate) => ({
          id: String(candidate.id ?? ''),
          accessKey: typeof candidate.accesskey === 'string' ? candidate.accesskey : '',
          ...(typeof candidate.duration === 'number' ? { duration: candidate.duration } : {})
        }))
        .filter((candidate) => candidate.id && candidate.accessKey)
        .filter((candidate) => duration === undefined || candidate.duration === undefined || Math.abs(toSeconds(candidate.duration) - duration) <= DURATION_TOLERANCE_SECONDS);
    } catch {
      return [];
    }
  }

  private async download(candidate: KuGouCandidate): Promise<string | null> {
    try {
      const url = new URL(`${this.baseUrl}/download`);
      url.searchParams.set('fmt', 'lrc');
      url.searchParams.set('charset', 'utf8');
      url.searchParams.set('client', 'pc');
      url.searchParams.set('ver', '1');
      url.searchParams.set('id', candidate.id);
      url.searchParams.set('accesskey', candidate.accessKey);
      const response = await fetchBodyWithTimeout(url, { headers: { Accept: 'application/json' } }, this.timeoutMs, this.fetchImpl);
      if (!response.ok) return null;
      const body: unknown = JSON.parse(response.body);
      if (!isRecord(body) || typeof body.content !== 'string') return null;
      const lyrics = withoutCredits(Buffer.from(body.content, 'base64').toString('utf8'));
      return lyrics && !looksLikeHtml(lyrics) ? lyrics : null;
    } catch {
      return null;
    }
  }
}

/** KuGou reports candidate duration in milliseconds or seconds depending on the entry. */
function toSeconds(value: number): number {
  return value > 10_000 ? value / 1000 : value;
}

function normalizeTitle(title: string): string {
  return title.replace(/[(（「『<《〈＜][^)）」』>》〉＞]*[)）」』>》〉＞]/g, '').trim();
}

function normalizeArtist(artist: string): string {
  return artist.replace(/, | & /g, '、').replace(/\./g, '').replace(/\([^)]*\)|（[^）]*）/g, '').trim();
}

/** Timed lines only, with the credit block ("Lyrics by：…", "Composed by：…") cut from either end. */
function withoutCredits(raw: string): string {
  const lines = raw.split(/\r?\n/).filter((line) => TIMED_LINE.test(line));
  let head = 0;
  for (let index = Math.min(CREDIT_SCAN_LINES, lines.length - 1); index >= 0; index -= 1) {
    if (CREDIT_LINE.test(lines[index] ?? '')) {
      head = index + 1;
      break;
    }
  }
  // At the end, only a closing run of credit lines goes.
  let tail = lines.length;
  while (tail > head && CREDIT_LINE.test(lines[tail - 1] ?? '')) {
    tail -= 1;
  }
  return lines.slice(head, tail).join('\n').trim();
}
