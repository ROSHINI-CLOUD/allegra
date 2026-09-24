import { cachedLookup, cacheKey, type CacheStore } from '../lib/cache.js';
import { inLanguages, languagesKey } from '../lib/languages.js';
import { songIdentity } from '../lib/normalize.js';
import type { UnifiedSong } from '../types.js';
import { MemoryRelationStore, SongRelations, type RelationStore } from './songRelations.js';

/** The catalog calls this needs — narrow on purpose so tests can fake them. */
export interface RecommendationCatalog {
  getSuggestions(id: string, limit: number): Promise<UnifiedSong[]>;
  getArtist(name: string): Promise<{ readonly songs: readonly UnifiedSong[] }>;
  search(query: string, limit: number, page: number): Promise<{ readonly results: readonly UnifiedSong[] }>;
}

/** Songs that listeners of a seed go on to play, already as catalog rows, strongest first. */
export interface RelatedSongSource {
  related(seed: UnifiedSong, limit: number): Promise<readonly UnifiedSong[]>;
}

export interface TasteContext {
  /** Songs to find more like: now playing, then recent plays, then likes — strongest first. */
  readonly seeds: readonly UnifiedSong[];
  /** Learned over time, strongest first. */
  readonly favoriteArtists: readonly { readonly name: string; readonly score: number }[];
  /** Learned from listening; nudges ranking only. */
  readonly favoriteLanguages: readonly string[];
  /** The listener's language setting: a hard filter. Empty means every language. */
  readonly languages: readonly string[];
}

export interface RecommendationResult {
  readonly songs: UnifiedSong[];
  readonly provider: string;
  readonly reasoning: string;
}

const HIT_TTL_SECONDS = 1_800;
const MISS_TTL_SECONDS = 300;
const MAX_SEEDS = 4;
const MAX_ARTISTS = 3;
const SUGGESTIONS_PER_SEED = 15;
const RELATED_PER_SEED = 8;
const SONGS_PER_ARTIST = 8;
const MAX_PER_ARTIST = 2;

interface Candidate {
  readonly song: UnifiedSong;
  score: number;
}

/**
 * Recommendations from the catalog alone — no model. JioSaavn already knows which songs go
 * together (its per-song suggestions), and the listener's taste says which artists and languages
 * they come back to, so the shelf is those two blended and ranked:
 *
 *   - suggestions for what they are playing, just played and liked (a song suggested by several
 *     of those ranks higher),
 *   - top songs of their favourite artists, weighted by how strong the affinity is,
 *   - popular songs in their languages when the first two come up short.
 *
 * Anything already heard is dropped, the language setting is applied, and no artist gets more
 * than two slots, so the shelf reads as discovery rather than a replay of the history.
 */
export class RecommendationService {
  public constructor(
    private readonly catalog: RecommendationCatalog,
    private readonly cache: CacheStore
  ) {}

  public get isAvailable(): boolean {
    return true;
  }

  /**
   * `excludeSongs` are the listener's liked and recently played songs. They are wanted in full,
   * not just as ids, because the catalog hands the same recording back under a different release
   * id — so excluding by id alone happily recommends a song already sitting in their likes.
   */
  public async recommend(
    context: TasteContext,
    excludeIds: ReadonlySet<string>,
    excludeSongs: readonly UnifiedSong[] = [],
    limit = 12
  ): Promise<RecommendationResult | null> {
    if (context.seeds.length === 0 && context.favoriteArtists.length === 0 && context.favoriteLanguages.length === 0 && context.languages.length === 0) {
      return null;
    }
    const key = cacheKey(
      'recommend',
      this.relatedSource ? 'relations-v1' : 'catalog-v2',
      String(limit),
      context.seeds.slice(0, MAX_SEEDS).map((song) => song.id).join('|'),
      context.favoriteArtists.slice(0, MAX_ARTISTS).map((artist) => artist.name).join('|'),
      languagesKey(context.languages),
      languagesKey(context.favoriteLanguages.slice(0, 3))
    );
    // Cache the ranked pool; per-request excludes apply on the way out, so a shelf stays reusable
    // while the listener's history grows by a song or two.
    const pool = await cachedLookup(this.cache, {
      key,
      hitTtlSeconds: HIT_TTL_SECONDS,
      missTtlSeconds: MISS_TTL_SECONDS,
      load: () => this.build(context, limit * 3)
    });
    if (!pool) return null;
    const excluded = new Set(excludeSongs.map(songIdentity));
    const songs = diversify(
      pool.songs.filter((song) => !excludeIds.has(song.id) && !excluded.has(songIdentity(song))),
      limit
    );
    return songs.length > 0 ? { ...pool, songs } : null;
  }

  private async build(context: TasteContext, poolSize: number): Promise<RecommendationResult | null> {
    const seeds = uniqueSongs(context.seeds).slice(0, MAX_SEEDS);
    const artists = context.favoriteArtists.slice(0, MAX_ARTISTS);
    const topScore = Math.max(1, ...artists.map((artist) => artist.score));
    const candidates = new Map<string, Candidate>();
    const seedIdentities = new Set(seeds.map(songIdentity));
    const add = (song: UnifiedSong, weight: number): void => {
      if (!inLanguages(song, context.languages)) return;
      const identity = songIdentity(song);
      if (seedIdentities.has(identity)) return;
      const existing = candidates.get(identity);
      if (existing) existing.score += weight;
      else candidates.set(identity, { song, score: weight });
    };

    const [suggestions, artistSongs] = await Promise.all([
      Promise.all(seeds.map((seed) => safe(() => this.catalog.getSuggestions(seed.id, SUGGESTIONS_PER_SEED)))),
      Promise.all(artists.map((artist) => safe(async () => (await this.catalog.getArtist(artist.name)).songs)))
    ]);
    // Earlier seeds are stronger (now playing beats a like from months ago).
    suggestions.forEach((songs, index) => songs.forEach((song) => add(song, 3 - index * 0.4)));
    artistSongs.forEach((songs, index) => {
      const affinity = (artists[index]?.score ?? 0) / topScore;
      songs.slice(0, SONGS_PER_ARTIST).forEach((song, rank) => add(song, 1 + 2 * affinity - rank * 0.05));
    });

    // Short on songs, or nothing to go on but languages: popular songs in their languages.
    const fillLanguages = context.languages.length > 0 ? context.languages : context.favoriteLanguages.slice(0, 2);
    if (candidates.size < poolSize && fillLanguages.length > 0) {
      const fills = await Promise.all(fillLanguages.slice(0, 3).map((language) => safe(async () => (await this.catalog.search(`top ${language} songs`, 20, 0)).results)));
      fills.forEach((songs) => songs.forEach((song) => add(song, 0.8)));
    }

    const favourites = new Map(artists.map((artist) => [artist.name.toLowerCase(), artist.score / topScore]));
    const liked = new Set(context.favoriteLanguages.map((language) => language.toLowerCase()));
    const ranked = [...candidates.values()]
      .map((candidate) => {
        const { song } = candidate;
        const artistBoost = Math.max(0, ...creditedArtists(song).map((name) => favourites.get(name) ?? 0));
        const languageBoost = song.language && liked.has(song.language.toLowerCase()) ? 0.5 : 0;
        const popularity = Math.log10((song.playCount || 0) + 1) * 0.1;
        return { song, score: candidate.score + artistBoost * 1.5 + languageBoost + popularity };
      })
      .sort((left, right) => right.score - left.score)
      .map((candidate) => candidate.song)
      .slice(0, poolSize);
    if (ranked.length === 0) return null;
    return { songs: ranked, provider: 'allegra', reasoning: explain(seeds, artists.map((artist) => artist.name), context.languages) };
  }
}

async function safe<T>(load: () => Promise<readonly T[]>): Promise<readonly T[]> {
  try {
    return await load();
  } catch {
    // One slow artist page or a suggestions miss must not sink the whole shelf.
    return [];
  }
}

function uniqueSongs(songs: readonly UnifiedSong[]): UnifiedSong[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const identity = songIdentity(song);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function creditedArtists(song: UnifiedSong): string[] {
  return song.artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i).map((name) => name.trim().toLowerCase()).filter(Boolean);
}

/** At most two songs per lead artist, keeping rank order. */
function diversify(songs: readonly UnifiedSong[], limit: number): UnifiedSong[] {
  const perArtist = new Map<string, number>();
  const out: UnifiedSong[] = [];
  for (const song of songs) {
    const lead = creditedArtists(song)[0] ?? song.artist.toLowerCase();
    const count = perArtist.get(lead) ?? 0;
    if (count >= MAX_PER_ARTIST) continue;
    perArtist.set(lead, count + 1);
    out.push(song);
    if (out.length === limit) break;
  }
  return out;
}

function explain(seeds: readonly UnifiedSong[], artists: readonly string[], languages: readonly string[]): string {
  const seed = seeds[0];
  const artist = artists[0];
  if (seed && artist && !seed.artist.toLowerCase().includes(artist.toLowerCase())) {
    return `Because you've been playing ${seed.title} and love ${artist}.`;
  }
  if (seed) return `Because you've been playing ${seed.title}.`;
  if (artist) return `Because you love ${artist}.`;
  if (languages.length > 0) return `Popular in ${languages.map(capitalise).join(' and ')} right now.`;
  return 'Picked from what you listen to.';
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
