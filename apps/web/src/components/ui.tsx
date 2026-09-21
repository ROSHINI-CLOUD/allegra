import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Heart } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { motionTokens } from '../motion';
import { usePress } from '../hooks/usePress';
import { titleAccent } from '../lib/utils';
import type { UnifiedSong } from '@shared/types';

type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost';

const BUTTON_BASE = 'tactile-control inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-pill font-medium text-sm whitespace-nowrap transition-transform duration-fast ease-press disabled:opacity-50 disabled:pointer-events-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-glass',
  accent: 'btn-primary',
  ghost: 'bg-transparent text-ink-muted hover:text-ink'
};

interface TactileButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: LucideIcon;
  readonly children: ReactNode;
}

export function TactileButton({ variant = 'secondary', icon: Icon, children, className = '', ...props }: TactileButtonProps) {
  const press = usePress();
  return (
    <button className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`} {...press} {...props}>
      {Icon ? <Icon size={16} strokeWidth={1.8} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly active?: boolean;
}

export function IconButton({ icon: Icon, label, active = false, className = '', ...props }: IconButtonProps) {
  const press = usePress();
  return (
    <button
      {...press}
      className={`tactile-icon-control inline-flex items-center justify-center w-11 h-11 rounded-pill border border-border bg-surface-raised transition-transform duration-fast ease-press ${active ? 'text-accent-deep border-accent-line' : 'text-ink-soft hover:text-ink hover:bg-surface-hover'} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {Icon === Heart ? <HeartGlyph active={active} /> : <Icon size={18} strokeWidth={1.8} aria-hidden="true" />}
    </button>
  );
}

const BURST = [0, 60, 120, 180, 240, 300] as const;

/**
 * Like heart: springs when it fills and throws a ring of sparks. Only transform and opacity animate,
 * and it stays still on first paint and for reduced motion.
 */
function HeartGlyph({ active }: { readonly active: boolean }) {
  const reduced = useReducedMotion();
  const previous = useRef(active);
  const justLiked = active && !previous.current;
  useEffect(() => {
    previous.current = active;
  }, [active]);
  return (
    <span className="heart-glyph">
      <motion.span
        className="heart-glyph-icon"
        key={active ? 'on' : 'off'}
        initial={justLiked && !reduced ? { scale: 0.55 } : false}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 14 }}
      >
        <Heart size={18} strokeWidth={1.8} aria-hidden="true" />
      </motion.span>
      {justLiked && !reduced ? BURST.map((angle) => (
        <motion.i
          key={angle}
          className="heart-spark"
          initial={{ opacity: 0.95, scale: 0.6, x: 0, y: 0 }}
          animate={{ opacity: 0, scale: 1, x: Math.cos((angle * Math.PI) / 180) * 15, y: Math.sin((angle * Math.PI) / 180) * 15 }}
          transition={{ duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate }}
        />
      )) : null}
    </span>
  );
}

interface FloatingFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly label: string;
  readonly ref?: Ref<HTMLInputElement> | undefined;
}

/** Text field whose label sits inside until you focus or type, then floats up (Watermelon "Floating Input"). Pure CSS. */
export function FloatingField({ label, className = '', ref, ...props }: FloatingFieldProps) {
  const id = useId();
  return (
    <div className={`floating-field ${className}`}>
      <input id={id} ref={ref} placeholder=" " {...props} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

export function Artwork({ song, size = 'medium', layoutId }: { readonly song: UnifiedSong; readonly size?: 'small' | 'medium' | 'large'; readonly layoutId?: string }) {
  return (
    <div className={`artwork artwork-${size}`} style={{ backgroundColor: titleAccent(song.title) }}>
      {layoutId ? (
        <motion.img layoutId={layoutId} src={song.artwork} alt={`${song.title} artwork`} loading="lazy" crossOrigin="anonymous" onError={(event) => { event.currentTarget.style.display = 'none'; }} transition={{ duration: motionTokens.duration.cinematic, ease: motionTokens.ease.emphasis }} />
      ) : (
        <img src={song.artwork} alt={`${song.title} artwork`} loading="lazy" crossOrigin="anonymous" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
      )}
      <span className="artwork-fallback" aria-hidden="true">{song.title.slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="song-card skeleton-card" aria-hidden="true">
      <div className="skeleton skeleton-art" />
      <div className="skeleton-line skeleton-line-long" />
      <div className="skeleton-line skeleton-line-short" />
    </div>
  );
}

export function EmptyState({ title, copy, action }: { readonly title: string; readonly copy: string; readonly action?: ReactNode }) {
  return (
    <div className="state-card">
      <span className="state-mark" aria-hidden="true">✦</span>
      <h3>{title}</h3>
      <p>{copy}</p>
      {action}
    </div>
  );
}

export function OfflineToast({ visible }: { readonly visible: boolean }) {
  return visible ? <div className="offline-toast" role="status">You are offline. Playback stays ready for when you return.</div> : null;
}
