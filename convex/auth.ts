import Google from '@auth/core/providers/google';
import { convexAuth } from '@convex-dev/auth/server';

/**
 * Sign-in lives in Convex, not in our API.
 *
 * Convex issues the session JWT and publishes its public keys, which is what lets
 * the Express API verify a caller without ever holding a Google secret. The
 * provider reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the Convex deployment's
 * environment; until those are set, sign-in fails but everything else (guest
 * listening, search, playback) keeps working.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google]
});
