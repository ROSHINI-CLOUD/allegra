import crypto from 'node:crypto';
import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { parseLanguages } from '../lib/languages.js';
import { MAX_COVER_BYTES, isCoverContentType, looksLikeStorageId, type CoverStorage } from '../lib/covers.js';
import type { LibraryRecord, TasteProfile, UserData } from '../user/store.js';
import { deriveMoodPrompts } from '../user/moodPrompts.js';
import { SIGNAL_WEIGHT, applySeeds, applySignal, emptyTaste, playWeight } from '../user/taste.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess, sanitizeSettings, songId } from './common.js';

export function userRouter(auth: AuthService, catalog: CatalogService, covers?: CoverStorage): Router {
  const router = Router();

  router.get('/libraries', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, user.libraries);
  });

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
    const library: LibraryRecord = {
      id: crypto.randomUUID(),
      name,
      ...(description ? { description } : {}),
      isPublic: body.isPublic === true,
      songIds: [],
      createdAt: new Date().toISOString()
    };
    try {
      await saveUser(auth, { ...user, libraries: [...user.libraries, library] });
      sendSuccess(response, library, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.patch('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const index = user.libraries.findIndex((library) => library.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const body = asRecord(request.body);
    const current = user.libraries[index];
    if (!current) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }

    // A new cover is a Convex storage id the browser just uploaded to. Check what was actually
    // stored before attaching it; anything wrong is deleted, never kept.
    let cover: { coverKey: string; coverUrl: string } | null | undefined;
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
      cover = { coverKey: storageId, coverUrl: stored.url };
    }

    const base = current;
    const keptCover = base.coverKey || base.coverUrl
      ? { ...(base.coverKey ? { coverKey: base.coverKey } : {}), ...(base.coverUrl ? { coverUrl: base.coverUrl } : {}) }
      : {};
    const updated: LibraryRecord = {
      id: base.id,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : base.name,
      ...(typeof body.description === 'string'
        ? (body.description.trim() ? { description: body.description.trim().slice(0, 500) } : {})
        : base.description
          ? { description: base.description }
          : {}),
      isPublic: typeof body.isPublic === 'boolean' ? body.isPublic : base.isPublic,
      songIds: base.songIds,
      createdAt: base.createdAt,
      ...(cover === undefined ? keptCover : cover === null ? {} : cover)
    };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    try {
      await saveUser(auth, { ...user, libraries });
      // The replaced image is no longer referenced by this playlist.
      if (cover !== undefined && base.coverKey && base.coverKey !== cover?.coverKey) await covers?.remove(base.coverKey);
      sendSuccess(response, updated);
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
    const libraries = user.libraries.filter((library) => library.id !== removed.id);
    try {
      await saveUser(auth, { ...user, libraries });
      if (removed.coverKey) await covers?.remove(removed.coverKey);
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/libraries/:id/songs', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const id = songId(asRecord(request.body).songId);
    const index = user.libraries.findIndex((library) => library.id === request.params.id);
    if (!id || index < 0) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const library = user.libraries[index];
    if (!library) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const adding = !library.songIds.includes(id);
    const updated = { ...library, songIds: adding ? [...library.songIds, id] : library.songIds };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    try {
      const taught = adding ? await learn(catalog, user, id, () => SIGNAL_WEIGHT.playlistAdd) : user;
      await saveUser(auth, { ...taught, libraries });
      sendSuccess(response, updated);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id/songs/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const index = user.libraries.findIndex((library) => library.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const library = user.libraries[index];
    if (!library) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const updated = { ...library, songIds: library.songIds.filter((id) => id !== request.params.songId) };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    try {
      await saveUser(auth, { ...user, libraries });
      sendSuccess(response, updated);
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
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    const isNew = !user.likedSongIds.includes(id);
    const likedSongIds = isNew ? [...user.likedSongIds, id] : user.likedSongIds;
    try {
      const taught = isNew ? await learn(catalog, user, id, () => SIGNAL_WEIGHT.like) : user;
      await saveUser(auth, { ...taught, likedSongIds });
      sendSuccess(response, { songId: id }, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/me/liked/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      const wasLiked = user.likedSongIds.includes(String(request.params.songId));
      const taught = wasLiked ? await learn(catalog, user, String(request.params.songId), () => SIGNAL_WEIGHT.unlike) : user;
      await saveUser(auth, { ...taught, likedSongIds: user.likedSongIds.filter((id) => id !== request.params.songId) });
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/recently-played', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      sendSuccess(response, await catalog.getSongs(user.recentlyPlayed.map((item) => item.songId)));
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
    const next = [{ songId: id, playDuration, playedAt: new Date().toISOString() }, ...user.recentlyPlayed.filter((item) => item.songId !== id)].slice(0, 50);
    try {
      // Pressing play is a mild vote. How long they stayed arrives separately, as a listen signal.
      const taught = await learn(catalog, user, id, (song) => (playDuration > 0 ? playWeight(playDuration, song.duration) : 0.3));
      const playStats = recordListen(recordPlay(taught.playStats, id), id, playDuration);
      await saveUser(auth, { ...taught, recentlyPlayed: next, playStats });
      sendSuccess(response, next[0], 201);
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
    const settings: Record<string, string | number | boolean> = { ...sanitizeSettings(user.settings), ...sanitizeSettings(body) };
    // Languages arrive as ["hindi", "tamil"] or "hindi,tamil"; stored as a known, ordered list.
    // An empty list means every language.
    if ('languages' in body) settings.languages = parseLanguages(body.languages).join(',');
    try {
      await saveUser(auth, { ...user, settings });
      sendSuccess(response, settings);
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
    try {
      const taste = applySeeds(user.taste, artists, languages);
      // Onboarding's language picks become the language setting; Settings changes it later.
      const picked = parseLanguages(languages);
      const settings = picked.length > 0 ? { ...user.settings, languages: picked.join(',') } : user.settings;
      await saveUser(auth, { ...user, taste, settings });
      sendSuccess(response, tasteSummary(taste));
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
      const taught = await learn(catalog, user, id, (song) => playWeight(seconds, song.duration));
      if (taught !== user) await saveUser(auth, taught);
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
 * Folds one behaviour on one song into the user's taste. Looking the song up can fail (provider down); that must
 * never fail the action the listener took, so on any trouble the user is returned untouched.
 */
export async function learn(catalog: CatalogService, user: UserData, id: string, weightFor: (song: { duration: number }) => number): Promise<UserData> {
  try {
    const [song] = await catalog.getSongs([id]);
    if (!song) return user;
    const taste = applySignal(user.taste, { artist: song.artist, ...(song.language ? { language: song.language } : {}) }, weightFor(song));
    return { ...user, taste };
  } catch {
    return user;
  }
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

async function saveUser(auth: AuthService, user: UserData): Promise<void> {
  await auth.update(user);
}
