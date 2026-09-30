/**
 * Where the Allegra account lives. Release builds talk to production — the same
 * Convex deployment and API the website at allegravibe.vercel.app uses, so a
 * Google sign-in here is the same listener as on the web.
 *
 * A dev build can point at a dev deployment and a local API instead:
 *   EXPO_PUBLIC_ALLEGRA_CONVEX_URL=https://charming-jaguar-140.convex.cloud
 *   EXPO_PUBLIC_ALLEGRA_API_URL=http://<laptop LAN IP>:8080
 * (the phone cannot reach the laptop's `localhost`).
 */
const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export const ALLEGRA_CONVEX_URL = trimSlash(
  process.env.EXPO_PUBLIC_ALLEGRA_CONVEX_URL || 'https://neighborly-ocelot-786.convex.cloud',
);

export const ALLEGRA_API_URL = trimSlash(process.env.EXPO_PUBLIC_ALLEGRA_API_URL || 'https://allegravibe.vercel.app');
