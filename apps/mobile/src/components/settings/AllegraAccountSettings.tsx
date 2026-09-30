/**
 * Settings → Allegra account: sign in with the same Google account as
 * allegravibe.vercel.app. Optional; it is what lets this phone and the website
 * see and control each other (Connect) and share likes and playlists.
 *
 * A phone that already has likes or playlists asks once, after signing in, how to
 * bring the two libraries together (services/sync/LibrarySync `choose`). Nothing
 * syncs until that is answered.
 */
import React, { useState } from 'react';
import { LayoutChangeEvent } from 'react-native';

import { useAccount } from '../../services/account/AccountProvider';
import { signInMessage } from '../../services/account/signInFlow';
import { choose } from '../../services/sync/LibrarySync';
import type { FirstSyncChoice } from '../../services/sync/plan';
import { useSyncStore } from '../../store/syncStore';
import * as Haptics from '../../utils/haptics';
import { ModernDeleteModal } from '../ModernDeleteModal';
import { Action, Row, Section } from './SettingsKit';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const AllegraAccountSettings: React.FC<{ onLayout?: (e: LayoutChangeEvent) => void; onNotice: (text: string) => void }> = ({
  onLayout,
  onNotice,
}) => {
  const account = useAccount();
  const question = useSyncStore(state => state.question);
  const syncing = useSyncStore(state => state.syncing);
  const lastSyncedAt = useSyncStore(state => state.lastSyncedAt);
  const [busy, setBusy] = useState(false);
  const [confirmPhone, setConfirmPhone] = useState(false);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    Haptics.selectionAsync();
    const outcome = await account.signInWithGoogle();
    setBusy(false);
    if (outcome === 'signed-in') onNotice('Signed in to Allegra');
    else onNotice(signInMessage[outcome]);
  };

  const signOut = async () => {
    setBusy(true);
    await account.signOut();
    setBusy(false);
    onNotice('Signed out of Allegra');
  };

  const pick = async (choice: FirstSyncChoice) => {
    if (busy) return;
    setBusy(true);
    Haptics.selectionAsync();
    const done = await choose(choice);
    setBusy(false);
    onNotice(done ? 'Your library is syncing' : "Couldn't reach Allegra. Check your connection and try again.");
  };

  const who = account.profile?.displayName || account.profile?.email;
  const syncHint = syncing
    ? 'Syncing now'
    : lastSyncedAt
      ? `Last synced at ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'Likes and playlists stay the same here and on the website';

  return (
    <Section
      icon="person-circle-outline"
      title="Allegra account"
      lead="Use this phone and allegravibe.vercel.app as one: same account, and each can play or control the other."
      onLayout={onLayout}
    >
      {account.loading ? (
        <Row label="Checking your account" />
      ) : account.signedIn ? (
        <>
          <Row label={who ? `Signed in as ${who}` : 'Signed in'} hint={account.profile?.email && who !== account.profile.email ? account.profile.email : undefined} />
          {question ? (
            <>
              <Row
                label="Choose how to sync your library"
                hint={`${count(question.phoneLikes, 'liked song', 'liked songs')} and ${count(question.phonePlaylists, 'playlist', 'playlists')} on this phone. Nothing syncs until you choose. Downloads are never deleted.`}
                stack
              />
              <Action label={busy ? 'Syncing' : 'Merge both'} hint="Recommended. Everything from this phone and your account, in both places." onPress={() => pick('merge')} />
              <Action label="Use my account's library" hint="This phone's likes and playlists are replaced by your account's." onPress={() => pick('account')} />
              <Action label="Use this phone's library" hint="Your account's likes and playlists are replaced by this phone's, on the website too." destructive onPress={() => setConfirmPhone(true)} />
            </>
          ) : (
            <Row label="Library sync" hint={syncHint} />
          )}
          <Action label="Sign out" destructive onPress={signOut} />
        </>
      ) : (
        <Action
          label={busy ? 'Opening Google' : 'Sign in with Google'}
          hint="Optional. Everything else works without an account."
          onPress={signIn}
        />
      )}
      <ModernDeleteModal
        visible={confirmPhone}
        title="Replace your account's library?"
        message="Likes and playlists in your account that aren't on this phone will be removed, on the website too. Downloads stay."
        confirmText="Replace"
        onConfirm={() => {
          setConfirmPhone(false);
          pick('phone');
        }}
        onCancel={() => setConfirmPhone(false)}
      />
    </Section>
  );
};

export default AllegraAccountSettings;
