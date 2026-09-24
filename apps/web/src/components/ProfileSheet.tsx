import { LogOut } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { AccountProfile } from '@shared/types';

import { FloatingField } from './ui';

interface ProfileSheetProps {
  readonly profile: AccountProfile;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSaveName: (displayName: string) => Promise<void>;
  readonly onSignOut: () => Promise<void>;
}

/**
 * Signed-in account panel: frosted sheet body with avatar, display name, and email.
 * Inspired by edit-profile patterns; fields kept to what Allegra actually needs.
 */
export function ProfileSheet({ profile, busy, error, onSaveName, onSignOut }: ProfileSheetProps) {
  const [editingName, setEditingName] = useState(profile.displayName ?? '');
  const firstField = useRef<HTMLInputElement | null>(null);
  const initial = (profile.displayName ?? profile.email ?? 'A').slice(0, 1).toUpperCase();

  useEffect(() => {
    setEditingName(profile.displayName ?? '');
  }, [profile.displayName]);

  useEffect(() => {
    const timer = window.setTimeout(() => firstField.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, []);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await onSaveName(editingName);
  };

  const unchanged = editingName.trim() === (profile.displayName ?? '');

  return (
    <div className="profile-sheet">
      <div className="profile-sheet__hero">
        <div className="profile-sheet__avatar" aria-hidden="true">
          {initial}
        </div>
        <div className="profile-sheet__intro">
          <span className="profile-sheet__eyebrow">Your listening room</span>
          <h2>{profile.displayName ?? 'Your account'}</h2>
          {profile.email ? <p className="profile-sheet__email">{profile.email}</p> : null}
        </div>
      </div>

      <form className="profile-sheet__form" onSubmit={(event) => void save(event)}>
        <FloatingField
          ref={firstField}
          label="Display name"
          value={editingName}
          maxLength={60}
          onChange={(event) => setEditingName(event.target.value)}
        />
        <button type="submit" className="btn-primary tactile-control profile-sheet__save" disabled={busy || unchanged}>
          Save name
        </button>
      </form>

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="button" className="profile-sheet__signout" onClick={() => void onSignOut()} disabled={busy}>
        <LogOut size={15} aria-hidden="true" /> Sign out
      </button>
    </div>
  );
}
