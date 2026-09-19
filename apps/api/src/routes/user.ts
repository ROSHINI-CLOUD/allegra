import crypto from 'node:crypto';
import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import type { LibraryRecord, UserData } from '../user/store.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess, sanitizeSettings, songId } from './common.js';

export function userRouter(auth: AuthService, catalog: CatalogService): Router {
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
    const updated: LibraryRecord = {
      ...current,
      ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim().slice(0, 100) } : {}),
      ...(typeof body.description === 'string' ? { description: body.description.trim().slice(0, 500) } : {}),
      ...(typeof body.isPublic === 'boolean' ? { isPublic: body.isPublic } : {})
    };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    try {
      await saveUser(auth, { ...user, libraries });
      sendSuccess(response, updated);
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
    const updated = { ...library, songIds: library.songIds.includes(id) ? library.songIds : [...library.songIds, id] };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    try {
      await saveUser(auth, { ...user, libraries });
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
    const likedSongIds = user.likedSongIds.includes(id) ? user.likedSongIds : [...user.likedSongIds, id];
    try {
      await saveUser(auth, { ...user, likedSongIds });
      sendSuccess(response, { songId: id }, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/me/liked/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      await saveUser(auth, { ...user, likedSongIds: user.likedSongIds.filter((id) => id !== request.params.songId) });
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
      await saveUser(auth, { ...user, recentlyPlayed: next });
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

  return router;
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
