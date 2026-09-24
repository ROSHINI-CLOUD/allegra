import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

import type { CoverStorage, StoredCover } from '../lib/covers.js';
import type { GrantLedger } from '../oauth/ledger.js';
import type { RelationStore, SongRelation } from '../services/songRelations.js';
import type { UnifiedSong } from '../types.js';
import type { LibraryRecord, PlayStat, RecentRecord, ShareRecord, TasteEntry, TasteProfile, UserData, UserStore } from '../user/store.js';

/** Function references into convex/profiles.ts and convex/shares.ts. anyApi is untyped, so name what we use. */
const profilesApi = anyApi.profiles as unknown as { readonly get: unknown; readonly byEmail: unknown; readonly save: unknown; readonly identity: unknown };
const sharesApi = anyApi.shares as unknown as { readonly get: unknown; readonly byLibrary: unknown; readonly save: unknown; readonly remove: unknown };
const oauthApi = anyApi.oauth as unknown as { readonly consume: unknown };
const coversApi = anyApi.covers as unknown as { readonly generateUploadUrl: unknown; readonly inspect: unknown; readonly remove: unknown };
const relationsApi = anyApi.relations as unknown as { readonly getMany: unknown; readonly put: unknown };

/** The two calls the store needs. Narrow on purpose so tests can fake it. */
export interface ConvexClientLike {
  query(reference: unknown, args: Record<string, unknown>): Promise<unknown>;
  mutation(reference: unknown, args: Record<string, unknown>): Promise<unknown>;
}

export interface ConvexUserStoreOptions {
  readonly url: string;
  readonly serverSecret: string;
  readonly client?: ConvexClientLike;
}

export class ConvexUserStore implements UserStore {
  private readonly client: ConvexClientLike;
  private readonly secret: string;

  public constructor(options: ConvexUserStoreOptions) {
    // The client is used as a plain HTTP caller: no websocket, no auth token.
    // Access is gated by the shared secret checked inside each Convex function.
    this.client = options.client ?? (new ConvexHttpClient(options.url) as unknown as ConvexClientLike);
    this.secret = options.serverSecret;
  }

  public async get(userId: string): Promise<UserData | null> {
    return parseUserData(await this.client.query(profilesApi.get, { secret: this.secret, userId }));
  }

  public async findByEmail(email: string): Promise<UserData | null> {
    return parseUserData(await this.client.query(profilesApi.byEmail, { secret: this.secret, email }));
  }

  public async save(user: UserData): Promise<void> {
    await this.client.mutation(profilesApi.save, { secret: this.secret, user });
  }

  public async getShare(code: string): Promise<ShareRecord | null> {
    return parseShare(await this.client.query(sharesApi.get, { secret: this.secret, code }));
  }

  public async findShare(ownerId: string, libraryId: string): Promise<ShareRecord | null> {
    return parseShare(await this.client.query(sharesApi.byLibrary, { secret: this.secret, ownerId, libraryId }));
  }

  public async saveShare(share: ShareRecord): Promise<void> {
    await this.client.mutation(sharesApi.save, { secret: this.secret, share });
  }

  public async deleteShare(code: string): Promise<void> {
    await this.client.mutation(sharesApi.remove, { secret: this.secret, code });
  }

  /**
   * What Convex Auth knows about a signed-in user, read once when their profile is
   * first created. Returns null rather than throwing: a missing name or email must
   * never block someone from signing in.
   */
  public async identity(userId: string): Promise<{ email?: string; displayName?: string } | null> {
    const raw = await this.client.query(profilesApi.identity, { secret: this.secret, userId });
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    return {
      ...(typeof record.email === 'string' ? { email: record.email } : {}),
      ...(typeof record.displayName === 'string' ? { displayName: record.displayName } : {})
    };
  }
}

function parseShare(value: unknown): ShareRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.code !== 'string' || typeof record.ownerId !== 'string' || typeof record.libraryId !== 'string' || typeof record.createdAt !== 'string') return null;
  return { code: record.code, ownerId: record.ownerId, libraryId: record.libraryId, createdAt: record.createdAt };
}

function parseEntries(value: unknown): TasteEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): TasteEntry[] => {
    if (typeof item !== 'object' || item === null) return [];
    const entry = item as Record<string, unknown>;
    return typeof entry.name === 'string' && typeof entry.score === 'number' ? [{ name: entry.name, score: entry.score }] : [];
  });
}

function parseTaste(value: unknown): TasteProfile | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return {
    artists: parseEntries(record.artists),
    languages: parseEntries(record.languages),
    signals: typeof record.signals === 'number' ? record.signals : 0,
    onboarded: record.onboarded === true,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString()
  };
}

function parseUserData(value: unknown): UserData | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.userId !== 'string' ||
    typeof record.isGuest !== 'boolean' ||
    typeof record.createdAt !== 'string' ||
    !Array.isArray(record.libraries) ||
    !Array.isArray(record.likedSongIds) ||
    !Array.isArray(record.recentlyPlayed)
  ) {
    return null;
  }
  const settings = typeof record.settings === 'object' && record.settings !== null && !Array.isArray(record.settings)
    ? (record.settings as Record<string, unknown>)
    : {};
  const taste = parseTaste(record.taste);
  return {
    userId: record.userId,
    isGuest: record.isGuest,
    createdAt: record.createdAt,
    libraries: record.libraries as LibraryRecord[],
    likedSongIds: record.likedSongIds.filter((id): id is string => typeof id === 'string'),
    recentlyPlayed: record.recentlyPlayed as RecentRecord[],
    settings,
    ...(typeof record.displayName === 'string' ? { displayName: record.displayName } : {}),
    ...(typeof record.email === 'string' ? { email: record.email } : {}),
    ...(taste ? { taste } : {})
  };
}

/** Song relations (convex/relations.ts), shared by every listener, behind the same server secret. */
export class ConvexRelationStore implements RelationStore {
  private readonly client: ConvexClientLike;
  private readonly secret: string;

  public constructor(options: ConvexUserStoreOptions) {
    this.client = options.client ?? (new ConvexHttpClient(options.url) as unknown as ConvexClientLike);
    this.secret = options.serverSecret;
  }

  public async getMany(songIds: readonly string[]): Promise<Map<string, SongRelation>> {
    const found = new Map<string, SongRelation>();
    if (songIds.length === 0) return found;
    const raw = await this.client.query(relationsApi.getMany, { secret: this.secret, songIds: [...songIds] });
    for (const item of Array.isArray(raw) ? raw : []) {
      const relation = parseRelation(item);
      if (relation) found.set(relation.songId, relation);
    }
    return found;
  }

  public async put(relation: SongRelation): Promise<void> {
    await this.client.mutation(relationsApi.put, {
      secret: this.secret,
      songId: relation.songId,
      songs: relation.songs.map(storedSong),
      updatedAt: relation.updatedAt
    });
  }
}

/** Exactly the fields convex/schema.ts `relatedSong` allows. The stream URL is derived, not stored. */
function storedSong(song: UnifiedSong): Record<string, unknown> {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    artwork: song.artwork,
    duration: song.duration,
    hasLyrics: song.hasLyrics,
    ...(song.language ? { language: song.language } : {}),
    playCount: song.playCount,
    source: song.source
  };
}

function parseRelation(value: unknown): SongRelation | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.songId !== 'string' || typeof record.updatedAt !== 'string' || !Array.isArray(record.songs)) return null;
  const songs = record.songs.flatMap((item): UnifiedSong[] => {
    if (typeof item !== 'object' || item === null) return [];
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.artist !== 'string' || typeof row.artwork !== 'string' ||
      typeof row.duration !== 'number' || typeof row.hasLyrics !== 'boolean' || typeof row.playCount !== 'number' ||
      (row.source !== 'Saavn' && row.source !== 'Gaana')
    ) {
      return [];
    }
    return [{
      id: row.id,
      title: row.title,
      artist: row.artist,
      ...(typeof row.album === 'string' ? { album: row.album } : {}),
      artwork: row.artwork,
      streamUrl: `/api/stream/${encodeURIComponent(row.id)}`,
      duration: row.duration,
      hasLyrics: row.hasLyrics,
      ...(typeof row.language === 'string' ? { language: row.language } : {}),
      playCount: row.playCount,
      source: row.source
    }];
  });
  return { songId: record.songId, songs, updatedAt: record.updatedAt };
}

/** Playlist covers in Convex file storage (convex/covers.ts), behind the same server secret. */
export class ConvexCoverStorage implements CoverStorage {
  private readonly client: ConvexClientLike;
  private readonly secret: string;

  public constructor(options: ConvexUserStoreOptions) {
    this.client = options.client ?? (new ConvexHttpClient(options.url) as unknown as ConvexClientLike);
    this.secret = options.serverSecret;
  }

  public async uploadUrl(): Promise<string> {
    const url = await this.client.mutation(coversApi.generateUploadUrl, { secret: this.secret });
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Convex returned no upload URL.');
    return url;
  }

  public async inspect(storageId: string): Promise<StoredCover | null> {
    try {
      const raw = await this.client.query(coversApi.inspect, { secret: this.secret, storageId });
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as Record<string, unknown>;
      if (typeof record.url !== 'string' || typeof record.size !== 'number') return null;
      return { url: record.url, size: record.size, contentType: typeof record.contentType === 'string' ? record.contentType : '' };
    } catch {
      // A malformed id fails Convex's own validator: same as "no such file".
      return null;
    }
  }

  public async remove(storageId: string): Promise<void> {
    try {
      await this.client.mutation(coversApi.remove, { secret: this.secret, storageId });
    } catch {
      // Best effort by contract.
    }
  }
}

/** Single-use OAuth tokens across serverless instances (convex/oauth.ts). */
export class ConvexGrantLedger implements GrantLedger {
  private readonly client: ConvexClientLike;
  private readonly secret: string;

  public constructor(options: ConvexUserStoreOptions) {
    this.client = options.client ?? (new ConvexHttpClient(options.url) as unknown as ConvexClientLike);
    this.secret = options.serverSecret;
  }

  public async consume(jti: string, expiresAtMs: number): Promise<boolean> {
    // A Convex failure refuses the grant: a code must never be accepted twice because the
    // ledger was unreachable.
    try {
      return (await this.client.mutation(oauthApi.consume, { secret: this.secret, jti, expiresAt: expiresAtMs })) === true;
    } catch {
      return false;
    }
  }
}
