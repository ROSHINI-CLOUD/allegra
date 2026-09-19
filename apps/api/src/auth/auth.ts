import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import type { UserData, UserStore } from '../user/store.js';

export interface AuthUser {
  readonly userId: string;
}

export class AuthService {
  public constructor(
    private readonly store: UserStore,
    private readonly secret: string
  ) {}

  public async createGuest(): Promise<{ token: string; user: UserData }> {
    const user: UserData = {
      userId: crypto.randomUUID(),
      isGuest: true,
      createdAt: new Date().toISOString(),
      libraries: [],
      likedSongIds: [],
      recentlyPlayed: [],
      settings: {}
    };
    await this.store.save(user);
    return { token: this.sign(user.userId), user };
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
    return this.store.get(userId);
  }

  public async update(user: UserData): Promise<void> {
    await this.store.save(user);
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
