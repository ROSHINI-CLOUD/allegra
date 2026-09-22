export type LiveKaraokeStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'processing'
  | 'active'
  | 'error';

export type LiveKaraokeBackend = 'midside' | 'scnet';

export interface LiveKaraokeCapabilities {
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly webgpu: boolean;
  readonly hardwareConcurrency: number;
  /** Preferred backend for this browser. SCNet only when model + ORT are available. */
  readonly recommendedBackend: LiveKaraokeBackend;
}

export interface ScnetAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export interface LiveKaraokePrepareResult {
  readonly backend: LiveKaraokeBackend;
  readonly instrumental: AudioBuffer;
  readonly blobUrl: string;
}
