import type { TasteEntry, TasteProfile } from './store.js';

/**
 * The taste profile is a small, decaying tally: every signal nudges the artists and languages it touches, and
 * everything else fades a little. Recent listening therefore outweighs old listening without any batch job,
 * and the profile stays a few dozen numbers, cheap to keep in the user's row and to hand to a model.
 */

/** How strongly each kind of behaviour says "this listener likes this". */
export const SIGNAL_WEIGHT = {
  /** Listened to most of a song. */
  play: 1,
  /** Bailed within seconds. */
  skip: -0.5,
  like: 3,
  unlike: -2,
  playlistAdd: 2,
  /** Picked as a favourite while setting up. */
  seed: 5
} as const;

const DECAY = 0.985;
const MAX_ARTISTS = 60;
const MAX_LANGUAGES = 12;
/** Enough organic signals that we stop asking a listener to pick favourites. */
const ONBOARDED_AFTER = 12;

export interface SongTraits {
  readonly artist: string;
  readonly language?: string;
}

export function emptyTaste(now = new Date()): TasteProfile {
  return { artists: [], languages: [], signals: 0, onboarded: false, updatedAt: now.toISOString() };
}

/** "A, B & C feat. D" -> ["A", "B", "C", "D"]. The first name is the headline artist. */
export function creditedArtists(artist: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of artist.split(/,|&| feat\.? | ft\.? | x /i)) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function bump(entries: readonly TasteEntry[], name: string, amount: number, keep: number): TasteEntry[] {
  const key = name.toLowerCase();
  const decayed = entries.map((entry) => ({ name: entry.name, score: entry.score * DECAY }));
  const index = decayed.findIndex((entry) => entry.name.toLowerCase() === key);
  if (index >= 0) {
    const current = decayed[index];
    if (current) decayed[index] = { name: current.name, score: current.score + amount };
  } else if (amount > 0) {
    decayed.push({ name, score: amount });
  }
  return decayed
    .filter((entry) => entry.score > 0.05)
    .sort((left, right) => right.score - left.score)
    .slice(0, keep)
    .map((entry) => ({ name: entry.name, score: Math.round(entry.score * 1000) / 1000 }));
}

/** Folds one behaviour on one song into the profile. The headline artist counts fully, guests on the track half. */
export function applySignal(taste: TasteProfile | undefined, song: SongTraits, weight: number, now = new Date()): TasteProfile {
  const base = taste ?? emptyTaste(now);
  let artists = [...base.artists];
  creditedArtists(song.artist).forEach((name, index) => {
    artists = bump(artists, name, index === 0 ? weight : weight / 2, MAX_ARTISTS);
  });
  const language = song.language?.trim();
  const languages = language ? bump(base.languages, language, weight, MAX_LANGUAGES) : base.languages;
  const signals = base.signals + 1;
  return {
    artists,
    languages,
    signals,
    onboarded: base.onboarded || signals >= ONBOARDED_AFTER,
    updatedAt: now.toISOString()
  };
}

/** Onboarding: the listener names favourites directly. Strong, and it ends the "pick your favourites" prompt. */
export function applySeeds(taste: TasteProfile | undefined, artistNames: readonly string[], languageNames: readonly string[], now = new Date()): TasteProfile {
  const base = taste ?? emptyTaste(now);
  let artists = [...base.artists];
  for (const name of artistNames) artists = bump(artists, name, SIGNAL_WEIGHT.seed, MAX_ARTISTS);
  let languages = [...base.languages];
  for (const name of languageNames) languages = bump(languages, name, SIGNAL_WEIGHT.seed, MAX_LANGUAGES);
  return { artists, languages, signals: base.signals + artistNames.length + languageNames.length, onboarded: true, updatedAt: now.toISOString() };
}

/** A play counts by how much of it was heard: finished-ish is a vote for, a few seconds is a vote against. */
export function playWeight(playedSeconds: number, songSeconds: number): number {
  if (playedSeconds < 10) return SIGNAL_WEIGHT.skip;
  const heard = songSeconds > 0 ? playedSeconds / songSeconds : 1;
  return heard >= 0.5 || playedSeconds >= 60 ? SIGNAL_WEIGHT.play : 0.4;
}

/** Two profiles of the same person (a guest session and the account they then signed into): scores add up. */
export function mergeTaste(left: TasteProfile, right: TasteProfile): TasteProfile {
  const combine = (a: readonly TasteEntry[], b: readonly TasteEntry[], keep: number): TasteEntry[] => {
    const map = new Map<string, TasteEntry>();
    for (const entry of [...a, ...b]) {
      const key = entry.name.toLowerCase();
      const current = map.get(key);
      map.set(key, { name: current?.name ?? entry.name, score: (current?.score ?? 0) + entry.score });
    }
    return [...map.values()].sort((x, y) => y.score - x.score).slice(0, keep);
  };
  return {
    artists: combine(left.artists, right.artists, MAX_ARTISTS),
    languages: combine(left.languages, right.languages, MAX_LANGUAGES),
    signals: left.signals + right.signals,
    onboarded: left.onboarded || right.onboarded,
    updatedAt: left.updatedAt > right.updatedAt ? left.updatedAt : right.updatedAt
  };
}
