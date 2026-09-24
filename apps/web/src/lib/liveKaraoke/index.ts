import { processToInstrumentalBlob } from './processInWorker';
import type { LiveKaraokePrepareResult, LiveKaraokeStatus } from './types';

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
  audioBufferToStereo44k,
  ensureRoformerModel,
  getSeparator,
  isRoformerLikelySupported,
  ROFORMER_MODEL
} from './roformer';
export { LiveKaraokeStream, type StreamSessionEvents } from './streamSession';

export interface MidSideKaraokeInput {
  readonly signal?: AbortSignal;
  readonly midAttenuation?: number;
  readonly bassKeepHz?: number;
  readonly airKeepHz?: number;
  readonly airKeep?: number;
  readonly sideBoost?: number;
  readonly makeupGain?: number;
  /** Why the AI model is not being used, shown to the listener. */
  readonly fallbackReason?: string;
  readonly onProgress?: (ratio: number) => void;
}

/**
 * The fallback when the AI model cannot run here (or cannot keep up): a bass-preserving
 * mid-side vocal remover rendered to a blob the player swaps in for the original.
 */
export async function prepareMidSideKaraoke(
  decoded: AudioBuffer,
  input: MidSideKaraokeInput = {}
): Promise<LiveKaraokePrepareResult> {
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
    input.onProgress,
    input.signal
  );
  return { backend: 'midside', blobUrl, monoSource, fallbackReason: input.fallbackReason };
}

export function statusAfterPrepare(active: boolean): LiveKaraokeStatus {
  return active ? 'active' : 'ready';
}
