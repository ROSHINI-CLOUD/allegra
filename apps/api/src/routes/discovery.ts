import { Router, type Request, type Response } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import { buildRecommendationInput } from '../services/recommendationContext.js';
import type { RecommendationService } from '../services/recommendations.js';
import type { TranslationService } from '../services/translation.js';
import type { LyricLine } from '../types.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess, songId } from './common.js';

const MAX_LINES = 400;
const MAX_LINE_LENGTH = 500;

/**
 * Recommendations (from the catalog and the listener's taste) and lyrics translation (MyMemory).
 * Neither uses an LLM. The `/ai/...` paths are the names these shipped under; they stay as
 * aliases so a client built before the rename keeps working.
 */
export function discoveryRouter(translation: TranslationService, recommendations: RecommendationService, auth: AuthService, catalog: CatalogService): Router {
  const router = Router();

  const translate = async (request: Request, response: Response): Promise<void> => {
    const body = asRecord(request.body);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const artist = typeof body.artist === 'string' ? body.artist.trim().slice(0, 200) : '';
    const targetLanguage = typeof body.targetLanguage === 'string' && body.targetLanguage.trim() ? body.targetLanguage.trim().slice(0, 40) : 'English';
    const language = typeof body.language === 'string' ? body.language.trim().slice(0, 40) : undefined;
    const lines = parseLines(body.lines);
    if (!title || !artist || !lines) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const result = await translation.translate(lines, title, artist, targetLanguage, language);
      if (!result) {
        response.status(502).json({ success: false, data: null, error: 'Could not translate this song right now. Try again later.' });
        return;
      }
      sendSuccess(response, result);
    } catch (error) {
      sendFailure(response, error);
    }
  };

  const recommend = async (request: Request, response: Response): Promise<void> => {
    const userId = await getUserId(auth, request);
    if (!userId) {
      sendUnauthorized(response);
      return;
    }
    try {
      const user = await auth.getUser(userId);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      const currentId = songId(request.query.songId);
      const { context, excludeIds, excludeSongs } = await buildRecommendationInput(catalog, user, currentId);
      const result = await recommendations.recommend(context, excludeIds, excludeSongs);
      if (!result) {
        response.status(404).json({ success: false, data: null, error: 'Not enough listening history yet for a recommendation.' });
        return;
      }
      sendSuccess(response, result);
    } catch (error) {
      sendFailure(response, error);
    }
  };

  router.post('/lyrics/translate', translate);
  router.post('/ai/translate-lyrics', translate);
  router.get('/recommendations', recommend);
  router.get('/ai/recommendations', recommend);

  return router;
}

function parseLines(value: unknown): LyricLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) return null;
  const lines: LyricLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.text !== 'string' || typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp)) return null;
    const lineOrder = typeof record.lineOrder === 'number' && Number.isFinite(record.lineOrder) ? record.lineOrder : lines.length;
    lines.push({ text: record.text.slice(0, MAX_LINE_LENGTH), timestamp: record.timestamp, lineOrder });
  }
  return lines;
}
