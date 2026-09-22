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
export { fetchAndDecodeSong } from './streamFetch';
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
 * Fetch + decode + remove vocals. Tries SCNet when recommended/available,
 * otherwise mid-side. Always returns a playable blob URL for the instrumental.
 */
export async function prepareLiveKaraoke(
  input: PrepareLiveKaraokeInput
): Promise<LiveKaraokePrepareResult> {
  const caps = detectLiveKaraokeCapabilities();
  const prefer = input.preferBackend ?? caps.recommendedBackend;

  let backend: LiveKaraokeBackend = 'midside';
  if (prefer === 'scnet') {
    const scnet = await probeScnetAvailability();
    if (scnet.available) backend = 'scnet';
  }

  const decoded = await fetchAndDecodeSong(input.streamUrl, input.songId, input.signal);

  let instrumental: AudioBuffer;
  if (backend === 'scnet') {
    // Reserved for worker-based separation; fall through to midside until wired.
    instrumental = midSideVocalRemove(decoded, {
      midAttenuation: input.midAttenuation
    });
    backend = 'midside';
  } else {
    instrumental = midSideVocalRemove(decoded, {
      midAttenuation: input.midAttenuation
    });
  }

  const blobUrl = audioBufferToBlobUrl(instrumental);
  return { backend, instrumental, blobUrl };
}

export function statusAfterPrepare(active: boolean): LiveKaraokeStatus {
  return active ? 'active' : 'ready';
}
