export interface LibraryRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly songIds: string[];
  readonly createdAt: string;
  /** S3 object key for a custom cover. Never a browser-facing URL. */
  readonly coverKey?: string;
  /** Derived for the client from coverKey + the public/CloudFront base. Not persisted. */
  readonly coverUrl?: string;
}

/** Recent listens kept per listener. Older ones are dropped on every write, not archived. */
export const RECENTLY_PLAYED_LIMIT = 25;

export interface RecentRecord {
  readonly songId: string;
  readonly playDuration: number;
  readonly playedAt: string;
}

export interface TasteEntry {
  readonly name: string;
  readonly score: number;
}

/** What the listener's behaviour has taught us. Grown a little on every play, like, and playlist add. */
export interface TasteProfile {
  readonly artists: TasteEntry[];
  readonly languages: TasteEntry[];
  /** How many signals have fed this profile; a cheap gauge of how much we know. */
  readonly signals: number;
  /** True once the listener picked favourites (or we have seen enough listening to skip asking). */
  readonly onboarded: boolean;
  readonly updatedAt: string;
}

export interface UserData {
  readonly userId: string;
  readonly isGuest: boolean;
  readonly createdAt: string;
  readonly libraries: LibraryRecord[];
  readonly likedSongIds: string[];
  readonly recentlyPlayed: RecentRecord[];
  readonly settings: Record<string, unknown>;
  readonly displayName?: string;
  readonly email?: string;
  readonly taste?: TasteProfile;
}

/** A playlist someone shared. It points at the owner's playlist, so it stays live. */
export interface ShareRecord {
  readonly code: string;
  readonly ownerId: string;
  readonly libraryId: string;
  readonly createdAt: string;
}

export interface UserStore {
  get(userId: string): Promise<UserData | null>;
  findByEmail(email: string): Promise<UserData | null>;
  save(user: UserData): Promise<void>;
  getShare(code: string): Promise<ShareRecord | null>;
  findShare(ownerId: string, libraryId: string): Promise<ShareRecord | null>;
  saveShare(share: ShareRecord): Promise<void>;
  deleteShare(code: string): Promise<void>;
}

/**
 * Once a LibraryStore owns a listener's library (their first like or playlist change), `save`
 * keeps the stored likedSongIds/libraries and ignores the ones passed in: those arrays are a
 * copy the library store rebuilds, and a whole-profile save (a taste or settings update) must
 * never undo a library change that happened in between. convex/profiles.ts `save` does the same.
 */
export class MemoryUserStore implements UserStore {
  private readonly users = new Map<string, UserData>();
  private readonly shares = new Map<string, ShareRecord>();
  private readonly libraryOwned = new Set<string>();

  public async get(userId: string): Promise<UserData | null> {
    return this.users.get(userId) ?? null;
  }

  /** For MemoryLibraryStore: from now on this listener's library copy is written only through writeLibraryCopy. */
  public ownLibrary(userId: string): void {
    this.libraryOwned.add(userId);
  }

  /** For MemoryLibraryStore: replace the profile's library copy. */
  public writeLibraryCopy(userId: string, copy: Pick<UserData, 'likedSongIds' | 'libraries'>): void {
    const user = this.users.get(userId);
    if (user) this.users.set(userId, { ...user, likedSongIds: copy.likedSongIds, libraries: copy.libraries });
  }

  public async findByEmail(email: string): Promise<UserData | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  public async save(user: UserData): Promise<void> {
    const existing = this.users.get(user.userId);
    this.users.set(
      user.userId,
      existing && this.libraryOwned.has(user.userId) ? { ...user, likedSongIds: existing.likedSongIds, libraries: existing.libraries } : user
    );
  }

  public async getShare(code: string): Promise<ShareRecord | null> {
    return this.shares.get(code) ?? null;
  }

  public async findShare(ownerId: string, libraryId: string): Promise<ShareRecord | null> {
    for (const share of this.shares.values()) {
      if (share.ownerId === ownerId && share.libraryId === libraryId) return share;
    }
    return null;
  }

  public async saveShare(share: ShareRecord): Promise<void> {
    this.shares.set(share.code, share);
  }

  public async deleteShare(code: string): Promise<void> {
    this.shares.delete(code);
  }
}
