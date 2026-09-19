import { Router } from 'express';

import type { ArtworkService } from '../services/artwork.js';
import { sendFailure, sendSuccess, queryString, positiveInt } from './common.js';

export function artworkRouter(artwork: ArtworkService): Router {
  const router = Router();
  router.get('/artwork', async (request, response) => {
    const title = queryString(request.query.title);
    const artist = queryString(request.query.artist);
    if (!title || !artist) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, { urls: await artwork.find(title, artist, positiveInt(request.query.limit, 5, 20)) });
    } catch (error) {
      sendFailure(response, error);
    }
  });
  return router;
}
