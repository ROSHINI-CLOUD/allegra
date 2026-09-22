import type { LiveKaraokeBackend, LiveKaraokeCapabilities } from './types';

export function detectLiveKaraokeCapabilities(): LiveKaraokeCapabilities {
  const sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const isCrossOriginIsolated =
    typeof globalThis.crossOriginIsolated === 'boolean'
      ? globalThis.crossOriginIsolated
      : false;
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const hardwareConcurrency =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 1;

  // MVP: prefer midside (no COOP/COEP, no model). SCNet is opt-in when the worker reports ready.
  const recommendedBackend: LiveKaraokeBackend = 'midside';

  return {
    sharedArrayBuffer,
    crossOriginIsolated: isCrossOriginIsolated,
    webgpu,
    hardwareConcurrency,
    recommendedBackend
  };
}
