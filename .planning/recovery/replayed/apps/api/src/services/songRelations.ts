import { songIdentity } from '../lib/normalize.js';
import type { UnifiedSong } from '../types.js';
import type { RelatedSongSource } from './recommendations.js';

/** A song's neighbours, strongest first, as catalog rows. */
export interface SongRelation {
  readonly songId: string;
  readonly songs: readonly UnifiedSong[];
  readonly updatedAt: string;
}

/** Where relations are kept. Convex in production; memory for tests and local dev without it. */
export interface RelationStore {
  getMany(songIds: readonly string[]): Promise<Map<string, SongRelation>>;
  put(relation: SongRelation): Promise<void>;
}

export class MemoryRelationStore implements RelationStore {
  private readonly rows = new Map<string, SongRelation>();

  public async getMany(songIds: readonly string[]): Promise<Map<string, SongRelation>> {
    const found = new Map<string, SongRelation>();
    for (const id of songIds) {
      const row = this.rows.get(id);
      if (row) found.set(id, row);
    }
    return found;
  }

  public async put(relation: SongRelation): Promise<void> {
    this.rows.set(relation.songId, relation);
  }
}

export interface RelationCatalog {
  getSuggestions(id: string, limit: number): Promise<UnifiedSong[]>;
}

export interface SongRelationsOptions {
  /** Missing relations worked out per call; the rest wait for a later shelf. */
  readonly computePerCall?: number;
  readonly maxAgeDays?: number;
}

const SUGGESTIONS = 15;
const RADIO = 12;
const KEEP = 25;
const RADIO_WEIGHT = 1.15;

/**
 * Echo's related_song_map: for every song a listener plays, remember which songs go with it.
 * Built from YouTube Music's song radio and the catalog's suggestions, merged so a song both
 * name ranks first. A relation is the same for every listener, so it is stored once and shared,
 * and a shelf with twenty seeds costs one read instead of forty provider calls.
 *
 * Nothing here runs in the background: each call fills in a few missing seeds, strongest first,
 * so the map grows with listening and a shelf never waits on more than a handful of lookups.
 */
export class SongRelations {
  private readonly computePerCall: number;
  private readonly maxAgeMs: number;

  public constructor(
    private readonly catalog: RelationCatalog,
    private readonly store: RelationStore,
    /** The radio half. Absent when YouTube Music is switched off. */
    private readonly radio?: RelatedSongSource,
    options: SongRelationsOptions = {}
  ) {
    this.computePerCall = options.computePerCall ?? 4;
    this.maxAgeMs = (options.maxAgeDays ?? 30) * 86_400_000;
  }

  /** Neighbours for each seed that has (or could be given, this call) a relation. */
  public async forSeeds(seeds: readonly UnifiedSong[], now = new Date()): Promise<Map<string, readonly UnifiedSong[]>> {
    const stored = await this.read(seeds.map((seed) => seed.id));
    const result = new Map<string, readonly UnifiedSong[]>();
    const toCompute: UnifiedSong[] = [];
    for (const seed of seeds) {
      const relation = stored.get(seed.id);
      if (relation) result.set(seed.id, relation.songs);
      const stale = !relation || now.getTime() - Date.parse(relation.updatedAt) > this.maxAgeMs;
      if (stale && toCompute.length < this.computePerCall) toCompute.push(seed);
    }
    const computed = await Promise.all(toCompute.map((seed) => this.compute(seed, now)));
    computed.forEach((songs, index) => {
      const seed = toCompute[index];
      // A failed recompute keeps the stale relation rather than blanking it.
      if (seed && songs.length > 0) result.set(seed.id, songs);
    });
    return result;
  }

  private async read(songIds: readonly string[]): Promise<Map<string, SongRelation>> {
    try {
      return await this.store.getMany([...new Set(songIds)]);
    } catch {
      return new Map();
    }
  }

  private async compute(seed: UnifiedSong, now: Date): Promise<readonly UnifiedSong[]> {
    const radio = this.radio;
    const [suggestions, radioSongs] = await Promise.all([
      safe(() => this.catalog.getSuggestions(seed.id, SUGGESTIONS)),
      radio ? safe(() => radio.related(seed, RADIO)) : Promise.resolve([])
    ]);
    const songs = merge(seed, radioSongs, suggestions);
    // Only remember a complete answer. With the radio configured but silent (YouTube refusing,
    // or the seed unknown to it) the catalog half is used today and the seed is retried later,
    // instead of freezing a weaker relation for a month.
    const complete = songs.length > 0 && (!radio || radioSongs.length > 0);
    if (complete) {
      try {
        await this.store.put({ songId: seed.id, songs, updatedAt: now.toISOString() });
      } catch {
        // The shelf still gets the answer; the next one recomputes.
      }
    }
    return songs;
  }
}

function merge(seed: UnifiedSong, radio: readonly UnifiedSong[], suggestions: readonly UnifiedSong[]): UnifiedSong[] {
  const seedIdentity = songIdentity(seed);
  const scored = new Map<string, { song: UnifiedSong; score: number }>();
  const add = (songs: readonly UnifiedSong[], weight: number): void => {
    songs.forEach((song, rank) => {
      const identity = songIdentity(song);
      if (song.id === seed.id || identity === seedIdentity) return;
      const value = weight * (1 - rank * 0.03);
      const existing = scored.get(identity);
      if (existing) existing.score += value;
      else scored.set(identity, { song: snapshot(song), score: value });
    });
  };
  add(radio, RADIO_WEIGHT);
  add(suggestions, 1);
  return [...scored.values()].sort((left, right) => right.score - left.score).slice(0, KEEP).map((entry) => entry.song);
}

/** What a relation keeps of a row: no nested variants, so stored rows stay small. */
function snapshot(song: UnifiedSong): UnifiedSong {
  if (!song.variants) return song;
  const row: { -readonly [K in keyof UnifiedSong]?: UnifiedSong[K] } = { ...song };
  delete row.variants;
  return row as UnifiedSong;
}

async function safe(load: () => Promise<readonly UnifiedSong[]>): Promise<readonly UnifiedSong[]> {
  try {
    return await load();
  } catch {
    return [];
  }
}
