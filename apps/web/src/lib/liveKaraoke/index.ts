import { audioBufferToBlobUrl, audioBufferToWav, encodeWavPcm16, midSideVocalRemove } from './midSideVocalRemove';
import { processToInstrumentalBlob } from './processInWorker';
import {
  isRoformerLikelySupported,
  separateInstrumentalRoformer,
  type KaraokeQualityMode
} from './roformer';
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
export {
  separateInstrumentalRoformer,
  ensureRoformerModel,
  ROFORMER_MODEL,
  type KaraokeQualityMode
} from './roformer';

export interface PrepareLiveKaraokeInput {
  readonly streamUrl: string;
  readonly songId?: string;
  readonly preferBackend?: LiveKaraokeBackend;
  readonly qualityMode?: KaraokeQualityMode;
  readonly signal?: AbortSignal;
  readonly midAttenuation?: number;
  readonly bassKeepHz?: number;
  readonly airKeepHz?: number;
  readonly airKeep?: number;
  readonly sideBoost?: number;
  readonly makeupGain?: number;
  readonly onProgress?: (ratio: number) => void;
}

/**
 * Prefer Mel-Band RoFormer (on-device ONNX). Fall back to bass-preserving mid-side
 * if WebGPU/WASM session or model download fails.
 */
export async function prepareLiveKaraoke(
  input: PrepareLiveKaraokeInput
): Promise<LiveKaraokePrepareResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const onProgress = input.onProgress;
  const prefer = input.preferBackend;
  const qualityMode = input.qualityMode ?? 'clean';

  onProgress?.(0.03);
  const decoded = await fetchAndDecodeSong(input.streamUrl, input.songId, input.signal);
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  onProgress?.(0.2);

  const tryRoformer =
    prefer !== 'midside' && prefer !== 'scnet' && isRoformerLikelySupported();

  if (tryRoformer) {
    try {
      const sep = await separateInstrumentalRoformer(
        decoded,
        qualityMode,
        (p) => onProgress?.(0.2 + p.ratio * 0.75),
        input.signal
      );
      const wav = encodeWavPcm16([sep.left, sep.right], sep.sampleRate);
      const blobUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      onProgress?.(1);
      return {
        backend: 'roformer',
        blobUrl,
        monoSource: decoded.numberOfChannels < 2
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      console.warn('[karaoke] RoFormer failed, using mid-side fallback', err);
    }
  }

  if (prefer === 'scnet') {
    try {
      await probeScnetAvailability();
    } catch {
      /* ignore */
    }
  }

  const { blobUrl, monoSource } = await processToInstrumentalBlob(
    decoded,
    {
      midAttenuation: input.midAttenuation ?? 0.95,
      bassKeepHz: input.bassKeepHz ?? 200,
      airKeepHz: input.airKeepHz,
      airKeep: input.airKeep,
      sideBoost: input.sideBoost ?? 1.22,
      makeupGain: input.makeupGain ?? 1.08
    },
    (ratio) => onProgress?.(0.25 + ratio * 0.75),
    input.signal
  );

  return { backend: 'midside', blobUrl, monoSource };
}

export function statusAfterPrepare(active: boolean): LiveKaraokeStatus {
  return active ? 'active' : 'ready';
}
