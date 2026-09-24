/// <reference lib="webworker" />

/**
 * Off-main-thread Mel-Band RoFormer. Holds the inference session for the page's lifetime
 * (model load is the slow part) and separates one song at a time, chunk by chunk,
 * starting wherever the listener is and working forward.
 */

import { sliceChunk, streamChunkCount, STREAM_HOP_SAMPLES } from './chunks';
import { ROFORMER_SAMPLE_RATE } from './config';
import { getSession, separateChunk } from './separate';
import type { StereoPcm } from './stft';

export type SeparatorRequest =
  | { readonly type: 'warm' }
  | {
      readonly type: 'job';
      readonly jobId: number;
      readonly left: Float32Array;
      readonly right: Float32Array;
      readonly focus: number;
    }
  | { readonly type: 'focus'; readonly jobId: number; readonly chunk: number }
  | { readonly type: 'pause'; readonly jobId: number }
  | { readonly type: 'resume'; readonly jobId: number }
  | { readonly type: 'cancel'; readonly jobId: number };

export type SeparatorResponse =
  | { readonly type: 'progress'; readonly ratio: number; readonly message?: string }
  | { readonly type: 'warm-ready' }
  | {
      readonly type: 'chunk';
      readonly jobId: number;
      readonly index: number;
      readonly left: Float32Array;
      readonly right: Float32Array;
      readonly ms: number;
      readonly residualPass: boolean;
    }
  | { readonly type: 'complete'; readonly jobId: number }
  | { readonly type: 'error'; readonly jobId: number | null; readonly message: string };

interface Job {
  readonly id: number;
  /** Dropped once every chunk is done: a whole song is tens of MB the worker no longer needs. */
  mix: StereoPcm | null;
  readonly done: Uint8Array;
  focus: number;
  paused: boolean;
  /** Decided from the first chunk's timing: only when the device has time for two passes. */
  residualPass: boolean | null;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let job: Job | null = null;
let pumping = false;

function post(message: SeparatorResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function nextChunk(j: Job): number {
  for (let k = Math.max(0, j.focus); k < j.done.length; k++) if (!j.done[k]) return k;
  for (let k = 0; k < j.done.length; k++) if (!j.done[k]) return k;
  return -1;
}

/**
 * A second pass doubles the work. Only take it when two passes still leave clear
 * headroom over real time, otherwise playback would outrun separation.
 */
function canAffordResidual(singlePassMs: number): boolean {
  const hopMs = (STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE) * 1000;
  return singlePassMs * 2 < hopMs * 0.6;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'AI model failed';
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    const session = await getSession((p) => post({ type: 'progress', ratio: p.ratio, message: p.message }));
    while (job && !job.paused) {
      const j = job;
      const k = nextChunk(j);
      if (k < 0 || !j.mix) {
        j.mix = null;
        post({ type: 'complete', jobId: j.id });
        break;
      }
      const residualPass = j.residualPass ?? false;
      const started = performance.now();
      const out = await separateChunk(session, sliceChunk(j.mix, k), residualPass);
      const ms = performance.now() - started;
      if (job !== j) continue; // cancelled or replaced while the GPU was busy
      j.done[k] = 1;
      if (j.residualPass === null) j.residualPass = canAffordResidual(ms);
      post(
        { type: 'chunk', jobId: j.id, index: k, left: out.left, right: out.right, ms, residualPass },
        [out.left.buffer, out.right.buffer]
      );
    }
  } catch (err) {
    post({ type: 'error', jobId: job?.id ?? null, message: errorMessage(err) });
    job = null;
  } finally {
    pumping = false;
  }
  // A focus/resume that landed during the last await may need the loop again.
  if (job && !job.paused && nextChunk(job) >= 0) void pump();
}

scope.onmessage = (event: MessageEvent<SeparatorRequest>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'warm':
      void getSession((p) => post({ type: 'progress', ratio: p.ratio, message: p.message }))
        .then(() => post({ type: 'warm-ready' }))
        .catch((err: unknown) => post({ type: 'error', jobId: null, message: errorMessage(err) }));
      break;
    case 'job': {
      const total = Math.min(msg.left.length, msg.right.length);
      job = {
        id: msg.jobId,
        mix: { left: msg.left, right: msg.right },
        done: new Uint8Array(streamChunkCount(total)),
        focus: msg.focus,
        paused: false,
        residualPass: null
      };
      void pump();
      break;
    }
    case 'focus':
      if (job?.id === msg.jobId) job.focus = msg.chunk;
      break;
    case 'pause':
      if (job?.id === msg.jobId) job.paused = true;
      break;
    case 'resume':
      if (job?.id === msg.jobId) {
        job.paused = false;
        void pump();
      }
      break;
    case 'cancel':
      if (job?.id === msg.jobId) job = null;
      break;
  }
};
