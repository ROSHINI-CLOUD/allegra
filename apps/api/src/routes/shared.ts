import crypto from 'node:crypto';
import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { withCoverUrl } from '../lib/covers.js';
import type { LibraryRecord, UserData } from '../user/store.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { sendFailure, sendSuccess } from './common.js';

/** Six url-safe characters ~ 2 billion codes; long enough not to guess, short enough to read out loud. */
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newCode(): string {
  return Array.from(crypto.randomBytes(8), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('').slice(0, 8);
}

const CODE_SHAPE = /^[a-z0-9]{6,12}$/;

/**
 * Sharing. A share is a code that points at one of the owner's playlists, so the link stays live as the owner
 * adds songs. Anyone with the code can read it and save a copy; only the owner can create or revoke it.
 */
export function sharedRouter(auth: AuthService, catalog: CatalogService, coversPublicBaseUrl?: string): Router {
  const router = Router();
  const store = auth.userStore;

  router.post('/libraries/:id/share', async (request, response) => {
    const user = await currentUser(auth, request);
    if (!user) {
      sendUnauthorized(response);
      return;
    }
    const library = user.libraries.find((item) => item.id === request.params.id);
    if (!library) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      const existing = await store.findShare(user.userId, library.id);
      const code = existing?.code ?? newCode();
      if (!existing) await store.saveShare({ code, ownerId: user.userId, libraryId: library.id, createdAt: new Date().toISOString() });
      if (!library.isPublic) {
        await auth.update({ ...user, libraries: user.libraries.map((item) => (item.id === library.id ? { ...item, isPublic: true } : item)) });
      }
      sendSuccess(response, { code, path: `#shared/${code}` }, existing ? 200 : 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.delete('/libraries/:id/share', async (request, response) => {
    const user = await currentUser(auth, request);
    if (!user) {
      sendUnauthorized(response);
      return;
    }
    const library = user.libraries.find((item) => item.id === request.params.id);
    if (!library) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      const existing = await store.findShare(user.userId, library.id);
      if (existing) await store.deleteShare(existing.code);
      await auth.update({ ...user, libraries: user.libraries.map((item) => (item.id === library.id ? { ...item, isPublic: false } : item)) });
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // Public: this is what a friend opens. No session needed to listen along.
  router.get('/shared/:code', async (request, response) => {
    const code = String(request.params.code ?? '').toLowerCase();
    if (!CODE_SHAPE.test(code)) {
      response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
      return;
    }
    try {
      const share = await store.getShare(code);
      const owner = share ? await store.get(share.ownerId) : null;
      const library = owner?.libraries.find((item) => item.id === share?.libraryId);
      if (!share || !owner || !library || !library.isPublic) {
        response.status(404).json({ success: false, data: null, error: "We couldn't find that. The link may have been turned off." });
        return;
      }
      const songs = library.songIds.length > 0 ? await catalog.getSongs(library.songIds) : [];
      const presented = withCoverUrl(library, coversPublicBaseUrl);
      sendSuccess(response, {
        code,
        name: library.name,
        ...(library.description ? { description: library.description } : {}),
        ...(presented.coverUrl ? { coverUrl: presented.coverUrl } : {}),
        ownerName: owner.displayName ?? 'A listener',
        songs
      });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // Save a copy into the caller's own account, so they can edit it without touching the original.
  router.post('/shared/:code/save', async (request, response) => {
    const user = await currentUser(auth, request);
    if (!user) {
      sendUnauthorized(response);
      return;
    }
    const code = String(request.params.code ?? '').toLowerCase();
    try {
      const share = CODE_SHAPE.test(code) ? await store.getShare(code) : null;
      const owner = share ? await store.get(share.ownerId) : null;
      const source = owner?.libraries.find((item) => item.id === share?.libraryId);
      if (!source || !source.isPublic) {
        response.status(404).json({ success: false, data: null, error: "We couldn't find that. The link may have been turned off." });
        return;
      }
      // Persist the owner's coverKey only (coverUrl is derived on read). The object is public-read.
      const stored: LibraryRecord = {
        id: crypto.randomUUID(),
        name: source.name,
        ...(source.description ? { description: source.description } : {}),
        isPublic: false,
        songIds: [...source.songIds],
        createdAt: new Date().toISOString(),
        ...(source.coverKey ? { coverKey: source.coverKey } : {})
      };
      await auth.update({ ...user, libraries: [...user.libraries, stored] });
      sendSuccess(response, withCoverUrl(stored, coversPublicBaseUrl), 201);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

async function currentUser(auth: AuthService, request: Parameters<typeof getUserId>[1]): Promise<UserData | null> {
  const userId = await getUserId(auth, request);
  return userId ? auth.getUser(userId).catch(() => null) : null;
}
