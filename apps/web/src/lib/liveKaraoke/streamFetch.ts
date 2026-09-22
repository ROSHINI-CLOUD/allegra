import { resolveApiUrl } from '../api';

const TOKEN_KEY = 'allegra-session-token';
/** Reject downloads that would blow memory when decoded + WAV-encoded. */
const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;
/** Soft cap on decoded duration (seconds) before mid-side + WAV. */
export const MAX_LIVE_KARAOKE_SECONDS = 8 * 60;

function authHeader(): HeadersInit {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * Prefer same-origin /api/stream/:id when we have a song id (CDN URLs are never
 * sent to the browser). Fall back to streamUrl for blob restores / overrides.
 */
export function resolveStreamFetchPath(
  streamUrl: string,
  songId: string | undefined
): string {
  if (songId && songId.length > 0) {
    return `/api/stream/${encodeURIComponent(songId)}`;
  }
  if (streamUrl && streamUrl.length > 0) return streamUrl;
  return '';
}

/**
 * Fetch a song as ArrayBuffer via same-origin stream, then decodeAudioData.
 */
export async function fetchAndDecodeSong(
  streamUrl: string,
  songId: string | undefined,
  signal?: AbortSignal
): Promise<AudioBuffer> {
  const path = resolveStreamFetchPath(streamUrl, songId);
  if (!path) {
    throw new Error('No stream URL available for this song.');
  }

  // blob:/data: are local restores — do not re-fetch through the API helper oddly
  const url =
    /^(blob:|data:)/.test(path) ? path : resolveApiUrl(path);

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: {
        Accept: 'audio/*,*/*',
        ...authHeader()
      },
      credentials: 'same-origin'
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error('Could not download the track (network or CORS).');
  }

  if (!response.ok) {
    throw new Error(
      `Stream failed (${response.status}). Play the song once, then try Karaoke again.`
    );
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      'This track is too large for in-browser Karaoke. Try a shorter song, or use Sing.'
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Empty audio response.');
  }
  if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      'This track is too large for in-browser Karaoke. Try a shorter song, or use Sing.'
    );
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio is not available in this browser.');
  }

  const ctx = new AudioCtx();
  try {
    const copy = arrayBuffer.slice(0);
    const decoded = await ctx.decodeAudioData(copy);
    if (!decoded || decoded.length === 0) {
      throw new Error('Decoded audio was empty.');
    }
    const duration = decoded.length / decoded.sampleRate;
    if (duration > MAX_LIVE_KARAOKE_SECONDS) {
      throw new Error(
        `Tracks longer than ${Math.round(MAX_LIVE_KARAOKE_SECONDS / 60)} minutes need Sing (server) for Karaoke.`
      );
    }
    return decoded;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof Error && /too large|longer than|Empty|not available/i.test(err.message)) {
      throw err;
    }
    throw new Error('Could not decode this audio format in the browser.');
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
