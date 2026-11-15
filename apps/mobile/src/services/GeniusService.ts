/**
 * Service for interacting with Genius API and Scraping Lyrics
 * https://docs.genius.com/
 */

import { LyricLine } from '../types/song';
import { decodeHtmlEntities, removeNonContentBlocks, stripTags } from '../utils/htmlText';

export const GeniusService = {
  /**
   * Scrape lyrics from a Genius song URL selected from the public lyrics sources.
   * Using Regex to extract text from <div data-lyrics-container="true">
   */
  scrapeGeniusLyrics: async (url: string): Promise<string | null> => {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 15000)
      );

      const response = await Promise.race([
        fetch(url),
        timeoutPromise
      ]) as Response;

      if (!response.ok) {
        // Handle native crash risk by just throwing error which is caught below
        throw new Error(`Failed to fetch Genius page: ${response.status}`);
      }

      const html = await response.text();

      // Modern Genius pages render lyrics in many data-lyrics-container blocks.
      // Keep this selector loose (attribute-only) so class name churn does not break scraping.
      const containerRegex = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi;
      const containerMatches = Array.from(html.matchAll(containerRegex));

      let lyricsHtml = containerMatches
        .map(match => (match[1] || '').trim())
        .filter(Boolean)
        .join('\n');

      // Fallback for legacy Genius pages.
      if (!lyricsHtml) {
        const legacyMatch = html.match(/<div[^>]*class="lyrics"[^>]*>([\s\S]*?)<\/div>/i);
        lyricsHtml = legacyMatch?.[1]?.trim() || '';
      }

      if (!lyricsHtml) {
        console.warn('[GeniusService] No lyrics container found in HTML');
        return null;
      }

      // Remove non-lyric blocks before stripping tags.
      const sanitizedHtml = removeNonContentBlocks(lyricsHtml);

      // Convert HTML to text while preserving line breaks. Entities are decoded last and in one pass, so a page
      // that wrote "&amp;lt;" gets "&lt;" and not "<".
      const plainText = decodeHtmlEntities(
        stripTags(
          sanitizedHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n'),
        ),
      ).replace(/\r\n?/g, '\n');

      // Remove metadata/pollution lines that are often injected around lyrics.
      const cleanedLines = plainText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => {
          const normalized = line.toLowerCase();

          // Keep section markers like [Verse 1], but remove unrelated metadata.
          if (/^\d+\s+contributors?$/i.test(line)) return false;
          if (/\bcontributor(s)?\b/i.test(line) && line.length < 80) return false;
          if (/\btranslations?\b/i.test(line)) return false;
          if (/^embed$/i.test(line) || /^you might also like$/i.test(line)) return false;
          if (/\bcover\b/i.test(line) && /\b(by|it was|was a)\b/i.test(normalized)) return false;
          if (/^\d*\s*embed$/i.test(line)) return false;

          return true;
        });

      const finalLyrics = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

      if (!finalLyrics) {
        console.warn('[GeniusService] Lyrics extracted but empty after cleaning');
        return null;
      }

      return finalLyrics;

    } catch (error) {
      console.error('[GeniusService] Scrape error:', error);
      return null;
    }
  },

  /**
   * Convert plain text to unsynced LyricLines
   * This allows them to be used in the same UI, just unsynced.
   */
  convertToLyricLines: (text: string): LyricLine[] => {
    return text.split('\n').map((line, index) => ({
      id: undefined,
      timestamp: 0, // 0 indicates unsynced
      text: line.trim(),
      lineOrder: index
    })).filter(l => l.text.length > 0);
  }
};
