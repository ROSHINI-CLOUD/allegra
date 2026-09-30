'use client';

import { ConvexAuthProvider, useAuthActions, useAuthToken } from '@convex-dev/auth/react';
import { ConvexReactClient, useQuery } from 'convex/react';
import { makeFunctionReference } from 'convex/server';
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { SignInContext, type SignInApi } from '../src/auth/SignInContext';
import { linkGuestSession, setAccountToken } from '../src/lib/api';

/** convex/library.ts myRev: the signed-in listener's newest library revision (null signed out). */
const libraryRevision = makeFunctionReference<'query', Record<string, never>, number | null>('library:myRev');

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
  // account rather than the guest this browser started as. Set during render, not in
  // an effect: accountToken is a plain module variable a child's effect (useAccount's
  // sign-in-triggered refresh) can run before a parent's effect does, so an effect
  // here would race that refresh and still hand it the stale guest token.
  setAccountToken(token ?? null);

  // Right after the first sign-in, hand the old guest token over once so the likes
  // and playlists made before signing in follow the listener into their account.
  useEffect(() => {
    if (!signedIn || linked) return;
    setLinked(true);
    void linkGuestSession().finally(() => {
      window.dispatchEvent(new CustomEvent('allegra:account'));
    });
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

  return (
    <SignInContext.Provider value={value}>
      {signedIn ? (
        <QuietBoundary>
          <LibraryRevisionWatcher />
        </QuietBoundary>
      ) : null}
      {children}
    </SignInContext.Provider>
  );
}

/**
 * Likes and playlists changed on another device (the phone): tell the app to reload them. The
 * subscription costs nothing until the revision actually moves.
 */
function LibraryRevisionWatcher(): null {
  const libraryRev = useQuery(libraryRevision, {});
  const seenRev = useRef<number | null>(null);
  useEffect(() => {
    if (typeof libraryRev !== 'number') return;
    if (seenRev.current !== null && seenRev.current !== libraryRev) window.dispatchEvent(new CustomEvent('allegra:library'));
    seenRev.current = libraryRev;
  }, [libraryRev]);
  return null;
}

/** useQuery throws when the query fails (e.g. Convex not yet deployed): lose live refresh, never the page. */
class QuietBoundary extends Component<{ readonly children: ReactNode }, { readonly failed: boolean }> {
  public override state = { failed: false };

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  public override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
