import { Guitar, Mic, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, type CSSProperties, type RefObject } from 'react';

import type { LiveKaraokeController } from '../hooks/useLiveKaraoke';
import { DEFAULT_KARAOKE_MIX, type KaraokeMix } from '../lib/karaokeMix';
import { motionTokens } from '../motion';

interface KaraokeMixSheetProps {
  readonly open: boolean;
  readonly karaoke: LiveKaraokeController;
  readonly onClose: () => void;
  /** The control that opened the sheet; focus goes back to it on close. */
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

const PRESETS: readonly { readonly label: string; readonly mix: KaraokeMix }[] = [
  { label: 'Karaoke', mix: DEFAULT_KARAOKE_MIX },
  { label: 'Guide vocal', mix: { vocals: 0.25, instruments: 1 } },
  { label: 'Vocals only', mix: { vocals: 1, instruments: 0 } },
  { label: 'Original', mix: { vocals: 1, instruments: 1 } }
];

function sameMix(a: KaraokeMix, b: KaraokeMix): boolean {
  return Math.abs(a.vocals - b.vocals) < 0.005 && Math.abs(a.instruments - b.instruments) < 0.005;
}

/**
 * Two faders over the two stems the on-device model separates. Opened by double-tapping
 * any Karaoke button (or its sliders button). The levels are a saved preference, so they
 * can be set before karaoke starts; they only sound where there are real stems to mix.
 */
export function KaraokeMixSheet({ open, karaoke, onClose, returnFocusRef }: KaraokeMixSheetProps) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const returnTo = returnFocusRef.current;
    // The first fader, or the close button when the faders are locked (a disabled input can't take focus).
    const frame = window.requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true })
    );
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The player sheet also closes on Escape; this one goes first and alone.
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      // A tap on the opener is its own gesture (it may be the second half of a double tap).
      if (returnTo?.contains(target)) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [open, returnFocusRef]);

  const { mix, setMix, supportsMix, active, busy, basicByChoice, backend } = karaoke;
  const basic = active && backend === 'midside';
  const locked = basic;

  let note: string;
  if (basicByChoice) note = 'Basic mode is on in Settings. It removes vocals without separating them, so there is nothing to mix. Set Karaoke to Auto to use these sliders.';
  else if (basic) note = 'The on-device AI model isn’t running here, so vocals and instruments aren’t separated. These levels apply whenever the AI model runs.';
  else if (busy) note = 'Applies as soon as the separated track is ready.';
  else if (!active) note = 'Saved for next time. Turn Karaoke on to hear it.';
  else if (supportsMix) note = 'Separated on this device. Nothing is uploaded.';
  else note = 'Applies as soon as the separated track is ready.';

  const fader = (key: keyof KaraokeMix, label: string, icon: typeof Mic) => {
    const Icon = icon;
    const percent = Math.round(mix[key] * 100);
    return (
      <label className="karaoke-mix__fader">
        <span className="karaoke-mix__label">
          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
          <output className="karaoke-mix__value">{percent}%</output>
        </span>
        <input
          type="range"
          className="karaoke-mix__range"
          min={0}
          max={100}
          step={1}
          value={percent}
          disabled={locked}
          aria-valuetext={`${percent} percent`}
          style={{ '--level': `${percent}%` } as CSSProperties}
          onChange={(event) => setMix({ ...mix, [key]: Number(event.target.value) / 100 })}
        />
      </label>
    );
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="karaoke-mix"
          ref={rootRef}
          className="karaoke-mix"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
          transition={{
            duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base,
            ease: motionTokens.ease.decelerate
          }}
        >
          <div className="karaoke-mix__head">
            <h3 id={titleId}>Karaoke mix</h3>
            <button type="button" className="karaoke-mix__close" onClick={onClose} aria-label="Close karaoke mix">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {fader('vocals', 'Vocals', Mic)}
          {fader('instruments', 'Bass & instruments', Guitar)}
          <div className="karaoke-mix__presets" role="group" aria-label="Mix presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="karaoke-mix__preset"
                aria-pressed={sameMix(mix, preset.mix)}
                disabled={locked}
                onClick={() => setMix(preset.mix)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="karaoke-mix__note">{note}</p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
