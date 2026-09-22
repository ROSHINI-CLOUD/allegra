import { detectLiveKaraokeCapabilities } from './capabilities';
import { audioBufferToBlobUrl, midSideVocalRemove } from './midSideVocalRemove';
import { probeScnetAvailability } from './scnetWorker.client';
import { fetchAndDecodeSong } from './streamFetch';
import type {
  LiveKaraokeBackend,
  LiveKaraokePrepareResult,
  LiveKaraokeStatus
} from './types';

export type {
  LiveKaraokeBackend,
  LiveKaraokeCapabilities,
  LiveKaraokePrepareResult,
  LiveKaraokeStatus,
  ScnetAvailability
} from './types';
export { detectLiveKaraokeCapabilities } from './capabilities';
export { midSideVocalRemove, audioBufferToWav, audioBufferToBlobUrl } from './midSideVocalRemove';
export { fetchAndDecodeSong, resolveStreamFetchPath, MAX_LIVE_KARAOKE_SECONDS } from './streamFetch';
export { LiveKaraokePlayer } from './LiveKaraokePlayer';
export { probeScnetAvailability } from './scnetWorker.client';

export interface PrepareLiveKaraokeInput {
  readonly streamUrl: string;
  readonly songId?: string;
  readonly preferBackend?: LiveKaraokeBackend;
  readonly signal?: AbortSignal;
  readonly midAttenuation?: number;
}

/**
 * Fetch + decode + remove vocals. SCNet is probed only when preferred;
 * MVP always applies mid-side until ORT inference is wired.
 */
export async function prepareLiveKaraoke(
  input: PrepareLiveKaraokeInput
): Promise<LiveKaraokePrepareResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const caps = detectLiveKaraokeCapabilities();
  const prefer = input.preferBackend ?? caps.recommendedBackend;

  let backend: LiveKaraokeBackend = 'midside';
  if (prefer === 'scnet') {
    try {
      const scnet = await probeScnetAvailability();
      if (scnet.available) backend = 'scnet';
    } catch {
      backend = 'midside';
    }
  }

  const decoded = await fetchAndDecodeSong(input.streamUrl, input.songId, input.signal);
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // SCNet path reserved — fall through to midside until inference is wired.
  if (backend === 'scnet') {
    backend = 'midside';
  }

  const { buffer: instrumental, monoSource } = midSideVocalRemove(decoded, {
    midAttenuation: input.midAttenuation
  });

  let blobUrl: string;
  try {
    blobUrl = audioBufferToBlobUrl(instrumental);
  } catch {
    throw new Error('Could not build the instrumental audio.');
  }

  return { backend, instrumental, blobUrl, monoSource };
}

export function statusAfterPrepare(active: boolean): LiveKaraokeStatus {
  return active ? 'active' : 'ready';
}
