'use client';

import { createContext, useContext } from 'react';

export interface SignInApi {
  /** False when no Convex deployment is configured — the app then runs guest-only. */
  readonly available: boolean;
  readonly signedIn: boolean;
  /** True while Convex is still working out whether there is a session. */
  readonly loading: boolean;
  readonly signInWithGoogle: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const GUEST_ONLY: SignInApi = {
  available: false,
  signedIn: false,
  loading: false,
  signInWithGoogle: async () => undefined,
  signOut: async () => undefined
};

/**
 * Sign-in as the app sees it. Convex Auth lives behind this on purpose: the player
 * never imports a Convex hook, so the whole UI still renders (guest-only) when no
 * deployment is configured, and swapping the identity provider touches one file.
 */
export const SignInContext = createContext<SignInApi>(GUEST_ONLY);

export function useSignIn(): SignInApi {
  return useContext(SignInContext);
}
