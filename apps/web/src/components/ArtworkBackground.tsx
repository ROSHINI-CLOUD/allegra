import { useEffect, useState, type CSSProperties } from 'react';

import type { Palette } from '../lib/palette';

export interface ArtworkBackgroundProps {
  /** Current song's cover art. `null` shows the palette fallback only. */
  readonly artworkUrl: string | null;
  readonly palette?: Palette | null;
  readonly light?: boolean;
  readonly className?: string;
}

function hexLuminance(hex: string | undefined): number {
  if (!hex) return 0.4;
  const clean = hex.replace('#', '');
  const expanded = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(expanded, 16);
  if (!Number.isFinite(value)) return 0.4;
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Apple Music–style lyrics wash without WebGL: the real cover art, duplicated at
 * a few scales, slowly rotating / drifting under heavy blur + saturation so only
 * colour relationships survive. GPU cost is CSS compositing (transform/opacity),
 * not a Pixi/WebGL filter graph.
 */
export function ArtworkBackground({
  artworkUrl,
  palette = null,
  light = false,
  className = ''
}: ArtworkBackgroundProps) {
  const [activeUrl, setActiveUrl] = useState<string | null>(artworkUrl);
  const [incomingUrl, setIncomingUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!artworkUrl || artworkUrl === activeUrl || artworkUrl === incomingUrl) return undefined;
    if (!activeUrl) {
      setActiveUrl(artworkUrl);
      return undefined;
    }

    setIncomingUrl(artworkUrl);
    const timer = window.setTimeout(() => {
      setActiveUrl(artworkUrl);
      setIncomingUrl(null);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [artworkUrl, activeUrl, incomingUrl]);

  const veilStrength = 0.18 + hexLuminance(palette?.primary) * 0.3;
  const style = {
    '--artwork-bg-veil': veilStrength,
    '--artwork-bg-fallback': palette?.primary ?? (light ? '#c9ccd1' : '#0b0b0d')
  } as CSSProperties;

  return (
    <div className={`artwork-bg ${className}`.trim()} aria-hidden="true" style={style}>
      <div className="artwork-bg-fallback" />
      {activeUrl ? <ArtworkStack url={activeUrl} fading={Boolean(incomingUrl)} /> : null}
      {incomingUrl ? <ArtworkStack url={incomingUrl} incoming /> : null}
      <div className="artwork-bg-veil" />
      <div className="artwork-bg-vignette" />
    </div>
  );
}

function ArtworkStack({
  url,
  incoming = false,
  fading = false
}: {
  readonly url: string;
  readonly incoming?: boolean;
  readonly fading?: boolean;
}) {
  const image = { backgroundImage: `url(${JSON.stringify(url)})` } as CSSProperties;
  return (
    <div
      className={`artwork-bg-stack${incoming ? ' is-incoming' : ''}${fading ? ' is-fading' : ''}`}
    >
      <div className="artwork-bg-layer artwork-bg-layer--xl" style={image} />
      <div className="artwork-bg-layer artwork-bg-layer--lg" style={image} />
      <div className="artwork-bg-layer artwork-bg-layer--md" style={image} />
      <div className="artwork-bg-layer artwork-bg-layer--sm" style={image} />
    </div>
  );
}
