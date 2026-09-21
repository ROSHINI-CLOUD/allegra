import { Check, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { fetchArtistFaces } from '../lib/api';
import type { Palette } from '../lib/palette';
import { motionTokens, spring } from '../motion';
import { MusicFlowShader } from './shader/MusicFlowShader';

/**
 * First-run taste setup: a full-screen takeover (Spotify/Apple Music both make this
 * unmissable rather than an easy-to-scroll-past card) with three steps — genres, then
 * artists, then languages — after Watermelon's "Onboarding Setup" card (step counter,
 * dashed divider, chips that pop a check) and "Emoji Spree Choice Chips" (the glyph-led
 * bubble chip). Genres are a pure client-side accelerator: picking one pre-selects a
 * few matching artists for the next step, but only artists + languages are ever sent
 * to the server, so no schema or contract change was needed for this step to exist.
 * From here on taste is learned from listening, so this is only ever asked once.
 */

const GENRES = [
  { id: 'bollywood', label: 'Bollywood', emoji: '🎬', seedArtists: ['Arijit Singh', 'Shreya Ghoshal', 'Pritam'] },
  { id: 'pop', label: 'Pop', emoji: '🎤', seedArtists: ['Taylor Swift', 'Dua Lipa', 'Ed Sheeran'] },
  { id: 'hiphop', label: 'Hip-Hop', emoji: '🎧', seedArtists: ['Badshah'] },
  { id: 'punjabi', label: 'Punjabi', emoji: '🥁', seedArtists: ['Diljit Dosanjh', 'Badshah'] },
  { id: 'indie', label: 'Indie & Alt', emoji: '🌙', seedArtists: ['Sid Sriram'] },
  { id: 'electronic', label: 'Electronic', emoji: '⚡', seedArtists: [] },
  { id: 'rnb', label: 'R&B & Soul', emoji: '💫', seedArtists: ['The Weeknd', 'Sid Sriram'] },
  { id: 'retro', label: 'Retro classics', emoji: '📻', seedArtists: ['Kishore Kumar', 'Lata Mangeshkar', 'Sonu Nigam'] },
  { id: 'southindian', label: 'Tamil & Telugu', emoji: '🪘', seedArtists: ['Anirudh Ravichander', 'Sid Sriram', 'A. R. Rahman'] },
  { id: 'acoustic', label: 'Acoustic', emoji: '🎸', seedArtists: ['Ed Sheeran', 'Atif Aslam'] }
] as const;

// Cycled per genre, in JS form of the same tokens DESIGN.md defines: --wave, --accent, --vibe-blue, --accent-bright, --accent-deep.
const GENRE_ACCENTS = ['#d9e66a', '#ee6b5f', '#7bafd4', '#ffaaa0', '#783e44'] as const;
const ONBOARDING_PALETTES: readonly Palette[] = [
  { primary: '#d9e66a', secondary: '#7bafd4', tertiary: '#ee6b5f' },
  { primary: '#ee6b5f', secondary: '#ffaaa0', tertiary: '#7bafd4' },
  { primary: '#7bafd4', secondary: '#d9e66a', tertiary: '#783e44' },
  { primary: '#ffaaa0', secondary: '#ee6b5f', tertiary: '#d9e66a' },
  { primary: '#783e44', secondary: '#ffaaa0', tertiary: '#7bafd4' }
];
const BUBBLE_SIZES = ['md', 'lg', 'sm'] as const;

const ARTISTS = [
  'Arijit Singh', 'A. R. Rahman', 'Anirudh Ravichander', 'Shreya Ghoshal', 'Pritam', 'Sid Sriram',
  'Diljit Dosanjh', 'Badshah', 'Atif Aslam', 'Kishore Kumar', 'Lata Mangeshkar', 'Taylor Swift',
  'The Weeknd', 'Ed Sheeran', 'Dua Lipa', 'Sonu Nigam'
] as const;

const LANGUAGES = ['Hindi', 'English', 'Tamil', 'Telugu', 'Punjabi', 'Malayalam', 'Kannada', 'Bengali', 'Marathi'] as const;

const MIN_GENRES = 1;
const MIN_ARTISTS = 3;
const TOTAL_STEPS = 3;

interface TasteOnboardingProps {
  readonly open: boolean;
  readonly onSubmit: (artists: string[], languages: string[]) => Promise<void>;
  readonly onSkip: () => void;
}

export function TasteOnboarding({ open, onSubmit, onSkip }: TasteOnboardingProps) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [genres, setGenres] = useState<string[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [lastAccent, setLastAccent] = useState<string>(GENRE_ACCENTS[0]);
  const [shaderPalette, setShaderPalette] = useState<Palette>(ONBOARDING_PALETTES[0]);
  const [faces, setFaces] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only worth fetching once the takeover is actually shown.
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    // The API takes at most 12 names per call, so ask in two batches.
    const batches = [ARTISTS.slice(0, 8), ARTISTS.slice(8)];
    for (const batch of batches) {
      void fetchArtistFaces([...batch], controller.signal)
        .then((found) => {
          if (controller.signal.aborted) return;
          setFaces((current) => {
            const next = { ...current };
            for (const face of found) if (face.image) next[face.name.toLocaleLowerCase()] = face.image;
            return next;
          });
        })
        .catch(() => undefined);
    }
    return () => controller.abort();
  }, [open]);

  // Full-screen takeover: lock page scroll for as long as it is open, same rule as any other immersive surface.
  useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    const body = document.body;
    const previous = { rootOverflow: root.style.overflow, bodyOverflow: body.style.overflow, rootOverscroll: root.style.overscrollBehavior, bodyOverscroll: body.style.overscrollBehavior };
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    return () => {
      root.style.overflow = previous.rootOverflow;
      body.style.overflow = previous.bodyOverflow;
      root.style.overscrollBehavior = previous.rootOverscroll;
      body.style.overscrollBehavior = previous.bodyOverscroll;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onSkip]);

  const toggle = (list: string[], value: string, set: (next: string[]) => void): void => {
    set(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  };

  const toggleGenre = (id: string, accent: string, palette: Palette): void => {
    toggle(genres, id, setGenres);
    setLastAccent(accent);
    setShaderPalette(palette);
  };

  const continueFromGenres = (): void => {
    const seeded = GENRES.filter((genre) => genres.includes(genre.id)).flatMap((genre) => genre.seedArtists);
    setArtists((current) => [...current, ...seeded.filter((name) => !current.includes(name))]);
    setStep(2);
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(artists, languages.map((item) => item.toLocaleLowerCase()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save that. Try again.');
      setBusy(false);
    }
  };

  const enter = reduced ? { duration: motionTokens.duration.instant } : spring.sheet;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="taste-overlay" key="taste-overlay">
          <div className="taste-overlay-backdrop" style={{ '--preview-tint': lastAccent } as CSSProperties} aria-hidden="true">
            <MusicFlowShader energy={0.58} mood="different" palette={shaderPalette} />
            <div className="taste-overlay-backdrop-wash" />
            <div className="taste-overlay-backdrop-vignette" />
          </div>
          <button type="button" className="taste-overlay-close" onClick={onSkip} aria-label="Skip for now"><X size={16} aria-hidden="true" /></button>

          <motion.div className="taste-shell" role="dialog" aria-modal="true" aria-labelledby="taste-title" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 14, scale: 0.98 }} transition={enter}>
            <section className="taste-card taste-panel">
              <header className="taste-head">
                <div>
                  <span className="eyebrow eyebrow-accent">Step {step} of {TOTAL_STEPS}</span>
                  <h2 id="taste-title">
                    {step === 1 ? 'What do you love?' : step === 2 ? 'Who do you love listening to?' : 'What do you listen in?'}
                  </h2>
                  <p>
                    {step === 1
                      ? 'Pick a few genres — your Home starts there.'
                      : step === 2
                        ? `Pick at least ${MIN_ARTISTS}. We started you off from your genres, swap in anyone you like.`
                        : 'Pick any that fit. We will lean your picks toward them.'}
                  </p>
                </div>
                <div className="taste-steps" aria-hidden="true">
                  {[1, 2, 3].map((dot) => <i key={dot} className={dot <= step ? 'is-on' : ''} />)}
                </div>
              </header>

              <div className="taste-rule" />

              <AnimatePresence mode="wait" initial={false}>
                {step === 1 ? (
                  <motion.div key="genres" className="taste-chips taste-bubbles" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate }}>
                    {GENRES.map((genre, index) => {
                      const active = genres.includes(genre.id);
                      const accent = GENRE_ACCENTS[index % GENRE_ACCENTS.length];
                      const palette = ONBOARDING_PALETTES[index % ONBOARDING_PALETTES.length];
                      const size = BUBBLE_SIZES[index % BUBBLE_SIZES.length];
                      return (
                        <motion.button key={genre.id} type="button" className={`taste-bubble taste-bubble--${size} ${active ? 'is-active' : ''}`} style={{ '--bubble-accent': accent } as CSSProperties} aria-pressed={active} whileTap={reduced ? undefined : { scale: 0.94 }} onClick={() => toggleGenre(genre.id, accent, palette)}>
                          <span className="taste-bubble-emoji" aria-hidden="true">{genre.emoji}</span>
                          <span className="taste-chip-name">{genre.label}</span>
                          <AnimatePresence>{active ? <motion.span className="taste-chip-check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.tactile}><Check size={12} strokeWidth={3} aria-hidden="true" /></motion.span> : null}</AnimatePresence>
                        </motion.button>
                      );
                    })}
                  </motion.div>
                ) : step === 2 ? (
                  <motion.div key="artists" className="taste-chips taste-chips--artists" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate }}>
                    {ARTISTS.map((name) => {
                      const active = artists.includes(name);
                      const photo = faces[name.toLocaleLowerCase()];
                      return (
                        <motion.button key={name} type="button" className={`taste-chip taste-chip--artist ${active ? 'is-active' : ''}`} aria-pressed={active} whileTap={reduced ? undefined : { scale: 0.96 }} onClick={() => toggle(artists, name, setArtists)}>
                          <span className="taste-chip-photo">{photo ? <img src={photo} alt="" loading="lazy" /> : <span aria-hidden="true">{name.slice(0, 1)}</span>}</span>
                          <span className="taste-chip-name">{name}</span>
                          <AnimatePresence>{active ? <motion.span className="taste-chip-check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.tactile}><Check size={12} strokeWidth={3} aria-hidden="true" /></motion.span> : null}</AnimatePresence>
                        </motion.button>
                      );
                    })}
                  </motion.div>
                ) : (
                  <motion.div key="languages" className="taste-chips" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate }}>
                    {LANGUAGES.map((name) => {
                      const active = languages.includes(name);
                      return (
                        <motion.button key={name} type="button" className={`taste-chip ${active ? 'is-active' : ''}`} aria-pressed={active} whileTap={reduced ? undefined : { scale: 0.96 }} onClick={() => toggle(languages, name, setLanguages)}>
                          <AnimatePresence>{active ? <motion.span className="taste-chip-check" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring.tactile}><Check size={12} strokeWidth={3} aria-hidden="true" /></motion.span> : null}</AnimatePresence>
                          <span className="taste-chip-name">{name}</span>
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              {error ? <p className="auth-error" role="alert">{error}</p> : null}

              <footer className="taste-foot">
                <button type="button" className="taste-skip" onClick={onSkip}>Not now</button>
                <div className="taste-actions">
                  {step > 1 ? <button type="button" className="btn-glass tactile-control taste-btn" onClick={() => setStep((current) => (current - 1) as 1 | 2)}>Back</button> : null}
                  {step === 1 ? (
                    <button type="button" className="btn-primary tactile-control taste-btn" disabled={genres.length < MIN_GENRES} onClick={continueFromGenres}>Continue</button>
                  ) : step === 2 ? (
                    <button type="button" className="btn-primary tactile-control taste-btn" disabled={artists.length < MIN_ARTISTS} onClick={() => setStep(3)}>
                      {artists.length < MIN_ARTISTS ? `Pick ${MIN_ARTISTS - artists.length} more` : 'Continue'}
                    </button>
                  ) : (
                    <button type="button" className="btn-primary tactile-control taste-btn" disabled={busy} onClick={() => void finish()}>{busy ? 'Saving…' : 'Build my Home'}</button>
                  )}
                </div>
              </footer>
            </section>

            <TastePreview step={step} artists={artists} languages={languages} faces={faces} accent={lastAccent} reduced={Boolean(reduced)} />
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

interface TastePreviewProps {
  readonly step: 1 | 2 | 3;
  readonly artists: readonly string[];
  readonly languages: readonly string[];
  readonly faces: Readonly<Record<string, string>>;
  readonly accent: string;
  readonly reduced: boolean;
}

/** The payoff, shown live: this is what "Home tunes itself to you" actually looks like while you are still picking. */
function TastePreview({ step, artists, languages, faces, accent, reduced }: TastePreviewProps) {
  const shown = artists.slice(0, 6);
  const heading = step === 1
    ? 'Pick what you love'
    : artists.length > 0
      ? `For fans of ${artists.slice(0, 2).join(' & ')}${artists.length > 2 ? ` +${artists.length - 2}` : ''}`
      : 'Your Home will look like this';

  return (
    <aside className="taste-preview" aria-hidden="true">
      <motion.div className="taste-preview-glow" style={{ '--preview-tint': accent } as CSSProperties} animate={reduced ? undefined : { scale: [1, 1.08, 1] }} transition={reduced ? undefined : { duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
      <div className="taste-preview-content">
        <span className="eyebrow eyebrow-accent taste-preview-eyebrow">Live preview</span>
        <h3>{heading}</h3>
        {shown.length > 0 ? (
          <div className="taste-preview-stack">
            {shown.map((name) => {
              const photo = faces[name.toLocaleLowerCase()];
              return (
                <span key={name} className="taste-preview-avatar" title={name}>
                  {photo ? <img src={photo} alt="" loading="lazy" /> : <span>{name.slice(0, 1)}</span>}
                </span>
              );
            })}
          </div>
        ) : null}
        <p className="taste-preview-stat">
          {artists.length} artist{artists.length === 1 ? '' : 's'} · {languages.length} language{languages.length === 1 ? '' : 's'} picked
        </p>
      </div>
    </aside>
  );
}
