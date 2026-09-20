import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import type { CatalogService } from '../catalog/catalog.js';
import type { RecommendationService } from '../services/recommendations.js';
import type { TranslationService } from '../services/translation.js';
import type { LyricLine } from '../types.js';
import { getUserId, sendUnauthorized } from './auth.js';
import { asRecord, sendFailure, sendSuccess, songId } from './common.js';

const MAX_LINES = 400;

export function aiRouter(translation: TranslationService, recommendations: RecommendationService, auth: AuthService, catalog: CatalogService): Router {
  const router = Router();

  router.post('/ai/translate-lyrics', async (request, response) => {
    if (!translation.isAvailable) {
      response.status(503).json({ success: false, data: null, error: 'Translation is not available right now.' });
      return;
    }
    const body = asRecord(request.body);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const artist = typeof body.artist === 'string' ? body.artist.trim() : '';
    const targetLanguage = typeof body.targetLanguage === 'string' && body.targetLanguage.trim() ? body.targetLanguage.trim().slice(0, 40) : 'English';
    const lines = parseLines(body.lines);
    if (!title || !artist || !lines) {
      response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
      return;
    }
    try {
      const result = await translation.translate(lines, title, artist, targetLanguage);
      if (!result) {
        response.status(502).json({ success: false, data: null, error: 'Could not translate this song right now.' });
        return;
      }
      sendSuccess(response, result);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/ai/recommendations', async (request, response) => {
    if (!recommendations.isAvailable) {
      response.status(503).json({ success: false, data: null, error: 'Recommendations are not available right now.' });
      return;
    }
    const userId = getUserId(auth, request);
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
      const recentIds = [...user.recentlyPlayed].sort((left, right) => right.playedAt.localeCompare(left.playedAt)).map((entry) => entry.songId).slice(0, 20);
      const likedIds = user.likedSongIds.slice(0, 20);
      const currentId = songId(request.query.songId);
      const allIds = [...new Set([...likedIds, ...recentIds, ...(currentId ? [currentId] : [])])];
      const songs = allIds.length > 0 ? await catalog.getSongs(allIds) : [];
      const byId = new Map(songs.map((song) => [song.id, song]));
      const describe = (id: string) => {
        const song = byId.get(id);
        return song ? { title: song.title, artist: song.artist } : null;
      };

      const result = await recommendations.recommend({
        likedSongs: likedIds.map(describe).filter((song): song is { title: string; artist: string } => song !== null),
        recentSongs: recentIds.map(describe).filter((song): song is { title: string; artist: string } => song !== null),
        ...(currentId && byId.has(currentId) ? { currentSong: describe(currentId)! } : {}),
        ...(user.taste && user.taste.artists.length > 0 ? { favoriteArtists: user.taste.artists.map((entry) => entry.name) } : {}),
        ...(user.taste && user.taste.languages.length > 0 ? { favoriteLanguages: user.taste.languages.map((entry) => entry.name) } : {})
      }, new Set([...user.likedSongIds, ...user.recentlyPlayed.map((entry) => entry.songId)]), songs);

      if (!result) {
        response.status(404).json({ success: false, data: null, error: 'Not enough listening history yet for a recommendation.' });
        return;
      }
      sendSuccess(response, result);
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

function parseLines(value: unknown): LyricLine[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) return null;
  const lines: LyricLine[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    if (typeof record.text !== 'string' || typeof record.timestamp !== 'number' || typeof record.lineOrder !== 'number') return null;
    lines.push({ text: record.text, timestamp: record.timestamp, lineOrder: record.lineOrder });
  }
  return lines;
}
