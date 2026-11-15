import { parse, type HTMLElement } from 'node-html-parser';
import { CACHE_MISS, isCacheMiss, type CacheMiss, type CacheStore } from '../../lib/cache.js';
import { decodeHtml } from '../../lib/decodeHtml.js';
import { stripTags } from '../../lib/htmlText.js';
import { cleanLyricStanzas, foldLatin, lyricStanzasText, type LyricStanzas } from '../../shared/lyricsText.js';
import { creditedNames, type LyricSite, type PoliteFetcher, type SiteLyrics, type SiteQuery, type SiteVersion } from './lyricSites.js';

const DEFAULT_BASE_URL = 'https://www.tamil2lyrics.com';
/** The site's song index. Its search (`/?s=`) is disallowed by robots.txt and never used. */
const SITEMAPS = ['lyrics-sitemap.xml', 'lyrics-sitemap2.xml', 'lyrics-sitemap3.xml', 'lyrics-sitemap4.xml', 'lyrics-sitemap5.xml'];
const INDEX_TTL_MS = 86_400_000;
/** A partial or failed index is tried again sooner, but not on every lookup. */
const INDEX_RETRY_MS = 600_000;
const PAGE_TTL_SECONDS = 86_400;
/** Bump when parsing or cleanup changes, so pages read the old way are read again. */
const PAGE_CACHE_VERSION = 'v2';
const MAX_PAGES_PER_SONG = 3;
/** Fewer lines than this is a stub page, not lyrics. */
const MIN_LINES = 4;
const TAMIL_SCRIPT = /[\u{0B80}-\u{0BFF}]/u;
/** Film and credits both agree: no other page can do better. */
const FULL_MATCH = 3;

/** One page's song, as read: who it credits and its text in each script, already cleaned. */
export interface Tamil2LyricsPage {
  readonly title?: string;
  readonly film?: string;
  /** Singers, composer and lyricist, as the page names them. */
  readonly people: readonly string[];
  readonly latin: LyricStanzas;
  readonly native: LyricStanzas;
}

interface IndexEntry {
  readonly slug: string;
  /** What follows "-song-lyrics" in the slug: "", "2", or a film or singer ("idli-kadai"). */
  readonly rest: string;
}

interface ScoredPage {
  readonly slug: string;
  readonly page: Tamil2LyricsPage;
  readonly score: number;
}

/** The fields of the page's schema.org MusicComposition that matching reads. */
interface PageCredits {
  readonly title?: string;
  readonly film?: string;
  readonly people: readonly string[];
}

/** A property of a parsed JSON value, or undefined when the value is not an object or lacks it. */
function field(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Song slugs from one of the site's lyrics sitemaps ("mozhiye-song-lyrics"). */
export function sitemapSlugs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*https?:\/\/[^/<]+\/lyrics\/([a-z0-9-]+)\/?\s*(?:\]\]>)?\s*<\/loc>/gi)]
    .map((match) => (match[1] ?? '').toLowerCase())
    .filter((slug) => /[a-z]/.test(slug));
}

/** The title part of a slug, folded for lookup, and what follows it. Null for slugs with no title. */
export function slugTitle(slug: string): { readonly key: string; readonly rest: string } | null {
  const marker = slug.indexOf('-song-lyrics');
  let head = '';
  let rest = '';
  if (marker >= 0) {
    head = slug.slice(0, marker);
    rest = slug.slice(marker + '-song-lyrics'.length).replace(/^-/, '');
  } else if (slug.endsWith('-lyrics')) {
    head = slug.slice(0, -'-lyrics'.length);
  }
  const key = foldLatin(head);
  return key ? { key, rest } : null;
}

/** "Mozhiye" as the site writes its slugs: "mozhiye". */
function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A paragraph's lines: `<br>` breaks, tags dropped, entities decoded. */
function paragraphLines(paragraph: HTMLElement): string[] {
  return decodeHtml(stripTags(paragraph.innerHTML.replace(/<br\s*\/?>/gi, '\n'))).split('\n');
}

/** A lyrics panel's stanzas. Newer pages mark each verse; older ones are plain paragraphs. */
function panelStanzas(panel: HTMLElement | null): string[][] {
  if (!panel) {
    return [];
  }
  const verses = panel.querySelectorAll('p.t2l-verse');
  return (verses.length > 0 ? verses : panel.querySelectorAll('p')).map(paragraphLines);
}

/** The people a credit line names: "Singers : Dhanush and Dhee" -> Dhanush, Dhee. */
function creditLinePeople(panel: HTMLElement | null): string[] {
  if (!panel) {
    return [];
  }
  const credit = /^\s*(?:singers?|singer\(s\)|music(?:\s+director)?|music\s+by|composer|lyricists?|lyrics\s+by)\s*:\s*(.+)$/i;
  return panel.querySelectorAll('p').flatMap((paragraph) =>
    paragraphLines(paragraph).flatMap((line) => {
      const names = line.match(credit)?.[1];
      return names ? names.split(/,|&|\band\b/i).map((name) => name.trim()) : [];
    })
  );
}

/** Title, film and credits from the page's schema.org MusicComposition; empty when it has none. */
function jsonLdCredits(root: HTMLElement): PageCredits {
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.rawText);
    } catch {
      // Malformed structured data: the visible credits still answer.
      continue;
    }
    const graph = field(parsed, '@graph');
    const nodes: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(graph) ? graph : [parsed];
    const composition = nodes.find((node) => field(node, '@type') === 'MusicComposition');
    if (composition === undefined) {
      continue;
    }
    const recording = field(composition, 'recordedAs');
    const people = [field(composition, 'composer'), field(composition, 'lyricist'), field(recording, 'byArtist')]
      .map((person) => nonEmptyText(field(person, 'name')))
      .filter((name): name is string => name !== undefined);
    const title = nonEmptyText(field(composition, 'name'));
    const film = nonEmptyText(field(field(recording, 'inAlbum'), 'name'));
    return { ...(title ? { title } : {}), ...(film ? { film } : {}), people };
  }
  return { people: [] };
}

/** Reads a song page: its credits and its English and Tamil panels, cleaned to the sung lines. */
export function parseTamil2LyricsPage(html: string): Tamil2LyricsPage {
  const root = parse(html);
  const english = root.querySelector('[data-t2l-tab-panel="english"]');
  const tamil = root.querySelector('[data-t2l-tab-panel="tamil"]');
  const credits = jsonLdCredits(root);
  const film = credits.film ?? nonEmptyText(root.querySelector('a[href*="/movie/"]')?.text);
  // A "Music : ………" break is not a person.
  const people = [...credits.people, ...creditLinePeople(english)].filter((name) => /\p{L}/u.test(name));
  return {
    ...(credits.title ? { title: credits.title } : {}),
    ...(film ? { film } : {}),
    people,
    latin: cleanLyricStanzas(panelStanzas(english)),
    native: cleanLyricStanzas(panelStanzas(tamil))
  };
}

function lineCount(stanzas: LyricStanzas): number {
  return stanzas.reduce((total, stanza) => total + stanza.length, 0);
}

/** Mostly Latin letters: a transliteration, not Tamil script under the wrong tab. */
function isLatin(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.filter((letter) => /[a-z]/i.test(letter)).length / letters.length > 0.9;
}

/** A page's usable versions: English (transliteration) first, then Tamil script. */
export function pageVersions(page: Tamil2LyricsPage): SiteVersion[] {
  const versions: SiteVersion[] = [];
  const latin = lyricStanzasText(page.latin);
  if (lineCount(page.latin) >= MIN_LINES && isLatin(latin)) {
    versions.push({ script: 'latin', language: 'ta', text: latin });
  }
  const native = lyricStanzasText(page.native);
  if (lineCount(page.native) >= MIN_LINES && TAMIL_SCRIPT.test(native)) {
    versions.push({ script: 'native', language: 'ta', text: native });
  }
  return versions;
}

/** Same person under the site's spelling: "SaiAbhyankkar" is "Sai Abhyankkar". */
function samePerson(left: string, right: string): boolean {
  return left === right || (Math.min(left.length, right.length) >= 6 && (left.includes(right) || right.includes(left)));
}

/** Index entries for the song's film first, then the plain slug, then "-2", "-3", then the rest. */
function indexRank(entry: IndexEntry, filmKey: string): number {
  if (filmKey && foldLatin(entry.rest) === filmKey) {
    return 0;
  }
  if (!entry.rest) {
    return 1;
  }
  return /^\d+$/.test(entry.rest) ? 2 : 3;
}

/**
 * tamil2lyrics.com: Tamil film songs in English transliteration and Tamil script. Found by title
 * through the site's sitemaps (or the slug it most likely has), confirmed by film or credits.
 */
export class Tamil2Lyrics implements LyricSite {
  public readonly languages: readonly string[] = ['tamil'];
  private readonly baseUrl: string;
  private index: { readonly map: Map<string, IndexEntry[]>; readonly expiresAt: number } | null = null;
  private indexLoad: Promise<Map<string, IndexEntry[]>> | null = null;

  public constructor(
    private readonly fetcher: PoliteFetcher,
    private readonly cache: CacheStore,
    options: { readonly baseUrl?: string } = {}
  ) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * The best-matching page's versions, or null. A page counts only when its film or its credits
   * match the song (a same-titled song from another film is a different song), and at most
   * MAX_PAGES_PER_SONG pages are read.
   */
  public async find(query: SiteQuery): Promise<SiteLyrics | null> {
    if (!foldLatin(query.title)) {
      return null;
    }
    const filmKey = query.film ? foldLatin(query.film) : '';
    const names = creditedNames(query.artist);
    const tried = new Set<string>();
    let best: ScoredPage | null = null;
    for await (const slug of this.candidates(query.title, filmKey)) {
      if (tried.size >= MAX_PAGES_PER_SONG) {
        break;
      }
      if (tried.has(slug)) {
        continue;
      }
      tried.add(slug);
      const scored = await this.score(slug, filmKey, names);
      if (scored && (!best || scored.score > best.score)) {
        best = scored;
      }
      if (best?.score === FULL_MATCH || (!filmKey && best !== null)) {
        break;
      }
    }
    if (!best) {
      return null;
    }
    return { versions: pageVersions(best.page), source: { name: 'tamil2lyrics', url: this.pageUrl(best.slug).href } };
  }

  /**
   * Slugs to try, best first: the one the site most likely gave the song (most pages are found
   * there in one request, without the index), then the index's entries for the title.
   */
  private async *candidates(title: string, filmKey: string): AsyncGenerator<string> {
    const guess = slugify(title);
    if (guess) {
      yield `${guess}-song-lyrics`;
    }
    const entries = (await this.loadIndex()).get(foldLatin(title)) ?? [];
    for (const entry of [...entries].sort((left, right) => indexRank(left, filmKey) - indexRank(right, filmKey))) {
      yield entry.slug;
    }
  }

  /** How well a page matches: 2 for the film, 1 for a credited person. Null for no match. */
  private async score(slug: string, filmKey: string, names: readonly string[]): Promise<ScoredPage | null> {
    const page = await this.page(slug);
    if (!page || pageVersions(page).length === 0) {
      return null;
    }
    const filmMatch = filmKey !== '' && page.film !== undefined && foldLatin(page.film) === filmKey;
    const peopleMatch = page.people.some((person) => names.some((name) => samePerson(foldLatin(person), name)));
    const score = (filmMatch ? 2 : 0) + (peopleMatch ? 1 : 0);
    return score > 0 ? { slug, page, score } : null;
  }

  private pageUrl(slug: string): URL {
    return new URL(`/lyrics/${slug}/`, this.baseUrl);
  }

  /** A song page, read and cleaned; cached a day either way. */
  private async page(slug: string): Promise<Tamil2LyricsPage | null> {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return null;
    }
    const key = `t2l-page:${PAGE_CACHE_VERSION}:${slug}`;
    const cached = await this.cache.get<Tamil2LyricsPage | CacheMiss>(key);
    if (cached) {
      return isCacheMiss(cached) ? null : cached;
    }
    const html = await this.fetcher.text(this.pageUrl(slug));
    let page: Tamil2LyricsPage | null = null;
    if (html) {
      try {
        page = parseTamil2LyricsPage(html);
      } catch {
        // An unreadable page is a miss like a missing one.
        page = null;
      }
    }
    await this.cache.set(key, page ?? CACHE_MISS, PAGE_TTL_SECONDS);
    return page;
  }

  /** Title -> slugs from the five sitemaps, held for a day in this instance. */
  private async loadIndex(): Promise<Map<string, IndexEntry[]>> {
    if (this.index && Date.now() < this.index.expiresAt) {
      return this.index.map;
    }
    this.indexLoad ??= this.buildIndex().finally(() => {
      this.indexLoad = null;
    });
    return this.indexLoad;
  }

  private async buildIndex(): Promise<Map<string, IndexEntry[]>> {
    const files = await Promise.all(SITEMAPS.map((name) => this.fetcher.text(new URL(`/${name}`, this.baseUrl))));
    const map = new Map<string, IndexEntry[]>();
    for (const slug of files.flatMap((xml) => (xml ? sitemapSlugs(xml) : []))) {
      const title = slugTitle(slug);
      if (!title) {
        continue;
      }
      const entry: IndexEntry = { slug, rest: title.rest };
      const list = map.get(title.key);
      if (list) {
        list.push(entry);
      } else {
        map.set(title.key, [entry]);
      }
    }
    const complete = files.every((xml) => xml !== null);
    this.index = { map, expiresAt: Date.now() + (complete ? INDEX_TTL_MS : INDEX_RETRY_MS) };
    return map;
  }
}
