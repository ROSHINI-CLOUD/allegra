'use client';

import { ConvexAuthProvider, useAuthActions, useAuthToken } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { SignInContext, type SignInApi } from '../src/auth/SignInContext';
import { linkGuestSession, setAccountToken } from '../src/lib/api';

// One client per tab. Built at module scope so a re-render never reconnects.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = convexUrl ? new ConvexReactClient(convexUrl) : null;

/**
 * Wires Convex Auth into the app when a deployment is configured, and gets out of
 * the way when one is not. Without this the whole UI would depend on Convex being
 * reachable just to listen to music as a guest.
 */
export function ConvexSignInProvider({ children }: { readonly children: ReactNode }) {
  if (!client) return <>{children}</>;
  return (
    <ConvexAuthProvider client={client}>
      <SignInBridge>{children}</SignInBridge>
    </ConvexAuthProvider>
  );
}

function SignInBridge({ children }: { readonly children: ReactNode }) {
  const { signIn, signOut } = useAuthActions();
  const token = useAuthToken();
  // undefined means "still deciding"; null means signed out.
  const loading = token === undefined;
  const signedIn = Boolean(token);
  const [linked, setLinked] = useState(false);

  // Every API call carries the Convex token once signed in, so the server sees the
  // account rather than the guest this browser started as.
  useEffect(() => {
    setAccountToken(token ?? null);
  }, [token]);

  // Right after the first sign-in, hand the old guest token over once so the likes
  // and playlists made before signing in follow the listener into their account.
  useEffect(() => {
    if (!signedIn || linked) return;
    setLinked(true);
    void linkGuestSession();
  }, [signedIn, linked]);

  const signInWithGoogle = useCallback(async () => {
    await signIn('google');
  }, [signIn]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    setAccountToken(null);
    setLinked(false);
  }, [signOut]);

  const value = useMemo<SignInApi>(
    () => ({ available: true, signedIn, loading, signInWithGoogle, signOut: handleSignOut }),
    [signedIn, loading, signInWithGoogle, handleSignOut]
  );

  return <SignInContext.Provider value={value}>{children}</SignInContext.Provider>;
}
