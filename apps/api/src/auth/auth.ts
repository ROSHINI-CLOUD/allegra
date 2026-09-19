import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { PersistenceError } from '../lib/errors.js';
import type { UserData, UserStore } from '../user/store.js';

export interface AuthUser {
  readonly userId: string;
}

export class AuthService {
  public constructor(
    private readonly store: UserStore,
    private readonly secret: string
  ) {}

  public async createGuest(): Promise<{ token: string; userId: string }> {
    const userId = crypto.randomUUID();
    const user: UserData = {
      userId,
      isGuest: true,
      createdAt: new Date().toISOString(),
      libraries: [],
      likedSongIds: [],
      recentlyPlayed: [],
      settings: {}
    };
    try {
      await this.store.save(user);
    } catch {
      throw new PersistenceError();
    }
    return { token: this.sign(userId), userId };
  }

  public verify(token: string): AuthUser | null {
    try {
      const payload = jwt.verify(token, this.secret);
      if (typeof payload === 'string' || typeof payload.sub !== 'string') {
        return null;
      }
      return { userId: payload.sub };
    } catch {
      return null;
    }
  }

  public async getUser(userId: string): Promise<UserData | null> {
    try {
      return await this.store.get(userId);
    } catch {
      throw new PersistenceError();
    }
  }

  public async update(user: UserData): Promise<void> {
    try {
      await this.store.save(user);
    } catch {
      throw new PersistenceError();
    }
  }

  private sign(userId: string): string {
    return jwt.sign({}, this.secret, { subject: userId, expiresIn: '30d' });
  }
}

export function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith('Bearer ')) {
    return null;
  }
  return value.slice('Bearer '.length).trim() || null;
}
