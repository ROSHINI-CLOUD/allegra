import { LogOut, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';

import { FloatingField } from './ui';
import type { AccountApi } from '../hooks/useAccount';
import { motionTokens, spring } from '../motion';

export type AuthMode = 'signUp' | 'signIn';

interface AuthDialogProps {
  readonly open: boolean;
  readonly mode: AuthMode;
  readonly account: AccountApi;
  readonly onModeChange: (mode: AuthMode) => void;
  readonly onClose: () => void;
}

const MODES: readonly { readonly id: AuthMode; readonly label: string }[] = [
  { id: 'signUp', label: 'Create account' },
  { id: 'signIn', label: 'Sign in' }
];

/**
 * Sign up / sign in, and once signed in the account panel. Fields use Watermelon's floating-label input.
 * Creating an account converts the current guest session, so nothing already liked or built is lost.
 */
export function AuthDialog({ open, mode, account, onModeChange, onClose }: AuthDialogProps) {
  const reduced = useReducedMotion();
  const { profile } = account;
  const signedIn = profile !== null && !profile.isGuest;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState('');
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setBusy(false);
    setPassword('');
    setEditingName(profile?.displayName ?? '');
    const timer = window.setTimeout(() => firstField.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open, mode, profile?.displayName]);

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

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signUp') await account.signUp({ email, password, ...(name.trim() ? { displayName: name.trim() } : {}) });
      else await account.signIn({ email, password });
      setPassword('');
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Try again.');
    } finally {
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
      await account.signOut();
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
            aria-label={signedIn ? 'Your account' : mode === 'signUp' ? 'Create an account' : 'Sign in'}
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
                <div className="auth-tabs" role="tablist" aria-label="Account">
                  {MODES.map((item) => (
                    <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className="auth-tab" onClick={() => onModeChange(item.id)}>
                      {mode === item.id ? <motion.span layoutId="auth-tab-pill" className="auth-tab-pill" transition={reduced ? { duration: 0 } : spring.tactile} /> : null}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
                <h2>{mode === 'signUp' ? 'Keep your music' : 'Welcome back'}</h2>
                <p className="auth-lede">
                  {mode === 'signUp'
                    ? 'Make an account and everything you have liked, every playlist and your taste comes with you, on any device.'
                    : 'Sign in and whatever you played as a guest on this device joins your library.'}
                </p>
                <form className="auth-form" onSubmit={(event) => void submit(event)}>
                  {mode === 'signUp' ? <FloatingField ref={firstField} label="Your name" autoComplete="name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} /> : null}
                  <FloatingField ref={mode === 'signIn' ? firstField : undefined} label="Email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
                  <FloatingField label="Password" type="password" autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'} required minLength={mode === 'signUp' ? 8 : 1} value={password} onChange={(event) => setPassword(event.target.value)} />
                  {mode === 'signUp' ? <p className="auth-hint">At least 8 characters.</p> : null}
                  {error ? <p className="auth-error" role="alert">{error}</p> : null}
                  <button type="submit" className="btn-primary tactile-control auth-submit" disabled={busy}>{busy ? 'One moment…' : mode === 'signUp' ? 'Create account' : 'Sign in'}</button>
                </form>
              </div>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
