export interface LibraryRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly songIds: string[];
  readonly createdAt: string;
}

export interface RecentRecord {
  readonly songId: string;
  readonly playDuration: number;
  readonly playedAt: string;
}

export interface UserData {
  readonly userId: string;
  readonly isGuest: boolean;
  readonly createdAt: string;
  readonly libraries: LibraryRecord[];
  readonly likedSongIds: string[];
  readonly recentlyPlayed: RecentRecord[];
  readonly settings: Record<string, unknown>;
}

export interface UserStore {
  get(userId: string): Promise<UserData | null>;
  save(user: UserData): Promise<void>;
}

export class MemoryUserStore implements UserStore {
  private readonly users = new Map<string, UserData>();

  public async get(userId: string): Promise<UserData | null> {
    return this.users.get(userId) ?? null;
  }

  public async save(user: UserData): Promise<void> {
    this.users.set(user.userId, user);
  }
}
