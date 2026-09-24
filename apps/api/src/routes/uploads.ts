import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import { MAX_COVER_BYTES, isCoverContentType, type CoverStorage } from '../lib/covers.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';

/**
 * One-time Convex upload URLs for custom playlist covers. The browser resizes the image to a
 * small WebP first and uploads it straight to Convex; this API never sees the bytes, and only
 * attaches the result (PATCH /libraries/:id with the storage id) after checking what was stored.
 */
export function uploadsRouter(auth: AuthService, covers?: CoverStorage): Router {
  const router = Router();

  router.post('/uploads/sign', async (request, response) => {
    const userId = await getUserId(auth, request);
    if (!userId) {
      sendUnauthorized(response);
      return;
    }
    if (!covers) {
      response.status(503).json({ success: false, data: null, error: 'Cover uploads are not available right now.' });
      return;
    }

    const body = asRecord(request.body);
    const libraryId = typeof body.libraryId === 'string' ? body.libraryId.trim() : '';
    const contentType = typeof body.contentType === 'string' ? body.contentType.trim().toLowerCase() : '';
    const contentLength = typeof body.contentLength === 'number' ? body.contentLength : Number.NaN;

    if (!libraryId || libraryId.length > 80) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    if (!isCoverContentType(contentType)) {
      response.status(400).json({ success: false, data: null, error: 'Use a WebP or JPEG image for the cover.' });
      return;
    }
    if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > MAX_COVER_BYTES) {
      response.status(400).json({ success: false, data: null, error: 'That cover is too large.' });
      return;
    }

    try {
      const user = await auth.getUser(userId);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      if (!user.libraries.some((item) => item.id === libraryId)) {
        response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
        return;
      }
      sendSuccess(response, { uploadUrl: await covers.uploadUrl(), maxBytes: MAX_COVER_BYTES });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}
