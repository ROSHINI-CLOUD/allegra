import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';

import { DEFAULT_PALETTE, extractPalette, shadePalette, type Palette } from '../lib/palette';

export interface DynamicLyricsBackgroundProps {
  readonly artworkUrl: string | null;
  /** Seed / fallback while the one-shot extract finishes. */
  readonly palette?: Palette | null;
  readonly light?: boolean;
  readonly className?: string;
}

interface Atmosphere {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly deep: string;
  readonly primaryRgb: string;
  readonly secondaryRgb: string;
  readonly accentRgb: string;
  readonly deepRgb: string;
  readonly key: string;
}

const CROSSFADE_MS = 1100;
const paletteCache = new Map<string, Atmosphere>();

function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '');
  const expanded = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(expanded, 16);
  if (!Number.isFinite(value)) return '12, 14, 18';
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function toAtmosphere(palette: Palette, key: string): Atmosphere {
  const deep = shadePalette(palette, 0.18).primary;
  return {
    primary: palette.primary,
    secondary: palette.secondary,
    accent: palette.tertiary,
    deep,
    primaryRgb: hexToRgbChannels(palette.primary),
    secondaryRgb: hexToRgbChannels(palette.secondary),
    accentRgb: hexToRgbChannels(palette.tertiary),
    deepRgb: hexToRgbChannels(deep),
    key
  };
}

function fallbackAtmosphere(seed: Palette | null | undefined, light: boolean): Atmosphere {
  const base = seed ?? (light
    ? { primary: '#9aa3ad', secondary: '#7d8793', tertiary: '#b7c0c9' }
    : DEFAULT_PALETTE);
  return toAtmosphere(base, seed ? 'seed' : 'default');
}

async function loadAtmosphere(url: string, signal: AbortSignal): Promise<Atmosphere> {
  const cached = paletteCache.get(url);
  if (cached) return cached;
  const palette = await extractPalette(url, signal);
  if (signal.aborted) return toAtmosphere(DEFAULT_PALETTE, url);
  const next = toAtmosphere(palette, url);
  paletteCache.set(url, next);
  return next;
}

function sceneVars(atmosphere: Atmosphere, light: boolean): CSSProperties {
  const baseMix = light ? '#eef1f4' : '#08090b';
  return {
    '--music-primary': atmosphere.primary,
    '--music-secondary': atmosphere.secondary,
    '--music-accent': atmosphere.accent,
    '--music-deep': atmosphere.deep,
    '--music-primary-rgb': atmosphere.primaryRgb,
    '--music-secondary-rgb': atmosphere.secondaryRgb,
    '--music-accent-rgb': atmosphere.accentRgb,
    '--music-deep-rgb': atmosphere.deepRgb,
    '--music-base': `color-mix(in srgb, ${atmosphere.primary} 16%, ${baseMix})`
  } as CSSProperties;
}

/**
 * Apple Music–style lyrics atmosphere at near-zero cost:
 * one-shot palette extract → 5 blurred colour fields → CSS transform only.
 * The blur is painted once per field and then only transformed, so the compositor
 * reuses the same texture every frame. No canvas loop, no WebGL, no per-frame JS.
 */
function DynamicLyricsBackgroundComponent({
  artworkUrl,
  palette = null,
  light = false,
  className = ''
}: DynamicLyricsBackgroundProps) {
  const [current, setCurrent] = useState<Atmosphere>(() => fallbackAtmosphere(palette, light));
  const [incoming, setIncoming] = useState<Atmosphere | null>(null);
  const [tabHidden, setTabHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const currentKeyRef = useRef(current.key);
  const incomingKeyRef = useRef<string | null>(null);

  useEffect(() => {
    currentKeyRef.current = current.key;
  }, [current.key]);

  useEffect(() => {
    const onVisibility = (): void => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!artworkUrl) {
      const next = fallbackAtmosphere(palette, light);
      if (next.key !== currentKeyRef.current) {
        setCurrent(next);
        setIncoming(null);
        incomingKeyRef.current = null;
      }
      return undefined;
    }

    if (artworkUrl === currentKeyRef.current || artworkUrl === incomingKeyRef.current) {
      return undefined;
    }

    const controller = new AbortController();
    let fadeTimer = 0;
    void loadAtmosphere(artworkUrl, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      if (next.key === currentKeyRef.current) return;

      if (currentKeyRef.current === 'default' || currentKeyRef.current === 'seed') {
        setCurrent(next);
        setIncoming(null);
        incomingKeyRef.current = null;
        return;
      }

      if (incomingKeyRef.current) {
        setCurrent(next);
        setIncoming(null);
        incomingKeyRef.current = null;
        return;
      }

      incomingKeyRef.current = next.key;
      setIncoming(next);
      fadeTimer = window.setTimeout(() => {
        if (controller.signal.aborted) return;
        setCurrent(next);
        setIncoming(null);
        incomingKeyRef.current = null;
      }, CROSSFADE_MS);
    });

    return () => {
      controller.abort();
      if (fadeTimer) window.clearTimeout(fadeTimer);
    };
  }, [artworkUrl, palette, light]);

  return (
    <div
      className={`music-background${tabHidden ? ' is-tab-hidden' : ''} ${className}`.trim()}
      aria-hidden="true"
    >
      <AtmosphereScene atmosphere={current} light={light} fading={Boolean(incoming)} />
      {incoming ? <AtmosphereScene atmosphere={incoming} light={light} incoming /> : null}
      <div className="music-background__darkness" />
      <div className="music-background__lyric-field" />
    </div>
  );
}

function AtmosphereScene({
  atmosphere,
  light,
  incoming = false,
  fading = false
}: {
  readonly atmosphere: Atmosphere;
  readonly light: boolean;
  readonly incoming?: boolean;
  readonly fading?: boolean;
}) {
  return (
    <div
      className={`music-bg-scene${incoming ? ' is-incoming' : ''}${fading ? ' is-fading' : ''}`}
      style={sceneVars(atmosphere, light)}
    >
      <div className="music-bg-base" />
      {/* Five colour fields drifting on their own long, mismatched cycles, so they merge and
          separate without ever looping back to a pose you recognise. */}
      <div className="ambient-blob blob-1" />
      <div className="ambient-blob blob-2" />
      <div className="ambient-blob blob-3" />
      <div className="ambient-blob blob-4" />
      <div className="ambient-blob blob-5" />
    </div>
  );
}

export const DynamicLyricsBackground = memo(DynamicLyricsBackgroundComponent);
