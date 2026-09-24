import { CircuitBreaker } from '../lib/circuitBreaker.js';
import { fetchWithTimeout } from '../lib/fetchWithTimeout.js';

export interface YouTubeMusicProviderOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** One song row from YouTube Music. Only used as a pointer: playback always stays on the catalog. */
export interface YouTubeMusicTrack {
  readonly videoId: string;
  readonly title: string;
  readonly artists: readonly string[];
  /** Seconds. */
  readonly duration?: number;
}

// The same web client music.youtube.com itself sends. Metadata only: search and the song radio.
const CONTEXT = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20260916.01.00', hl: 'en', gl: 'IN' } };
const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Origin: 'https://music.youtube.com',
  Referer: 'https://music.youtube.com/'
};
// The "Songs" chip on a YouTube Music search: tracks only, no videos, albums or playlists.
const SONGS_FILTER = 'EgWKAQIIAWoQEBAQCRAEEAMQBRAKEBUQEQ==';

/**
 * YouTube Music's own "what plays next" graph, used as a recommendation signal. It knows which
 * songs go together from what its listeners actually play, which is the part JioSaavn's per-song
 * suggestions are weakest at. Returns empty on any failure, and a breaker stops a blocked or
 * changed endpoint from adding its timeout to every shelf.
 */
export class YouTubeMusicProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly breaker = new CircuitBreaker(3, 10 * 60_000);

  public constructor(options: YouTubeMusicProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
  }

  /** The best song row for a title and artist, or null. */
  public async findSong(title: string, artist: string): Promise<YouTubeMusicTrack | null> {
    const body = await this.post('search', { query: `${title} ${artist}`, params: SONGS_FILTER });
    const tracks = searchTracks(body);
    return tracks.find((track) => sameSong(track, title, artist)) ?? null;
  }

  /** The song radio for a video, strongest first, without the seed itself. */
  public async radio(videoId: string, limit: number): Promise<YouTubeMusicTrack[]> {
    const body = await this.post('next', { videoId, playlistId: `RDAMVM${videoId}`, isAudioOnly: true, enablePersistentPlaylistPanel: true });
    return radioTracks(body).filter((track) => track.videoId !== videoId).slice(0, limit);
  }

  private async post(endpoint: 'search' | 'next', body: Record<string, unknown>): Promise<unknown> {
    if (this.breaker.isOpen) return null;
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/${endpoint}?prettyPrint=false`,
        { method: 'POST', headers: HEADERS, body: JSON.stringify({ context: CONTEXT, ...body }) },
        this.timeoutMs,
        this.fetchImpl
      );
      if (!response.ok) {
        this.breaker.failure();
        return null;
      }
      const json: unknown = await response.json();
      this.breaker.success();
      return json;
    } catch {
      this.breaker.failure();
      return null;
    }
  }
}

// ── Response shapes: narrow, covering only what is read ──────────────────────

interface Run {
  readonly text?: string;
  readonly navigationEndpoint?: {
    readonly browseEndpoint?: {
      readonly browseEndpointContextSupportedConfigs?: {
        readonly browseEndpointContextMusicConfig?: { readonly pageType?: string };
      };
    };
  };
}

interface ListItem {
  readonly playlistItemData?: { readonly videoId?: string };
  readonly flexColumns?: readonly { readonly musicResponsiveListItemFlexColumnRenderer?: { readonly text?: { readonly runs?: readonly Run[] } } }[];
}

interface QueueItem {
  readonly videoId?: string;
  readonly title?: { readonly runs?: readonly Run[] };
  readonly longBylineText?: { readonly runs?: readonly Run[] };
  readonly lengthText?: { readonly runs?: readonly Run[] };
}

function searchTracks(body: unknown): YouTubeMusicTrack[] {
  const tabs = dig(body, ['contents', 'tabbedSearchResultsRenderer', 'tabs']);
  const sections = dig(first(tabs), ['tabRenderer', 'content', 'sectionListRenderer', 'contents']);
  const tracks: YouTubeMusicTrack[] = [];
  for (const section of asArray(sections)) {
    for (const entry of asArray(dig(section, ['musicShelfRenderer', 'contents']))) {
      const item = dig(entry, ['musicResponsiveListItemRenderer']) as ListItem | undefined;
      const track = item ? fromListItem(item) : null;
      if (track) tracks.push(track);
    }
  }
  return tracks;
}

function fromListItem(item: ListItem): YouTubeMusicTrack | null {
  const videoId = item.playlistItemData?.videoId;
  const columns = item.flexColumns ?? [];
  const title = columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text;
  const byline = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
  if (!videoId || !title) return null;
  return track(videoId, title, byline, lastSegment(byline));
}

function radioTracks(body: unknown): YouTubeMusicTrack[] {
  const tabs = dig(body, ['contents', 'singleColumnMusicWatchNextResultsRenderer', 'tabbedRenderer', 'watchNextTabbedResultsRenderer', 'tabs']);
  const items = dig(first(tabs), ['tabRenderer', 'content', 'musicQueueRenderer', 'content', 'playlistPanelRenderer', 'contents']);
  const tracks: YouTubeMusicTrack[] = [];
  for (const entry of asArray(items)) {
    // Some rows come wrapped (a counterpart video offered next to the song); the song is primary.
    const item = (dig(entry, ['playlistPanelVideoRenderer'])
      ?? dig(entry, ['playlistPanelVideoWrapperRenderer', 'primaryRenderer', 'playlistPanelVideoRenderer'])) as QueueItem | undefined;
    const title = item?.title?.runs?.[0]?.text;
    if (!item?.videoId || !title) continue;
    tracks.push(track(item.videoId, title, item.longBylineText?.runs ?? [], item.lengthText?.runs?.[0]?.text));
  }
  return tracks;
}

function track(videoId: string, title: string, byline: readonly Run[], length: string | undefined): YouTubeMusicTrack {
  const duration = parseDuration(length);
  return { videoId, title, artists: bylineArtists(byline), ...(duration !== undefined ? { duration } : {}) };
}

/**
 * "Artist • Album • 4:22". Linked artists carry an artist page type; an artist with no channel is
 * plain text, so without any links everything before the first separator is the credit.
 */
function bylineArtists(runs: readonly Run[]): string[] {
  const linked = runs
    .filter((run) => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST')
    .map((run) => run.text?.trim() ?? '')
    .filter(Boolean);
  if (linked.length > 0) return linked;
  const lead = runs.map((run) => run.text ?? '').join('').split(' • ')[0] ?? '';
  return lead.split(/\s*(?:,|&)\s*/).map((name) => name.trim()).filter(Boolean);
}

function lastSegment(runs: readonly Run[]): string | undefined {
  return runs.map((run) => run.text ?? '').join('').split(' • ').pop();
}

function parseDuration(value: string | undefined): number | undefined {
  if (!value || !/^\d+(?::\d{1,2}){1,2}$/.test(value.trim())) return undefined;
  return value.trim().split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

/** Same song if the titles agree once trailers are dropped and at least one artist is shared. */
export function sameSong(track: YouTubeMusicTrack, title: string, artist: string): boolean {
  if (plainTitle(track.title) !== plainTitle(title)) return false;
  const wanted = new Set(artistTokens(artist));
  return track.artists.some((name) => artistTokens(name).some((token) => wanted.has(token)));
}

export function plainTitle(value: string): string {
  return flat(value.replace(/[([][^)\]]*[)\]]/gu, ' ').replace(/\s-\s.*$/u, ''));
}

function artistTokens(value: string): string[] {
  return value.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/iu).map(flat).filter(Boolean);
}

function flat(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function dig(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
