import type { ApiResponse, HomePayload, LyricLine, LyricsPayload, UnifiedSong } from '@shared/types';

export interface LibraryRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly songIds: string[];
  readonly createdAt: string;
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

export class ApiError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function apiBaseUrl(): string {
  return API_BASE_URL;
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE_URL}/${path.replace(/^\/+/, '')}`;
}

const TOKEN_KEY = 'allegra-session-token';
let renewing: Promise<void> | null = null;

/*
 * A stored token can outlive its user (API restarted on the in-memory store, or a
 * fresh Convex deployment). The API answers 401, and without this the Library
 * sat on an error forever. Renew once, deduped across parallel calls, and retry.
 */
function renewSession(): Promise<void> {
  renewing ??= (async () => {
    window.localStorage.removeItem(TOKEN_KEY);
    const session = await createAnonymousSession();
    window.localStorage.setItem(TOKEN_KEY, session.token);
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

async function send(path: string, init?: RequestInit, canRenew = true): Promise<Response> {
  let response: Response;
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    response = await fetch(resolveApiUrl(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers
      }
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('We could not reach the music service. Check your connection and try again.', 0);
  }
  if (response.status === 401 && canRenew && !path.startsWith('/api/auth/')) {
    await renewSession().catch(() => undefined);
    return send(path, init, false);
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  const body: unknown = await response.json().catch(() => null);
  if (!isApiResponse<T>(body)) {
    throw new ApiError('The music service returned an unexpected response.', response.status);
  }
  if (!response.ok || !body.success) {
    throw new ApiError(body.success ? 'Something went wrong. Try again shortly.' : body.error, response.status);
  }
  return body.data;
}

async function requestWithoutBody(path: string, init?: RequestInit): Promise<void> {
  const response = await send(path, init);
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    if (isApiResponse<never>(body) && !body.success) throw new ApiError(body.error, response.status);
    throw new ApiError('Something went wrong. Try again shortly.', response.status);
  }
}

export async function searchSongs(query: string, signal?: AbortSignal): Promise<{ results: UnifiedSong[]; source: 'Saavn' | 'Gaana' }> {
  return request(`/api/search?q=${encodeURIComponent(query)}&limit=20&page=0`, { signal });
}

export async function fetchHome(signal?: AbortSignal): Promise<HomePayload> {
  return request('/api/home', { signal });
}

export async function fetchLyrics(song: UnifiedSong, signal?: AbortSignal): Promise<LyricsPayload> {
  return request(
    `/api/lyrics?${new URLSearchParams({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      duration: String(song.duration),
      syncedOnly: 'false'
    }).toString()}`,
    { signal }
  );
}

export async function createAnonymousSession(): Promise<{ token: string; userId: string }> {
  return request('/api/auth/anon', { method: 'POST' });
}

export async function fetchLikedSongs(signal?: AbortSignal): Promise<UnifiedSong[]> {
  return request('/api/me/liked', { signal });
}

export async function setLikedSong(songId: string, liked: boolean): Promise<void> {
  if (liked) {
    await request('/api/me/liked', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId })
    });
    return;
  }
  await requestWithoutBody(`/api/me/liked/${encodeURIComponent(songId)}`, { method: 'DELETE' });
}

export async function fetchRecentlyPlayed(signal?: AbortSignal): Promise<UnifiedSong[]> {
  return request('/api/me/recently-played', { signal });
}

export async function fetchSuggestions(songId: string, signal?: AbortSignal): Promise<UnifiedSong[]> {
  return request(`/api/songs/${encodeURIComponent(songId)}/suggestions?limit=6`, { signal });
}

export async function recordRecentlyPlayed(songId: string, playDuration: number): Promise<void> {
  await request('/api/me/recently-played', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, playDuration })
  });
}

export async function fetchSongsByIds(ids: readonly string[], signal?: AbortSignal): Promise<UnifiedSong[]> {
  if (ids.length === 0) return [];
  const results: UnifiedSong[] = [];
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    results.push(...await request<UnifiedSong[]>(`/api/songs?ids=${batch.map(encodeURIComponent).join(',')}`, { signal }));
  }
  return results;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export async function fetchLibraries(signal?: AbortSignal): Promise<LibraryRecord[]> {
  return request('/api/libraries', { signal });
}

export async function createLibrary(name: string): Promise<LibraryRecord> {
  return request('/api/libraries', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) });
}

export async function deleteLibrary(libraryId: string): Promise<void> {
  await requestWithoutBody(`/api/libraries/${encodeURIComponent(libraryId)}`, { method: 'DELETE' });
}

export async function addSongToLibrary(libraryId: string, songId: string): Promise<LibraryRecord> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}/songs`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ songId }) });
}

export async function removeSongFromLibrary(libraryId: string, songId: string): Promise<LibraryRecord> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}/songs/${encodeURIComponent(songId)}`, { method: 'DELETE' });
}

export function fallbackLyrics(duration: number): LyricLine[] {
  return [{ timestamp: 0, text: duration > 0 ? 'Lyrics are taking a quiet moment.' : '[INSTRUMENTAL]', lineOrder: 0 }];
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.success === 'boolean' && ('data' in record || 'error' in record);
}
