import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import { DEFAULT_PALETTE, extractPalette } from '../lib/palette';
import type { Palette } from '../lib/palette';

interface FluidArtBackgroundProps {
  readonly artworkUrl: string;
}

function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '');
  const expanded = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(expanded, 16);
  if (!Number.isFinite(value)) return '11, 13, 17';
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function paletteVars(palette: Palette): CSSProperties {
  return {
    '--fluid-a': hexToRgbChannels(palette.primary),
    '--fluid-b': hexToRgbChannels(palette.secondary)
  } as CSSProperties;
}

/**
 * Apple-Music-style fluid backdrop, in plain CSS: two colours pulled straight out of the
 * cover (never the picture itself), plus black, as four blurred orbs that orbit and spin
 * at their own pace. Where the coloured orbs cross they fuse into new hues (mix-blend-mode:
 * screen); the black orb gives the field somewhere to recede to. Only `transform` animates,
 * so the blur is painted once per layer and the compositor does the rest — no canvas,
 * WebGL or animation library.
 */
export const FluidArtBackground = memo(function FluidArtBackground({ artworkUrl }: FluidArtBackgroundProps) {
  const [current, setCurrent] = useState<Palette>(DEFAULT_PALETTE);
  const [incoming, setIncoming] = useState<Palette | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void extractPalette(artworkUrl, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setIncoming(next);
      const timer = window.setTimeout(() => {
        if (controller.signal.aborted) return;
        setCurrent(next);
        setIncoming(null);
      }, 1300);
      return () => window.clearTimeout(timer);
    });
    return () => controller.abort();
  }, [artworkUrl]);

  return (
    <div className="fluid" aria-hidden="true">
      <div className="fluid__scene" style={paletteVars(current)}>
        <div className="fluid__spin fluid__spin--1"><div className="fluid__orb fluid__orb--a" /></div>
        <div className="fluid__spin fluid__spin--2"><div className="fluid__orb fluid__orb--b" /></div>
        <div className="fluid__spin fluid__spin--3"><div className="fluid__orb fluid__orb--a" /></div>
        <div className="fluid__spin fluid__spin--4"><div className="fluid__orb fluid__orb--dark" /></div>
      </div>
      {incoming ? (
        <div className="fluid__scene is-incoming" style={paletteVars(incoming)}>
          <div className="fluid__spin fluid__spin--1"><div className="fluid__orb fluid__orb--a" /></div>
          <div className="fluid__spin fluid__spin--2"><div className="fluid__orb fluid__orb--b" /></div>
          <div className="fluid__spin fluid__spin--3"><div className="fluid__orb fluid__orb--a" /></div>
          <div className="fluid__spin fluid__spin--4"><div className="fluid__orb fluid__orb--dark" /></div>
        </div>
      ) : null}
      <div className="fluid__shade" />
    </div>
  );
});
