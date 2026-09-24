import { lockScroll } from '../lib/scrollLock';
import { BadgeCheck, Pause, Play, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ArtistProfile, UnifiedSong } from '@shared/types';

import { Artwork } from './ui';
import { fetchArtist } from '../lib/api';
import { formatTime } from '../lib/utils';
import { motionTokens } from '../motion';

/*
 * Portrait card that expands into a side-by-side artist sheet. The morph (shared layoutId on card,
 * photo and name) follows Watermelon UI's "Expandable Profile Card" pattern (ui.watermelon.sh),
 * rebuilt on Allegra's motion tokens, reduced-motion handling and keyboard/focus rules.
 */

interface ArtistPreviewCardProps {
  readonly name: string;
  /** Real artist photo when the provider has one. */
  readonly image?: string | null;
  /** The photo lookup is still in flight. Hold a neutral placeholder rather than
   *  showing a song cover that will visibly flip to a face a few seconds later. */
  readonly photoPending?: boolean;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly onPlayTrack: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onOpenArtist: (name: string) => void;
}

function formatFollowers(count: number): string {
  const trim = (value: number): string => (value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, ''));
  if (count >= 1e6) return `${trim(count / 1e6)}M followers`;
  if (count >= 1e3) return `${trim(count / 1e3)}K followers`;
  return `${count} followers`;
}

export function ArtistPreviewCard({ name, image = null, photoPending = false, currentSongId, isPlaying, onPlayTrack, onOpenArtist }: ArtistPreviewCardProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const layoutId = `artist-card-${name}`;
  const transition = reduced ? { duration: motionTokens.duration.instant } : { type: 'spring' as const, duration: 0.45, bounce: 0.12 };

  // Load the profile only once the sheet is opened; the API caches it, so a second open is instant.
  useEffect(() => {
    if (!open || profile) return undefined;
    const controller = new AbortController();
    setFailed(false);
    fetchArtist(name, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setProfile(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [open, profile, name]);

  // Escape closes, page scroll is locked while open, and focus returns to the card.
  useEffect(() => {
    if (!open) return undefined;
    const unlock = lockScroll();
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    const card = cardRef.current;
    return () => {
      unlock();
      window.removeEventListener('keydown', onKeyDown);
      card?.focus({ preventScroll: true });
    };
  }, [open]);

  const photo = profile?.image ?? image;
  const songs = profile?.songs ?? [];
  const playing = songs.some((song) => song.id === currentSongId) && isPlaying;

  // A song cover is not a face. It used to stand in while the photo lookup ran, which
  // meant every card visibly flipped from album art to a portrait seconds after load —
  // and for artists with no photo at all, the cover just stayed there pretending.
  // An initial holds the slot instead, and only a real photo replaces it.
  const faceContent = photo ? (
    <img src={photo} alt="" loading="lazy" crossOrigin="anonymous" />
  ) : (
    <span className={`artist-card-initial${photoPending ? ' is-pending' : ''}`} aria-hidden="true">
      {name.trim().slice(0, 1).toLocaleUpperCase()}
    </span>
  );

  const media = (className: string) => <span className={className}>{faceContent}</span>;

  return (
    <>
      <motion.button
        ref={cardRef}
        type="button"
        layoutId={layoutId}
        className="artist-card"
        onClick={() => setOpen(true)}
        aria-label={`Preview ${name}`}
        aria-haspopup="dialog"
        transition={transition}
      >
        <motion.span layoutId={`${layoutId}-photo`} className="artist-card-photo" transition={transition}>
          {faceContent}
        </motion.span>
        <span className="artist-card-shade" aria-hidden="true" />
        <span className="artist-card-copy">
          <motion.strong layoutId={`${layoutId}-name`} transition={transition}>{name}</motion.strong>
          <span>Artist</span>
        </span>
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {open ? (
            <div className="artist-sheet-layer">
              <motion.div
                className="artist-sheet-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionTokens.duration.base }}
                onClick={() => setOpen(false)}
              />
              <motion.div className="artist-sheet" layoutId={layoutId} role="dialog" aria-modal="true" aria-label={`${name}, artist preview`} transition={transition}>
                <button ref={closeRef} type="button" className="artist-sheet-close" onClick={() => setOpen(false)} aria-label="Close preview"><X size={16} aria-hidden="true" /></button>

                <motion.div layoutId={`${layoutId}-photo`} className="artist-sheet-photo" transition={transition}>
                  {media('artist-sheet-photo-inner')}
                </motion.div>

                <div className="artist-sheet-body">
                  {!profile?.isVerified ? <span className="artist-sheet-eyebrow">Artist</span> : null}
                  <motion.h3 layoutId={`${layoutId}-name`} transition={transition}>
                    {profile?.name ?? name}
                    {profile?.isVerified ? <span className="artist-verified artist-verified--inline" aria-label="Verified artist" title="Verified artist"><BadgeCheck size={15} aria-hidden="true" /></span> : null}
                  </motion.h3>
                  <p className="artist-sheet-meta">{profile?.followerCount ? formatFollowers(profile.followerCount) : failed ? 'Details unavailable right now' : 'Loading…'}</p>

                  <motion.div
                    className="artist-sheet-songs"
                    initial={{ opacity: 0, x: reduced ? 0 : 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: reduced ? 0 : 0.15, duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate }}
                  >
                    <h4>Top songs</h4>
                    {songs.slice(0, 5).map((song) => (
                      <button key={song.id} type="button" className="artist-sheet-song" onClick={() => onPlayTrack(song, songs)}>
                        <Artwork song={song} size="small" />
                        <span className="artist-sheet-song-title">{song.title}</span>
                        <span className="artist-sheet-song-time">{song.id === currentSongId && isPlaying ? 'Playing' : formatTime(song.duration)}</span>
                      </button>
                    ))}
                    {profile && songs.length === 0 ? <p className="artist-sheet-meta">No playable songs yet.</p> : null}
                  </motion.div>

                  <div className="artist-sheet-actions">
                    <button
                      type="button"
                      className="artist-sheet-primary"
                      disabled={songs.length === 0}
                      onClick={() => { const first = songs[0]; if (first) onPlayTrack(first, songs); }}
                    >
                      {playing ? <Pause size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />} {playing ? 'Playing' : 'Play'}
                    </button>
                    <button type="button" className="artist-sheet-secondary" onClick={() => { setOpen(false); onOpenArtist(name); }}>Open artist page</button>
                  </div>
                </div>
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
