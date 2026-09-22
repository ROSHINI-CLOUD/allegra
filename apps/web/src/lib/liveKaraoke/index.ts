import { detectLiveKaraokeCapabilities } from './capabilities';
import { audioBufferToWav, audioBufferToBlobUrl, midSideVocalRemove } from './midSideVocalRemove';
import { processToInstrumentalBlob } from './processInWorker';
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
export { processToInstrumentalBlob } from './processInWorker';

export interface PrepareLiveKaraokeInput {
  readonly streamUrl: string;
  readonly songId?: string;
  readonly preferBackend?: LiveKaraokeBackend;
  readonly signal?: AbortSignal;
  readonly midAttenuation?: number;
  readonly bassKeepHz?: number;
  readonly onProgress?: (ratio: number) => void;
}

/**
 * Fetch + decode + remove vocals (bass-preserving mid-side).
 * DSP/encode run in a worker when available so the UI stays responsive.
 */
export async function prepareLiveKaraoke(
  input: PrepareLiveKaraokeInput
): Promise<LiveKaraokePrepareResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const caps = detectLiveKaraokeCapabilities();
  const prefer = input.preferBackend ?? caps.recommendedBackend;
  const onProgress = input.onProgress;

  let backend: LiveKaraokeBackend = 'midside';
  if (prefer === 'scnet') {
    try {
      const scnet = await probeScnetAvailability();
      if (scnet.available) backend = 'scnet';
    } catch {
      backend = 'midside';
    }
  }

  onProgress?.(0.05);
  const decoded = await fetchAndDecodeSong(input.streamUrl, input.songId, input.signal);
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  onProgress?.(0.35);

  if (backend === 'scnet') backend = 'midside';

  const { blobUrl, monoSource } = await processToInstrumentalBlob(
    decoded,
    {
      midAttenuation: input.midAttenuation,
      bassKeepHz: input.bassKeepHz
    },
    (ratio) => onProgress?.(0.35 + ratio * 0.65),
    input.signal
  );

  return { backend, blobUrl, monoSource };
}

export function statusAfterPrepare(active: boolean): LiveKaraokeStatus {
  return active ? 'active' : 'ready';
}
