import type { AccountProfile, ApiResponse, ArtistProfile, ArtistSummary, HomePayload, LyricLine, LyricsPayload, SharedPlaylist, TasteSummary, UnifiedSong } from '@shared/types';

export interface LibraryRecord {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly songIds: string[];
  readonly createdAt: string;
  /** S3 object key; present when a custom cover was uploaded. */
  readonly coverKey?: string;
  /** Browser-facing cover URL derived by the API from coverKey. */
  readonly coverUrl?: string;
}

/*
 * Local dev: leave VITE_API_BASE_URL blank so requests hit same-origin `/api`
 * and Vite proxies to the API (see vite.config.ts). That avoids CORS and the
 * Windows localhost vs 127.0.0.1 trap. Production sets the Render URL explicitly.
 */
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

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
  const normalized = path.replace(/^\/+/, '');
  return API_BASE_URL ? `${API_BASE_URL}/${normalized}` : `/${normalized}`;
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

export async function searchSongs(query: string, signal?: AbortSignal, page = 0): Promise<{ results: UnifiedSong[]; source: 'Saavn' | 'Gaana' }> {
  return request(`/api/search?q=${encodeURIComponent(query)}&limit=20&page=${page}`, { signal });
}

/** Provider profile for an artist: real photo, followers, top songs, albums, similar artists. */
export async function fetchArtist(name: string, signal?: AbortSignal): Promise<ArtistProfile> {
  return request(`/api/artists/${encodeURIComponent(name)}`, { signal });
}

/** Photos for a list of artist names (max 12). Names without a photo are omitted. */
export async function fetchArtistFaces(names: readonly string[], signal?: AbortSignal): Promise<ArtistSummary[]> {
  return request(`/api/artists/faces?names=${encodeURIComponent(names.join(','))}`, { signal });
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

export interface CoverUploadSign {
  readonly uploadUrl: string;
  readonly coverKey: string;
  readonly coverUrl: string;
  readonly headers: { readonly 'Content-Type': string; readonly 'Content-Length': string };
  readonly expiresInSeconds: number;
}

/** Ask the API for a short-lived S3 PUT URL. The browser uploads the bytes itself. */
export async function signCoverUpload(libraryId: string, file: File): Promise<CoverUploadSign> {
  return request('/api/uploads/sign', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ libraryId, contentType: file.type, contentLength: file.size })
  });
}

export async function setLibraryCover(libraryId: string, coverKey: string | null): Promise<LibraryRecord> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}`, {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify({ coverKey })
  });
}

/**
 * Full cover upload: sign → PUT to S3 with the signed headers → PATCH the library.
 * Throws ApiError / Error with user-facing copy.
 */
export async function uploadLibraryCover(libraryId: string, file: File, onProgress?: (ratio: number) => void): Promise<LibraryRecord> {
  const signed = await signCoverUpload(libraryId, file);
  onProgress?.(0.15);
  await putToPresignedUrl(signed.uploadUrl, file, signed.headers, (ratio) => onProgress?.(0.15 + ratio * 0.7));
  onProgress?.(0.9);
  const saved = await setLibraryCover(libraryId, signed.coverKey);
  onProgress?.(1);
  return saved;
}

function putToPresignedUrl(
  uploadUrl: string,
  file: File,
  headers: CoverUploadSign['headers'],
  onProgress?: (ratio: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    // Content-Type must match the signed header. Content-Length is a forbidden
    // header name in XHR — the browser sets it from the body, which is why we
    // signed the exact file.size up front.
    xhr.setRequestHeader('Content-Type', headers['Content-Type']);
    void headers['Content-Length'];
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error('The cover could not be uploaded. Try a smaller JPEG, PNG or WebP.'));
    };
    xhr.onerror = () => reject(new Error('The cover could not be uploaded. Check your connection and retry.'));
    xhr.send(file);
  });
}

export async function translateLyrics(
  song: UnifiedSong,
  lines: readonly LyricLine[],
  targetLanguage = 'English',
  signal?: AbortSignal
): Promise<{ lines: LyricLine[]; provider: string }> {
  return request('/api/ai/translate-lyrics', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: song.title, artist: song.artist, lines, targetLanguage }),
    signal
  });
}

export async function fetchAiRecommendations(currentSongId?: string, signal?: AbortSignal): Promise<{ songs: UnifiedSong[]; provider: string; reasoning: string }> {
  const query = currentSongId ? `?songId=${encodeURIComponent(currentSongId)}` : '';
  return request(`/api/ai/recommendations${query}`, { signal });
}

export function fallbackLyrics(duration: number): LyricLine[] {
  return [{ timestamp: 0, text: duration > 0 ? 'Lyrics are taking a quiet moment.' : '[INSTRUMENTAL]', lineOrder: 0 }];
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.success === 'boolean' && ('data' in record || 'error' in record);
}

/* ---------- Accounts, taste and sharing ---------- */

export function hasStoredSession(): boolean {
  return Boolean(window.localStorage.getItem(TOKEN_KEY));
}

function storeSession(session: { token: string }): void {
  window.localStorage.setItem(TOKEN_KEY, session.token);
}

let ensuring: Promise<void> | null = null;

/** Makes sure this browser has a session (guest until they sign up). Parallel callers share one request. */
export function ensureSession(): Promise<void> {
  if (hasStoredSession()) return Promise.resolve();
  ensuring ??= createAnonymousSession().then(storeSession).finally(() => {
    ensuring = null;
  });
  return ensuring;
}

export async function fetchProfile(signal?: AbortSignal): Promise<AccountProfile> {
  return request('/api/auth/me', { signal });
}

/** Turns this device's guest session into an account, keeping everything the guest had. */
export async function registerAccount(input: { email: string; password: string; displayName?: string }): Promise<AccountProfile> {
  const session = await request<{ token: string; userId: string }>('/api/auth/register', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) });
  storeSession(session);
  return fetchProfile();
}

/** Signs in; whatever this device did as a guest is folded into the account. */
export async function loginAccount(input: { email: string; password: string }): Promise<AccountProfile> {
  const session = await request<{ token: string; userId: string }>('/api/auth/login', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) });
  storeSession(session);
  return fetchProfile();
}

/** Signs out by starting a fresh guest session; the account stays safe on the server. */
export async function logoutAccount(): Promise<AccountProfile> {
  window.localStorage.removeItem(TOKEN_KEY);
  storeSession(await createAnonymousSession());
  return fetchProfile();
}

export async function updateDisplayName(displayName: string): Promise<AccountProfile> {
  return request('/api/me/profile', { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ displayName }) });
}

export async function fetchTaste(signal?: AbortSignal): Promise<TasteSummary> {
  return request('/api/me/taste', { signal });
}

export async function seedTaste(artists: readonly string[], languages: readonly string[]): Promise<TasteSummary> {
  return request('/api/me/taste/seed', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ artists, languages }) });
}

/** How long a song was really listened to; the server counts it for or against the song's artist. */
export async function sendListenSignal(songId: string, seconds: number): Promise<void> {
  await requestWithoutBody('/api/me/taste/signal', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ songId, seconds: Math.round(seconds) }) });
}

export async function shareLibrary(libraryId: string): Promise<{ code: string; path: string }> {
  return request(`/api/libraries/${encodeURIComponent(libraryId)}/share`, { method: 'POST' });
}

export async function unshareLibrary(libraryId: string): Promise<void> {
  await requestWithoutBody(`/api/libraries/${encodeURIComponent(libraryId)}/share`, { method: 'DELETE' });
}

export async function fetchSharedPlaylist(code: string, signal?: AbortSignal): Promise<SharedPlaylist> {
  return request(`/api/shared/${encodeURIComponent(code)}`, { signal });
}

export async function saveSharedPlaylist(code: string): Promise<LibraryRecord> {
  return request(`/api/shared/${encodeURIComponent(code)}/save`, { method: 'POST' });
}
