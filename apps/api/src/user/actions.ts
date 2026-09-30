import crypto from 'node:crypto';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import type { CoverStorage } from '../lib/covers.js';
import { NotFoundError } from '../lib/errors.js';
import type { LibraryOp, PlaylistCover, RejectReason } from '../shared/library.js';
import type { SongRef, SongSnapshot } from '../shared/songRef.js';
import type { UnifiedSong } from '../types.js';
import { opsForPlaylistCopy, refForId, snapshotOf } from './libraryOps.js';
import { RECENTLY_PLAYED_LIMIT, type LibraryRecord, type RecentRecord, type UserData, type UserStore } from './store.js';
import { SIGNAL_WEIGHT, applySignal, playWeight } from './taste.js';

/** Eight url-safe characters (~10^11 codes): long enough not to guess, short enough to read out loud. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_SHAPE = /^[a-z0-9]{6,12}$/;

export function isShareCode(code: string): boolean {
  return CODE_SHAPE.test(code);
}

function newCode(): string {
  return Array.from(crypto.randomBytes(8), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

export interface PlaylistDraft {
  readonly name: string;
  readonly description?: string;
  readonly isPublic?: boolean;
}

export interface PlaylistEdit {
  readonly name?: string;
  /** null clears it. */
  readonly description?: string | null;
  readonly isPublic?: boolean;
  /** An already-checked upload; null removes the cover. */
  readonly cover?: PlaylistCover | null;
}

export interface SharedPlaylist {
  readonly owner: UserData;
  readonly library: LibraryRecord;
}

/**
 * What a listener does, whoever asks for it: the website's routes, the MCP tools and the phone's
 * sync all come through here, so a like means the same thing from every one of them.
 *
 * Each library change is one operation (user/library.ts) carrying the song's details, so every
 * device can show it without looking it up; taste learns from it once; and a playlist cover
 * nothing uses any more is deleted. Profile changes go through AuthService.updateProfile, so
 * concurrent actions never undo each other.
 *
 * A playlist or song that isn't there throws NotFoundError. The catalog being down never fails
 * an action: the change still lands, without details, and nothing is learned from it.
 */
export class ListenerActions {
  public constructor(
    private readonly auth: AuthService,
    private readonly users: UserStore,
    private readonly catalog: CatalogService,
    private readonly covers: CoverStorage | undefined,
    private readonly now: () => number = Date.now
  ) {}

  // ── Likes ─────────────────────────────────────────────────────────────────

  public async like(user: UserData, songId: string): Promise<void> {
    const ref = refOf(songId);
    const song = await this.lookUp(songId);
    await this.apply(user.userId, [{ op: 'like', ref, ...withSnapshot(song), at: this.now() }]);
    if (song && !user.likedSongIds.includes(songId)) await this.learn(user.userId, song, SIGNAL_WEIGHT.like);
  }

  public async unlike(user: UserData, songId: string): Promise<void> {
    const ref = refForId(songId);
    if (!ref) return; // never liked: nothing to undo
    await this.apply(user.userId, [{ op: 'unlike', ref, at: this.now() }]);
    if (!user.likedSongIds.includes(songId)) return;
    const song = await this.lookUp(songId);
    if (song) await this.learn(user.userId, song, SIGNAL_WEIGHT.unlike);
  }

  // ── Playlists ─────────────────────────────────────────────────────────────

  public async createPlaylist(user: UserData, draft: PlaylistDraft): Promise<LibraryRecord> {
    const id = crypto.randomUUID();
    const description = draft.description?.trim().slice(0, 500);
    await this.apply(user.userId, [
      {
        op: 'playlist_upsert',
        playlistId: id,
        name: draft.name.trim().slice(0, 100),
        ...(description ? { description } : {}),
        isPublic: draft.isPublic === true,
        at: this.now()
      }
    ]);
    return this.playlistAfter(user.userId, id);
  }

  public async updatePlaylist(user: UserData, playlistId: string, edit: PlaylistEdit): Promise<LibraryRecord> {
    const library = playlistOf(user, playlistId);
    const name = edit.name?.trim().slice(0, 100);
    const description = edit.description === null ? null : edit.description?.trim().slice(0, 500);
    await this.apply(user.userId, [
      {
        op: 'playlist_upsert',
        playlistId: library.id,
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description: description || null } : {}),
        ...(edit.isPublic !== undefined ? { isPublic: edit.isPublic } : {}),
        ...(edit.cover !== undefined ? { cover: edit.cover } : {}),
        at: this.now()
      }
    ]);
    return this.playlistAfter(user.userId, library.id);
  }

  public async deletePlaylist(user: UserData, playlistId: string): Promise<void> {
    const library = playlistOf(user, playlistId);
    await this.apply(user.userId, [{ op: 'playlist_delete', playlistId: library.id, at: this.now() }]);
  }

  public async addToPlaylist(user: UserData, playlistId: string, songId: string): Promise<LibraryRecord> {
    const library = playlistOf(user, playlistId);
    const ref = refOf(songId);
    const song = await this.lookUp(songId);
    await this.apply(user.userId, [{ op: 'playlist_add', playlistId: library.id, ref, ...withSnapshot(song), at: this.now() }]);
    if (song && !library.songIds.includes(songId)) await this.learn(user.userId, song, SIGNAL_WEIGHT.playlistAdd);
    return this.playlistAfter(user.userId, library.id);
  }

  public async removeFromPlaylist(user: UserData, playlistId: string, songId: string): Promise<LibraryRecord> {
    const library = playlistOf(user, playlistId);
    await this.apply(user.userId, [{ op: 'playlist_remove', playlistId: library.id, ref: refOf(songId), at: this.now() }]);
    return this.playlistAfter(user.userId, library.id);
  }

  // ── Sharing ───────────────────────────────────────────────────────────────

  /** The playlist's share link (made public), created the first time. */
  public async share(user: UserData, playlistId: string): Promise<{ readonly code: string; readonly created: boolean }> {
    const library = playlistOf(user, playlistId);
    const existing = await this.users.findShare(user.userId, library.id);
    const code = existing?.code ?? newCode();
    if (!existing) await this.users.saveShare({ code, ownerId: user.userId, libraryId: library.id, createdAt: new Date(this.now()).toISOString() });
    if (!library.isPublic) await this.apply(user.userId, [{ op: 'playlist_upsert', playlistId: library.id, isPublic: true, at: this.now() }]);
    return { code, created: !existing };
  }

  /** Turns the link off and makes the playlist private again. */
  public async unshare(user: UserData, playlistId: string): Promise<void> {
    const library = playlistOf(user, playlistId);
    const existing = await this.users.findShare(user.userId, library.id);
    if (existing) await this.users.deleteShare(existing.code);
    await this.apply(user.userId, [{ op: 'playlist_upsert', playlistId: library.id, isPublic: false, at: this.now() }]);
  }

  /** What a share link opens, or null when the code is unknown or the link was turned off. */
  public async openShare(code: string): Promise<SharedPlaylist | null> {
    if (!isShareCode(code)) return null;
    const share = await this.users.getShare(code);
    const owner = share ? await this.users.get(share.ownerId) : null;
    const library = owner?.libraries.find((item) => item.id === share?.libraryId);
    return owner && library?.isPublic ? { owner, library } : null;
  }

  /** A private copy of a shared playlist in the listener's own library, or null when the link is off. */
  public async saveSharedCopy(user: UserData, code: string): Promise<LibraryRecord | null> {
    const shared = await this.openShare(code);
    if (!shared) return null;
    const { library: source } = shared;
    // The copy shows the owner's cover but does not own the file (no coverKey), so replacing or
    // deleting it here can never delete the owner's image.
    const copy: LibraryRecord = {
      id: crypto.randomUUID(),
      name: source.name,
      ...(source.description ? { description: source.description } : {}),
      isPublic: false,
      songIds: [...source.songIds],
      createdAt: new Date(this.now()).toISOString(),
      ...(source.coverUrl ? { coverUrl: source.coverUrl } : {})
    };
    await this.apply(user.userId, opsForPlaylistCopy(copy, this.now(), await this.snapshots(copy.songIds)));
    return (await this.auth.getUser(user.userId))?.libraries.find((item) => item.id === copy.id) ?? copy;
  }

  // ── The phone's library sync ──────────────────────────────────────────────

  /** A batch of operations from another device. Taste learns from them as from the website's buttons. */
  public async applyFromDevice(
    user: UserData,
    ops: readonly LibraryOp[]
  ): Promise<{ readonly rev: number; readonly rejected: readonly { readonly index: number; readonly reason: RejectReason }[] }> {
    const result = await this.apply(user.userId, ops);
    const rejected = new Set(result.rejected.map((item) => item.index));
    const lessons: { song: SongSnapshot; weight: number }[] = [];
    ops.forEach((op, index) => {
      if (rejected.has(index) || !('song' in op) || !op.song) return;
      const alreadyLiked = user.likedSongIds.some((id) => refForId(id) === op.ref);
      if (op.op === 'like' && !alreadyLiked) lessons.push({ song: op.song, weight: SIGNAL_WEIGHT.like });
      if (op.op === 'playlist_add') lessons.push({ song: op.song, weight: SIGNAL_WEIGHT.playlistAdd });
    });
    if (lessons.length > 0) {
      await this.auth.updateProfile(user.userId, (current) => lessons.reduce((taught, lesson) => teach(taught, lesson.song, lesson.weight), current));
    }
    return { rev: result.rev, rejected: result.rejected };
  }

  // ── Listening ─────────────────────────────────────────────────────────────

  /** A play, for Recently played. Pressing play is a mild vote; how long they stayed arrives as `listened`. */
  public async recordPlay(user: UserData, songId: string, playDuration: number, playedAt: string): Promise<RecentRecord> {
    const entry: RecentRecord = { songId, playDuration, playedAt };
    const song = await this.lookUp(songId);
    await this.auth.updateProfile(user.userId, (current) => {
      const recentlyPlayed = [entry, ...current.recentlyPlayed.filter((item) => item.songId !== songId)]
        .sort((left, right) => right.playedAt.localeCompare(left.playedAt))
        .slice(0, RECENTLY_PLAYED_LIMIT);
      const taught = song ? teach(current, song, playDuration > 0 ? playWeight(playDuration, song.duration) : 0.3) : current;
      return { ...taught, recentlyPlayed };
    });
    return entry;
  }

  /** How long a song was actually heard: a few seconds counts against it, most of it for it. */
  public async listened(user: UserData, songId: string, seconds: number): Promise<UserData> {
    const song = await this.lookUp(songId);
    return (song ? await this.learn(user.userId, song, playWeight(seconds, song.duration)) : null) ?? user;
  }

  public async skipped(user: UserData, songId: string): Promise<void> {
    const song = await this.lookUp(songId);
    if (song) await this.learn(user.userId, song, SIGNAL_WEIGHT.skip);
  }

  // ── Inside ────────────────────────────────────────────────────────────────

  /** Applies library operations, then deletes playlist covers nothing uses any more. */
  private async apply(userId: string, ops: readonly LibraryOp[]) {
    const result = await this.auth.library.apply(userId, ops);
    for (const key of result.removedCoverKeys) {
      try {
        await this.covers?.remove(key);
      } catch {
        // A leftover image costs storage, not correctness; the playlist change already landed.
      }
    }
    return result;
  }

  /** A playlist as the profile shows it right after a change. */
  private async playlistAfter(userId: string, playlistId: string): Promise<LibraryRecord> {
    const library = (await this.auth.getUser(userId))?.libraries.find((item) => item.id === playlistId);
    if (!library) throw new NotFoundError();
    return library;
  }

  /** The catalog row for an id, or null when the provider is down (the action still goes ahead). */
  private async lookUp(songId: string): Promise<UnifiedSong | null> {
    try {
      const [song] = await this.catalog.getSongs([songId]);
      return song ?? null;
    } catch {
      return null;
    }
  }

  /** Details for many songs at once, for the ones the catalog can find. */
  private async snapshots(songIds: readonly string[]): Promise<Map<string, SongSnapshot>> {
    const found = new Map<string, SongSnapshot>();
    if (songIds.length === 0) return found;
    try {
      for (const song of await this.catalog.getSongs([...songIds])) {
        const snapshot = snapshotOf(song);
        if (snapshot) found.set(song.id, snapshot);
      }
    } catch {
      // Provider down: the copy still lands; other devices look the songs up themselves.
    }
    return found;
  }

  private learn(userId: string, song: TasteSong, weight: number): Promise<UserData | null> {
    return this.auth.updateProfile(userId, (current) => teach(current, song, weight));
  }
}

type TasteSong = { readonly artist: string; readonly language?: string };

function teach(user: UserData, song: TasteSong, weight: number): UserData {
  return { ...user, taste: applySignal(user.taste, { artist: song.artist, ...(song.language ? { language: song.language } : {}) }, weight) };
}

function playlistOf(user: UserData, playlistId: string): LibraryRecord {
  const library = user.libraries.find((item) => item.id === playlistId);
  if (!library) throw new NotFoundError();
  return library;
}

function refOf(songId: string): SongRef {
  const ref = refForId(songId);
  if (!ref) throw new NotFoundError();
  return ref;
}

function withSnapshot(song: UnifiedSong | null): { song: SongSnapshot } | Record<string, never> {
  const snapshot = song ? snapshotOf(song) : undefined;
  return snapshot ? { song: snapshot } : {};
}
