/**
 * Google sign-in for the Allegra account, the React Native way.
 *
 * 1. `signIn('google', { redirectTo })` asks Convex Auth for Google's URL.
 * 2. An in-app browser opens it; Google comes back through Convex Auth to
 *    `lyricflow://auth?code=…` (allowed by convex/authRedirect.ts on the server).
 * 3. `signIn('google', { code })` trades the code for a session.
 *
 * The steps are injected so this runs in a test without a browser or a server.
 */
export const MOBILE_AUTH_REDIRECT = 'lyricflow://auth';

export type SignInOutcome = 'signed-in' | 'cancelled' | 'failed';

type SignIn = (
  provider: string,
  params: { redirectTo?: string; code?: string },
) => Promise<{ signingIn: boolean; redirect?: URL }>;

/** `WebBrowser.openAuthSessionAsync`'s result, narrowed to what we read. */
export type AuthSessionResult = { type: 'success'; url: string } | { type: string };

type OpenAuthSession = (url: string, returnUrl: string) => Promise<AuthSessionResult>;

/** The `code` query param, without relying on a URL polyfill. */
export const codeFrom = (url: string): string | null => {
  const match = url.match(/[?&]code=([^&#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
};

export const runGoogleSignIn = async (signIn: SignIn, openAuthSession: OpenAuthSession): Promise<SignInOutcome> => {
  try {
    const started = await signIn('google', { redirectTo: MOBILE_AUTH_REDIRECT });
    if (!started.redirect) return started.signingIn ? 'signed-in' : 'failed';
    const result = await openAuthSession(started.redirect.toString(), MOBILE_AUTH_REDIRECT);
    if (result.type !== 'success' || !('url' in result)) return 'cancelled';
    const code = codeFrom(result.url);
    if (!code) return 'failed';
    const finished = await signIn('google', { code });
    return finished.signingIn ? 'signed-in' : 'failed';
  } catch {
    return 'failed';
  }
};

/** What the listener reads for each outcome. Sentence case, no raw errors. */
export const signInMessage: Record<Exclude<SignInOutcome, 'signed-in'>, string> = {
  cancelled: 'Sign-in was cancelled.',
  failed: "Couldn't sign in. Check your connection and try again.",
};
