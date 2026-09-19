import type { ApiResponse, LyricLine, LyricsPayload, UnifiedSong } from '@shared/types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:9090').replace(/\/+$/, '');

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const token = window.localStorage.getItem('allegra-session-token');
    response = await fetch(resolveApiUrl(path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers
      }
    });
  } catch {
    throw new ApiError('We could not reach the music service. Check your connection and try again.', 0);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!isApiResponse<T>(body)) {
    throw new ApiError('The music service returned an unexpected response.', response.status);
  }
  if (!response.ok || !body.success) {
    throw new ApiError(body.success ? 'Something went wrong. Try again shortly.' : body.error, response.status);
  }
  return body.data;
}

export async function searchSongs(query: string, signal?: AbortSignal): Promise<{ results: UnifiedSong[]; source: 'Saavn' | 'Gaana' }> {
  return request(`/api/search?q=${encodeURIComponent(query)}&limit=20&page=0`, { signal });
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

export function fallbackLyrics(duration: number): LyricLine[] {
  return [{ timestamp: 0, text: duration > 0 ? 'Lyrics are taking a quiet moment.' : '[INSTRUMENTAL]', lineOrder: 0 }];
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.success === 'boolean' && ('data' in record || 'error' in record);
}
