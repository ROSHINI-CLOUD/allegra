/**
 * The Allegra account on the phone: Google sign-in through Convex Auth, the same
 * identity as allegravibe.vercel.app. Optional — nothing in the app needs it; it
 * unlocks Connect and library sync (.planning/connect-and-sync/PLAN.md).
 *
 * Components read it through `useAccount()` and never import a Convex hook, so
 * the provider can change without touching them (the web's SignInContext does
 * the same).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider, useAuthActions, useAuthToken } from '@convex-dev/auth/react';
import * as WebBrowser from 'expo-web-browser';

import { getAccountProfile, type AccountProfile } from './allegraApi';
import { ALLEGRA_CONVEX_URL } from './config';
import { secureStorage } from './secureStorage';
import { runGoogleSignIn, type SignInOutcome } from './signInFlow';
import { attach, detach } from '../sync/LibrarySync';
import { useOnlineLibraryStore } from '../../store/onlineLibraryStore';

/** One client for the app's lifetime: a re-render must never reconnect. */
export const allegraConvex = new ConvexReactClient(ALLEGRA_CONVEX_URL, { unsavedChangesWarning: false });

export interface AccountApi {
  /** True while Convex Auth is still reading the stored session. */
  readonly loading: boolean;
  readonly signedIn: boolean;
  /** The Convex Auth JWT, for `Authorization: Bearer` on Allegra API calls. */
  readonly token: string | null;
  /** Name and email from Allegra, once fetched. Null offline or signed out. */
  readonly profile: AccountProfile | null;
  readonly signInWithGoogle: () => Promise<SignInOutcome>;
  readonly signOut: () => Promise<void>;
}

const SIGNED_OUT: AccountApi = {
  loading: false,
  signedIn: false,
  token: null,
  profile: null,
  signInWithGoogle: async () => 'failed',
  signOut: async () => undefined,
};

const AccountContext = createContext<AccountApi>(SIGNED_OUT);

export const useAccount = (): AccountApi => useContext(AccountContext);

export const AccountProvider: React.FC<{ children: ReactNode }> = ({ children }) => (
  // shouldHandleCode: there is no window URL in React Native; signInFlow hands the code over itself.
  <ConvexAuthProvider client={allegraConvex} storage={secureStorage} shouldHandleCode={false}>
    <AccountBridge>{children}</AccountBridge>
  </ConvexAuthProvider>
);

const AccountBridge: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { signIn, signOut } = useAuthActions();
  const token = useAuthToken();
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  // The engine asks for the token each time it calls the API: Convex Auth refreshes it.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token ?? null;

  useEffect(() => {
    useOnlineLibraryStore.getState().load();
  }, []);

  // Library sync runs while signed in, once we know which account this is.
  const userId = token ? profile?.userId : undefined;
  useEffect(() => {
    if (token === undefined) return; // still reading the stored session
    if (!userId) {
      if (token === null) detach();
      return;
    }
    attach({ userId, getToken: () => tokenRef.current }, allegraConvex).catch(() => undefined);
  }, [token, userId]);


  useEffect(() => {
    if (!token) {
      setProfile(null);
      return;
    }
    let current = true;
    getAccountProfile(token).then(found => {
      if (current) setProfile(found);
    });
    return () => {
      current = false;
    };
  }, [token]);

  const signInWithGoogle = useCallback(
    () => runGoogleSignIn(signIn, (url, returnUrl) => WebBrowser.openAuthSessionAsync(url, returnUrl)),
    [signIn],
  );

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } finally {
      setProfile(null);
    }
  }, [signOut]);

  const value = useMemo<AccountApi>(
    () => ({
      loading: token === undefined,
      signedIn: Boolean(token),
      token: token ?? null,
      profile,
      signInWithGoogle,
      signOut: handleSignOut,
    }),
    [token, profile, signInWithGoogle, handleSignOut],
  );

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
};
