/**
 * The app's URL space, in one place. The shell reads the pathname through
 * parseRoute; everything that navigates builds its href through `paths`.
 */
export type AppView = 'home' | 'discover' | 'library' | 'album' | 'artist' | 'playlist' | 'liked' | 'shared' | 'settings';

export interface Route {
  readonly view: AppView;
  readonly artistName: string | null;
  readonly playlistId: string | null;
  readonly sharedCode: string | null;
}

export const paths = {
  home: '/',
  discover: '/discover',
  library: '/library',
  liked: '/liked',
  album: '/album',
  settings: '/settings',
  artist: (name: string): string => `/artist/${encodeURIComponent(name)}`,
  playlist: (id: string): string => `/playlist/${encodeURIComponent(id)}`,
  shared: (code: string): string => `/shared/${encodeURIComponent(code)}`
} as const;

const NO_PARAMS: Omit<Route, 'view'> = { artistName: null, playlistId: null, sharedCode: null };

function decode(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment).trim() || null;
  } catch {
    return null;
  }
}

export function parseRoute(pathname: string): Route {
  const [first, second] = pathname.split('/').filter(Boolean);
  switch (first) {
    case 'discover':
      return { view: 'discover', ...NO_PARAMS };
    case 'library':
      return { view: 'library', ...NO_PARAMS };
    case 'liked':
      return { view: 'liked', ...NO_PARAMS };
    case 'album':
      return { view: 'album', ...NO_PARAMS };
    case 'settings':
      return { view: 'settings', ...NO_PARAMS };
    case 'artist': {
      const artistName = decode(second);
      return artistName ? { view: 'artist', ...NO_PARAMS, artistName } : { view: 'home', ...NO_PARAMS };
    }
    case 'playlist': {
      const playlistId = decode(second);
      return playlistId ? { view: 'playlist', ...NO_PARAMS, playlistId } : { view: 'library', ...NO_PARAMS };
    }
    case 'shared': {
      const sharedCode = decode(second)?.toLowerCase() ?? null;
      return sharedCode ? { view: 'shared', ...NO_PARAMS, sharedCode } : { view: 'home', ...NO_PARAMS };
    }
    default:
      return { view: 'home', ...NO_PARAMS };
  }
}

/** Links shared before the move to real URLs (`/#shared/abc`, `/#artist/x`) keep working. */
export function legacyHashToPath(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  const body = hash.slice(1);
  const [head, ...rest] = body.split('/');
  const tail = rest.join('/');
  switch (head) {
    case 'home':
      return paths.home;
    case 'discover':
    case 'library':
    case 'liked':
    case 'album':
      return `/${head}`;
    case 'artist':
    case 'playlist':
    case 'shared':
      return tail ? `/${head}/${tail}` : null;
    default:
      return null;
  }
}
