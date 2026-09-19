import crypto from 'node:crypto';
import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import type { LibraryRecord, UserData } from '../user/store.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { sendSuccess, queryString } from './common.js';

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
    const body = request.body as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    const library: LibraryRecord = {
      id: crypto.randomUUID(),
      name,
      ...(typeof body.description === 'string' ? { description: body.description.trim() } : {}),
      isPublic: body.isPublic === true,
      songIds: [],
      createdAt: new Date().toISOString()
    };
    await saveUser(auth, { ...user, libraries: [...user.libraries, library] });
    sendSuccess(response, library, 201);
  });

  router.patch('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const index = user.libraries.findIndex((library) => library.id === request.params.id);
    if (index < 0) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const body = request.body as Record<string, unknown>;
    const current = user.libraries[index];
    if (!current) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const updated: LibraryRecord = {
      ...current,
      ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
      ...(typeof body.description === 'string' ? { description: body.description.trim() } : {}),
      ...(typeof body.isPublic === 'boolean' ? { isPublic: body.isPublic } : {})
    };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    await saveUser(auth, { ...user, libraries });
    sendSuccess(response, updated);
  });

  router.delete('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const libraries = user.libraries.filter((library) => library.id !== request.params.id);
    if (libraries.length === user.libraries.length) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    await saveUser(auth, { ...user, libraries });
    response.status(204).end();
  });

  router.post('/libraries/:id/songs', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const songId = queryString((request.body as Record<string, unknown>).songId);
    const index = user.libraries.findIndex((library) => library.id === request.params.id);
    if (!songId || index < 0) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const library = user.libraries[index];
    if (!library) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    const updated = { ...library, songIds: library.songIds.includes(songId) ? library.songIds : [...library.songIds, songId] };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    await saveUser(auth, { ...user, libraries });
    sendSuccess(response, updated);
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
    const updated = { ...library, songIds: library.songIds.filter((songId) => songId !== request.params.songId) };
    const libraries = [...user.libraries];
    libraries[index] = updated;
    await saveUser(auth, { ...user, libraries });
    sendSuccess(response, updated);
  });

  router.get('/me/liked', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, await catalog.getSongs(user.likedSongIds));
  });

  router.post('/me/liked', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const songId = queryString((request.body as Record<string, unknown>).songId);
    if (!songId) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    const likedSongIds = user.likedSongIds.includes(songId) ? user.likedSongIds : [...user.likedSongIds, songId];
    await saveUser(auth, { ...user, likedSongIds });
    sendSuccess(response, { songId }, 201);
  });

  router.delete('/me/liked/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    await saveUser(auth, { ...user, likedSongIds: user.likedSongIds.filter((id) => id !== request.params.songId) });
    response.status(204).end();
  });

  router.get('/me/recently-played', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, await catalog.getSongs(user.recentlyPlayed.map((item) => item.songId)));
  });

  router.post('/me/recently-played', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const body = request.body as Record<string, unknown>;
    const songId = queryString(body.songId);
    const playDuration = typeof body.playDuration === 'number' && body.playDuration >= 0 ? body.playDuration : 0;
    if (!songId) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    const next = [{ songId, playDuration, playedAt: new Date().toISOString() }, ...user.recentlyPlayed.filter((item) => item.songId !== songId)].slice(0, 50);
    await saveUser(auth, { ...user, recentlyPlayed: next });
    sendSuccess(response, next[0], 201);
  });

  router.get('/me/settings', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    sendSuccess(response, user.settings);
  });

  router.patch('/me/settings', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const settings = { ...user.settings, ...(request.body as Record<string, unknown>) };
    await saveUser(auth, { ...user, settings });
    sendSuccess(response, settings);
  });

  return router;
}

async function authenticatedUser(auth: AuthService, request: Parameters<typeof getUserId>[1], response: Parameters<typeof sendUnauthorized>[0]): Promise<UserData | null> {
  const userId = getUserId(auth, request);
  if (!userId) {
    sendUnauthorized(response);
    return null;
  }
  const user = await auth.getUser(userId);
  if (!user) {
    sendUnauthorized(response);
    return null;
  }
  return user;
}

async function saveUser(auth: AuthService, user: UserData): Promise<void> {
  await auth.update(user);
}
