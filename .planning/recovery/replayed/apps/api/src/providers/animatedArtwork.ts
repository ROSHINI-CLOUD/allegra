import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';
import type { MotionArtwork } from '../types.js';

export interface CanvasQuery {
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  /** Seconds. Lets the lookup pick the right version of a track. */
  readonly duration?: number;
}

/** Any source of Apple album motion artwork. Implementations return null on every failure. */
export interface CanvasProvider {
  find(query: CanvasQuery): Promise<MotionArtwork | null>;
}

export interface AnimatedArtworkProviderOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** artwork.boidu.dev response fields we consume. `error` marks a definitive "no artwork". */
interface BoiduArtworkResponse {
  readonly artist?: unknown;
  readonly animated?: unknown;
  readonly videoUrl?: unknown;
  readonly error?: unknown;
}

/** artwork.m8tec.top response fields we consume. 404 means no artwork. */
interface M8tecArtworkResponse {
  readonly artist?: unknown;
  readonly url?: unknown;
}

/**
 * Better Lyrics' public Artwork API. It resolves Apple Music motion artwork server-side and
 * returns a direct MP4 alongside the HLS playlist; the MP4 plays in a plain <video> in every
 * browser, so it is preferred.
 */
export class BoiduArtworkProvider implements CanvasProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: AnimatedArtworkProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  public async find(query: CanvasQuery): Promise<MotionArtwork | null> {
    try {
      const url = new URL(`${this.baseUrl}/`);
      url.searchParams.set('s', query.title);
      url.searchParams.set('a', query.artist);
      if (query.album) url.searchParams.set('al', query.album);
      if (query.duration !== undefined && Number.isFinite(query.duration) && query.duration > 0) {
        url.searchParams.set('d', String(Math.round(query.duration)));
      }
      const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json', 'User-Agent': 'Allegra/1.0' } }, this.timeoutMs, this.fetchImpl);
      if (!response.ok) return null;
      const body: unknown = await response.json();
      if (!isRecord(body)) return null;
      const result = body as BoiduArtworkResponse;
      if (result.error !== undefined && result.error !== null) return null;
      if (!sameArtist(query.artist, result.artist)) return null;
      const videoUrl = [result.videoUrl, result.animated].find(appleMediaUrl);
      return typeof videoUrl === 'string' ? { source: 'Apple Music', videoUrl } : null;
    } catch {
      return null;
    }
  }
}

/** m8tec's public Animated Artworks API. HLS only, and it needs the album name to search. */
export class M8tecArtworkProvider implements CanvasProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  public constructor(options: AnimatedArtworkProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  public async find(query: CanvasQuery): Promise<MotionArtwork | null> {
    if (!query.album) return null;
    try {
      const url = new URL(`${this.baseUrl}/api/v1/artwork/search`);
      url.searchParams.set('artist', query.artist);
      url.searchParams.set('album', query.album);
      url.searchParams.set('title', query.title);
      const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json', 'User-Agent': 'Allegra/1.0' } }, this.timeoutMs, this.fetchImpl);
      if (!response.ok) return null;
      const body: unknown = await response.json();
      if (!isRecord(body)) return null;
      const result = body as M8tecArtworkResponse;
      if (!sameArtist(query.artist, result.artist)) return null;
      return appleMediaUrl(result.url) ? { source: 'Apple Music', videoUrl: result.url } : null;
    } catch {
      return null;
    }
  }
}

/**
 * The URL ends up in the listener's <video src>, so only Apple's own media hosts are accepted —
 * a compromised third-party API cannot point the player anywhere else.
 */
function appleMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (host === 'apple.com' || host.endsWith('.apple.com'));
  } catch {
    return false;
  }
}

/** A missing artist field is trusted; a present one must overlap, so a bad match never replaces the cover. */
function sameArtist(wanted: string, actual: unknown): boolean {
  if (typeof actual !== 'string' || !actual.trim()) return true;
  const left = normalize(wanted);
  const right = normalize(actual);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
