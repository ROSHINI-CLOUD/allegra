import { MusicFlowShader } from './shader/MusicFlowShader';
import type { Palette } from '../lib/palette';
import type { CSSProperties } from 'react';

/**
 * The shared VibeRoom music-flow field. The shader owns pointer smoothing,
 * visibility and reduced-motion handling; this wrapper only composes the
 * flutes and scrim that keep the field legible under Allegra's content.
 */
export function DynamicAura({ paused = false, energy = 0.48, mood = 'energy', palette = null, light = false }: { readonly paused?: boolean; readonly energy?: number; readonly mood?: 'energy' | 'chill' | 'different' | 'surprise'; readonly palette?: Palette | null; readonly light?: boolean }) {
  const auraStyle = {
    '--aura-primary': palette?.primary ?? '#ee6b5f',
    '--aura-secondary': palette?.secondary ?? '#7bafd4',
    '--aura-tertiary': palette?.tertiary ?? '#c4dd74'
  } as CSSProperties;

  return (
    <div className={`dynamic-aura ${paused ? 'is-paused' : ''}`} style={auraStyle} aria-hidden="true">
      <MusicFlowShader energy={paused ? 0.12 : energy} mood={mood} palette={palette} light={light} />
      <div className="vibe-flutes" />
      <div className="vibe-vignette" />
      <div className="vibe-scrim" />
    </div>
  );
}
