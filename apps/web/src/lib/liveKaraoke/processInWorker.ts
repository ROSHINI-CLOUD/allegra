import type { MidSideOptions } from './midSideVocalRemove';
import {
  audioBufferToBlobUrl,
  midSideVocalRemove
} from './midSideVocalRemove';
import type { ProcessWorkerRequest, ProcessWorkerResponse } from './processWorker';

export interface ProcessInstrumentalResult {
  readonly blobUrl: string;
  readonly monoSource: boolean;
}

export type ProgressFn = (ratio: number) => void;

/**
 * Strip vocals and build a WAV blob URL.
 * Prefers a Web Worker so decode stays on main but DSP/encode don't freeze the UI.
 */
export async function processToInstrumentalBlob(
  decoded: AudioBuffer,
  options: MidSideOptions = {},
  onProgress?: ProgressFn,
  signal?: AbortSignal
): Promise<ProcessInstrumentalResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (decoded.numberOfChannels < 2) {
    onProgress?.(0.5);
    const { buffer, monoSource } = midSideVocalRemove(decoded, options);
    onProgress?.(0.9);
    return { blobUrl: audioBufferToBlobUrl(buffer), monoSource };
  }

  if (typeof Worker === 'undefined') {
    return processOnMain(decoded, options, onProgress, signal);
  }

  try {
    return await processViaWorker(decoded, options, onProgress, signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Worker failed (bundler / CSP) — fall back without blocking forever.
    return processOnMain(decoded, options, onProgress, signal);
  }
}

async function processViaWorker(
  decoded: AudioBuffer,
  options: MidSideOptions,
  onProgress?: ProgressFn,
  signal?: AbortSignal
): Promise<ProcessInstrumentalResult> {
  const left = decoded.getChannelData(0);
  const right = decoded.getChannelData(1);
  // Copy so we can transfer without detaching the AudioBuffer's memory oddly on some engines.
  const leftCopy = left.slice(0);
  const rightCopy = right.slice(0);

  const worker = new Worker(new URL('./processWorker.ts', import.meta.url), {
    type: 'module'
  });

  const result = await new Promise<ProcessInstrumentalResult>((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    worker.onmessage = (event: MessageEvent<ProcessWorkerResponse>) => {
      const data = event.data;
      if (data.type === 'progress') {
        onProgress?.(data.ratio);
        return;
      }
      if (data.type === 'error') {
        cleanup();
        reject(new Error(data.message));
        return;
      }
      if (data.type === 'done') {
        const blobUrl = URL.createObjectURL(new Blob([data.wav], { type: 'audio/wav' }));
        cleanup();
        onProgress?.(1);
        resolve({ blobUrl, monoSource: data.monoSource });
      }
    };

    worker.onerror = () => {
      cleanup();
      reject(new Error('Karaoke worker failed to start'));
    };

    onProgress?.(0.12);
    const req: ProcessWorkerRequest = {
      type: 'process',
      left: leftCopy,
      right: rightCopy,
      sampleRate: decoded.sampleRate,
      midAttenuation: options.midAttenuation,
      bassKeepHz: options.bassKeepHz
    };
    worker.postMessage(req, [leftCopy.buffer, rightCopy.buffer]);
  });

  return result;
}

async function processOnMain(
  decoded: AudioBuffer,
  options: MidSideOptions,
  onProgress?: ProgressFn,
  signal?: AbortSignal
): Promise<ProcessInstrumentalResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  onProgress?.(0.2);
  // Yield so the Preparing… paint can land before the heavy loop.
  await new Promise<void>((r) => setTimeout(r, 0));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const { buffer, monoSource } = midSideVocalRemove(decoded, options);
  onProgress?.(0.75);
  await new Promise<void>((r) => setTimeout(r, 0));
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const blobUrl = audioBufferToBlobUrl(buffer);
  onProgress?.(1);
  return { blobUrl, monoSource };
}
