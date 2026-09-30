import type { CoverStorage, StoredCover } from '../lib/covers.js';
import type { GrantLedger } from '../oauth/ledger.js';
import type { LibraryRecord, RecentRecord, ShareRecord, TasteEntry, TasteProfile, UserData, UserStore } from '../user/store.js';
import type { ConvexGateway } from './convexGateway.js';

/** Profiles and shares in Convex (convex/profiles.ts, convex/shares.ts). */
export class ConvexUserStore implements UserStore {
  public constructor(private readonly convex: ConvexGateway) {}

  public async get(userId: string): Promise<UserData | null> {
    return parseUserData(await this.convex.query('profiles:get', { userId }));
  }

  public async findByEmail(email: string): Promise<UserData | null> {
    return parseUserData(await this.convex.query('profiles:byEmail', { email }));
  }

  public async save(user: UserData): Promise<void> {
    await this.convex.mutation('profiles:save', { user });
  }

  public async getShare(code: string): Promise<ShareRecord | null> {
    return parseShare(await this.convex.query('shares:get', { code }));
  }

  public async findShare(ownerId: string, libraryId: string): Promise<ShareRecord | null> {
    return parseShare(await this.convex.query('shares:byLibrary', { ownerId, libraryId }));
  }

  public async saveShare(share: ShareRecord): Promise<void> {
    await this.convex.mutation('shares:save', { share });
  }

  public async deleteShare(code: string): Promise<void> {
    await this.convex.mutation('shares:remove', { code });
  }

  /**
   * What Convex Auth knows about a signed-in user, read once when their profile is
   * first created. Returns null rather than throwing: a missing name or email must
   * never block someone from signing in.
   */
  public async identity(userId: string): Promise<{ email?: string; displayName?: string } | null> {
    const raw = await this.convex.query('profiles:identity', { userId });
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

/** Playlist covers in Convex file storage (convex/covers.ts), behind the same server secret. */
export class ConvexCoverStorage implements CoverStorage {
  public constructor(private readonly convex: ConvexGateway) {}

  public async uploadUrl(): Promise<string> {
    const url = await this.convex.mutation('covers:generateUploadUrl');
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Convex returned no upload URL.');
    return url;
  }

  public async inspect(storageId: string): Promise<StoredCover | null> {
    try {
      const raw = await this.convex.query('covers:inspect', { storageId });
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
      await this.convex.mutation('covers:remove', { storageId });
    } catch {
      // Best effort by contract.
    }
  }
}

/** Single-use OAuth tokens across serverless instances (convex/oauth.ts). */
export class ConvexGrantLedger implements GrantLedger {
  public constructor(private readonly convex: ConvexGateway) {}

  public async consume(jti: string, expiresAtMs: number): Promise<boolean> {
    // A Convex failure refuses the grant: a code must never be accepted twice because the
    // ledger was unreachable.
    try {
      return (await this.convex.mutation('oauth:consume', { jti, expiresAt: expiresAtMs })) === true;
    } catch {
      return false;
    }
  }
}
