/// <reference lib="webworker" />

/**
 * SCNet ONNX worker stub.
 * Looks for the model at /models/scnet-tran-core-2.75s-v1.onnx.
 * Full ORT inference is a follow-up (see README); this probe only checks the model file.
 * Engine falls back to midside when unavailable.
 */

export type ScnetWorkerRequest =
  | { readonly type: 'probe' }
  | {
      readonly type: 'separate';
      readonly channelData: Float32Array[];
      readonly sampleRate: number;
    };

export type ScnetWorkerResponse =
  | { readonly type: 'probe'; readonly available: boolean; readonly reason?: string }
  | {
      readonly type: 'separate';
      readonly ok: boolean;
      readonly reason?: string;
      readonly channelData?: Float32Array[];
      readonly sampleRate?: number;
    };

const MODEL_URL = '/models/scnet-tran-core-2.75s-v1.onnx';

async function probe(): Promise<ScnetWorkerResponse> {
  try {
    const res = await fetch(MODEL_URL, { method: 'HEAD' });
    if (!res.ok) {
      return {
        type: 'probe',
        available: false,
        reason: `model missing at ${MODEL_URL} (drop file in apps/web/public/models/)`
      };
    }
  } catch {
    return {
      type: 'probe',
      available: false,
      reason: `model unreachable at ${MODEL_URL}`
    };
  }

  // Model present, but ORT + STFT pipeline not wired in this MVP.
  return {
    type: 'probe',
    available: false,
    reason: 'SCNet ONNX inference not wired yet — using midside'
  };
}

self.onmessage = (event: MessageEvent<ScnetWorkerRequest>): void => {
  const msg = event.data;
  void (async () => {
    if (msg.type === 'probe') {
      (self as DedicatedWorkerGlobalScope).postMessage(await probe());
      return;
    }

    if (msg.type === 'separate') {
      const probeResult = await probe();
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: 'separate',
        ok: false,
        reason: probeResult.reason ?? 'SCNet unavailable'
      } satisfies ScnetWorkerResponse);
    }
  })();
};

export {};
