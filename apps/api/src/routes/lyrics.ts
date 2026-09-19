import { Router } from 'express';

import type { LyricsService } from '../services/lyrics.js';
import { sendFailure, sendSuccess, queryString } from './common.js';

export function lyricsRouter(lyrics: LyricsService): Router {
  const router = Router();
  router.get('/lyrics', async (request, response) => {
    const title = queryString(request.query.title);
    const artist = queryString(request.query.artist);
    const duration = typeof request.query.duration === 'string' ? Number(request.query.duration) : undefined;
    const syncedOnly = request.query.syncedOnly === 'true';
    if (!title || !artist) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const value = await lyrics.find(title, artist, Number.isFinite(duration) ? duration : undefined, syncedOnly);
      if (!value) {
        response.status(404).json({ success: false, data: null, error: 'No lyrics found for this song.' });
        return;
      }
      sendSuccess(response, value);
    } catch (error) {
      sendFailure(response, error);
    }
  });
  router.get('/lyrics/search', async (request, response) => {
    const title = queryString(request.query.title);
    const artist = queryString(request.query.artist);
    const duration = typeof request.query.duration === 'string' ? Number(request.query.duration) : undefined;
    if (!title || !artist) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await lyrics.search(title, artist, Number.isFinite(duration) ? duration : undefined));
    } catch (error) {
      sendFailure(response, error);
    }
  });
  return router;
}
