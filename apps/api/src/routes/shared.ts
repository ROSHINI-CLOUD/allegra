import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import type { ListenerActions } from '../user/actions.js';
import type { UserData } from '../user/store.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { sendFailure, sendSuccess } from './common.js';

const LINK_OFF = "We couldn't find that. The link may have been turned off.";

/**
 * Sharing. A share is a code that points at one of the owner's playlists, so the link stays live as the owner
 * adds songs. Anyone with the code can read it and save a copy; only the owner can create or revoke it.
 * The rules live in ListenerActions (user/actions.ts), which the MCP tools share.
 */
export function sharedRouter(auth: AuthService, catalog: CatalogService, actions: ListenerActions): Router {
  const router = Router();

  router.post('/libraries/:id/share', async (request, response) => {
    const user = await currentUser(auth, request);
    if (!user) {
      sendUnauthorized(response);
      return;
    }
    try {
      const { code, created } = await actions.share(user, String(request.params.id));
      sendSuccess(response, { code, path: `#shared/${code}` }, created ? 201 : 200);
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
    try {
      await actions.unshare(user, String(request.params.id));
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // Public: this is what a friend opens. No session needed to listen along.
  router.get('/shared/:code', async (request, response) => {
    const code = String(request.params.code ?? '').toLowerCase();
    try {
      const shared = await actions.openShare(code);
      if (!shared) {
        response.status(404).json({ success: false, data: null, error: LINK_OFF });
        return;
      }
      const { owner, library } = shared;
      const songs = library.songIds.length > 0 ? await catalog.getSongs(library.songIds) : [];
      sendSuccess(response, {
        code,
        name: library.name,
        ...(library.description ? { description: library.description } : {}),
        ...(library.coverUrl ? { coverUrl: library.coverUrl } : {}),
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
    try {
      const saved = await actions.saveSharedCopy(user, String(request.params.code ?? '').toLowerCase());
      if (!saved) {
        response.status(404).json({ success: false, data: null, error: LINK_OFF });
        return;
      }
      sendSuccess(response, saved, 201);
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
