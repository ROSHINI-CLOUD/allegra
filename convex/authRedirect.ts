/**
 * Where Convex Auth may send a listener after Google sign-in.
 *
 * Without a `redirect` callback Convex Auth only allows paths and URLs under
 * SITE_URL (the website). LuvLyrics signs in through the same Google flow and
 * needs to land back in the app, on its `lyricflow://auth` deep link. Anything
 * else is refused: an open redirect would hand a session code to any site.
 *
 * Pure, so it is tested without a deployment (tests/convex/authRedirect.test.ts).
 */

/** The phone app's sign-in return link (app.json `scheme` + the `auth` path). */
export const MOBILE_AUTH_REDIRECT = 'lyricflow://auth';

export function allowedAuthRedirect(redirectTo: string, siteUrl: string | undefined): string {
  if (redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
    if (!siteUrl) throw new Error('SITE_URL is not set');
    return `${siteUrl.replace(/\/+$/, '')}${redirectTo}`;
  }
  if (redirectTo.startsWith('?')) {
    if (!siteUrl) throw new Error('SITE_URL is not set');
    return `${siteUrl.replace(/\/+$/, '')}/${redirectTo}`;
  }
  if (siteUrl && isUnder(redirectTo, siteUrl)) return redirectTo;
  if (redirectTo === MOBILE_AUTH_REDIRECT || redirectTo.startsWith(`${MOBILE_AUTH_REDIRECT}?`)) return redirectTo;
  throw new Error(`Invalid redirectTo: ${redirectTo}`);
}

function isUnder(url: string, base: string): boolean {
  const root = base.replace(/\/+$/, '');
  return url === root || url.startsWith(`${root}/`) || url.startsWith(`${root}?`);
}
