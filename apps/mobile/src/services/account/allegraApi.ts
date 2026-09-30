/**
 * Calls to Allegra's API (apps/api) with the account's Convex token. Every call
 * uses fetchWithTimeout: a timeout, and null on any failure, never a throw.
 * Shapes follow docs/api-contract.md: `{ success, data, error? }`.
 */
import type { LibraryChange, LibraryOp } from '@shared/library';

import { fetchJson } from '../net/fetchWithTimeout';
import { ALLEGRA_API_URL } from './config';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** `GET /api/auth/me` (docs/api-contract.md, Accounts). */
export interface AccountProfile {
  userId: string;
  isGuest: boolean;
  createdAt: string;
  displayName?: string;
  email?: string;
}

const authHeaders = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** Who this signed-in listener is, or null (signed out, offline, or a guest token). */
export const getAccountProfile = async (token: string): Promise<AccountProfile | null> => {
  const res = await fetchJson<Envelope<AccountProfile>>(`${ALLEGRA_API_URL}/api/auth/me`, {
    headers: authHeaders(token),
    timeoutMs: 10_000,
  });
  return res?.success && res.data && !res.data.isGuest ? res.data : null;
};

// ── Library sync (docs/api-contract.md, "Library sync") ─────────────────────

/** 'sent': done. 'refused': the server will never take it (drop it). 'offline': try again later. */
export type SendOutcome<T> = { outcome: 'sent'; data: T } | { outcome: 'refused' } | { outcome: 'offline' };

const send = async <T>(method: 'GET' | 'POST', path: string, token: string, body?: unknown): Promise<SendOutcome<T>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${ALLEGRA_API_URL}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...authHeaders(token),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    // 4xx other than auth, rate limits and 404: this request is wrong and always will be. A 404 is
    // an API that doesn't have this route yet (an older deployment): keep the change and retry.
    if (res.status >= 400 && res.status < 500 && ![401, 404, 408, 429].includes(res.status)) return { outcome: 'refused' };
    if (!res.ok) return { outcome: 'offline' };
    const json = (await res.json()) as Envelope<T>;
    return json.success && json.data !== undefined ? { outcome: 'sent', data: json.data } : { outcome: 'offline' };
  } catch {
    return { outcome: 'offline' };
  } finally {
    clearTimeout(timer);
  }
};

export interface OpsReply {
  rev: number;
  rejected: { index: number; reason: string }[];
}

export const postLibraryOps = (token: string, ops: readonly LibraryOp[]): Promise<SendOutcome<OpsReply>> =>
  send<OpsReply>('POST', '/api/me/library/ops', token, { ops });

export interface ChangesReply {
  rev: number;
  changes: LibraryChange[];
  more: boolean;
}

export const getLibraryChanges = (token: string, since: number, limit = 200): Promise<SendOutcome<ChangesReply>> =>
  send<ChangesReply>('GET', `/api/me/library/changes?since=${Math.max(0, Math.floor(since))}&limit=${limit}`, token);

/** A play, for Recently played and the taste that ranks Quick picks. `playedAt` for plays made offline. */
export const postPlay = (token: string, play: { songId: string; playDuration: number; playedAt: string }): Promise<SendOutcome<unknown>> =>
  send('POST', '/api/me/recently-played', token, play);

/** How long a song was listened to: the stronger taste signal. */
export const postListenSignal = (token: string, songId: string, seconds: number): Promise<SendOutcome<unknown>> =>
  send('POST', '/api/me/taste/signal', token, { songId, seconds });

/** Allegra catalog rows by Saavn id (for synced songs that arrived without their details). */
export interface AllegraSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  artwork: string;
  duration: number;
  source: string;
}

/** The catalog's songs for these ids (unknown ids are left out), or null when the API could not be reached. */
export const getAllegraSongs = async (token: string, ids: readonly string[]): Promise<AllegraSong[] | null> => {
  if (ids.length === 0) return [];
  const reply = await send<AllegraSong[]>('GET', `/api/songs?ids=${ids.map(encodeURIComponent).join(',')}`, token);
  if (reply.outcome === 'offline') return null;
  return reply.outcome === 'sent' && Array.isArray(reply.data) ? reply.data : [];
};

/** The account's Quick picks: the same ranking the website shows. */
export const getRecommendations = async (token: string): Promise<AllegraSong[]> => {
  const reply = await send<{ songs: AllegraSong[] }>('GET', '/api/recommendations', token);
  return reply.outcome === 'sent' && Array.isArray(reply.data.songs) ? reply.data.songs : [];
};
