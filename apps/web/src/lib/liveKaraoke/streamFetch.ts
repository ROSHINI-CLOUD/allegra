import { resolveApiUrl } from '../api';

const TOKEN_KEY = 'allegra-session-token';

function authHeader(): HeadersInit {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * Fetch a song as ArrayBuffer via same-origin stream URL (or /api/stream/:id),
 * then decode with AudioContext.decodeAudioData.
 */
export async function fetchAndDecodeSong(
  streamUrl: string,
  songId: string | undefined,
  signal?: AbortSignal
): Promise<AudioBuffer> {
  const path =
    streamUrl && streamUrl.length > 0
      ? streamUrl
      : songId
        ? `/api/stream/${encodeURIComponent(songId)}`
        : '';
  if (!path) {
    throw new Error('No stream URL available for this song.');
  }

  const url = resolveApiUrl(path);
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
    throw new Error(`Stream failed (${response.status}). Try playing the song first.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error('Empty audio response.');
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    // decodeAudioData may detach the buffer; copy first for safety on some browsers.
    const copy = arrayBuffer.slice(0);
    return await ctx.decodeAudioData(copy);
  } catch {
    throw new Error('Could not decode this audio format in the browser.');
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
