import crypto from 'node:crypto';
import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { parseLanguages } from '../lib/languages.js';
import { MAX_COVER_BYTES, isCoverContentType, looksLikeStorageId, type CoverStorage } from '../lib/covers.js';
import { parseLibraryOps, type LibraryOp, type PlaylistCover } from '../shared/library.js';
import type { UnifiedSong } from '../types.js';
import type { LibraryApplyResult } from '../user/library.js';
import type { SongSnapshot } from '../shared/songRef.js';
import { refForId, snapshotOf } from '../user/libraryOps.js';
import { RECENTLY_PLAYED_LIMIT, type LibraryRecord, type TasteProfile, type UserData } from '../user/store.js';
import { deriveMoodPrompts } from '../user/moodPrompts.js';
import { SIGNAL_WEIGHT, applySeeds, applySignal, emptyTaste, playWeight } from '../user/taste.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, positiveInt, sendFailure, sendSuccess, sanitizeSettings, songId } from './common.js';

export function userRouter(auth: AuthService, catalog: CatalogService, covers?: CoverStorage): Router {
  const router = Router();

  router.get('/libraries', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, user.libraries);
  });

  // Every playlist and like change below is a library operation (user/library.ts): it lands in
  // one transaction and syncs to the listener's other devices. Shapes are unchanged.

  router.post('/libraries', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
    const id = crypto.randomUUID();
    try {
      await applyLibrary(auth, user.userId, [{ op: 'playlist_upsert', playlistId: id, name, ...(description ? { description } : {}), isPublic: body.isPublic === true, at: Date.now() }], covers);
      sendSuccess(response, await libraryAfter(auth, user.userId, id), 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.patch('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const current = user.libraries.find((library) => library.id === request.params.id);
    if (!current) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const body = asRecord(request.body);

    // A new cover is a Convex storage id the browser just uploaded to. Check what was actually
    // stored before attaching it; anything wrong is deleted, never kept.
    let cover: PlaylistCover | null | undefined;
    if (body.coverKey === null) {
      cover = null;
    } else if (typeof body.coverKey === 'string') {
      const storageId = body.coverKey.trim();
      if (!covers) {
        response.status(503).json({ success: false, data: null, error: 'Cover uploads are not available right now.' });
        return;
      }
      const stored = looksLikeStorageId(storageId) ? await covers.inspect(storageId) : null;
      if (!stored) {
        response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
        return;
      }
      if (!isCoverContentType(stored.contentType) || stored.size > MAX_COVER_BYTES) {
        await covers.remove(storageId);
        response.status(400).json({ success: false, data: null, error: 'Use a WebP or JPEG image for the cover.' });
        return;
      }
      cover = { key: storageId, url: stored.url };
    }

    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : undefined;
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) || null : undefined;
    try {
      await applyLibrary(
        auth,
        user.userId,
        [
          {
            op: 'playlist_upsert',
            playlistId: current.id,
            ...(name ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(typeof body.isPublic === 'boolean' ? { isPublic: body.isPublic } : {}),
            ...(cover !== undefined ? { cover } : {}),
            at: Date.now()
          }
        ],
        covers
      );
      sendSuccess(response, await libraryAfter(auth, user.userId, current.id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const removed = user.libraries.find((library) => library.id === request.params.id);
    if (!removed) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      await applyLibrary(auth, user.userId, [{ op: 'playlist_delete', playlistId: removed.id, at: Date.now() }], covers);
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/libraries/:id/songs', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const id = songId(asRecord(request.body).songId);
    const library = user.libraries.find((item) => item.id === request.params.id);
    const ref = id ? refForId(id) : null;
    if (!id || !ref || !library) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      const song = await lookUp(catalog, id);
      await applyLibrary(auth, user.userId, [{ op: 'playlist_add', playlistId: library.id, ref, ...withSnapshot(song), at: Date.now() }], covers);
      if (!library.songIds.includes(id) && song) await learnFrom(auth, user.userId, song, SIGNAL_WEIGHT.playlistAdd);
      sendSuccess(response, await libraryAfter(auth, user.userId, library.id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id/songs/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const library = user.libraries.find((item) => item.id === request.params.id);
    const ref = refForId(String(request.params.songId));
    if (!library || !ref) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      await applyLibrary(auth, user.userId, [{ op: 'playlist_remove', playlistId: library.id, ref, at: Date.now() }], covers);
      sendSuccess(response, await libraryAfter(auth, user.userId, library.id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/liked', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      sendSuccess(response, await catalog.getSongs(user.likedSongIds));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/me/liked', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const id = songId(asRecord(request.body).songId);
    const ref = id ? refForId(id) : null;
    if (!id || !ref) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const song = await lookUp(catalog, id);
      await applyLibrary(auth, user.userId, [{ op: 'like', ref, ...withSnapshot(song), at: Date.now() }], covers);
      if (!user.likedSongIds.includes(id) && song) await learnFrom(auth, user.userId, song, SIGNAL_WEIGHT.like);
      sendSuccess(response, { songId: id }, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/me/liked/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const id = String(request.params.songId);
    const ref = refForId(id);
    try {
      if (ref) await applyLibrary(auth, user.userId, [{ op: 'unlike', ref, at: Date.now() }], covers);
      if (user.likedSongIds.includes(id)) {
        const song = await lookUp(catalog, id);
        if (song) await learnFrom(auth, user.userId, song, SIGNAL_WEIGHT.unlike);
      }
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // Library sync for the listener's other devices (the phone). Operations in, changes out.
  router.post('/me/library/ops', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const ops = parseLibraryOps(asRecord(request.body).ops);
    if (!ops) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const result = await applyLibrary(auth, user.userId, ops, covers);
      // What the device did teaches taste the same way the website's buttons do.
      const rejected = new Set(result.rejected.map((item) => item.index));
      const lessons: { song: SongSnapshot; weight: number }[] = [];
      ops.forEach((op, index) => {
        if (rejected.has(index) || !('song' in op) || !op.song) return;
        const alreadyLiked = user.likedSongIds.some((id) => refForId(id) === op.ref);
        if (op.op === 'like' && !alreadyLiked) lessons.push({ song: op.song, weight: SIGNAL_WEIGHT.like });
        if (op.op === 'playlist_add') lessons.push({ song: op.song, weight: SIGNAL_WEIGHT.playlistAdd });
      });
      if (lessons.length > 0) {
        await auth.updateProfile(user.userId, (current) => lessons.reduce((taught, lesson) => teach(taught, lesson.song, lesson.weight), current));
      }
      sendSuccess(response, { rev: result.rev, rejected: result.rejected });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/library/changes', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const sinceRaw = typeof request.query.since === 'string' ? Number.parseInt(request.query.since, 10) : 0;
    const since = Number.isInteger(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
    const limit = positiveInt(request.query.limit, 200, 500);
    try {
      sendSuccess(response, await auth.library.changes(user.userId, since, limit));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/recently-played', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      sendSuccess(response, await catalog.getSongs(user.recentlyPlayed.slice(0, RECENTLY_PLAYED_LIMIT).map((item) => item.songId)));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/me/recently-played', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const id = songId(body.songId);
    const playDuration = typeof body.playDuration === 'number' && Number.isFinite(body.playDuration) && body.playDuration >= 0 ? body.playDuration : 0;
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    // A phone that played offline sends when it happened; anything else is "now".
    const entry = { songId: id, playDuration, playedAt: playedAtFrom(body.playedAt) ?? new Date().toISOString() };
    try {
      // Pressing play is a mild vote. How long they stayed arrives separately, as a listen signal.
      const song = await lookUp(catalog, id);
      await auth.updateProfile(user.userId, (current) => {
        const recentlyPlayed = [entry, ...current.recentlyPlayed.filter((item) => item.songId !== id)]
          .sort((left, right) => right.playedAt.localeCompare(left.playedAt))
          .slice(0, RECENTLY_PLAYED_LIMIT);
        const taught = song ? teach(current, song, playDuration > 0 ? playWeight(playDuration, song.duration) : 0.3) : current;
        return { ...taught, recentlyPlayed };
      });
      sendSuccess(response, entry, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/settings', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, user.settings);
  });

  router.patch('/me/settings', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const changed: Record<string, string | number | boolean> = sanitizeSettings(body);
    // Languages arrive as ["hindi", "tamil"] or "hindi,tamil"; stored as a known, ordered list.
    // An empty list means every language.
    if ('languages' in body) changed.languages = parseLanguages(body.languages).join(',');
    try {
      const saved = await auth.updateProfile(user.userId, (current) => ({ ...current, settings: { ...sanitizeSettings(current.settings), ...changed } }));
      sendSuccess(response, sanitizeSettings(saved?.settings ?? {}));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/taste', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, tasteSummary(user.taste));
  });

  // Onboarding: the listener names favourites. Everything after that is learned from behaviour.
  router.post('/me/taste/seed', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const artists = stringList(body.artists, 30);
    const languages = stringList(body.languages, 8);
    // Onboarding's language picks become the language setting; Settings changes it later.
    const picked = parseLanguages(languages);
    try {
      const saved = await auth.updateProfile(user.userId, (current) => ({
        ...current,
        taste: applySeeds(current.taste, artists, languages),
        settings: picked.length > 0 ? { ...current.settings, languages: picked.join(',') } : current.settings
      }));
      sendSuccess(response, tasteSummary(saved?.taste));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // How long a song was actually listened to. A few seconds counts against it, most of it counts for it.
  router.post('/me/taste/signal', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const id = songId(body.songId);
    const seconds = typeof body.seconds === 'number' && Number.isFinite(body.seconds) && body.seconds >= 0 ? Math.min(body.seconds, 3600) : null;
    if (!id || seconds === null) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      await learn(auth, catalog, user.userId, id, (song) => playWeight(seconds, song.duration));
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

/** The slice of taste the browser needs: who they love, in what language, and whether to ask them to pick favourites. */
export function tasteSummary(taste: TasteProfile | undefined): { topArtists: { name: string; score: number }[]; languages: { name: string; score: number }[]; signals: number; onboarded: boolean; prompts: string[] } {
  const value = taste ?? emptyTaste();
  const summary = {
    topArtists: value.artists.slice(0, 12).map((entry) => ({ name: entry.name, score: entry.score })),
    languages: value.languages.slice(0, 5).map((entry) => ({ name: entry.name, score: entry.score })),
    signals: value.signals,
    onboarded: value.onboarded
  };
  return {
    ...summary,
    prompts: deriveMoodPrompts(summary)
  };
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 80)).filter(Boolean))].slice(0, max);
}

/**
 * Folds one behaviour on one song into the listener's taste and saves it. Looking the song up can
 * fail (provider down); that must never fail the action the listener took, so then nothing is learned.
 */
export async function learn(auth: AuthService, catalog: CatalogService, userId: string, id: string, weightFor: (song: { duration: number }) => number): Promise<UserData | null> {
  const song = await lookUp(catalog, id);
  if (!song) return auth.getUser(userId);
  return learnFrom(auth, userId, song, weightFor(song));
}

/** One behaviour on one known song, folded into taste atomically. */
function learnFrom(auth: AuthService, userId: string, song: { readonly artist: string; readonly language?: string }, weight: number): Promise<UserData | null> {
  return auth.updateProfile(userId, (current) => teach(current, song, weight));
}

async function authenticatedUser(auth: AuthService, request: Parameters<typeof getUserId>[1], response: Parameters<typeof sendUnauthorized>[0]): Promise<UserData | null> {
  const userId = await getUserId(auth, request);
  if (!userId) {
    sendUnauthorized(response);
    return null;
  }
  try {
    const user = await auth.getUser(userId);
    if (!user) {
      sendUnauthorized(response);
      return null;
    }
    return user;
  } catch (error) {
    sendFailure(response, error);
    return null;
  }
}

/** Applies library operations, then deletes playlist covers nothing uses any more. */
async function applyLibrary(auth: AuthService, userId: string, ops: readonly LibraryOp[], covers: CoverStorage | undefined): Promise<LibraryApplyResult> {
  const result = await auth.library.apply(userId, ops);
  for (const key of result.removedCoverKeys) {
    try {
      await covers?.remove(key);
    } catch {
      // A leftover image costs storage, not correctness; the playlist change already landed.
    }
  }
  return result;
}

/** A playlist as the profile shows it right after a change. */
async function libraryAfter(auth: AuthService, userId: string, id: string): Promise<LibraryRecord> {
  const library = (await auth.getUser(userId))?.libraries.find((item) => item.id === id);
  if (!library) throw new Error('Playlist missing after change');
  return library;
}

/** The song snapshot to carry on an operation, when the catalog found the song. */
function withSnapshot(song: UnifiedSong | null): { song: SongSnapshot } | Record<string, never> {
  const snapshot = song ? snapshotOf(song) : undefined;
  return snapshot ? { song: snapshot } : {};
}

/** The catalog row for an id, or null when the provider is down (the action still goes ahead). */
async function lookUp(catalog: CatalogService, id: string): Promise<UnifiedSong | null> {
  try {
    const [song] = await catalog.getSongs([id]);
    return song ?? null;
  } catch {
    return null;
  }
}

/** One behaviour on one song, folded into taste. */
function teach(user: UserData, song: { readonly artist: string; readonly language?: string }, weight: number): UserData {
  return { ...user, taste: applySignal(user.taste, { artist: song.artist, ...(song.language ? { language: song.language } : {}) }, weight) };
}

/** An ISO time within the last week and not in the future, or null. */
function playedAtFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(time) || time > now + 60_000 || time < now - 7 * 24 * 3600_000) return null;
  return new Date(Math.min(time, now)).toISOString();
}

