import { LogOut, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';

import { useSignIn } from '../auth/SignInContext';
import type { AccountApi } from '../hooks/useAccount';
import { motionTokens, spring } from '../motion';
import { FloatingField } from './ui';

interface AuthDialogProps {
  readonly open: boolean;
  readonly account: AccountApi;
  readonly onClose: () => void;
}

/** Google's mark, inlined so the button never waits on a third-party request. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Sign in, and once signed in the account panel.
 *
 * Google is the only way in: Convex Auth owns the credentials, so this app never
 * holds a password. Whatever was liked or built as a guest follows the listener in.
 */
export function AuthDialog({ open, account, onClose }: AuthDialogProps) {
  const reduced = useReducedMotion();
  const signIn = useSignIn();
  const { profile } = account;
  const signedIn = profile !== null && !profile.isGuest;

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState('');
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setBusy(false);
    setEditingName(profile?.displayName ?? '');
    const timer = window.setTimeout(() => firstField.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, profile?.displayName]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const root = document.documentElement;
    const body = document.body;
    const previous = {
      rootOverflow: root.style.overflow,
      bodyOverflow: body.style.overflow,
      rootOverscroll: root.style.overscrollBehavior,
      bodyOverscroll: body.style.overscrollBehavior
    };
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

  const startGoogle = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn.signInWithGoogle();
      // The redirect back from Google re-mounts the app, so there is nothing to
      // close here on success; only a failure returns to this dialog.
    } catch {
      setError('Google sign-in did not complete. Try again.');
      setBusy(false);
    }
  };

  const saveName = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await account.rename(editingName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save that name.');
    } finally {
      setBusy(false);
    }
  };

  const leave = async (): Promise<void> => {
    setBusy(true);
    try {
      await signIn.signOut();
      await account.startGuest();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  const enter = reduced ? { duration: motionTokens.duration.instant } : spring.sheet;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="cmdk-layer auth-layer" key="auth">
          <motion.div className="cmdk-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.duration.base }} onClick={onClose} />
          <motion.div
            className="glass-sheet auth-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={signedIn ? 'Your account' : 'Sign in'}
            initial={{ opacity: 0, y: 22, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.975 }}
            style={{ transformOrigin: 'top center' }}
            transition={enter}
          >
            <button type="button" className="sheet-close" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>

            {signedIn ? (
              <div className="auth-body">
                <div className="auth-avatar" aria-hidden="true">{(profile.displayName ?? profile.email ?? 'A').slice(0, 1).toUpperCase()}</div>
                <h2>{profile.displayName ?? 'Your account'}</h2>
                <p className="auth-lede">{profile.email}</p>
                <form className="auth-form" onSubmit={(event) => void saveName(event)}>
                  <FloatingField ref={firstField} label="Display name" value={editingName} maxLength={60} onChange={(event) => setEditingName(event.target.value)} />
                  <button type="submit" className="btn-glass tactile-control auth-submit" disabled={busy || editingName.trim() === (profile.displayName ?? '')}>Save name</button>
                </form>
                {error ? <p className="auth-error" role="alert">{error}</p> : null}
                <button type="button" className="auth-signout" onClick={() => void leave()} disabled={busy}><LogOut size={15} aria-hidden="true" /> Sign out</button>
              </div>
            ) : (
              <div className="auth-body">
                <h2>Keep your music</h2>
                <p className="auth-lede">
                  Sign in and everything you have liked, every playlist and your taste comes with you, on any device.
                  What you played as a guest on this device joins your library.
                </p>
                {signIn.available ? (
                  <>
                    <button
                      type="button"
                      className="btn-glass tactile-control auth-google"
                      onClick={() => void startGoogle()}
                      disabled={busy || signIn.loading}
                    >
                      <GoogleMark />
                      <span>{busy ? 'Taking you to Google…' : 'Continue with Google'}</span>
                    </button>
                    {error ? <p className="auth-error" role="alert">{error}</p> : null}
                    <p className="auth-hint">You can keep listening as a guest — nothing is lost either way.</p>
                  </>
                ) : (
                  <p className="auth-hint">
                    Accounts are not switched on for this deployment yet. Everything still works as a guest on
                    this device.
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
