import { DEFAULT_KARAOKE_MIX, normalizeMix, type KaraokeMix } from './karaokeMix';

/**
 * Device-local preferences. One versioned key, one parser, one store: the player, the
 * lyrics, karaoke and the settings page all read the same object, and a guest's choices
 * never need the API. Every field survives a corrupt or partial stored value.
 */
export type ThemePreference = 'dark' | 'light' | 'system';
export type LyricsSize = 'small' | 'medium' | 'large';
/** `auto` tries the on-device model and falls back; `basic` always uses the light remover. */
export type KaraokeMode = 'auto' | 'basic';

export interface Settings {
  readonly theme: ThemePreference;
  /** The shader behind the shell. Off keeps a still frame (the header pause button, remembered). */
  readonly animatedBackground: boolean;
  /** When a song came from a search or a short list, keep queueing similar songs after it. */
  readonly autoplaySimilar: boolean;
  readonly lyricsSize: LyricsSize;
  readonly showLyricsSource: boolean;
  /** Keep each song's lyric sync nudge instead of resetting it on the next play. */
  readonly rememberLyricsOffset: boolean;
  /** Seconds, by song id. Only written while `rememberLyricsOffset` is on. */
  readonly lyricsOffsets: Readonly<Record<string, number>>;
  readonly karaokeMode: KaraokeMode;
  readonly karaokeMix: KaraokeMix;
  /** Vercel Analytics + Speed Insights (cookie-less). Applies from the next page load. */
  readonly analytics: boolean;
}

export const SETTINGS_KEY = 'allegra-settings-v1';
/** Written by earlier builds; read once so an existing theme choice is not lost. */
export const LEGACY_THEME_KEY = 'allegra-theme';
/** Enough for a long listening history; oldest entries go first. */
export const MAX_LYRICS_OFFSETS = 300;
export const MAX_LYRICS_OFFSET_SECONDS = 5;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  animatedBackground: true,
  autoplaySimilar: true,
  lyricsSize: 'medium',
  showLyricsSource: true,
  rememberLyricsOffset: true,
  lyricsOffsets: {},
  karaokeMode: 'auto',
  karaokeMix: DEFAULT_KARAOKE_MIX,
  analytics: true
};

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Rounded to the nudge's 0.1 s step and kept inside its ±5 s range. */
export function clampLyricsOffset(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const bounded = Math.min(MAX_LYRICS_OFFSET_SECONDS, Math.max(-MAX_LYRICS_OFFSET_SECONDS, seconds));
  return Math.round(bounded * 10) / 10;
}

function offsets(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(-MAX_LYRICS_OFFSETS);
  for (const [id, seconds] of entries) {
    if (typeof seconds !== 'number') continue;
    const clamped = clampLyricsOffset(seconds);
    if (clamped !== 0) out[id] = clamped;
  }
  return out;
}

/** Stored JSON (or nothing) → complete settings. Unknown fields are dropped, bad ones defaulted. */
export function parseSettings(raw: string | null, legacyTheme: string | null = null): Settings {
  let stored: Record<string, unknown> = {};
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
    } catch {
      stored = {};
    }
  }
  const legacy = legacyTheme === 'light' || legacyTheme === 'dark' ? legacyTheme : DEFAULT_SETTINGS.theme;
  return {
    theme: oneOf(stored.theme, ['dark', 'light', 'system'], raw ? DEFAULT_SETTINGS.theme : legacy),
    animatedBackground: flag(stored.animatedBackground, DEFAULT_SETTINGS.animatedBackground),
    autoplaySimilar: flag(stored.autoplaySimilar, DEFAULT_SETTINGS.autoplaySimilar),
    lyricsSize: oneOf(stored.lyricsSize, ['small', 'medium', 'large'], DEFAULT_SETTINGS.lyricsSize),
    showLyricsSource: flag(stored.showLyricsSource, DEFAULT_SETTINGS.showLyricsSource),
    rememberLyricsOffset: flag(stored.rememberLyricsOffset, DEFAULT_SETTINGS.rememberLyricsOffset),
    lyricsOffsets: offsets(stored.lyricsOffsets),
    karaokeMode: oneOf(stored.karaokeMode, ['auto', 'basic'], DEFAULT_SETTINGS.karaokeMode),
    karaokeMix: stored.karaokeMix === undefined ? DEFAULT_KARAOKE_MIX : normalizeMix(stored.karaokeMix),
    analytics: flag(stored.analytics, DEFAULT_SETTINGS.analytics)
  };
}

/** Record (or clear, at 0) one song's offset, keeping the map bounded. */
export function withLyricsOffset(current: Readonly<Record<string, number>>, songId: string, seconds: number): Record<string, number> {
  const next: Record<string, number> = { ...current };
  delete next[songId];
  const clamped = clampLyricsOffset(seconds);
  if (clamped !== 0) next[songId] = clamped;
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_LYRICS_OFFSETS))) delete next[id];
  return next;
}

/* ── The store ───────────────────────────────────────────────────────────── */

type Listener = () => void;
const listeners = new Set<Listener>();
let current: Settings | null = null;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function load(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  return parseSettings(readStorage(SETTINGS_KEY), readStorage(LEGACY_THEME_KEY));
}

export function getSettings(): Settings {
  if (current === null) current = load();
  return current;
}

export function getServerSettings(): Settings {
  return DEFAULT_SETTINGS;
}

export type SettingsPatch = Partial<Settings> | ((settings: Settings) => Partial<Settings>);

export function updateSettings(patch: SettingsPatch): void {
  const base = getSettings();
  const changes = typeof patch === 'function' ? patch(base) : patch;
  current = parseSettings(JSON.stringify({ ...base, ...changes }));
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable (private mode, quota): the choice holds for this visit only.
  }
  for (const listener of listeners) listener();
}

/** Restore defaults. Per-song lyric offsets go too. */
export function resetSettings(): void {
  updateSettings(DEFAULT_SETTINGS);
}

function onStorage(event: StorageEvent): void {
  if (event.key !== SETTINGS_KEY) return;
  current = parseSettings(event.newValue);
  for (const listener of listeners) listener();
}

export function subscribeSettings(listener: Listener): () => void {
  listeners.add(listener);
  // Another tab changed a setting: follow it.
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}
