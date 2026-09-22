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
  readonly recommendedBackend: LiveKaraokeBackend;
}

export interface ScnetAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export interface LiveKaraokePrepareResult {
  readonly backend: LiveKaraokeBackend;
  readonly blobUrl: string;
  /** True when input was mono — vocal cancel is weak / none. */
  readonly monoSource: boolean;
}
