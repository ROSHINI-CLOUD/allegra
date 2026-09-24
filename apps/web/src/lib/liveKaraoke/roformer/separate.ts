import type * as OrtNamespace from 'onnxruntime-web';

import {
  RESIDUAL_DEFAULTS,
  ROFORMER_CHUNK_SAMPLES,
  ROFORMER_FRAMES,
  ROFORMER_MODEL,
  ROFORMER_PACKED_FREQ
} from './config';
import { ensureRoformerModel, type ModelProgress } from './modelCache';
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
export type OrtBackend = 'webgpu' | 'wasm';
let activeBackend: OrtBackend | null = null;
/** Set once WebGPU has failed on this machine, so every later session goes straight to WASM. */
let wasmOnly = false;

async function loadOrt(): Promise<typeof OrtNamespace> {
  if (ortModule) return ortModule;
  try {
    ortModule = await import('onnxruntime-web/webgpu');
  } catch {
    ortModule = await import('onnxruntime-web');
  }
  // ORT logs graph-optimizer notes (e.g. "Removing initializer") through console.error,
  // which Next's dev overlay reports as errors. Only surface real failures.
  ortModule.env.logLevel = 'error';
  return ortModule;
}

/** Load the model and build the inference session once; later calls reuse it. */
export async function getSession(
  onProgress?: (p: SeparateProgress) => void,
  signal?: AbortSignal
): Promise<OrtNamespace.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt();
      const model = await ensureRoformerModel((mp: ModelProgress) => {
        onProgress?.({
          phase: mp.phase,
          ratio: mp.ratio * 0.8,
          message: mp.file ? `Model ${mp.file}` : mp.message
        });
      }, signal);

      onProgress?.({ phase: 'session', ratio: 0.85, message: 'Creating inference session' });
      // ORT Web does not fetch a sibling .onnx.data on its own; hand it the weights.
      const externalData = [{ path: ROFORMER_MODEL.dataFile, data: model.data }];
      const create = (executionProviders: OrtNamespace.InferenceSession.SessionOptions['executionProviders']) =>
        typeof model.graph === 'string'
          ? ort.InferenceSession.create(model.graph, { executionProviders, externalData, logSeverityLevel: 3 })
          : ort.InferenceSession.create(model.graph, { executionProviders, externalData, logSeverityLevel: 3 });

      if (!wasmOnly && typeof navigator !== 'undefined' && 'gpu' in navigator) {
        try {
          const gpuSession = await create([{ name: 'webgpu', storageBufferCacheMode: 'simple' } as never]);
          activeBackend = 'webgpu';
          return gpuSession;
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[karaoke] WebGPU session failed, trying WASM', err);
          }
        }
      }
      const wasmSession = await create(['wasm']);
      activeBackend = 'wasm';
      return wasmSession;
    })();
    // A failed load must not poison every later attempt this session.
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  const session = await sessionPromise;
  onProgress?.({ phase: 'ready', ratio: 1 });
  return session;
}

/**
 * A WebGPU session can build fine and still fail on the first run (driver/validation errors).
 * Drop it and rebuild on WASM; returns null when there is nothing to recover from.
 */
export async function recoverWithWasm(
  onProgress?: (p: SeparateProgress) => void
): Promise<OrtNamespace.InferenceSession | null> {
  if (activeBackend !== 'webgpu') return null;
  const failed = sessionPromise;
  wasmOnly = true;
  sessionPromise = null;
  activeBackend = null;
  try {
    (await failed)?.release();
  } catch {
    // The GPU session is already unusable; releasing it is best-effort.
  }
  return getSession(onProgress);
}

async function inferVocals(
  session: OrtNamespace.InferenceSession,
  mixChunk: StereoPcm
): Promise<StereoPcm> {
  const ort = await loadOrt();
  const stft = encodeStftPacked(mixChunk, ROFORMER_FRAMES);
  const input = new ort.Tensor('float32', stft, [1, ROFORMER_PACKED_FREQ, ROFORMER_FRAMES, 2]);
  let result: OrtNamespace.InferenceSession.OnnxValueMapType | null = null;
  try {
    result = await session.run({ stft_repr: input });
    const masksTensor = result.masks ?? result[Object.keys(result)[0]!];
    if (!masksTensor) throw new Error('RoFormer returned no masks');
    const vocalStft = applyComplexMasks(stft, masksTensor.data as Float32Array);
    return decodeIstftPacked(vocalStft, ROFORMER_FRAMES);
  } finally {
    // Every chunk runs this; a leaked output on a failed or odd run adds up over a song.
    input.dispose();
    if (result) for (const tensor of Object.values(result)) tensor.dispose();
  }
}

function subtract(mix: StereoPcm, vocals: StereoPcm): StereoPcm {
  const n = ROFORMER_CHUNK_SAMPLES;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    left[i] = (mix.left[i] ?? 0) - (vocals.left[i] ?? 0);
    right[i] = (mix.right[i] ?? 0) - (vocals.right[i] ?? 0);
  }
  return { left, right };
}

/**
 * Instrumental for one model window: mix − vocals. With `residualPass`, the model runs
 * again on that instrumental and subtracts what vocal it still finds (doubles the cost).
 */
export async function separateChunk(
  session: OrtNamespace.InferenceSession,
  mixChunk: StereoPcm,
  residualPass: boolean
): Promise<StereoPcm> {
  const instrumental = subtract(mixChunk, await inferVocals(session, mixChunk));
  if (!residualPass) return instrumental;
  const residualVocals = await inferVocals(session, instrumental);
  if (residualRatio(instrumental, residualVocals) < RESIDUAL_DEFAULTS.residualRatioThreshold) {
    return instrumental;
  }
  return softSubtractResidual(instrumental, residualVocals);
}
