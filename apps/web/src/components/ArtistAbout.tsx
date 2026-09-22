import { BadgeCheck, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { motionTokens, spring } from '../motion';

interface ArtistAboutProps {
  readonly open: boolean;
  readonly name: string;
  readonly photo: string | null;
  readonly verified: boolean;
  readonly bio: string;
  readonly facts: readonly string[];
  /** The hero's artwork-derived tint, so the sheet belongs to the same artist. */
  readonly tint: CSSProperties;
  readonly onClose: () => void;
}

/** An editorial "about" sheet: the artist's portrait beside their story, set as readable paragraphs. */
export function ArtistAbout({ open, name, photo, verified, bio, facts, tint, onClose }: ArtistAboutProps) {
  const reduced = useReducedMotion();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const paragraphs = bio.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="artist-about"
          style={tint}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base, ease: motionTokens.ease.standard }}
          onClick={onClose}
        >
          <motion.section
            className="artist-about__sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="artist-about-title"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 36, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 }}
            transition={reduced ? { duration: motionTokens.duration.instant } : spring.sheet}
            onClick={(event) => event.stopPropagation()}
          >
            <button ref={closeRef} type="button" className="artist-about__close" onClick={onClose} aria-label="Close">
              <X size={18} aria-hidden="true" />
            </button>

            <aside className="artist-about__side">
              <figure className="artist-about__portrait">
                {photo ? <img src={photo} alt="" crossOrigin="anonymous" /> : <span aria-hidden="true">{name.trim().slice(0, 1).toLocaleUpperCase()}</span>}
              </figure>
              <span className="artist-about__eyebrow">{verified ? 'Verified artist' : 'Artist'}</span>
              <h2 id="artist-about-title">
                {name}
                {verified ? <BadgeCheck size={20} aria-label="Verified" /> : null}
              </h2>
              {facts.length > 0 ? (
                <ul className="artist-about__facts">
                  {facts.map((fact) => <li key={fact}>{fact}</li>)}
                </ul>
              ) : null}
            </aside>

            <div className="artist-about__story">
              <span className="artist-about__kicker">The story</span>
              <div className="artist-about__scroll">
                {paragraphs.map((paragraph, index) => (
                  <p key={index} className={index === 0 ? 'is-lead' : undefined}>{paragraph}</p>
                ))}
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
