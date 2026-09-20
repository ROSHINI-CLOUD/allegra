import { Artwork } from './ui';
import type { UnifiedSong } from '@shared/types';

interface TurntableProps {
  readonly song: UnifiedSong;
  readonly playing?: boolean;
  readonly layoutId?: string;
}

/**
 * A real player object made from the song's artwork. The art stays the source
 * of truth; the deck, record, and tonearm are interface material around it.
 */
export function Turntable({ song, playing = false, layoutId }: TurntableProps) {
  return (
    <span className={`turntable ${playing ? 'is-playing' : ''}`} aria-hidden="true">
      <span className="turntable-mark">ALLEGRA <b>33⅓</b></span>
      <span className="turntable-disc">
        <span className="turntable-grooves" />
        <Artwork song={song} size="large" layoutId={layoutId} />
        <span className="turntable-spindle" />
      </span>
      <span className="turntable-arm"><span className="turntable-arm-head" /></span>
      <span className="turntable-speed" aria-hidden="true"><i /><b /></span>
      <span className="turntable-switch" aria-hidden="true" />
    </span>
  );
}
