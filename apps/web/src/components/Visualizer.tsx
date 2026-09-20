import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

interface VisualizerProps {
  /** Reads the live spectrum. Returns false when there is no audible signal. */
  readonly readSpectrum: (target: Uint8Array) => boolean;
  readonly binCount: () => number;
  /** True only while the element is actually producing sound. */
  readonly active: boolean;
  /** Ambient motion is paused by the reader. */
  readonly paused: boolean;
  /** Gradient stops taken from the album art, low frequency to high. */
  readonly colors: readonly [string, string, string];
  readonly label: string;
}

const BARS = 28;
/** Bars fall faster than they rise, which is what makes a meter read as rhythm. */
const RISE = 0.55;
const FALL = 0.12;

/**
 * Spectrum bars for the track that is playing right now.
 *
 * Truthfulness rule: this only moves when the audio element is genuinely
 * producing sound. While a track is buffering, or after a failed play, the bars
 * rest flat. A meter that dances over silence is a lie about the product state.
 *
 * Drawn on a canvas rather than as DOM nodes so 28 bars at 60fps cost one paint
 * instead of 28 style recalculations.
 */
export function Visualizer({ readSpectrum, binCount, active, paused, colors, label }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const heightsRef = useRef<number[]>(Array.from({ length: BARS }, () => 0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    let frame = 0;
    let spectrum = new Uint8Array(Math.max(binCount(), BARS));
    const heights = heightsRef.current;
    // Bass end wears the primary colour, treble end the tertiary, so the bar
    // field reads as one gradient rather than 28 identical sticks.
    const ramp = Array.from({ length: BARS }, (_, i) => {
      const t = i / (BARS - 1);
      const [from, mid, to] = colors;
      return t < 0.5
        ? mixHex(from, mid, t * 2)
        : mixHex(mid, to, (t - 0.5) * 2);
    });

    const resize = (): void => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = (): void => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width === 0 || height === 0) {
        frame = window.requestAnimationFrame(draw);
        return;
      }

      const bins = binCount();
      if (bins > 0 && spectrum.length !== bins) spectrum = new Uint8Array(bins);
      const live = bins > 0 ? readSpectrum(spectrum) : false;

      context.clearRect(0, 0, width, height);
      const gap = 2;
      const barWidth = Math.max(1, (width - gap * (BARS - 1)) / BARS);

      for (let i = 0; i < BARS; i += 1) {
        // Sample logarithmically: low frequencies carry most of the perceived
        // energy, so a linear sweep would leave the right half permanently flat.
        const position = (i / BARS) ** 1.7;
        const index = Math.min(spectrum.length - 1, Math.floor(position * spectrum.length));
        const raw = live ? (spectrum[index] ?? 0) / 255 : 0;
        const target = live ? Math.min(1, raw * 1.25) : 0;
        const current = heights[i] ?? 0;
        heights[i] = current + (target - current) * (target > current ? RISE : FALL);

        const value = heights[i] ?? 0;
        const barHeight = Math.max(2, value * height);
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        context.globalAlpha = 0.4 + value * 0.6;
        context.fillStyle = ramp[i] ?? colors[0];
        context.beginPath();
        context.roundRect(x, y, barWidth, barHeight, Math.min(barWidth / 2, 2));
        context.fill();
      }
      context.globalAlpha = 1;
      frame = window.requestAnimationFrame(draw);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Reduced motion and ambient pause both keep the bars, they just stop animating
    // them. The feature still reports that something is playing.
    if (reduced || paused) {
      const rect = canvas.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      const gap = 2;
      const barWidth = Math.max(1, (rect.width - gap * (BARS - 1)) / BARS);
      for (let i = 0; i < BARS; i += 1) {
        const value = active ? 0.34 : 0.08;
        const barHeight = Math.max(2, value * rect.height);
        context.globalAlpha = 0.6;
        context.fillStyle = ramp[i] ?? colors[0];
        context.beginPath();
        context.roundRect(i * (barWidth + gap), rect.height - barHeight, barWidth, barHeight, Math.min(barWidth / 2, 2));
        context.fill();
      }
      context.globalAlpha = 1;
      return () => observer.disconnect();
    }

    frame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [colors, active, binCount, paused, readSpectrum, reduced]);

  return (
    <div className="visualizer" data-active={active ? 'true' : undefined}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Linear blend of two #rrggbb colours. */
function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return a;
  const mix = (shift: number): number =>
    Math.round((((pa >> shift) & 255) * (1 - t)) + (((pb >> shift) & 255) * t));
  return `rgb(${mix(16)} ${mix(8)} ${mix(0)})`;
}
