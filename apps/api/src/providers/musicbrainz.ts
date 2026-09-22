import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

/**
 * Which record a song actually came from.
 *
 * The streaming provider lists one row per *licence*, so a viral song comes back on
 * twenty playlist "albums" — "Throwback TikTok Songs", "Summer Nights Sounds" — and
 * often not once on the record it was released on. Every row then carries the
 * playlist's cover, which is what the listener sees.
 *
 * MusicBrainz knows the difference: a release group is typed, and an editorial
 * compilation is tagged `Compilation` in its secondary types. Filtering to a plain
 * `Album` with no secondary type and taking the earliest leaves the original record.
 * Its cover comes from the Cover Art Archive, keyed on the same release group.
 *
 * Both are free, need no key, and are rate limited to roughly one request a second
 * per IP — so callers must cache, and must only ask about rows that need it.
 */

export interface CanonicalRelease {
  /** The record the song was released on, e.g. `Long Way Down`. */
  readonly album: string;
  readonly year: number | null;
  /** Front cover from the Cover Art Archive, or null when it has none. */
  readonly coverUrl: string | null;
}

/** The seam: anything that can name a song's original record. */
export interface ReleaseAuthority {
  canonical(title: string, artist: string, durationSeconds?: number): Promise<CanonicalRelease | null>;
}

interface MbReleaseGroup {
  readonly id?: string;
  readonly 'primary-type'?: string | null;
  readonly 'secondary-types'?: readonly string[] | null;
}

interface MbRelease {
  readonly title?: string;
  readonly date?: string | null;
  readonly 'release-group'?: MbReleaseGroup;
}

interface MbRecording {
  readonly score?: number;
  readonly length?: number | null;
  readonly releases?: readonly MbRelease[];
}

export interface MusicBrainzOptions {
  readonly baseUrl?: string;
  readonly coverArtUrl?: string;
  /** MusicBrainz requires a contact in the User-Agent; anonymous agents get throttled harder. */
  readonly contact: string;
  readonly appVersion?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/** A recording this far from the provider's duration is a different take, not the same master. */
const MAX_LENGTH_DRIFT_SECONDS = 4;
/** Below this the search matched on something other than the title and artist. */
const MIN_SCORE = 90;
/** One request per second per IP, with headroom. Shared by both hosts. */
const MIN_REQUEST_GAP_MS = 1_100;

export class MusicBrainzReleaseAuthority implements ReleaseAuthority {
  private readonly baseUrl: string;
  private readonly coverArtUrl: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  /** Requests are chained rather than fired in parallel: the limit is per IP, not per caller. */
  private gate: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  public constructor(options: MusicBrainzOptions) {
    this.baseUrl = options.baseUrl ?? 'https://musicbrainz.org/ws/2';
    this.coverArtUrl = options.coverArtUrl ?? 'https://coverartarchive.org';
    this.userAgent = `Allegra/${options.appVersion ?? '0.1.0'} ( ${options.contact} )`;
    this.timeoutMs = options.timeoutMs ?? 6_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async canonical(title: string, artist: string, durationSeconds?: number): Promise<CanonicalRelease | null> {
    const recordings = await this.searchRecordings(title, artist);
    if (recordings.length === 0) return null;

    const best = electRelease(recordings, durationSeconds);
    if (!best) return null;

    const coverUrl = best.releaseGroupId ? await this.coverFor(best.releaseGroupId) : null;
    return { album: best.album, year: best.year, coverUrl };
  }

  private async searchRecordings(title: string, artist: string): Promise<readonly MbRecording[]> {
    const query = `recording:"${lucene(title)}" AND artist:"${lucene(artist)}"`;
    const url = new URL(`${this.baseUrl}/recording`);
    url.searchParams.set('query', query);
    url.searchParams.set('fmt', 'json');
    url.searchParams.set('limit', '25');

    const response = await this.request(url);
    if (!response?.ok) return [];
    try {
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null || !('recordings' in body)) return [];
      const recordings = (body as { recordings?: unknown }).recordings;
      return Array.isArray(recordings) ? (recordings as MbRecording[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * The Cover Art Archive answers 404 for a release group nobody has uploaded art for,
   * so the URL is confirmed before it replaces a cover that already loads.
   */
  private async coverFor(releaseGroupId: string): Promise<string | null> {
    const url = `${this.coverArtUrl}/release-group/${releaseGroupId}/front-500`;
    const response = await this.request(new URL(url), 'HEAD');
    return response?.ok ? url : null;
  }

  private async request(url: URL, method: 'GET' | 'HEAD' = 'GET'): Promise<Response | null> {
    const run = this.gate.then(async () => {
      const wait = MIN_REQUEST_GAP_MS - (Date.now() - this.lastRequestAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastRequestAt = Date.now();
      try {
        return await fetchWithTimeout(
          url,
          { method, headers: { Accept: 'application/json', 'User-Agent': this.userAgent } },
          this.timeoutMs,
          this.fetchImpl
        );
      } catch {
        // Rule: an outbound call returns empty, never throws — the cascade stays alive.
        return null;
      }
    });
    // The gate must advance even when this call fails, or every later lookup deadlocks.
    this.gate = run.catch(() => undefined);
    return run;
  }
}

interface ElectedRelease {
  readonly album: string;
  readonly year: number | null;
  readonly releaseGroupId: string | null;
}

/**
 * The earliest plain `Album` release of a recording that matches the duration we hold.
 * Exported so the election can be tested without reaching MusicBrainz.
 */
export function electRelease(
  recordings: readonly MbRecording[],
  durationSeconds?: number
): ElectedRelease | null {
  let best: { date: string; release: ElectedRelease } | null = null;

  for (const recording of recordings) {
    if ((recording.score ?? 0) < MIN_SCORE) continue;
    if (durationSeconds !== undefined && recording.length) {
      // A live take or an edit shares the title and artist; only the clock separates them.
      if (Math.abs(recording.length / 1000 - durationSeconds) > MAX_LENGTH_DRIFT_SECONDS) continue;
    }

    for (const release of recording.releases ?? []) {
      const group = release['release-group'];
      if (!group || group['primary-type'] !== 'Album') continue;
      if ((group['secondary-types'] ?? []).length > 0) continue;
      const album = release.title?.trim();
      if (!album) continue;

      // Undated releases sort last, so a dated original always wins over a reissue with no date.
      const date = release.date?.trim() || '9999';
      if (best && date >= best.date) continue;
      const year = Number.parseInt(date.slice(0, 4), 10);
      best = {
        date,
        release: {
          album,
          year: Number.isInteger(year) && year > 1900 && year < 2100 ? year : null,
          releaseGroupId: group.id ?? null
        }
      };
    }
  }

  return best?.release ?? null;
}

/**
 * A title's own qualifiers are noise to MusicBrainz — it indexes `Hayyoda`, not
 * `Hayyoda (From "Jawan")` — and the quote would close the phrase early besides.
 */
function lucene(value: string): string {
  return value
    .replace(/[([{][^)\]}]*[)\]}]/gu, ' ')
    .replace(/["\\]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
