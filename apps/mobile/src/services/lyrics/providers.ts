/**
 * Lyrics providers ported from Echo Music. Every provider:
 *   - takes the same LyricsQuery,
 *   - returns normalised LRC (or plain text) or null, keeping word timing as
 *     `<mm:ss.xxx>` tags when the source has it (see `@shared/wordSync`),
 *   - never throws (see fetchWithTimeout).
 */
import { Buffer } from 'buffer';
import { buildUrl, fetchJson, type RequestOptions } from '../net/fetchWithTimeout';
import { ALLEGRA_API_URL } from '../account/config';
import { leadArtist, parseSongRef } from '@shared/songRef';
import { alignSyllables, enhancedLine, LyricWord } from '@shared/wordSync';
import { decodeHtmlEntities, removeUntilStable, stripTags } from '../../utils/htmlText';
import { formatLrcTime, hasLrcTimestamps, toTimedLrc, ttmlToLrc } from './lrc';

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  /** Seconds; 0/undefined when unknown. */
  duration?: number;
  /** YouTube video id, when the song came from YouTube. */
  videoId?: string;
  /** The catalog song ("saavn:<id>", `@shared/songRef`), when known: Allegra and JioSaavn look it up by it. */
  ref?: string;
  /**
   * Passed to every request a provider makes: `signal` cancels them all (the song changed), `onFailure` hears of a
   * timeout or server error, so the cascade remembers only true misses. Set by the cascade, not by callers.
   */
  net?: Pick<RequestOptions, 'signal' | 'onFailure'>;
}

export type LyricsProviderName =
  | 'Allegra'
  | 'YouLyPlus'
  | 'Paxsenix'
  | 'Unison'
  | 'BetterLyrics'
  | 'SimpMusic'
  | 'LrcLib'
  | 'KuGou'
  | 'JioSaavn';

export interface ProviderLyrics {
  provider: LyricsProviderName;
  lyrics: string;
  synced: boolean;
  /** What the listener is shown instead of the provider's name ("Allegra · Tamil"). */
  label?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
}

export type LyricsProvider = (q: LyricsQuery) => Promise<ProviderLyrics | null>;

const durationSecs = (q: LyricsQuery): number | undefined =>
  q.duration && q.duration > 0 ? Math.round(q.duration) : undefined;

/**
 * Resolves with the first non-null value, or null once every promise settles
 * empty. Promise.any isn't guaranteed in React Native's Promise polyfill.
 */
export const firstNonNull = <T>(promises: Promise<T | null>[]): Promise<T | null> =>
  new Promise(resolve => {
    let pending = promises.length;
    if (pending === 0) resolve(null);
    for (const p of promises) {
      p.then(
        value => {
          if (value !== null) resolve(value);
          else if (--pending === 0) resolve(null);
        },
        () => {
          if (--pending === 0) resolve(null);
        },
      );
    }
  });

const result = (
  provider: LyricsProviderName,
  raw: string | null | undefined,
  meta: Partial<Omit<ProviderLyrics, 'provider' | 'lyrics' | 'synced'>> = {},
): ProviderLyrics | null => {
  if (!raw || !raw.trim()) return null;
  const synced = hasLrcTimestamps(raw);
  const lyrics = synced ? toTimedLrc(raw) : raw.trim();
  return lyrics ? { provider, lyrics, synced, ...meta } : null;
};

// ─── YouLyPlus (LyricsPlus / KPoe mirrors) ──────────────────────────────────

const YOULY_SERVERS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
];

interface YoulySyllable { text?: string; time?: number; duration?: number; isBackground?: boolean }
interface YoulyLine { text?: string; time?: number; duration?: number; syllabus?: YoulySyllable[] }
interface YoulyResponse {
  syncedLyrics?: string;
  plainLyrics?: string;
  lyrics?: YoulyLine[];
  trackName?: string;
  artistName?: string;
  albumName?: string;
}

let youlyLastWorking: string | null = null;

/** KPoe lines → LRC, every syllable timed (milliseconds upstream); background vocals left out. */
export const youlyLinesToLrc = (lines: YoulyLine[]): string =>
  lines
    .map(line => {
      const lineStart = (line.time ?? 0) / 1000;
      const lead = (line.syllabus ?? []).filter(s => !s.isBackground);
      const text = (line.text?.trim() ? line.text : lead.map(s => s.text ?? '').join('')).replace(/\s+/g, ' ').trim();
      // Timed only when every syllable is: a partly timed line is lit as a whole.
      const sung: LyricWord[] = lead.every(s => typeof s.time === 'number')
        ? lead.map(s => ({ text: s.text ?? '', start: (s.time ?? 0) / 1000, end: ((s.time ?? 0) + (s.duration ?? 0)) / 1000 }))
        : [];
      const syllables = alignSyllables(sung, text);
      if (syllables.length > 0) return enhancedLine(lineStart, syllables);
      return `${formatLrcTime(line.time ?? 0)}${text}`;
    })
    .join('\n');

export const youLyPlus: LyricsProvider = async q => {
  const servers = youlyLastWorking
    ? [youlyLastWorking, ...YOULY_SERVERS.filter(s => s !== youlyLastWorking)]
    : YOULY_SERVERS;
  const params = { title: q.title, artist: q.artist, duration: durationSecs(q), album: q.album };

  // Race the mirrors: the first one with usable lyrics wins.
  return firstNonNull(servers.map(async server => {
    const res = await fetchJson<YoulyResponse>(buildUrl(`${server}/v2/lyrics/get`, params), { ...q.net, timeoutMs: 10_000 });
    // The syllable list is the richest form; LRCLIB-style text when there is none.
    const timed = res?.lyrics?.some(l => l.syllabus?.length) ? youlyLinesToLrc(res.lyrics) : '';
    const raw = timed
      || res?.syncedLyrics?.trim()
      || (res?.lyrics?.length ? youlyLinesToLrc(res.lyrics) : '')
      || res?.plainLyrics?.trim();
    const hit = result('YouLyPlus', raw, { trackName: res?.trackName, artistName: res?.artistName, albumName: res?.albumName });
    if (hit) youlyLastWorking = server;
    return hit;
  }));
};

// ─── Paxsenix (Apple Music lyrics proxy) ────────────────────────────────────

const PAXSENIX = 'https://lyrics.paxsenix.org';

interface PaxSearchResult { id: string; songName?: string; trackName?: string; artistName?: string; albumName?: string; duration?: number }
interface PaxLyricText { text: string; timestamp?: number; endtime?: number; part?: boolean }
interface PaxLyricsResponse {
  type?: string;
  content?: { timestamp: number; text?: PaxLyricText[] }[];
  elrc?: string;
  elrcMultiPerson?: string;
  ttmlContent?: string;
  plain?: string;
}

/** Apple Music's word list → LRC. `part` marks a syllable that runs on into the next one (no space). */
export const paxContentToLrc = (content: NonNullable<PaxLyricsResponse['content']>): string =>
  content
    .map(line => {
      const pieces = line.text ?? [];
      const text = pieces.map((t, i) => t.text + (t.part || i === pieces.length - 1 ? '' : ' ')).join('').replace(/\s+/g, ' ').trim();
      const timed = pieces.every(t => typeof t.timestamp === 'number');
      if (!timed || pieces.length === 0) return `${formatLrcTime(line.timestamp)}${text}`;
      const syllables = alignSyllables(
        pieces.map(t => ({ text: t.text, start: (t.timestamp ?? 0) / 1000, end: (t.endtime ?? t.timestamp ?? 0) / 1000 })),
        text,
      );
      return enhancedLine(line.timestamp / 1000, syllables);
    })
    .join('\n');

export const paxsenix: LyricsProvider = async q => {
  const results = await fetchJson<PaxSearchResult[]>(
    buildUrl(`${PAXSENIX}/apple-music/search`, { q: `${q.title} ${q.artist}` }),
    { ...q.net, headers: { 'User-Agent': 'LuvLyrics/1.0' } },
  );
  if (!Array.isArray(results) || results.length === 0) return null;

  const target = durationSecs(q);
  const lower = (s?: string) => (s ?? '').toLowerCase();
  const best = results
    .map(r => {
      const name = lower(r.trackName ?? r.songName);
      let score = 0;
      if (name === lower(q.title)) score += 10;
      else if (name.includes(lower(q.title)) || lower(q.title).includes(name)) score += 5;
      if (lower(r.artistName).includes(lower(q.artist).split(/[,&]/)[0].trim())) score += 6;
      // Paxsenix durations are milliseconds.
      if (target && r.duration && Math.abs(r.duration / 1000 - target) <= 4) score += 4;
      return { r, score };
    })
    .filter(x => x.score >= 9)
    .sort((a, b) => b.score - a.score)[0]?.r;
  if (!best) return null;

  const res = await fetchJson<PaxLyricsResponse>(buildUrl(`${PAXSENIX}/apple-music/lyrics`, { id: best.id }), {
    ...q.net,
    headers: { 'User-Agent': 'LuvLyrics/1.0' },
  });
  if (!res) return null;

  let raw: string | undefined;
  if (res.ttmlContent) raw = ttmlToLrc(res.ttmlContent);
  if (!raw && res.content?.length) raw = paxContentToLrc(res.content);
  if (!raw) raw = res.elrcMultiPerson || res.elrc;
  if (!raw) raw = res.plain;
  return result('Paxsenix', raw, { trackName: best.trackName ?? best.songName, artistName: best.artistName, albumName: best.albumName });
};

// ─── Unison (community-voted lyrics) ────────────────────────────────────────

const UNISON = 'https://unison.boidu.dev';

interface UnisonEntry { song?: string; artist?: string; lyrics?: string }
interface UnisonResponse { success?: boolean; data?: UnisonEntry | null }

export const unison: LyricsProvider = async q => {
  const pick = (res: UnisonResponse | null) => (res?.success && res.data?.lyrics ? res.data : null);
  let entry: UnisonEntry | null = null;
  if (q.videoId) entry = pick(await fetchJson<UnisonResponse>(buildUrl(`${UNISON}/lyrics`, { v: q.videoId }), q.net));
  if (!entry) {
    entry = pick(await fetchJson<UnisonResponse>(buildUrl(`${UNISON}/lyrics`, {
      song: q.title,
      artist: q.artist,
      album: q.album,
      duration: durationSecs(q),
    }), q.net));
  }
  return entry ? result('Unison', entry.lyrics, { trackName: entry.song, artistName: entry.artist }) : null;
};

// ─── Better Lyrics (TTML, word-synced upstream) ─────────────────────────────

const BETTER_LYRICS = 'https://lyrics-api.boidu.dev/getLyrics';

export const betterLyrics: LyricsProvider = async q => {
  const res = await fetchJson<{ ttml?: string }>(buildUrl(BETTER_LYRICS, {
    s: q.title,
    a: q.artist,
    d: durationSecs(q),
    al: q.album,
  }), q.net);
  return res?.ttml ? result('BetterLyrics', ttmlToLrc(res.ttml)) : null;
};

// ─── SimpMusic (keyed by YouTube video id) ──────────────────────────────────

const SIMPMUSIC = ['https://api-lyrics.simpmusic.org/v1/', 'https://vivi-yt-music-server.onrender.com/v1/'];

interface SimpLyrics {
  songTitle?: string;
  artistName?: string;
  durationSeconds?: number;
  syncedLyrics?: string | null;
  plainLyric?: string | null;
  richSyncLyrics?: string | null;
}
interface SimpResponse { type?: string; data?: SimpLyrics[] }

export const simpMusic: LyricsProvider = async q => {
  if (!q.videoId) return null;
  const d = durationSecs(q);
  for (const base of SIMPMUSIC) {
    const res = await fetchJson<SimpResponse>(`${base}${encodeURIComponent(q.videoId)}`, {
      ...q.net,
      headers: { 'User-Agent': 'SimpMusicLyrics/1.0' },
    });
    if (!res) continue; // HTTP failure: try the fallback mirror
    if (res.type !== 'success' || !Array.isArray(res.data)) return null;
    const valid = d ? res.data.filter(t => Math.abs((t.durationSeconds ?? 0) - d) <= 10) : res.data;
    const best = d
      ? [...valid].sort((a, b) => Math.abs((a.durationSeconds ?? 0) - d) - Math.abs((b.durationSeconds ?? 0) - d))[0]
      : valid[0];
    if (!best) return null;
    return result('SimpMusic', best.richSyncLyrics || best.syncedLyrics || best.plainLyric, {
      trackName: best.songTitle,
      artistName: best.artistName,
      duration: best.durationSeconds,
    });
  }
  return null;
};

// ─── LRCLIB ─────────────────────────────────────────────────────────────────

const LRCLIB = 'https://lrclib.net/api';

interface LrcLibHit {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

const LRCLIB_HEADERS = { 'User-Agent': 'LuvLyrics/1.0 (https://github.com/LuvLyricsApp/LuvLyricsApp)' };

const lrcLibLookup = async (q: LyricsQuery, artist: string, d: number | undefined): Promise<LrcLibHit | null> => {
  let hit: LrcLibHit | null = null;
  if (d) {
    hit = await fetchJson<LrcLibHit>(buildUrl(`${LRCLIB}/get`, {
      track_name: q.title,
      artist_name: artist,
      album_name: q.album,
      duration: d,
    }), { ...q.net, headers: LRCLIB_HEADERS });
  }
  if (!hit?.syncedLyrics && !hit?.plainLyrics) {
    const list = await fetchJson<LrcLibHit[]>(buildUrl(`${LRCLIB}/search`, { track_name: q.title, artist_name: artist }), { ...q.net, headers: LRCLIB_HEADERS });
    const candidates = (list ?? []).filter(h => !d || !h.duration || Math.abs(h.duration - d) <= 5);
    hit = candidates.find(h => h.syncedLyrics) ?? candidates.find(h => h.plainLyrics) ?? null;
  }
  return hit;
};

/**
 * The credited artists first, then the lead artist alone: a catalog credit such as
 * "Anirudh Ravichander, Super Subu, M.S Krsna, Heisenberg" finds nothing on LRCLIB,
 * which files the song under "Anirudh Ravichander".
 */
export const lrcLib: LyricsProvider = async q => {
  const d = durationSecs(q);
  const lead = leadArtist(q.artist);
  let hit = await lrcLibLookup(q, q.artist, d);
  if (!hit && lead && lead !== q.artist) hit = await lrcLibLookup(q, lead, d);
  if (!hit) return null;
  return result('LrcLib', hit.syncedLyrics || hit.plainLyrics, {
    trackName: hit.trackName,
    artistName: hit.artistName,
    albumName: hit.albumName,
    duration: hit.duration,
  });
};

// ─── KuGou ──────────────────────────────────────────────────────────────────

const KUGOU_DURATION_TOLERANCE = 8;

interface KuGouSongs { data?: { info?: { duration: number; hash: string }[] } }
interface KuGouCandidates { candidates?: { id: number | string; accesskey: string }[] }
interface KuGouDownload { content?: string }

/** A bracketed note in a title: "(feat. X)", "「…」", "<…>". Not HTML; repeated so nested notes go too. */
const KUGOU_TITLE_NOTE = /\(.*\)|（.*）|「.*」|『.*』|<.*>|《.*》|〈.*〉|＜.*＞/g;
const kugouTitle = (t: string) => removeUntilStable(t, KUGOU_TITLE_NOTE).trim();
const kugouArtist = (a: string) =>
  a.replace(/, /g, '、').replace(/ & /g, '、').replace(/\./g, '').replace(/和/g, '、').replace(/\(.*\)|（.*）/g, '').trim();

/** Drops credit lines ("作词 : …", "Composer: …") at the head and tail. */
const stripKuGouCredits = (lrc: string): string => {
  const lines = lrc.split(/\r?\n/).filter(l => /^\[\d\d:\d\d\.\d{2,3}\].*/.test(l));
  const isCredit = (l: string) => /.+\].+[:：].+/.test(l);
  let head = 0;
  for (let i = Math.min(30, lines.length - 1); i >= 0; i--) {
    if (isCredit(lines[i])) { head = i + 1; break; }
  }
  return lines.slice(head).join('\n');
};

export const kuGou: LyricsProvider = async q => {
  const keyword = `${kugouTitle(q.title)} - ${kugouArtist(q.artist)}${q.album ? ` ${q.album}` : ''}`;
  const d = durationSecs(q);

  const download = async (id: number | string, accesskey: string): Promise<ProviderLyrics | null> => {
    const res = await fetchJson<KuGouDownload>(buildUrl('https://lyrics.kugou.com/download', {
      fmt: 'lrc', charset: 'utf8', client: 'pc', ver: 1, id, accesskey,
    }), q.net);
    if (!res?.content) return null;
    try {
      return result('KuGou', stripKuGouCredits(Buffer.from(res.content, 'base64').toString('utf8')));
    } catch {
      return null;
    }
  };

  const songs = await fetchJson<KuGouSongs>(buildUrl('https://mobileservice.kugou.com/api/v3/search/song', {
    version: 9108, plat: 0, pagesize: 8, showtype: 0, keyword,
  }), q.net);
  for (const song of songs?.data?.info ?? []) {
    if (d && Math.abs(song.duration - d) > KUGOU_DURATION_TOLERANCE) continue;
    const byHash = await fetchJson<KuGouCandidates>(buildUrl('https://lyrics.kugou.com/search', {
      ver: 1, man: 'yes', client: 'pc', hash: song.hash,
    }), q.net);
    const c = byHash?.candidates?.[0];
    if (c) {
      const hit = await download(c.id, c.accesskey);
      if (hit) return hit;
    }
  }

  const byKeyword = await fetchJson<KuGouCandidates>(buildUrl('https://lyrics.kugou.com/search', {
    ver: 1, man: 'yes', client: 'pc', keyword, duration: d ? d * 1000 : undefined,
  }), q.net);
  const c = byKeyword?.candidates?.[0];
  return c ? download(c.id, c.accesskey) : null;
};

// ─── Allegra (lyrics listeners synced on the website) ───────────────────────

interface VerifiedVersion { script?: string; language?: string; lrc?: string }
interface VerifiedResponse {
  data?: { title?: string; artist?: string; duration?: number; versions?: VerifiedVersion[] } | null;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ta: 'Tamil', te: 'Telugu', hi: 'Hindi', ml: 'Malayalam', kn: 'Kannada', bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', or: 'Odia', ur: 'Urdu',
};

const versionLabel = (version: VerifiedVersion): string =>
  version.script === 'native' ? `Allegra · ${LANGUAGE_NAMES[version.language ?? ''] ?? 'Native script'}` : 'Allegra · English';

/**
 * Every version listeners synced for the song on allegravibe.vercel.app (`GET /api/lyrics/verified`),
 * English first, then the song's own script. By ref; a download with no ref is matched by title,
 * artist and length.
 */
export const allegraVersions = async (q: LyricsQuery): Promise<ProviderLyrics[]> => {
  if (!q.ref && !q.title) return [];
  const res = await fetchJson<VerifiedResponse>(buildUrl(`${ALLEGRA_API_URL}/api/lyrics/verified`, {
    ref: q.ref,
    title: q.title,
    artist: q.artist,
    duration: durationSecs(q),
  }), q.net);
  const data = res?.data;
  return (data?.versions ?? []).flatMap(version => {
    const hit = result('Allegra', version.lrc, {
      label: versionLabel(version),
      trackName: data?.title,
      artistName: data?.artist,
      duration: data?.duration,
    });
    return hit?.synced ? [hit] : [];
  });
};

export const allegra: LyricsProvider = async q => (await allegraVersions(q))[0] ?? null;

// ─── JioSaavn (the catalog's own plain lyrics) ──────────────────────────────

interface SaavnLyricsResponse { lyrics?: string }

const decodeEntities = decodeHtmlEntities;

/** JioSaavn's `line<br>line` as plain text: one lyric per line, entities decoded, tags dropped. */
export const saavnLyricsText = (raw: string): string =>
  decodeEntities(stripTags(raw.replace(/<br\s*\/?>/gi, '\n')))
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Plain lyrics for the exact recording, asked by its Saavn id. Only for `saavn:` refs. */
export const jioSaavn: LyricsProvider = async q => {
  const song = q.ref ? parseSongRef(q.ref) : null;
  if (song?.source !== 'saavn' || !/^[A-Za-z0-9_-]{1,32}$/.test(song.id)) return null;
  const res = await fetchJson<SaavnLyricsResponse>(buildUrl('https://www.jiosaavn.com/api.php', {
    __call: 'lyrics.getLyrics',
    ctx: 'web6dot0',
    api_version: 4,
    _format: 'json',
    _marker: 0,
    lyrics_id: song.id,
  }), q.net);
  return typeof res?.lyrics === 'string' ? result('JioSaavn', saavnLyricsText(res.lyrics)) : null;
};

export const LYRICS_PROVIDERS: Record<LyricsProviderName, LyricsProvider> = {
  Allegra: allegra,
  YouLyPlus: youLyPlus,
  Paxsenix: paxsenix,
  Unison: unison,
  BetterLyrics: betterLyrics,
  SimpMusic: simpMusic,
  LrcLib: lrcLib,
  KuGou: kuGou,
  JioSaavn: jioSaavn,
};

/**
 * Lyrics listeners synced on Allegra first, then Echo Music's order (richest word-synced sources
 * first), and JioSaavn's plain text last: it only answers when nothing else has the song.
 */
export const DEFAULT_PROVIDER_ORDER: LyricsProviderName[] = [
  'Allegra',
  'YouLyPlus',
  'Paxsenix',
  'Unison',
  'BetterLyrics',
  'SimpMusic',
  'LrcLib',
  'KuGou',
  'JioSaavn',
];
