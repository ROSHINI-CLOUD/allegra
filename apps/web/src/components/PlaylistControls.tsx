import { Check, Copy, ImagePlus, Link2, Trash2, Undo2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { shareLibrary, unshareLibrary } from '../lib/api';
import { motionTokens, spring } from '../motion';

const COVER_ACCEPT = 'image/jpeg,image/png,image/webp';
const COVER_MAX_BYTES = 2 * 1024 * 1024;

/* ---------- Share ---------- */

interface ShareButtonProps {
  readonly libraryId: string;
  readonly isPublic: boolean;
  /** Called after sharing is switched on or off, so the playlist list can refresh. */
  readonly onChanged: () => void;
}

function linkFor(code: string): string {
  return `${window.location.origin}${window.location.pathname}#shared/${code}`;
}

/**
 * Share a playlist by link. The link stays live: whatever the owner adds later shows up for everyone who has it.
 * Switching it off makes the link stop working straight away.
 */
export function ShareButton({ libraryId, isPublic, onChanged }: ShareButtonProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Opening the popover creates (or re-finds) the link, so sharing is one click.
  const openPopover = async (): Promise<void> => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError(null);
    setCopied(false);
    setBusy(true);
    try {
      const result = await shareLibrary(libraryId);
      setLink(linkFor(result.code));
      if (!isPublic) onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create a link.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy failed. Select the link and copy it yourself.');
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      await unshareLibrary(libraryId);
      setLink(null);
      setOpen(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not turn sharing off.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-control" ref={root}>
      <button type="button" className="btn-glass tactile-control" aria-expanded={open} onClick={() => void openPopover()}>
        <Link2 size={16} strokeWidth={1.8} aria-hidden="true" /><span>{isPublic ? 'Shared' : 'Share'}</span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="glass-sheet share-pop"
            role="dialog"
            aria-label="Share this playlist"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={reduced ? { duration: motionTokens.duration.instant } : spring.tactile}
          >
            <strong>Anyone with the link can listen</strong>
            <p>They can save a copy to their own library. Songs you add later show up for them too.</p>
            <div className="share-row">
              <input readOnly value={busy && !link ? 'Making your link…' : link ?? ''} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} />
              <button type="button" className="btn-primary tactile-control" onClick={() => void copy()} disabled={!link}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={copied ? 'done' : 'copy'} className="share-copy-label" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: motionTokens.duration.fast }}>
                    {copied ? <><Check size={15} aria-hidden="true" /> Copied</> : <><Copy size={15} aria-hidden="true" /> Copy</>}
                  </motion.span>
                </AnimatePresence>
              </button>
            </div>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <button type="button" className="share-stop" onClick={() => void stop()} disabled={busy || !link}>Stop sharing</button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ---------- Timed undo ---------- */

interface UndoDeleteProps {
  readonly label: string;
  readonly seconds?: number;
  readonly onConfirm: () => void;
}

/**
 * Delete that gives you a way out (Watermelon "Timed Undo Action"). Press it and the button turns into
 * "Undo" with a countdown; if the count reaches zero the delete goes through, and pressing again cancels it.
 */
export function UndoDelete({ label, seconds = 5, onConfirm }: UndoDeleteProps) {
  const reduced = useReducedMotion();
  const [left, setLeft] = useState<number | null>(null);
  const confirm = useRef(onConfirm);
  confirm.current = onConfirm;

  useEffect(() => {
    if (left === null) return undefined;
    if (left <= 0) {
      confirm.current();
      return undefined;
    }
    const timer = window.setTimeout(() => setLeft((value) => (value === null ? null : value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  const pending = left !== null;

  return (
    <motion.button
      type="button"
      layout={!reduced}
      className={`undo-delete ${pending ? 'is-pending' : ''}`}
      onClick={() => setLeft(pending ? null : seconds)}
      transition={reduced ? { duration: 0 } : spring.tactile}
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {pending ? (
          <motion.span key="undo" className="undo-delete-inner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: motionTokens.duration.fast }}>
            <Undo2 size={15} aria-hidden="true" /> Undo
            <span className="undo-delete-count" aria-label={`${left} seconds left`}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={left} initial={{ opacity: 0, y: -10, scale: 0.6 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.6 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>{left}</motion.span>
              </AnimatePresence>
            </span>
          </motion.span>
        ) : (
          <motion.span key="delete" className="undo-delete-inner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: motionTokens.duration.fast }}>
            <Trash2 size={15} aria-hidden="true" /> {label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/* ---------- Change cover ---------- */

interface ChangeCoverProps {
  readonly libraryId: string;
  readonly coverUrl?: string;
  readonly onUpload: (libraryId: string, file: File, onProgress?: (ratio: number) => void) => Promise<unknown>;
}

/**
 * Glass popover to replace a playlist's mosaic with a custom cover (S3 via
 * presigned PUT). File picker + drag-drop, progress bar, and an error state.
 */
export function ChangeCoverButton({ libraryId, coverUrl, onUpload }: ChangeCoverProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent): void => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const runUpload = async (file: File): Promise<void> => {
    if (!COVER_ACCEPT.split(',').includes(file.type)) {
      setError('Use a JPEG, PNG or WebP image.');
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      setError('Covers must be under 2 MB.');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const saved = await onUpload(libraryId, file, setProgress);
      if (!saved) {
        setError('That cover could not be saved.');
        return;
      }
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That cover could not be saved.');
    } finally {
      setBusy(false);
      setProgress(0);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="share-control cover-control" ref={root}>
      <button type="button" className="btn-glass tactile-control" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ImagePlus size={16} strokeWidth={1.8} aria-hidden="true" /><span>{coverUrl ? 'Change cover' : 'Add cover'}</span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            className="glass-sheet share-pop cover-pop"
            role="dialog"
            aria-label="Change playlist cover"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={reduced ? { duration: motionTokens.duration.instant } : spring.tactile }
          >
            <strong>{coverUrl ? 'Replace the cover' : 'Add a cover'}</strong>
            <p>JPEG, PNG or WebP · under 2 MB. Uploads go straight to storage — we never keep the file on the API.</p>
            {coverUrl ? (
              <div className="cover-pop-preview" aria-hidden="true">
                <img src={coverUrl} alt="" />
              </div>
            ) : null}
            <label
              className={`cover-drop ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) void runUpload(file);
              }}
            >
              <input
                ref={input}
                type="file"
                accept={COVER_ACCEPT}
                disabled={busy}
                aria-label="Choose a cover image"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void runUpload(file);
                }}
              />
              <span>{busy ? 'Uploading…' : dragging ? 'Drop it here' : 'Drop an image, or click to choose'}</span>
              {busy ? (
                <span className="cover-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                  <span style={{ transform: `scaleX(${Math.max(0.04, progress)})` }} />
                </span>
              ) : null}
            </label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The owner's controls on a playlist: cover, share by link, and delete with a way back. */
export function PlaylistControls({
  share,
  onDelete,
  cover
}: {
  readonly share?: ShareButtonProps;
  readonly onDelete?: () => void;
  readonly cover?: ChangeCoverProps;
}) {
  return (
    <>
      {cover ? <ChangeCoverButton {...cover} /> : null}
      {share ? <ShareButton {...share} /> : null}
      {onDelete ? <UndoDelete label="Delete" onConfirm={onDelete} /> : null}
    </>
  );
}
