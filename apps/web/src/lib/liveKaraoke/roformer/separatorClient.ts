import type { StereoPcm } from './stft';
import type { SeparatorRequest, SeparatorResponse } from './separatorWorker';

export interface SeparatorJobHandlers {
  readonly onProgress?: (ratio: number, message?: string) => void;
  readonly onChunk: (index: number, pcm: StereoPcm, ms: number, residualPass: boolean) => void;
  readonly onError: (message: string) => void;
}

/**
 * One long-lived worker per page. The model session inside it is the expensive part, so
 * it survives toggles and song changes; only the job (one song's audio) is replaced.
 */
class SeparatorClient {
  private readonly worker: Worker;
  private nextJobId = 1;
  private jobId: number | null = null;
  private handlers: SeparatorJobHandlers | null = null;
  private warmState: 'idle' | 'loading' | 'ready' = 'idle';

  constructor(onCrash: () => void) {
    this.worker = new Worker(new URL('./separatorWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SeparatorResponse>) => this.receive(event.data);
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.handlers?.onError('The karaoke engine stopped unexpectedly.');
      this.handlers = null;
      this.jobId = null;
      this.worker.terminate();
      onCrash();
    };
  }

  /** Load the model ahead of time so a later Karaoke press starts in seconds. */
  public warm(): void {
    if (this.warmState !== 'idle') return;
    this.warmState = 'loading';
    this.send({ type: 'warm' });
  }

  /**
   * Hands the song to the worker. The mix's buffers are transferred, not copied (a long
   * song is well over 100 MB), so the caller must not use `mix` afterwards.
   */
  public startJob(mix: StereoPcm, focusChunk: number, handlers: SeparatorJobHandlers): number {
    if (this.jobId !== null) this.send({ type: 'cancel', jobId: this.jobId });
    const jobId = this.nextJobId++;
    this.jobId = jobId;
    this.handlers = handlers;
    const { left, right } = mix;
    const transfer = left.buffer === right.buffer ? [left.buffer] : [left.buffer, right.buffer];
    this.send({ type: 'job', jobId, left, right, focus: focusChunk }, transfer);
    return jobId;
  }

  public focus(jobId: number, chunk: number): void {
    if (jobId === this.jobId) this.send({ type: 'focus', jobId, chunk });
  }

  public pause(jobId: number): void {
    if (jobId === this.jobId) this.send({ type: 'pause', jobId });
  }

  public resume(jobId: number, handlers: SeparatorJobHandlers): boolean {
    if (jobId !== this.jobId) return false;
    this.handlers = handlers;
    this.send({ type: 'resume', jobId });
    return true;
  }

  public cancel(jobId: number): void {
    if (jobId !== this.jobId) return;
    this.send({ type: 'cancel', jobId });
    this.jobId = null;
    this.handlers = null;
  }

  private send(message: SeparatorRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  private receive(msg: SeparatorResponse): void {
    switch (msg.type) {
      case 'progress':
        this.handlers?.onProgress?.(msg.ratio, msg.message);
        break;
      case 'warm-ready':
        this.warmState = 'ready';
        break;
      case 'chunk':
        if (msg.jobId === this.jobId) {
          this.handlers?.onChunk(msg.index, { left: msg.left, right: msg.right }, msg.ms, msg.residualPass);
        }
        break;
      case 'complete':
        break;
      case 'error':
        if (msg.jobId === null) this.warmState = 'idle';
        if (msg.jobId === null || msg.jobId === this.jobId) {
          this.handlers?.onError(msg.message);
          if (msg.jobId !== null) {
            this.jobId = null;
            this.handlers = null;
          }
        }
        break;
    }
  }
}

let shared: SeparatorClient | null = null;

/** The page's separator; throws if workers are unavailable (caller falls back). */
export function getSeparator(): SeparatorClient {
  if (!shared) {
    shared = new SeparatorClient(() => {
      shared = null;
    });
  }
  return shared;
}

export type { SeparatorClient };
