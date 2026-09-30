import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { parseLanguages } from '../lib/languages.js';
import { MAX_COVER_BYTES, isCoverContentType, looksLikeStorageId, type CoverStorage } from '../lib/covers.js';
import { parseLibraryOps, type PlaylistCover } from '../shared/library.js';
import type { ListenerActions } from '../user/actions.js';
import { RECENTLY_PLAYED_LIMIT, type UserData } from '../user/store.js';
import { applySeeds, tasteSummary } from '../user/taste.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, positiveInt, sendFailure, sendSuccess, sanitizeSettings, songId } from './common.js';

const MISSING = "Something's missing from that request.";

/**
 * The listener's own data over HTTP. What they do (likes, playlists, plays) is a ListenerActions
 * call (user/actions.ts), the same one the MCP tools and the phone's sync make; these handlers
 * only read the request and shape the reply. Reply shapes are docs/api-contract.md.
 */
export function userRouter(auth: AuthService, catalog: CatalogService, actions: ListenerActions, covers?: CoverStorage): Router {
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
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      const description = typeof body.description === 'string' ? body.description : undefined;
      const library = await actions.createPlaylist(user, { name, ...(description ? { description } : {}), isPublic: body.isPublic === true });
      sendSuccess(response, library, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.patch('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    // Checked before touching any upload, so a request for a playlist that isn't there changes nothing.
    if (!user.libraries.some((library) => library.id === request.params.id)) {
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
        response.status(400).json({ success: false, data: null, error: MISSING });
        return;
      }
      if (!isCoverContentType(stored.contentType) || stored.size > MAX_COVER_BYTES) {
        await covers.remove(storageId);
        response.status(400).json({ success: false, data: null, error: 'Use a WebP or JPEG image for the cover.' });
        return;
      }
      cover = { key: storageId, url: stored.url };
    }

    try {
      const library = await actions.updatePlaylist(user, String(request.params.id), {
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(typeof body.isPublic === 'boolean' ? { isPublic: body.isPublic } : {}),
        ...(cover !== undefined ? { cover } : {})
      });
      sendSuccess(response, library);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      await actions.deletePlaylist(user, String(request.params.id));
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/libraries/:id/songs', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    const id = songId(asRecord(request.body).songId);
    if (!id) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      sendSuccess(response, await actions.addToPlaylist(user, String(request.params.id), id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id/songs/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      sendSuccess(response, await actions.removeFromPlaylist(user, String(request.params.id), String(request.params.songId)));
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
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      await actions.like(user, id);
      sendSuccess(response, { songId: id }, 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/me/liked/:songId', async (request, response) => {
    const user = await authenticatedUser(auth, request, response);
    if (!user) return;
    try {
      await actions.unlike(user, String(request.params.songId));
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
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      sendSuccess(response, await actions.applyFromDevice(user, ops));
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
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      // A phone that played offline sends when it happened; anything else is "now".
      sendSuccess(response, await actions.recordPlay(user, id, playDuration, playedAtFrom(body.playedAt) ?? new Date().toISOString()), 201);
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
      response.status(400).json({ success: false, data: null, error: MISSING });
      return;
    }
    try {
      await actions.listened(user, id, seconds);
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 80)).filter(Boolean))].slice(0, max);
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

/** An ISO time within the last week and not in the future, or null. */
function playedAtFrom(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(time) || time > now + 60_000 || time < now - 7 * 24 * 3600_000) return null;
  return new Date(Math.min(time, now)).toISOString();
}
