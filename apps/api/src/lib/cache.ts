export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Entry {
  readonly value: unknown;
  readonly expiresAt: number;
}

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  public async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000
    });
  }

  public async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

export class LayeredCacheStore implements CacheStore {
  public constructor(
    private readonly memory: MemoryCacheStore,
    private readonly persistent: CacheStore
  ) {}

  public async get<T>(key: string): Promise<T | null> {
    const local = await this.memory.get<T>(key);
    if (local !== null) {
      return local;
    }
    try {
      const value = await this.persistent.get<T>(key);
      if (value !== null) {
        await this.memory.set(key, value, 300);
      }
      return value;
    } catch {
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.memory.set(key, value, ttlSeconds);
    try {
      await this.persistent.set(key, value, ttlSeconds);
    } catch {
      // The warm in-process cache keeps the request path available during a Dynamo outage.
    }
  }

  public async delete(key: string): Promise<void> {
    await this.memory.delete(key);
    try {
      await this.persistent.delete(key);
    } catch {
      // Best effort; the TTL remains the safety net for the persistent row.
    }
  }
}

export function cacheKey(...parts: string[]): string {
  return parts
    .map((part) => part.toLowerCase().trim().replace(/\s+/g, ' '))
    .join(':');
}
