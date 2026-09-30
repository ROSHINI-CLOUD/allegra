/**
 * Library sync between this phone and the Allegra account (web + other devices).
 *
 * Out: every like and playlist change made here becomes an operation in the SQLite
 * outbox, sent in batches (docs/api-contract.md "Library sync"). Offline, it waits.
 * In:  the change feed since the last revision, applied straight to SQLite
 *      (database/syncQueries.ts) — not through the stores, so nothing echoes back.
 * When: on sign-in, when the app comes to the front, shortly after a change here,
 *      and whenever the account's revision moves (Convex `library:myRev`).
 *
 * The decisions are plain functions in plan.ts; this file is the I/O around them.
 * Nothing here throws to a caller: sync failing must never break the library.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { makeFunctionReference } from 'convex/server';
import type { ConvexReactClient } from 'convex/react';

import type { LibraryChange, LibraryOp } from '@shared/library';
import { matchKey, parseSongRef, songRef, toAllegraId, type SongRef, type SongSnapshot } from '@shared/songRef';

import * as db from '../../database/syncQueries';
import { searchMusic } from '../MultiSourceSearchService';
import * as api from '../account/allegraApi';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';
import { useSyncStore } from '../../store/syncStore';
import {
  LIKED_PLAYLIST_ID,
  buildLocalIndex,
  opsForFirstSync,
  planInbound,
  refForLocalSong,
  snapshotOfLocal,
  type AccountLibrary,
  type FirstSyncChoice,
  type LocalAction,
  type PhoneLibrary,
} from './plan';

const libraryRevision = makeFunctionReference<'query', Record<string, never>, number | null>('library:myRev');
const OPS_PER_BATCH = 100;
const FLUSH_DELAY_MS = 1500;

interface Session {
  readonly userId: string;
  readonly getToken: () => string | null;
}

let session: Session | null = null;
/** True once this phone's library is bound to the signed-in account (first-sync choice made). */
let active = false;
let running: Promise<void> | null = null;
let rerun = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;
let appState: NativeEventSubscription | null = null;

const revKey = (userId: string) => `rev:${userId}`;
const log = (...args: unknown[]) => {
  if (__DEV__) console.log('[LibrarySync]', ...args);
};

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Called when an account signs in (and on each start while signed in). */
export async function attach(next: Session, convex: ConvexReactClient): Promise<void> {
  if (session?.userId === next.userId) return;
  detach();
  session = next;
  try {
    const bound = await db.getMeta('account');
    if (bound === next.userId) {
      active = true;
    } else {
      const phone = await readPhoneLibrary();
      const hasLibrary = phone.likes.length > 0 || phone.playlists.length > 0;
      if (hasLibrary) {
        // A phone with its own library meets an account for the first time: ask.
        useSyncStore.getState().set({ question: { phoneLikes: phone.likes.length, phonePlaylists: phone.playlists.length } });
      } else {
        await bind(next.userId);
      }
    }
  } catch (error) {
    log('attach failed', error);
  }

  try {
    const watch = convex.watchQuery(libraryRevision, {});
    unwatch = watch.onUpdate(() => {
      try {
        if (typeof watch.localQueryResult() === 'number') syncSoon(0);
      } catch {
        // The function may not be deployed yet: sync still runs on the other triggers.
      }
    });
  } catch {
    unwatch = null;
  }
  appState = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') syncSoon(0);
  });
  syncSoon(0);
}

/** Called on sign-out. The phone keeps its library; nothing is deleted. */
export function detach(): void {
  unwatch?.();
  unwatch = null;
  appState?.remove();
  appState = null;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  session = null;
  active = false;
  useSyncStore.getState().set({ question: null, syncing: false });
}

async function bind(userId: string): Promise<void> {
  await db.setMeta('account', userId);
  await db.setMeta(revKey(userId), '0');
  active = true;
  useSyncStore.getState().set({ question: null });
}

// ── Recording what happens on this phone ────────────────────────────────────

/** A library change made here. Ignored until the phone is bound to an account. */
export function record(op: LibraryOp): void {
  if (!active) return;
  db.enqueueOutbox('op', op)
    .then(() => syncSoon(FLUSH_DELAY_MS))
    .catch(error => log('record failed', error));
}

/**
 * The ref for a phone song, finding it in the catalog for a download made before
 * origins were recorded (and remembering it). Null for songs that never leave the phone.
 */
export async function refFor(song: { id: string; title: string; artist?: string; originId?: string }): Promise<SongRef | null> {
  const known = refForLocalSong(song);
  if (known) return known;
  const found = await findInCatalog(song.title, song.artist ?? '');
  if (found) await db.setOriginId(song.id, found).catch(() => undefined);
  return found;
}

/** A play of a catalog song: Recently played on every device, and taste for Quick picks. */
export function recordPlay(ref: SongRef, seconds: number): void {
  if (!active) return;
  const songId = toAllegraId(ref);
  if (!songId || seconds < 5) return;
  db.enqueueOutbox('play', { songId, seconds: Math.round(seconds), playedAt: new Date().toISOString() })
    .then(() => syncSoon(FLUSH_DELAY_MS))
    .catch(error => log('play record failed', error));
}

// ── First sign-in choice ────────────────────────────────────────────────────

export async function choose(choice: FirstSyncChoice): Promise<boolean> {
  const current = session;
  if (!current) return false;
  const token = current.getToken();
  if (!token) return false;
  useSyncStore.getState().set({ syncing: true });
  try {
    const account = await readAccountLibrary(token);
    if (!account) return false; // offline: the question stays until it can be answered
    const phone = await readPhoneLibrary();
    const ops = opsForFirstSync(choice, phone, account.library, Date.now());
    if (choice === 'account') await dropPhoneOnlyItems(account.library);
    await db.clearOutbox(); // anything queued before the choice is covered by it
    for (const op of ops) await db.enqueueOutbox('op', op);
    await bind(current.userId);
    syncSoon(0);
    return true;
  } catch (error) {
    log('choice failed', error);
    return false;
  } finally {
    useSyncStore.getState().set({ syncing: false });
  }
}

// ── The loop ────────────────────────────────────────────────────────────────

/** Send and pull now (or after `delayMs`). Overlapping calls fold into one more run. */
export function syncSoon(delayMs: number): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    runOnce().catch(error => log('sync failed', error));
  }, delayMs);
}

async function runOnce(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      const current = session;
      if (!current || !active) break;
      useSyncStore.getState().set({ syncing: true });
      try {
        const sent = await flush(current);
        const pulled = await pull(current);
        if (sent && pulled) useSyncStore.getState().set({ lastSyncedAt: Date.now() });
      } catch (error) {
        log('sync failed', error);
      } finally {
        useSyncStore.getState().set({ syncing: false });
      }
    } while (rerun);
  })();
  try {
    await running;
  } finally {
    running = null;
  }
}

/** Sends the outbox. False when offline (the rest waits for the next run). */
async function flush(current: Session): Promise<boolean> {
  for (;;) {
    const token = current.getToken();
    if (!token) return false;
    const batch = await db.peekOutbox('op', OPS_PER_BATCH);
    if (batch.length === 0) break;
    const ops = batch.flatMap(entry => {
      try {
        return [JSON.parse(entry.body) as LibraryOp];
      } catch {
        return [];
      }
    });
    let reply = ops.length > 0 ? await api.postLibraryOps(token, ops) : { outcome: 'refused' as const };
    if (reply.outcome === 'offline') return false;
    if (reply.outcome === 'refused' && ops.length > 1) {
      // One bad operation must not cost the good ones: send them singly, drop only what is still refused.
      for (const op of ops) {
        reply = await api.postLibraryOps(token, [op]);
        if (reply.outcome === 'offline') return false;
      }
    }
    // Sent, or refused for good (malformed): either way these entries are done.
    await db.removeOutbox(batch.map(entry => entry.id));
    if (reply.outcome === 'refused') log('batch refused', ops.length);
  }
  for (;;) {
    const token = current.getToken();
    if (!token) return false;
    const plays = await db.peekOutbox('play', 20);
    if (plays.length === 0) break;
    for (const entry of plays) {
      const play = parsePlay(entry.body);
      if (play) {
        const reply = await api.postPlay(token, { songId: play.songId, playDuration: play.seconds, playedAt: play.playedAt });
        if (reply.outcome === 'offline') return false;
        await api.postListenSignal(token, play.songId, play.seconds);
      }
      await db.removeOutbox([entry.id]);
    }
  }
  useSyncStore.getState().set({ pending: 0 });
  return true;
}

/** Applies every change after the stored revision. False when offline. */
async function pull(current: Session): Promise<boolean> {
  let since = Number((await db.getMeta(revKey(current.userId))) ?? '0') || 0;
  let changed = false;
  for (let guard = 0; guard < 100; guard++) {
    const token = current.getToken();
    if (!token) return false;
    const reply = await api.getLibraryChanges(token, since);
    if (reply.outcome !== 'sent') return false;
    if (reply.data.changes.length > 0) {
      const applied = await apply(reply.data.changes, token);
      changed = true;
      // Not stored: the next pull asks for these again (applying is idempotent).
      if (!applied) {
        await refreshStores();
        return false;
      }
    }
    since = reply.data.rev;
    await db.setMeta(revKey(current.userId), String(since));
    if (!reply.data.more) break;
  }
  if (changed) await refreshStores();
  return true;
}

/** False when any change could not be written, so the caller keeps its place and retries. */
async function apply(changes: readonly LibraryChange[], token: string): Promise<boolean> {
  const [songs, playlists] = await Promise.all([db.getLocalSongs(), db.getLocalPlaylists()]);
  const index = buildLocalIndex(songs);
  const playlistIds = new Set(playlists.filter(list => !list.isDefault).map(list => list.id));
  const actions = planInbound(changes, index, playlistIds);
  const { details, complete } = await detailsFor(actions, token);

  // Details that could not be fetched (offline) mean a like or playlist song would be skipped:
  // apply the rest, but keep our place so the next pull brings those back.
  let ok = complete;
  for (const action of actions) {
    try {
      await applyAction(action, details);
    } catch (error) {
      ok = false;
      log('apply failed', action.kind, error);
    }
  }
  return ok;
}

async function applyAction(action: LocalAction, details: Map<string, SongSnapshot>): Promise<void> {
  switch (action.kind) {
    case 'like_local':
      await db.setPlaylistMembership(LIKED_PLAYLIST_ID, action.songId, action.liked);
      await db.setOriginId(action.songId, action.ref);
      return;
    case 'online_like': {
      const song = action.song ?? details.get(action.ref);
      if (song) await db.upsertOnlineLike(rowOf(song, action.likedAt));
      return;
    }
    case 'online_unlike':
      await db.removeOnlineLike(action.ref);
      return;
    case 'playlist_upsert':
      await db.upsertPlaylistRaw(action.playlistId, action.name, action.description, action.createdAt);
      return;
    case 'playlist_delete':
      await db.deletePlaylistRaw(action.playlistId);
      return;
    case 'playlist_local':
      await db.setPlaylistMembership(action.playlistId, action.songId, action.present);
      if (action.present) await db.setOriginId(action.songId, action.ref);
      return;
    case 'playlist_online': {
      if (!action.present) {
        await db.removeOnlinePlaylistSong(action.playlistId, action.ref);
        return;
      }
      const song = action.song ?? details.get(action.ref);
      if (song) await db.upsertOnlinePlaylistSong(action.playlistId, rowOf(song, action.addedAt));
      return;
    }
  }
}

/**
 * Songs a change named without details (e.g. liked on the website while the catalog was down).
 * `complete` is false when the API could not be reached for some of them; a song the catalog
 * no longer has cannot be shown and is left out for good.
 */
async function detailsFor(actions: readonly LocalAction[], token: string): Promise<{ details: Map<string, SongSnapshot>; complete: boolean }> {
  const missing = new Set<string>();
  for (const action of actions) {
    if ((action.kind === 'online_like' || (action.kind === 'playlist_online' && action.present)) && !action.song) {
      const id = toAllegraId(action.ref);
      if (id) missing.add(id);
    }
  }
  const found = new Map<string, SongSnapshot>();
  let complete = true;
  const ids = [...missing];
  for (let i = 0; i < ids.length; i += 50) {
    const songs = await api.getAllegraSongs(token, ids.slice(i, i + 50));
    if (!songs) {
      complete = false;
      continue;
    }
    for (const song of songs) {
      const ref = songRef(song.source, song.id);
      if (ref) found.set(ref, { ref, title: song.title, artist: song.artist, ...(song.album ? { album: song.album } : {}), artwork: song.artwork, duration: song.duration });
    }
  }
  return { details: found, complete };
}

const rowOf = (song: SongSnapshot, at: number): db.OnlineSongRow => ({
  ref: song.ref,
  title: song.title,
  ...(song.artist ? { artist: song.artist } : {}),
  ...(song.album ? { album: song.album } : {}),
  ...(song.artwork ? { artwork: song.artwork } : {}),
  duration: song.duration,
  at,
});

async function refreshStores(): Promise<void> {
  // Imported late: the stores import this module to record changes.
  const [{ usePlaylistStore }, { useSongsStore }] = await Promise.all([import('../../store/playlistStore'), import('../../store/songsStore')]);
  await Promise.all([
    usePlaylistStore.getState().fetchPlaylists(),
    useSongsStore.getState().fetchSongs(),
    useOnlineLibraryStore.getState().load(),
  ]);
  useOnlineLibraryStore.getState().bumpPlaylists();
}

// ── Reading both libraries (first sign-in) ──────────────────────────────────

async function readPhoneLibrary(): Promise<PhoneLibrary> {
  const [songs, playlists, onlineLikes] = await Promise.all([db.getLocalSongs(), db.getLocalPlaylists(), db.getOnlineLikes()]);
  const byId = new Map(songs.map(song => [song.id, song]));
  const syncable = async (songId: string) => {
    const song = byId.get(songId);
    if (!song) return null;
    const ref = await refFor(song);
    return ref ? { ref, song: snapshotOfLocal(song, ref) } : null;
  };
  const likes: { ref: SongRef; song?: SongSnapshot }[] = [];
  const lists: PhoneLibrary['playlists'][number][] = [];
  for (const list of playlists) {
    const items = (await Promise.all(list.songIds.map(syncable))).filter((item): item is { ref: SongRef; song: SongSnapshot } => item !== null);
    if (list.isDefault) likes.push(...items);
    else {
      const online = await db.getOnlinePlaylistSongs(list.id);
      lists.push({
        id: list.id,
        name: list.name,
        ...(list.description ? { description: list.description } : {}),
        items: [...items, ...online.flatMap(row => (parseSongRef(row.ref) ? [{ ref: row.ref as SongRef }] : []))],
      });
    }
  }
  for (const row of onlineLikes) if (parseSongRef(row.ref)) likes.push({ ref: row.ref as SongRef });
  return { likes, playlists: lists };
}

async function readAccountLibrary(token: string): Promise<{ library: AccountLibrary } | null> {
  const likedRefs = new Set<SongRef>();
  const playlists = new Map<string, Set<SongRef>>();
  let since = 0;
  for (let guard = 0; guard < 100; guard++) {
    const reply = await api.getLibraryChanges(token, since, 500);
    if (reply.outcome !== 'sent') return null;
    for (const change of reply.data.changes) {
      if (change.kind === 'like') {
        if (change.liked) likedRefs.add(change.ref);
        else likedRefs.delete(change.ref);
      } else if (change.kind === 'playlist') {
        if (change.deleted) playlists.delete(change.playlistId);
        else if (!playlists.has(change.playlistId)) playlists.set(change.playlistId, new Set());
      } else {
        const list = playlists.get(change.playlistId);
        if (list) {
          if (change.deleted) list.delete(change.ref);
          else list.add(change.ref);
        }
      }
    }
    since = reply.data.rev;
    if (!reply.data.more) break;
  }
  return { library: { likedRefs, playlists } };
}

/** "Use my account's library": the phone's likes and playlists the account lacks go. Downloads stay. */
async function dropPhoneOnlyItems(account: AccountLibrary): Promise<void> {
  const [songs, playlists, onlineLikes] = await Promise.all([db.getLocalSongs(), db.getLocalPlaylists(), db.getOnlineLikes()]);
  const byId = new Map(songs.map(song => [song.id, song]));
  for (const list of playlists) {
    if (!list.isDefault && !account.playlists.has(list.id)) {
      await db.deletePlaylistRaw(list.id);
      continue;
    }
    if (!list.isDefault) continue;
    for (const songId of list.songIds) {
      const song = byId.get(songId);
      const ref = song ? refForLocalSong(song) : null;
      if (!ref || !account.likedRefs.has(ref)) await db.setPlaylistMembership(LIKED_PLAYLIST_ID, songId, false);
    }
  }
  for (const row of onlineLikes) if (!account.likedRefs.has(row.ref as SongRef)) await db.removeOnlineLike(row.ref);
}

// ── Catalog lookups ─────────────────────────────────────────────────────────

/** The catalog song with this exact title and lead artist, or null. Never a guess. */
async function findInCatalog(title: string, artist: string): Promise<SongRef | null> {
  if (!title.trim()) return null;
  try {
    const key = matchKey(title, artist);
    const hits = await searchMusic(`${title} ${artist}`.trim(), artist || undefined);
    for (const hit of hits) {
      if (matchKey(hit.title, hit.artist) !== key) continue;
      const ref = songRef(hit.source, hit.id);
      if (ref) return ref;
    }
  } catch {
    // Offline or provider down: the song simply stays on the phone for now.
  }
  return null;
}

function parsePlay(body: string): { songId: string; seconds: number; playedAt: string } | null {
  try {
    const value = JSON.parse(body) as { songId?: unknown; seconds?: unknown; playedAt?: unknown };
    return typeof value.songId === 'string' && typeof value.seconds === 'number' && typeof value.playedAt === 'string'
      ? { songId: value.songId, seconds: value.seconds, playedAt: value.playedAt }
      : null;
  } catch {
    return null;
  }
}
