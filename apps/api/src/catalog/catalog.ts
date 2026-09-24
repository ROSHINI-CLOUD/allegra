import { ProviderUnavailableError, NotFoundError, TimeoutError } from '../lib/errors.js';
import { cacheKey, type CacheStore } from '../lib/cache.js';
import { CircuitBreaker } from '../lib/circuitBreaker.js';
import { isDerivative, queryWantsDerivative } from '../lib/derivative.js';
import { collapseRecordings, needsCanonicalRelease, normalizeSong, songIdentity } from '../lib/normalize.js';
import type { GaanaProvider } from '../providers/gaana.js';
import type { CanonicalRelease, ReleaseAuthority } from '../providers/musicbrainz.js';
import type { ProviderResult, SaavnAsset, SaavnProvider, SaavnSong } from '../providers/saavn.js';
import { decodeHtml, repairMojibake } from '../lib/decodeHtml.js';
import { inLanguages, languagesKey } from '../lib/languages.js';
import type { ArtistProfile, ArtistSummary, HomePayload, UnifiedSong } from '../types.js';

export interface CatalogSearch {
  readonly results: UnifiedSong[];
  readonly source: 'Saavn' | 'Gaana';
}

export interface CatalogOptions {
  readonly saavn: SaavnProvider;
  readonly gaana: GaanaProvider;
  readonly cache: CacheStore;
  /** Names the record a song was released on. Unset leaves the provider's album and cover alone. */
  readonly releaseAuthority?: ReleaseAuthority;
}

export interface SearchOptions {
  /**
   * Correct the top row's album and cover against the release authority. On by
   * default; off for internal searches (shelves, recommendations) that run several
   * queries at once and must not queue up behind a rate limit.
   */
  readonly enrich?: boolean;
}

/** A corrected album name and cover are worth a month; a miss is re-asked tomorrow. */
const RELEASE_TTL_SECONDS = 2_592_000;
const RELEASE_MISS_TTL_SECONDS = 86_400;

/**
 * Originals first, edits after, each side keeping the provider's own order.
 *
 * Left alone when the query asked for an edit: someone typing "another love slowed"
 * wants the slowed one at the top, not buried under the record.
 */
function originalsFirst(songs: readonly UnifiedSong[], query: string): UnifiedSong[] {
  if (queryWantsDerivative(query)) return [...songs];
  const originals: UnifiedSong[] = [];
  const edits: UnifiedSong[] = [];
  for (const song of songs) {
    (isDerivative(song) ? edits : originals).push(song);
  }
  return [...originals, ...edits];
}

export class CatalogService {
  private readonly saavn: SaavnProvider;
  private readonly gaana: GaanaProvider;
  private readonly cache: CacheStore;
  private readonly releaseAuthority: ReleaseAuthority | undefined;
  private readonly saavnBreaker = new CircuitBreaker();
  private readonly gaanaBreaker = new CircuitBreaker();

  public constructor(options: CatalogOptions) {
    this.saavn = options.saavn;
    this.gaana = options.gaana;
    this.cache = options.cache;
    this.releaseAuthority = options.releaseAuthority;
  }

  public async search(query: string, limit: number, page: number, options: SearchOptions = {}): Promise<CatalogSearch> {
    // v4: edits rank below originals, and the top row's album and cover are corrected
    // against the release authority when the provider only has it on a playlist.
    const key = cacheKey('search', 'v4', query, String(limit), String(page));
    const cached = await this.cache.get<CatalogSearch>(key);
    if (cached) {
      return cached;
    }

    // Over-fetch so collapse still fills `limit` when the provider repeats releases.
    const fetchLimit = Math.min(Math.max(limit * 3, limit), 50);
    const saavn = await this.call(this.saavnBreaker, () => this.saavn.search(query, fetchLimit, page));
    if (!saavn.ok) {
      throw unavailable(saavn.reason);
    }

    let raw = saavn.data;
    let source: 'Saavn' | 'Gaana' = 'Saavn';
    if (raw.length === 0) {
      const gaana = await this.tryGaana(query, fetchLimit, page);
      if (gaana) {
        raw = gaana;
        source = 'Gaana';
      }
    }

    const ordered = originalsFirst(collapseRecordings(normalizeMany(raw, source)), query).slice(0, limit);
    const value = {
      results: options.enrich === false ? ordered : await this.withCanonicalRelease(ordered),
      source
    } satisfies CatalogSearch;
    await this.cache.set(key, value, 3600);
    return value;
  }

  /**
   * Put the real record's name and cover on the top row.
   *
   * Only the top row, and only when it needs it: the authority is rate limited to
   * about one request a second, so this is at most one round trip per uncached query.
   * Any failure returns the provider's own data untouched.
   */
  private async withCanonicalRelease(results: readonly UnifiedSong[]): Promise<UnifiedSong[]> {
    const top = results[0];
    if (!this.releaseAuthority || !top || !needsCanonicalRelease(top)) {
      return [...results];
    }

    const key = cacheKey('release', 'v1', top.title, top.artist);
    // `false` is a remembered miss; `null` means we have never asked.
    let canonical = await this.cache.get<CanonicalRelease | false>(key);
    if (canonical === null) {
      canonical = (await this.releaseAuthority.canonical(top.title, top.artist, top.duration)) ?? false;
      await this.cache.set(key, canonical, canonical ? RELEASE_TTL_SECONDS : RELEASE_MISS_TTL_SECONDS);
    }
    if (!canonical) {
      return [...results];
    }

    return [
      {
        ...top,
        album: canonical.album,
        // Keep the provider's cover when the archive has no front image for the record.
        ...(canonical.coverUrl ? { artwork: canonical.coverUrl } : {})
      },
      ...results.slice(1)
    ];
  }

  public async getSong(id: string): Promise<UnifiedSong> {
    const key = cacheKey('song', id);
    const cached = await this.cache.get<UnifiedSong>(key);
    if (cached) {
      return cached;
    }

    const result = await this.call(this.saavnBreaker, () => this.saavn.getSong(id));
    if (!result.ok) {
      throw result.reason === 'timeout' ? new TimeoutError() : new NotFoundError();
    }
    if (!result.data) {
      throw new NotFoundError();
    }
    const song = normalizeSong(result.data, 'Saavn');
    if (!song) {
      throw new NotFoundError();
    }
    await this.cache.set(key, song, 21_600);
    return song;
  }

  public async getSongs(ids: string[]): Promise<UnifiedSong[]> {
    const songs = await Promise.all(ids.map(async (id) => {
      try {
        return await this.getSong(id);
      } catch {
        return null;
      }
    }));
    return songs.filter((song): song is UnifiedSong => song !== null);
  }

  /**
   * Songs like this one. With a language setting, only those languages; when that leaves the list
   * short (a Tamil song's suggestions for a Hindi-only listener), it is topped up with popular songs
   * in their languages so Up next never runs dry.
   */
  public async getSuggestions(id: string, limit: number, languages: readonly string[] = []): Promise<UnifiedSong[]> {
    if (languages.length === 0) return this.getRawSuggestions(id, limit);
    let pool: UnifiedSong[] = [];
    try {
      pool = await this.getRawSuggestions(id, Math.min(30, limit * 2));
    } catch {
      pool = [];
    }
    const picked = pool.filter((song) => inLanguages(song, languages));
    if (picked.length < limit) {
      const seen = new Set([id, ...picked.map((song) => songIdentity(song))]);
      for (const language of languages) {
        if (picked.length >= limit) break;
        let results: UnifiedSong[] = [];
        try {
          results = (await this.search(`top ${language} songs`, 20, 0, { enrich: false })).results;
        } catch {
          continue;
        }
        for (const song of results) {
          if (picked.length >= limit) break;
          const identity = songIdentity(song);
          if (song.id === id || seen.has(identity) || !inLanguages(song, languages)) continue;
          seen.add(identity);
          picked.push(song);
        }
      }
    }
    return picked.slice(0, limit);
  }

  private async getRawSuggestions(id: string, limit: number): Promise<UnifiedSong[]> {
    const key = cacheKey('suggestions', 'v3', id, String(limit));
    const cached = await this.cache.get<UnifiedSong[]>(key);
    if (cached) {
      return cached;
    }

    const fetchLimit = Math.min(Math.max(limit * 3, limit), 50);
    const result = await this.call(this.saavnBreaker, () => this.saavn.getSuggestions(id, fetchLimit));
    if (!result.ok) {
      throw unavailable(result.reason);
    }
    const songs = collapseRecordings(normalizeMany(result.data, 'Saavn')).slice(0, limit);
    await this.cache.set(key, songs, 86_400);
    return songs;
  }

  /** Full artist page data by name: photo, followers, top songs, albums, similar artists. */
  public async getArtist(name: string): Promise<ArtistProfile> {
    const key = cacheKey('artist', normalizeName(name));
    const cached = await this.cache.get<ArtistProfile>(key);
    if (cached) {
      return cached;
    }

    const match = await this.findArtist(name);
    if (!match) {
      throw new NotFoundError();
    }
    const detail = await this.call(this.saavnBreaker, () => this.saavn.getArtist(match.id));
    if (!detail.ok) {
      throw unavailable(detail.reason);
    }
    const raw = detail.data;
    if (!raw) {
      throw new NotFoundError();
    }

    const bio = Array.isArray(raw.bio)
      ? raw.bio.map((part: unknown) => (typeof part === 'object' && part !== null && 'text' in part ? String((part as { text: unknown }).text) : '')).filter(Boolean).join('\n\n')
      : typeof raw.bio === 'string' ? raw.bio : '';
    const albums = [...(raw.topAlbums ?? []), ...(raw.singles ?? [])]
      .filter((album) => album.id !== undefined && album.name)
      .filter((album, index, all) => all.findIndex((other) => String(other.id) === String(album.id)) === index)
      .slice(0, 16)
      .map((album) => ({
        id: String(album.id),
        name: decodeHtml(String(album.name)),
        year: album.year !== undefined && String(album.year) !== '' ? String(album.year) : null,
        image: pickImage(album.image)
      }));
    const profile: ArtistProfile = {
      id: match.id,
      name: decodeHtml(raw.name ?? match.name),
      image: pickImage(raw.image) ?? match.image,
      isVerified: raw.isVerified === true,
      followerCount: toCount(raw.followerCount),
      bio: bio.trim() ? repairMojibake(decodeHtml(bio.trim())) : null,
      songs: normalizeMany([...(raw.topSongs ?? [])], 'Saavn'),
      albums,
      similar: (raw.similarArtists ?? [])
        .filter((artist) => artist.id !== undefined && artist.name)
        .slice(0, 12)
        .map((artist) => ({ id: String(artist.id), name: decodeHtml(String(artist.name)), image: pickImage(artist.image) }))
    };
    await this.cache.set(key, profile, 21_600);
    return profile;
  }

  /** Just names and faces, for avatars on lists. Unmatched names are omitted. */
  public async getArtistFaces(names: readonly string[]): Promise<ArtistSummary[]> {
    const faces = await Promise.all(names.map(async (name) => {
      const key = cacheKey('artist-face', normalizeName(name));
      const cached = await this.cache.get<ArtistSummary | false>(key);
      // `name` is always the spelling the caller sent, so the client can map faces back to its own list.
      if (cached !== null && cached !== undefined) {
        return cached ? { ...cached, name } : null;
      }
      const match = await this.findArtist(name);
      await this.cache.set(key, match ?? false, match ? 86_400 : 3_600);
      return match ? { ...match, name } : null;
    }));
    return faces.filter((face): face is ArtistSummary => face !== null && face.image !== null);
  }

  private async findArtist(name: string): Promise<ArtistSummary | null> {
    try {
      const result = await this.call(this.saavnBreaker, () => this.saavn.searchArtists(name, 6));
      if (!result.ok) {
        return null;
      }
      const wanted = normalizeName(name);
      const candidates = result.data.filter((artist) => artist.id !== undefined && artist.name);
      const chosen = candidates.find((artist) => normalizeName(String(artist.name)) === wanted)
        ?? candidates.find((artist) => normalizeName(String(artist.name)).startsWith(wanted))
        ?? candidates[0];
      return chosen ? { id: String(chosen.id), name: decodeHtml(String(chosen.name)), image: pickImage(chosen.image) } : null;
    } catch {
      return null;
    }
  }

  public async getHome(languages: readonly string[] = []): Promise<HomePayload> {
    if (languages.length > 0) return this.getLanguageHome(languages);
    // v3: originals ranked ahead of edits (same as search v4).
    const cached = await this.cache.get<HomePayload>('home:default:v3');
    if (cached) {
      return cached;
    }

    // Seeds matter: the provider only does text search, so a shelf query that
    // reads like a label ("made for you") comes back as ten unrelated songs
    // literally *titled* "Made For You". These phrases match real music instead.
    const [trending, loved, upbeat] = await Promise.all([
      this.search('top songs', 20, 0, { enrich: false }),
      this.search('romantic hits', 20, 0, { enrich: false }),
      this.search('party songs', 20, 0, { enrich: false })
    ]);

    // The provider also lists the same recording several times over (one row per
    // release, sometimes with the artist list reordered), so an untouched shelf
    // shows the same song three times in a row. Collapse those, and keep a shelf
    // from repeating something an earlier shelf already showed.
    const seen = new Set<string>();
    const shelf = (results: UnifiedSong[], byPopularity = false): UnifiedSong[] => {
      const ordered = byPopularity
        ? [...results].sort((left, right) => (right.playCount ?? 0) - (left.playCount ?? 0))
        : results;
      const songs: UnifiedSong[] = [];
      for (const song of ordered) {
        const key = songIdentity(song);
        if (seen.has(key)) continue;
        seen.add(key);
        songs.push(song);
        if (songs.length === 10) break;
      }
      return songs;
    };
    const home = {
      // Trending keeps the provider's own order — that ordering is the "what's new" signal.
      trending: shelf(trending.results),
      madeForYou: shelf(loved.results, true),
      recommended: shelf(upbeat.results, true)
    } satisfies HomePayload;
    await this.cache.set('home:default:v3', home, 3600);
    return home;
  }

  /**
   * The home shelves for a language setting: the same three shelves, searched per language and
   * interleaved so two languages share each shelf instead of one crowding out the other.
   */
  private async getLanguageHome(languages: readonly string[]): Promise<HomePayload> {
    const key = `home:languages:v1:${languagesKey(languages)}`;
    const cached = await this.cache.get<HomePayload>(key);
    if (cached) return cached;

    const searchAll = async (template: (language: string) => string): Promise<UnifiedSong[][]> =>
      Promise.all(languages.map(async (language) => {
        try {
          return (await this.search(template(language), 20, 0, { enrich: false })).results.filter((song) => inLanguages(song, languages));
        } catch {
          return [];
        }
      }));
    const [trending, loved, upbeat] = await Promise.all([
      searchAll((language) => `top ${language} songs`),
      searchAll((language) => `romantic ${language} hits`),
      searchAll((language) => `${language} party songs`)
    ]);

    const seen = new Set<string>();
    const shelf = (lists: UnifiedSong[][], byPopularity = false): UnifiedSong[] => {
      const ordered = lists.map((list) => (byPopularity ? [...list].sort((left, right) => (right.playCount ?? 0) - (left.playCount ?? 0)) : list));
      const songs: UnifiedSong[] = [];
      for (let round = 0; songs.length < 10 && ordered.some((list) => round < list.length); round++) {
        for (const list of ordered) {
          const song = list[round];
          if (!song) continue;
          const identity = songIdentity(song);
          if (seen.has(identity)) continue;
          seen.add(identity);
          songs.push(song);
          if (songs.length === 10) break;
        }
      }
      return songs;
    };
    const home = { trending: shelf(trending), madeForYou: shelf(loved, true), recommended: shelf(upbeat, true) } satisfies HomePayload;
    // An empty shelf means the provider was down: do not pin that for an hour.
    if (home.trending.length > 0) await this.cache.set(key, home, 3600);
    return home;
  }

  private async tryGaana(query: string, limit: number, page: number): Promise<SaavnSong[] | null> {
    try {
      const gaana = await this.call(this.gaanaBreaker, () => this.gaana.search(query, limit, page));
      if (gaana.ok && gaana.data.length > 0) {
        return gaana.data;
      }
    } catch {
      return null;
    }
    return null;
  }

  private async call<T>(
    breaker: CircuitBreaker,
    operation: () => Promise<ProviderResult<T>>
  ): Promise<ProviderResult<T>> {
    if (breaker.isOpen) {
      throw new ProviderUnavailableError();
    }
    const result = await operation();
    if (result.ok) {
      breaker.success();
    } else {
      breaker.failure();
    }
    return result;
  }
}

function unavailable(reason: 'timeout' | 'error' | undefined): Error {
  return reason === 'timeout' ? new TimeoutError() : new ProviderUnavailableError();
}

function normalizeMany(raw: SaavnSong[], source: 'Saavn' | 'Gaana'): UnifiedSong[] {
  return raw
    .map((song) => normalizeSong(song, source))
    .filter((song): song is UnifiedSong => song !== null)
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === 'Saavn' ? -1 : 1;
      }
      return right.playCount - left.playCount;
    });
}

function normalizeName(value: string): string {
  return decodeHtml(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Largest available image, preferring 500x500. Empty provider placeholders resolve to null. */
function pickImage(assets: readonly SaavnAsset[] | undefined): string | null {
  const usable = (assets ?? []).filter((asset): asset is SaavnAsset & { url: string } => typeof asset.url === 'string' && asset.url.length > 0);
  const best = usable.find((asset) => asset.quality === '500x500') ?? usable[usable.length - 1];
  return best && !/artist-default|default-artist/i.test(best.url) ? best.url : null;
}

function toCount(value: number | string | undefined): number | null {
  const count = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(count) && count >= 0 ? count : null;
}
