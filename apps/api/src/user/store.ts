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
  readonly passwordHash?: string;
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

export class MemoryUserStore implements UserStore {
  private readonly users = new Map<string, UserData>();
  private readonly shares = new Map<string, ShareRecord>();

  public async get(userId: string): Promise<UserData | null> {
    return this.users.get(userId) ?? null;
  }

  public async findByEmail(email: string): Promise<UserData | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  public async save(user: UserData): Promise<void> {
    this.users.set(user.userId, user);
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
