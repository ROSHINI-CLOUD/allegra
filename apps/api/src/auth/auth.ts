import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { ConflictError, InvalidCredentialsError, PersistenceError } from '../lib/errors.js';
import type { UserData, UserStore } from '../user/store.js';
import { mergeTaste } from '../user/taste.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthUser {
  readonly userId: string;
}

export interface Session {
  readonly token: string;
  readonly userId: string;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface Registration extends Credentials {
  readonly displayName?: string;
}

/** Checked against when the email is unknown, so "no such account" and "wrong password" cost the same. */
const DUMMY_HASH = 'scrypt$00000000000000000000000000000000$' + '00'.repeat(64);

export class AuthService {
  public constructor(
    private readonly store: UserStore,
    private readonly secret: string
  ) {}

  public async createGuest(): Promise<Session> {
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
    await this.persist(user);
    return { token: this.sign(userId), userId };
  }

  /**
   * Turns the caller's guest session into a real account, so nothing they liked or built as a guest is lost.
   * With no guest session (or one that is already an account) a fresh account is created instead.
   */
  public async register(guestUserId: string | null, input: Registration): Promise<Session> {
    const existing = await this.lookupByEmail(input.email);
    if (existing) throw new ConflictError();

    const passwordHash = await hashPassword(input.password);
    const guest = guestUserId ? await this.getUser(guestUserId) : null;
    const base: UserData = guest?.isGuest
      ? guest
      : {
          userId: crypto.randomUUID(),
          isGuest: false,
          createdAt: new Date().toISOString(),
          libraries: [],
          likedSongIds: [],
          recentlyPlayed: [],
          settings: {}
        };
    const displayName = input.displayName?.trim().slice(0, 60);
    const account: UserData = {
      ...base,
      isGuest: false,
      email: input.email,
      passwordHash,
      ...(displayName ? { displayName } : {})
    };
    await this.persist(account);
    return { token: this.sign(account.userId), userId: account.userId };
  }

  /** Signs in, and folds whatever the visitor did as a guest on this device into the account they signed into. */
  public async login(guestUserId: string | null, input: Credentials): Promise<Session> {
    const account = await this.lookupByEmail(input.email);
    const ok = await verifyPassword(input.password, account?.passwordHash ?? DUMMY_HASH);
    if (!account || !ok) throw new InvalidCredentialsError();

    if (guestUserId && guestUserId !== account.userId) {
      const guest = await this.getUser(guestUserId);
      if (guest?.isGuest && (guest.likedSongIds.length > 0 || guest.libraries.length > 0 || guest.recentlyPlayed.length > 0 || guest.taste)) {
        await this.persist(mergeGuestInto(account, guest));
      }
    }
    return { token: this.sign(account.userId), userId: account.userId };
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
    await this.persist(user);
  }

  /** Storage seams for the routes that need them (sharing looks up other people's playlists). */
  public get userStore(): UserStore {
    return this.store;
  }

  private async lookupByEmail(email: string): Promise<UserData | null> {
    try {
      return await this.store.findByEmail(email);
    } catch {
      throw new PersistenceError();
    }
  }

  private async persist(user: UserData): Promise<void> {
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

/** Account data wins on conflicts; the guest's likes, playlists, plays and taste are added underneath it. */
export function mergeGuestInto(account: UserData, guest: UserData): UserData {
  const likedSongIds = [...new Set([...account.likedSongIds, ...guest.likedSongIds])];
  const known = new Set(account.libraries.map((library) => library.id));
  const libraries = [...account.libraries, ...guest.libraries.filter((library) => !known.has(library.id))];
  const recentlyPlayed = [...account.recentlyPlayed, ...guest.recentlyPlayed]
    .sort((left, right) => right.playedAt.localeCompare(left.playedAt))
    .filter((entry, index, all) => all.findIndex((other) => other.songId === entry.songId) === index)
    .slice(0, 50);
  const taste = account.taste && guest.taste ? mergeTaste(account.taste, guest.taste) : (account.taste ?? guest.taste);
  return { ...account, likedSongIds, libraries, recentlyPlayed, ...(taste ? { taste } : {}) };
}

export function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith('Bearer ')) {
    return null;
  }
  return value.slice('Bearer '.length).trim() || null;
}
