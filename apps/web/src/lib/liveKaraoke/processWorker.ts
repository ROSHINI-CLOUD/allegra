/// <reference lib="webworker" />

/**
 * Off-main-thread mid-side vocal strip + WAV encode so the UI stays responsive.
 */

import { encodeWavPcm16, processMidSideStereo } from './midSideVocalRemove';

export type ProcessWorkerRequest = {
  readonly type: 'process';
  readonly left: Float32Array;
  readonly right: Float32Array;
  readonly sampleRate: number;
  readonly midAttenuation?: number;
  readonly bassKeepHz?: number;
};

export type ProcessWorkerResponse =
  | { readonly type: 'progress'; readonly ratio: number }
  | {
      readonly type: 'done';
      readonly wav: ArrayBuffer;
      readonly monoSource: boolean;
    }
  | { readonly type: 'error'; readonly message: string };

self.onmessage = (event: MessageEvent<ProcessWorkerRequest>): void => {
  const msg = event.data;
  if (!msg || msg.type !== 'process') return;

  try {
    const { left, right, sampleRate } = msg;
    if (!left || !right || left.length !== right.length || left.length === 0) {
      throw new Error('Invalid audio buffers for karaoke.');
    }

    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'progress',
      ratio: 0.2
    } satisfies ProcessWorkerResponse);

    const outL = new Float32Array(left.length);
    const outR = new Float32Array(right.length);
    processMidSideStereo(left, right, outL, outR, sampleRate, {
      midAttenuation: msg.midAttenuation,
      bassKeepHz: msg.bassKeepHz
    });

    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'progress',
      ratio: 0.7
    } satisfies ProcessWorkerResponse);

    const wav = encodeWavPcm16([outL, outR], sampleRate);

    (self as DedicatedWorkerGlobalScope).postMessage(
      {
        type: 'done',
        wav,
        monoSource: false
      } satisfies ProcessWorkerResponse,
      [wav]
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Karaoke processing failed.';
    (self as DedicatedWorkerGlobalScope).postMessage({
      type: 'error',
      message
    } satisfies ProcessWorkerResponse);
  }
};

export {};
