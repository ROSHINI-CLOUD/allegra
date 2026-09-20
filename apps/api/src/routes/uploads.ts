import crypto from 'node:crypto';
import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { UploadsConfig } from '../config.js';
import {
  COVER_CONTENT_TYPES,
  MAX_COVER_BYTES,
  coverKeyPrefix,
  isCoverContentType,
  publicCoverUrl
} from '../lib/covers.js';
import { presignPutUrl } from '../lib/s3Presign.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';

/**
 * Short-lived S3 PUT URLs for custom playlist covers. The browser uploads
 * straight to S3; this API never sees the image bytes and never sends AWS keys
 * to the client.
 */
export function uploadsRouter(auth: AuthService, uploads?: UploadsConfig): Router {
  const router = Router();

  router.post('/uploads/sign', async (request, response) => {
    const userId = getUserId(auth, request);
    if (!userId) {
      sendUnauthorized(response);
      return;
    }
    if (!uploads) {
      response.status(503).json({
        success: false,
        data: null,
        error: 'Cover uploads are not available right now.'
      });
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
      response.status(400).json({
        success: false,
        data: null,
        error: 'Use a JPEG, PNG or WebP image for the cover.'
      });
      return;
    }
    if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > MAX_COVER_BYTES) {
      response.status(400).json({
        success: false,
        data: null,
        error: 'Covers must be under 2 MB.'
      });
      return;
    }

    try {
      const user = await auth.getUser(userId);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      const library = user.libraries.find((item) => item.id === libraryId);
      if (!library) {
        response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
        return;
      }

      const ext = COVER_CONTENT_TYPES[contentType];
      const coverKey = `${coverKeyPrefix(userId, libraryId)}${crypto.randomUUID()}.${ext}`;
      const uploadUrl = presignPutUrl({
        accessKeyId: uploads.accessKeyId,
        secretAccessKey: uploads.secretAccessKey,
        region: uploads.region,
        bucket: uploads.bucket,
        key: coverKey,
        contentType,
        contentLength,
        expiresInSeconds: uploads.expiresInSeconds
      });

      sendSuccess(response, {
        uploadUrl,
        coverKey,
        coverUrl: publicCoverUrl(uploads.publicBaseUrl, coverKey),
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(contentLength)
        },
        expiresInSeconds: uploads.expiresInSeconds
      });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}
