import { BookmarkPlus, Check, Heart, ListMusic, Pause, Play, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';

import type { UnifiedSong } from '@shared/types';

import { CoverFlow } from './CoverFlow';
import { PlaylistControls } from './PlaylistControls';
import { SongCard } from './SongCard';
import { EmptyState, SkeletonCard, TactileButton } from './ui';
import { formatAlbumDuration } from '../lib/album';
import { extractPalette } from '../lib/palette';
import type { Palette } from '../lib/palette';

interface CollectionPageProps {
  readonly kind: 'playlist' | 'liked' | 'shared';
  readonly title: string;
  readonly songs: readonly UnifiedSong[];
  readonly loading: boolean;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: Set<string>;
  readonly onToggle: () => void;
  readonly onPlayTrack: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onPlayAll: (shuffle: boolean) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onOpenAlbum: (song: UnifiedSong) => void;
  readonly onDiscover: () => void;
  /** Playlists can be deleted; Liked Songs cannot. */
  readonly onDelete?: () => void;
  /** A playlist the signed-in listener owns can be shared by link. */
  readonly share?: { readonly libraryId: string; readonly isPublic: boolean; readonly onChanged: () => void };
  /** Custom cover for owned playlists (Change cover control + hero art). */
  readonly cover?: {
    readonly libraryId: string;
    readonly coverUrl?: string;
    readonly onUpload: (libraryId: string, file: File, onProgress?: (ratio: number) => void) => Promise<unknown>;
  };
  /** Shared playlists: who made it, and a way to keep a copy. */
  readonly ownerName?: string;
  readonly onSaveCopy?: () => Promise<void>;
  /** Shared playlist cover from the owner, when present. */
  readonly coverUrl?: string;
}

/**
 * A playlist or the Liked Songs list. The hero leads with the collection on a cover shelf — the
 * centred song facing you, its neighbours turned away — and the full track list sits under it.
 */
export function CollectionPage({ kind, title, songs, loading, currentSongId, isPlaying, likedIds, onToggle, onPlayTrack, onPlayAll, onLike, onOpenAlbum, onDiscover, onDelete, share, cover, ownerName, onSaveCopy, coverUrl }: CollectionPageProps) {
  const [palette, setPalette] = useState<Palette | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const queue = useMemo(() => [...songs], [songs]);
  const customCover = cover?.coverUrl ?? coverUrl ?? null;
  // Custom cover wins; otherwise the first real song art colours the hero.
  const leadArtwork = useMemo(
    () => customCover ?? songs.find((song) => song.artwork)?.artwork ?? null,
    [customCover, songs]
  );
  const totalSeconds = useMemo(() => songs.reduce((sum, song) => sum + song.duration, 0), [songs]);
  const collectionIsCurrent = currentSongId !== null && songs.some((song) => song.id === currentSongId);
  const collectionPlaying = collectionIsCurrent && isPlaying;

  useEffect(() => {
    setPalette(null);
    if (!leadArtwork) return undefined;
    const controller = new AbortController();
    void extractPalette(leadArtwork, controller.signal).then((next) => {
      if (!controller.signal.aborted) setPalette(next);
    });
    return () => controller.abort();
  }, [leadArtwork]);

  const heroStyle = {
    '--art-primary': palette?.primary ?? '#3a3d45',
    '--art-secondary': palette?.secondary ?? '#2c2f36',
    '--art-tertiary': palette?.tertiary ?? '#3a3d45',
    ...(leadArtwork ? { '--cover': `url(${JSON.stringify(leadArtwork)})` } : {})
  } as CSSProperties;

  const Icon = kind === 'liked' ? Heart : ListMusic;
  const showCustomHero = Boolean(customCover);

  return (
    <div className="artist-page collection-page">
      <header className={`artist-hero collection-hero ${!showCustomHero && songs.length > 0 ? 'collection-hero--flow' : ''}`} style={heroStyle}>
        {showCustomHero ? (
          <div className="artist-cover collection-custom-cover" aria-hidden="true">
            <img src={customCover ?? undefined} alt="" />
          </div>
        ) : songs.length === 0 ? (
          <div className="artist-cover artist-cover--mosaic is-sparse" aria-hidden="true">
            <span className="collection-empty-cover"><Icon size={72} strokeWidth={1.25} /></span>
          </div>
        ) : (
          <CoverFlow
            songs={songs}
            currentSongId={currentSongId}
            isPlaying={isPlaying}
            label={`${title} covers`}
            onPlay={(song) => onPlayTrack(song, queue)}
            onToggle={onToggle}
          />
        )}
        <div className="artist-hero-copy">
          <span className="artist-sheet-eyebrow">{kind === 'liked' ? 'Your collection' : kind === 'shared' ? `Shared by ${ownerName ?? 'a listener'}` : 'Playlist'}</span>
          <h1>{title}</h1>
          <p>{loading ? 'Loading…' : songs.length > 0 ? `${songs.length} ${songs.length === 1 ? 'song' : 'songs'} · ${formatAlbumDuration(totalSeconds)}` : 'No songs yet'}</p>
          <div className="artist-actions">
            {songs.length > 0 ? (
              <>
                <TactileButton variant="primary" icon={collectionPlaying ? Pause : Play} onClick={() => { if (collectionIsCurrent) onToggle(); else onPlayAll(false); }}>{collectionPlaying ? 'Pause' : 'Play'}</TactileButton>
                <TactileButton variant="secondary" icon={Shuffle} onClick={() => onPlayAll(true)}>Shuffle</TactileButton>
              </>
            ) : null}
            {onSaveCopy ? (
              <TactileButton
                variant="secondary"
                icon={saveState === 'saved' ? Check : BookmarkPlus}
                disabled={saveState !== 'idle'}
                onClick={() => { setSaveState('saving'); void onSaveCopy().then(() => setSaveState('saved')).catch(() => setSaveState('idle')); }}
              >
                {saveState === 'saved' ? 'Saved to your library' : saveState === 'saving' ? 'Saving…' : 'Save to my library'}
              </TactileButton>
            ) : null}
            <PlaylistControls
              {...(share ? { share } : {})}
              {...(onDelete ? { onDelete } : {})}
              {...(cover ? { cover } : {})}
            />
          </div>
        </div>
      </header>

      {loading && songs.length === 0 ? (
        <div className="track-list" aria-busy="true"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
      ) : songs.length === 0 ? (
        <EmptyState
          title={kind === 'liked' ? 'Nothing liked yet' : 'This playlist is empty'}
          copy={kind === 'liked' ? 'Tap the heart on any song and it lands here.' : 'Use the list-plus button on any song to add it.'}
          action={<TactileButton variant="primary" onClick={onDiscover}>Find something to play</TactileButton>}
        />
      ) : (
        <section className="artist-section-block" aria-label={`${title} songs`}>
          <div className="library-track-list">
            {songs.map((song, index) => (
              <SongCard
                key={song.id}
                song={song}
                index={index}
                isCurrent={song.id === currentSongId}
                isPlaying={song.id === currentSongId && isPlaying}
                onPlay={() => onPlayTrack(song, queue)}
                onLike={() => onLike(song)}
                liked={likedIds.has(song.id)}
                onOpenAlbum={onOpenAlbum}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
