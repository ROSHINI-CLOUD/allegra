import { Router } from 'express';

import type { KaraokeService, KaraokeStem } from '../services/karaoke/karaoke.service.js';
import { sendFailure, sendSuccess, songId } from './common.js';

export function karaokeRouter(karaoke: KaraokeService): Router {
  const router = Router();

  router.get('/songs/:songId/karaoke', async (request, response) => {
    if (!karaoke.isAvailable) {
      response.status(503).json({ success: false, data: null, error: 'Sing is not available right now.' });
      return;
    }
    const id = songId(request.params.songId);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      sendSuccess(response, await karaoke.status(id));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.post('/songs/:songId/karaoke', async (request, response) => {
    if (!karaoke.isAvailable) {
      response.status(503).json({ success: false, data: null, error: 'Sing is not available right now.' });
      return;
    }
    const id = songId(request.params.songId);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const { payload, accepted } = await karaoke.request(id);
      sendSuccess(response, payload, accepted ? 202 : 200);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/stream/karaoke/:songId', async (request, response) => {
    const id = songId(request.params.songId);
    if (!id) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      await karaoke.pipeStem(id, 'instrumental', request.header('range'), response);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/stream/karaoke/:songId/:stem', async (request, response) => {
    const id = songId(request.params.songId);
    const stem = parseStem(request.params.stem);
    if (!id || !stem) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      await karaoke.pipeStem(id, stem, request.header('range'), response);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

function parseStem(value: string | string[] | undefined): KaraokeStem | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'instrumental' || raw === 'vocals') return raw;
  return null;
}
