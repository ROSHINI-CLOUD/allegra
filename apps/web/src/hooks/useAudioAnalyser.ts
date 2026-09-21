import { useCallback, useEffect, useMemo, useRef } from 'react';

import { createBandTracker } from '../lib/bands';
import type { AudioBands } from '../lib/bands';

/**
 * Reads the real output of the <audio> element through a Web Audio AnalyserNode.
 *
 * Why this is safe to do to a playing element:
 *  - createMediaElementSource can only be called once per element, so the node is
 *    cached on the element itself and reused across re-mounts.
 *  - Routing through Web Audio means a suspended context is silent, so the context
 *    is resumed on every play and only ever created from a user gesture.
 *  - If the stream were not CORS-clean the analyser would return silence rather
 *    than throwing. Callers must treat a flat signal as "no data", never as "quiet".
 *
 * Nothing here sets React state. Frame data goes into refs and callers read it
 * inside their own animation frame, so audio never re-renders the tree.
 */

export type { AudioBands };

export interface AnalyserHandle {
  /** Fills `target` with the current spectrum (0..255). Returns false when there is no live graph. */
  readonly readSpectrum: (target: Uint8Array) => boolean;
  /** Smoothed overall loudness, 0..1. Returns 0 when nothing is audible. */
  readonly readLevel: () => number;
  /**
   * Band energies for the current frame, or `null` when nothing is playing.
   *
   * `null` means "no data", never "silence": a caller must hold its last look rather than
   * collapsing to zero, or a muted tab would read as the song having stopped.
   */
  readonly readBands: () => AudioBands | null;
  /** How many spectrum bins `readSpectrum` expects. */
  readonly binCount: () => number;
}

interface ElementWithGraph extends HTMLAudioElement {
  __allegraGraph?: { context: AudioContext; analyser: AnalyserNode };
}

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function useAudioAnalyser(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  active: boolean
): AnalyserHandle {
  const analyserRef = useRef<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const levelRef = useRef(0);
  const scratchRef = useRef<Uint8Array | null>(null);
  const trackerRef = useRef(createBandTracker());

  useEffect(() => {
    const audio = audioRef.current as ElementWithGraph | null;
    if (!audio || !active) return undefined;

    const existing = audio.__allegraGraph;
    if (existing) {
      contextRef.current = existing.context;
      analyserRef.current = existing.analyser;
      void existing.context.resume().catch(() => undefined);
      return undefined;
    }

    const Ctor = getAudioContextCtor();
    if (!Ctor) return undefined;

    let context: AudioContext;
    try {
      context = new Ctor();
      const source = context.createMediaElementSource(audio);
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      // Smoothing is done here rather than per frame so every reader sees the same curve.
      analyser.smoothingTimeConstant = 0.78;
      source.connect(analyser);
      analyser.connect(context.destination);
      audio.__allegraGraph = { context, analyser };
      contextRef.current = context;
      analyserRef.current = analyser;
    } catch {
      // No graph. The element keeps playing on its own and readers get `false`.
      return undefined;
    }

    void context.resume().catch(() => undefined);
    return undefined;
  }, [active, audioRef]);

  // A context can be auto-suspended by the browser. Resume whenever playback starts,
  // otherwise routing through Web Audio would leave the element silent.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const resume = (): void => {
      const context = contextRef.current;
      if (context && context.state === 'suspended') void context.resume().catch(() => undefined);
    };
    audio.addEventListener('play', resume);
    return () => audio.removeEventListener('play', resume);
  }, [audioRef]);

  const binCount = useCallback((): number => analyserRef.current?.frequencyBinCount ?? 0, []);

  const readSpectrum = useCallback((target: Uint8Array): boolean => {
    const analyser = analyserRef.current;
    const audio = audioRef.current;
    if (!analyser || !audio || audio.paused || audio.muted) return false;
    analyser.getByteFrequencyData(target as Uint8Array<ArrayBuffer>);
    return true;
  }, [audioRef]);

  const readLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const audio = audioRef.current;
    if (!analyser || !audio || audio.paused || audio.muted) {
      levelRef.current += (0 - levelRef.current) * 0.12;
      return levelRef.current;
    }
    let scratch = scratchRef.current;
    if (!scratch || scratch.length !== analyser.frequencyBinCount) {
      scratch = new Uint8Array(analyser.frequencyBinCount);
      scratchRef.current = scratch;
    }
    analyser.getByteFrequencyData(scratch as Uint8Array<ArrayBuffer>);
    // Weight the low end: it tracks what people hear as "the beat".
    const usable = Math.max(1, Math.floor(scratch.length * 0.6));
    let sum = 0;
    for (let i = 0; i < usable; i += 1) sum += scratch[i] ?? 0;
    const next = sum / usable / 255;
    levelRef.current += (next - levelRef.current) * 0.22;
    return levelRef.current;
  }, [audioRef]);

  const readBands = useCallback((): AudioBands | null => {
    const analyser = analyserRef.current;
    const audio = audioRef.current;
    if (!analyser || !audio || audio.paused || audio.muted) return null;
    let scratch = scratchRef.current;
    if (!scratch || scratch.length !== analyser.frequencyBinCount) {
      scratch = new Uint8Array(analyser.frequencyBinCount);
      scratchRef.current = scratch;
    }
    analyser.getByteFrequencyData(scratch as Uint8Array<ArrayBuffer>);
    const bins = scratch.length;
    if (bins === 0) return null;

    const mean = (from: number, to: number): number => {
      const start = Math.max(0, Math.floor(bins * from));
      const end = Math.min(bins, Math.max(start + 1, Math.floor(bins * to)));
      let sum = 0;
      for (let i = start; i < end; i += 1) sum += scratch[i] ?? 0;
      return sum / (end - start) / 255;
    };

    // Band edges as fractions of the spectrum rather than bin indices, so a different fftSize
    // still splits the same way.
    return trackerRef.current.next(mean(0, 0.05), mean(0.05, 0.25), mean(0.25, 0.6));
  }, [audioRef]);

  /*
   * The handle is memoised because callers put it in effect dependency arrays.
   * Returning a fresh object each render tore down and restarted the aura's
   * animation frame on every timeupdate, which flashed the light back to rest
   * several times a second.
   */
  return useMemo(
    () => ({ readSpectrum, readLevel, readBands, binCount }),
    [binCount, readBands, readLevel, readSpectrum]
  );
}
