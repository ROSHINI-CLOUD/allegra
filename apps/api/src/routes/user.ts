import crypto from 'node:crypto';
import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { forPersistence, isOwnedCoverKey, withCoverUrl, withCoverUrls } from '../lib/covers.js';
import type { LibraryRecord, TasteProfile, UserData } from '../user/store.js';
import { SIGNAL_WEIGHT, applySeeds, applySignal, emptyTaste, playWeight } from '../user/taste.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess, sanitizeSettings, songId } from './common.js';

export function userRouter(auth: AuthService, catalog: CatalogService, coversPublicBaseUrl?: string): Router {
  const router = Router();
  const present = (library: LibraryRecord): LibraryRecord => withCoverUrl(library, coversPublicBaseUrl);

  router.get('/libraries', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, withCoverUrls(user.libraries, coversPublicBaseUrl));
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
      sendSuccess(response, present(library), 201);
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

    let coverKeyUpdate: { coverKey?: string } | undefined;
    if (body.coverKey === null) {
      coverKeyUpdate = {};
    } else if (typeof body.coverKey === 'string') {
      const coverKey = body.coverKey.trim();
      if (!isOwnedCoverKey(coverKey, user.userId, current.id)) {
        response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
        return;
      }
      coverKeyUpdate = { coverKey };
    }

    const base = forPersistence(current);
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
      ...(coverKeyUpdate
        ? coverKeyUpdate.coverKey
          ? { coverKey: coverKeyUpdate.coverKey }
          : {}
        : base.coverKey
          ? { coverKey: base.coverKey }
          : {})
    };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    try {
      await saveUser(auth, { ...user, libraries });
      sendSuccess(response, present(updated));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const libraries = user.libraries.filter((library) => library.id !== request.params.id);
    if (libraries.length === user.libraries.length) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      await saveUser(auth, { ...user, libraries });
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
      sendSuccess(response, present(updated));
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
      sendSuccess(response, present(updated));
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
      await saveUser(auth, { ...taught, recentlyPlayed: next });
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
    const settings = { ...sanitizeSettings(user.settings), ...sanitizeSettings(request.body) };
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
      await saveUser(auth, { ...user, taste });
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
export function tasteSummary(taste: TasteProfile | undefined): { topArtists: { name: string; score: number }[]; languages: { name: string; score: number }[]; signals: number; onboarded: boolean } {
  const value = taste ?? emptyTaste();
  return {
    topArtists: value.artists.slice(0, 12).map((entry) => ({ name: entry.name, score: entry.score })),
    languages: value.languages.slice(0, 5).map((entry) => ({ name: entry.name, score: entry.score })),
    signals: value.signals,
    onboarded: value.onboarded
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
  const userId = getUserId(auth, request);
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
