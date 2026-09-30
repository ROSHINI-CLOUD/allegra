/**
 * Settings → Allegra account: sign in with the same Google account as
 * allegravibe.vercel.app. Optional; it is what lets this phone and the website
 * see and control each other (Connect) and share likes and playlists.
 */
import React, { useState } from 'react';
import { LayoutChangeEvent } from 'react-native';

import { useAccount } from '../../services/account/AccountProvider';
import { signInMessage } from '../../services/account/signInFlow';
import * as Haptics from '../../utils/haptics';
import { Action, Row, Section } from './SettingsKit';

export const AllegraAccountSettings: React.FC<{ onLayout?: (e: LayoutChangeEvent) => void; onNotice: (text: string) => void }> = ({
  onLayout,
  onNotice,
}) => {
  const account = useAccount();
  const [busy, setBusy] = useState(false);

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

  const who = account.profile?.displayName || account.profile?.email;

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
          <Action label="Sign out" destructive onPress={signOut} />
        </>
      ) : (
        <Action
          label={busy ? 'Opening Google' : 'Sign in with Google'}
          hint="Optional. Everything else works without an account."
          onPress={signIn}
        />
      )}
    </Section>
  );
};

export default AllegraAccountSettings;
