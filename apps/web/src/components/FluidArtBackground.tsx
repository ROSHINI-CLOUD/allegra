import { memo, useEffect, useRef, useState } from 'react';
import type { AnimationEvent, CSSProperties } from 'react';

import { DEFAULT_PALETTE, extractPalette } from '../lib/palette';
import type { Palette } from '../lib/palette';

/** Scenes alive at once: the base plus fades still landing during quick skips. Bounds the DOM. */
const MAX_SCENES = 3;

interface Scene {
  readonly id: number;
  readonly palette: Palette;
}

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
  // Oldest first. The newest dissolves in over the rest (CSS, --d-atmosphere); when it lands, the
  // scenes under it are dropped and it stays on as the base. The element that faded in is the one
  // that keeps playing, so its orbs never jump to another scene's point in their orbit, and every
  // scene is opaque, so removing the ones underneath changes nothing on screen.
  const [scenes, setScenes] = useState<readonly Scene[]>([{ id: 0, palette: DEFAULT_PALETTE }]);
  const nextId = useRef(1);

  useEffect(() => {
    const controller = new AbortController();
    void extractPalette(artworkUrl, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      const id = nextId.current++;
      setScenes((current) => [...current, { id, palette: next }].slice(-MAX_SCENES));
    });
    return () => controller.abort();
  }, [artworkUrl]);

  const settle = (id: number) => (event: AnimationEvent<HTMLDivElement>): void => {
    // The orbs' own endless spin animations bubble here too; only the scene's dissolve counts.
    if (event.target !== event.currentTarget) return;
    setScenes((current) => current.slice(Math.max(0, current.findIndex((scene) => scene.id === id))));
  };

  return (
    <div className="fluid" aria-hidden="true">
      {scenes.map((scene) => (
        <div
          key={scene.id}
          className={`fluid__scene${scene.id === 0 ? '' : ' is-incoming'}`}
          style={paletteVars(scene.palette)}
          onAnimationEnd={scene.id === 0 ? undefined : settle(scene.id)}
        >
          <div className="fluid__spin fluid__spin--1"><div className="fluid__orb fluid__orb--a" /></div>
          <div className="fluid__spin fluid__spin--2"><div className="fluid__orb fluid__orb--b" /></div>
          <div className="fluid__spin fluid__spin--3"><div className="fluid__orb fluid__orb--a" /></div>
          <div className="fluid__spin fluid__spin--4"><div className="fluid__orb fluid__orb--dark" /></div>
        </div>
      ))}
      <div className="fluid__shade" />
    </div>
  );
});
