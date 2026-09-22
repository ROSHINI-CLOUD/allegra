import type * as OrtNamespace from 'onnxruntime-web';

import {
  OVERLAP_BY_MODE,
  RESIDUAL_DEFAULTS,
  ROFORMER_CHUNK_SAMPLES,
  ROFORMER_FRAMES,
  ROFORMER_PACKED_FREQ,
  ROFORMER_SAMPLE_RATE,
  type KaraokeQualityMode
} from './config';
import { ensureRoformerModel, type ModelProgress } from './modelCache';
import { chunkOffsets, normalizeOverlap, overlapAddStereo } from './overlapAdd';
import { residualRatio, softSubtractResidual } from './residual';
import {
  applyComplexMasks,
  decodeIstftPacked,
  encodeStftPacked,
  type StereoPcm
} from './stft';

export type SeparateProgress = {
  readonly phase: string;
  readonly ratio: number;
  readonly message?: string;
};

let ortModule: typeof OrtNamespace | null = null;
let sessionPromise: Promise<OrtNamespace.InferenceSession> | null = null;

async function loadOrt(): Promise<typeof OrtNamespace> {
  if (ortModule) return ortModule;
  try {
    ortModule = await import('onnxruntime-web/webgpu');
  } catch {
    ortModule = await import('onnxruntime-web');
  }
  return ortModule;
}

async function getSession(
  onProgress?: (p: SeparateProgress) => void,
  signal?: AbortSignal
): Promise<OrtNamespace.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt();
      const { modelUrl } = await ensureRoformerModel((mp: ModelProgress) => {
        onProgress?.({
          phase: mp.phase,
          ratio: mp.ratio * 0.35,
          message: mp.file ? `Model ${mp.file}` : mp.message
        });
      }, signal);

      onProgress?.({ phase: 'session', ratio: 0.38, message: 'Creating inference session' });
      const providers: string[] = [];
      if (typeof navigator !== 'undefined' && 'gpu' in navigator) providers.push('webgpu');
      providers.push('wasm');

      try {
        return await ort.InferenceSession.create(modelUrl, {
          executionProviders: providers[0] === 'webgpu'
            ? [{ name: 'webgpu', storageBufferCacheMode: 'simple' } as never, 'wasm']
            : ['wasm']
        });
      } catch {
        return ort.InferenceSession.create(modelUrl, {
          executionProviders: ['wasm']
        });
      }
    })();
  }
  return sessionPromise;
}

function slicePcm(pcm: StereoPcm, start: number, length: number): StereoPcm {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  left.set(pcm.left.subarray(start, start + length));
  right.set(pcm.right.subarray(start, start + length));
  // zero-pad if short
  return { left, right };
}

function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - t) + (input[i1] ?? 0) * t;
  }
  return out;
}

export function audioBufferToStereo44k(buffer: AudioBuffer): StereoPcm {
  const fromRate = buffer.sampleRate;
  const leftIn = buffer.getChannelData(0);
  const rightIn =
    buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);
  return {
    left: resampleLinear(leftIn, fromRate, ROFORMER_SAMPLE_RATE),
    right: resampleLinear(rightIn, fromRate, ROFORMER_SAMPLE_RATE)
  };
}

async function inferVocalsChunk(
  session: OrtNamespace.InferenceSession,
  ort: typeof OrtNamespace,
  mixChunk: StereoPcm
): Promise<StereoPcm> {
  const stft = encodeStftPacked(mixChunk, ROFORMER_FRAMES);
  const input = new ort.Tensor('float32', stft, [
    1,
    ROFORMER_PACKED_FREQ,
    ROFORMER_FRAMES,
    2
  ]);
  const result = await session.run({ stft_repr: input });
  const masksTensor = result.masks ?? result[Object.keys(result)[0]!];
  if (!masksTensor) throw new Error('RoFormer returned no masks');
  const masks = masksTensor.data as Float32Array;
  const vocalStft = applyComplexMasks(stft, masks);
  return decodeIstftPacked(vocalStft, ROFORMER_FRAMES);
}

function subtractAligned(mix: StereoPcm, vocals: StereoPcm, length: number): StereoPcm {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = (mix.left[i] ?? 0) - (vocals.left[i] ?? 0);
    right[i] = (mix.right[i] ?? 0) - (vocals.right[i] ?? 0);
  }
  return { left, right };
}

/**
 * Phase 1–3: overlapping Mel-Band RoFormer vocal separation + optional residual pass.
 */
export async function separateInstrumentalRoformer(
  mixBuffer: AudioBuffer,
  mode: KaraokeQualityMode = 'clean',
  onProgress?: (p: SeparateProgress) => void,
  signal?: AbortSignal
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number; backend: 'roformer' }> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const ort = await loadOrt();
  const session = await getSession(onProgress, signal);
  const mix = audioBufferToStereo44k(mixBuffer);
  const total = Math.min(mix.left.length, mix.right.length);
  const chunkSamples = ROFORMER_CHUNK_SAMPLES;
  const overlap = OVERLAP_BY_MODE[mode];
  const offsets = chunkOffsets(total, chunkSamples, overlap);

  const outL = new Float32Array(total);
  const outR = new Float32Array(total);
  const weight = new Float32Array(total);

  for (let i = 0; i < offsets.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const start = offsets[i]!;
    onProgress?.({
      phase: 'separating',
      ratio: 0.4 + 0.45 * (i / Math.max(1, offsets.length)),
      message: `Chunk ${i + 1}/${offsets.length}`
    });

    const chunk = slicePcm(mix, start, chunkSamples);
    const vocals = await inferVocalsChunk(session, ort, chunk);
    let instrumental = subtractAligned(chunk, vocals, chunkSamples);

    if (mode === 'clean' || mode === 'ultra') {
      const residualVocals = await inferVocalsChunk(session, ort, instrumental);
      const ratio = residualRatio(instrumental, residualVocals);
      if (ratio >= RESIDUAL_DEFAULTS.residualRatioThreshold) {
        const strength =
          mode === 'ultra'
            ? Math.min(0.95, RESIDUAL_DEFAULTS.suppressionStrength + 0.05)
            : RESIDUAL_DEFAULTS.suppressionStrength;
        instrumental = softSubtractResidual(instrumental, residualVocals, strength);
      }
    }

    // Only accumulate the valid mix region
    const valid = Math.min(chunkSamples, total - start);
    overlapAddStereo(
      outL,
      outR,
      weight,
      {
        left: instrumental.left.subarray(0, valid),
        right: instrumental.right.subarray(0, valid)
      },
      start
    );
  }

  normalizeOverlap(outL, outR, weight);
  onProgress?.({ phase: 'done', ratio: 1 });
  return {
    left: outL,
    right: outR,
    sampleRate: ROFORMER_SAMPLE_RATE,
    backend: 'roformer'
  };
}

export function isRoformerLikelySupported(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}
