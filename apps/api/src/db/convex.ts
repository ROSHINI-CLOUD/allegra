import { ConvexHttpClient } from 'convex/browser';
import { anyApi } from 'convex/server';

import type { LibraryRecord, RecentRecord, UserData, UserStore } from '../user/store.js';

/** Function references into convex/users.ts. anyApi is untyped, so name the two we use. */
const usersApi = anyApi.users as unknown as { readonly get: unknown; readonly save: unknown };

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
    const value = await this.client.query(usersApi.get, { secret: this.secret, userId });
    return parseUserData(value);
  }

  public async save(user: UserData): Promise<void> {
    await this.client.mutation(usersApi.save, { secret: this.secret, user });
  }
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
  return {
    userId: record.userId,
    isGuest: record.isGuest,
    createdAt: record.createdAt,
    libraries: record.libraries as LibraryRecord[],
    likedSongIds: record.likedSongIds.filter((id): id is string => typeof id === 'string'),
    recentlyPlayed: record.recentlyPlayed as RecentRecord[],
    settings
  };
}
