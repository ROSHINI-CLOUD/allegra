import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

export interface SongChangeLimitConfig {
  readonly windowMs: number;
  /** Different songs one client may start per window. */
  readonly limit: number;
  /** Clients tracked at once; the least recently seen are dropped past this. Bounds memory. */
  readonly maxClients?: number;
}

const STREAM_PREFIX = '/api/stream/';

/**
 * Caps how many *different* songs one client can start per window.
 *
 * A request counter cannot express this: a single song is many stream requests (the first
 * fetch, then a Range request per seek), so a per-request cap either throttles someone who
 * scrubs a lot or lets a bot walk the catalogue. Here a song counts once, when it is first
 * streamed in the window; every later request for it — seeks included — passes free.
 *
 * In-memory and per function instance, like express-rate-limit's default store: it costs no
 * database call per request, which is the point, but it is not a global quota.
 */
export function songChangeLimiter(
  config: SongChangeLimitConfig,
  onLimited: (response: Response) => void
): (request: Request, response: Response, next: NextFunction) => void {
  const maxClients = config.maxClients ?? 10_000;
  /** client key → songId → when it was first streamed. Insertion order is time order. */
  const clients = new Map<string, Map<string, number>>();

  const prune = (songs: Map<string, number>, now: number): void => {
    for (const [songId, firstSeen] of songs) {
      if (now - firstSeen < config.windowMs) break;
      songs.delete(songId);
    }
  };

  return (request, response, next) => {
    const songId = streamedSongId(request.path);
    if (!songId) {
      next();
      return;
    }
    const key = ipKeyGenerator(request.ip ?? 'unknown');
    const now = Date.now();

    let songs = clients.get(key);
    if (songs) {
      prune(songs, now);
      if (songs.has(songId)) {
        next();
        return;
      }
      if (songs.size >= config.limit) {
        const oldest = songs.values().next().value ?? now;
        response.setHeader('Retry-After', String(Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000))));
        onLimited(response);
        return;
      }
      clients.delete(key);
    } else {
      songs = new Map();
      if (clients.size >= maxClients) {
        const leastRecent = clients.keys().next().value;
        if (leastRecent !== undefined) clients.delete(leastRecent);
      }
    }
    // Re-inserting keeps the map ordered by last activity, so eviction drops the idlest client.
    clients.set(key, songs);
    songs.set(songId, now);
    next();
  };
}

function streamedSongId(path: string): string | null {
  if (!path.startsWith(STREAM_PREFIX)) return null;
  const segment = path.slice(STREAM_PREFIX.length).split('/')[0] ?? '';
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
