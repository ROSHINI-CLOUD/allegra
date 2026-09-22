import { memo, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

interface FluidArtBackgroundProps {
  readonly artworkUrl: string;
}

/**
 * Apple-Music-style fluid backdrop in plain CSS: four blurred copies of the cover, each
 * orbiting and turning at its own pace, so the colours fuse and drift. Only `transform`
 * animates (see .fluid in app.css); the blur is painted once per layer.
 */
export const FluidArtBackground = memo(function FluidArtBackground({ artworkUrl }: FluidArtBackgroundProps) {
  // Keep the previous cover underneath while the new one fades in.
  const [scenes, setScenes] = useState<string[]>([artworkUrl]);

  useEffect(() => {
    setScenes((current) => (current[current.length - 1] === artworkUrl ? current : [...current.slice(-1), artworkUrl]));
    const timer = window.setTimeout(() => setScenes((current) => current.slice(-1)), 1400);
    return () => window.clearTimeout(timer);
  }, [artworkUrl]);

  return (
    <div className="fluid" aria-hidden="true">
      {scenes.map((url) => (
        <div className="fluid__scene" key={url} style={{ '--fluid-art': `url(${JSON.stringify(url)})` } as CSSProperties}>
          <div className="fluid__spin fluid__spin--1"><div className="fluid__art" /></div>
          <div className="fluid__spin fluid__spin--2"><div className="fluid__art" /></div>
          <div className="fluid__spin fluid__spin--3"><div className="fluid__art" /></div>
          <div className="fluid__spin fluid__spin--4"><div className="fluid__art" /></div>
        </div>
      ))}
      <div className="fluid__shade" />
    </div>
  );
});
