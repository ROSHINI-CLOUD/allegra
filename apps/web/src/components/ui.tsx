import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';

import { motionTokens } from '../motion';
import { usePress } from '../hooks/usePress';
import { titleGradient } from '../lib/utils';
import type { UnifiedSong } from '@shared/types';

type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost';

interface TactileButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: LucideIcon;
  readonly children: ReactNode;
}

export function TactileButton({ variant = 'secondary', icon: Icon, children, className = '', ...props }: TactileButtonProps) {
  const press = usePress();
  return (
    <button className={`tactile-button tactile-${variant} ${className}`} {...press} {...props}>
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
      className={`icon-button ${active ? 'is-active' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

export function Artwork({ song, size = 'medium', layoutId }: { readonly song: UnifiedSong; readonly size?: 'small' | 'medium' | 'large'; readonly layoutId?: string }) {
  return (
    <div className={`artwork artwork-${size}`} style={{ background: titleGradient(song.title) }}>
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
