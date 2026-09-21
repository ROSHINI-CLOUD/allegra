import { ArrowRight, Clock, Compass, Disc3, Heart, House, Library, ListMusic, Moon, Search, Sun, User } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import type { UnifiedSong } from '@shared/types';

import { searchSongs } from '../lib/api';
import { motionTokens, spring } from '../motion';

/**
 * Global command palette, after Watermelon's "Command Search": the search pill morphs into a sheet
 * (shared layoutId), results are grouped into sections, and a highlight slides between rows.
 * Songs are searched live, so Enter plays what you typed without leaving the page.
 */

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** What the pill shows when a Discover search is active. */
  readonly activeQuery: string;
  readonly recent: readonly UnifiedSong[];
  readonly theme: 'dark' | 'light';
  readonly onPlaySong: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onOpenArtist: (name: string) => void;
  readonly onNavigate: (hash: string) => void;
  readonly onSearchAll: (query: string) => void;
  readonly onToggleTheme: () => void;
  readonly onClearSearch: () => void;
}

interface CommandItem {
  readonly id: string;
  readonly section: string;
  readonly title: string;
  readonly hint?: string;
  readonly icon: ReactNode;
  readonly art?: string;
  readonly run: () => void;
}

const SHEET_ID = 'command-palette';
const SEARCH_DEBOUNCE_MS = 220;

export function CommandPalette({ open, onOpen, onClose, activeQuery, recent, theme, onPlaySong, onOpenArtist, onNavigate, onSearchAll, onToggleTheme, onClearSearch }: CommandPaletteProps) {
  const reduced = useReducedMotion();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnifiedSong[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);

  const trimmed = query.trim();

  // Fresh sheet each time it opens; hand focus back to the pill when it closes.
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setFailed(false);
      setActive(0);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
      wasOpen.current = true;
      return () => window.clearTimeout(timer);
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      const timer = window.setTimeout(() => triggerRef.current?.focus(), 0);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  // Live song search, debounced, with the previous request cancelled.
  useEffect(() => {
    if (!open || trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      setFailed(false);
      return undefined;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchSongs(trimmed, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          setResults(response.results.slice(0, 20));
          setFailed(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([]);
            setFailed(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, trimmed]);

  const go = useCallback((hash: string) => () => onNavigate(hash), [onNavigate]);

  const items = useMemo<CommandItem[]>(() => {
    const needle = trimmed.toLowerCase();
    const list: CommandItem[] = [];

    if (trimmed) {
      list.push({ id: 'all', section: 'Search', title: `Search “${trimmed}”`, hint: 'All results', icon: <ArrowRight size={16} />, run: () => onSearchAll(trimmed) });
    }

    const songs = results.slice(0, 5);
    songs.forEach((song) => {
      list.push({ id: `song-${song.id}`, section: 'Songs', title: song.title, hint: song.artist, icon: <Disc3 size={16} />, ...(song.artwork ? { art: song.artwork } : {}), run: () => onPlaySong(song, results) });
    });

    // Credited names across the results; the one you typed comes first, so "arijit" offers Arijit Singh.
    const seen = new Set<string>();
    const names: string[] = [];
    results.forEach((song) => {
      song.artist.split(/,|&| feat\.? /i).map((part) => part.trim()).filter(Boolean).forEach((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        names.push(name);
      });
    });
    names
      .sort((left, right) => Number(right.toLowerCase().includes(needle)) - Number(left.toLowerCase().includes(needle)))
      .slice(0, 3)
      .forEach((name) => {
        list.push({ id: `artist-${name.toLowerCase()}`, section: 'Artists', title: name, hint: 'Artist', icon: <User size={16} />, run: () => onOpenArtist(name) });
      });

    if (!trimmed) {
      recent.slice(0, 4).forEach((song) => {
        list.push({ id: `recent-${song.id}`, section: 'Recently played', title: song.title, hint: song.artist, icon: <Clock size={16} />, ...(song.artwork ? { art: song.artwork } : {}), run: () => onPlaySong(song, [...recent]) });
      });
    }

    const destinations: CommandItem[] = [
      { id: 'go-home', section: 'Go to', title: 'Home', icon: <House size={16} />, run: go('#home') },
      { id: 'go-browse', section: 'Go to', title: 'Browse', icon: <Compass size={16} />, run: go('#discover') },
      { id: 'go-library', section: 'Go to', title: 'Your library', icon: <Library size={16} />, run: go('#library') },
      { id: 'go-liked', section: 'Go to', title: 'Favorite songs', icon: <Heart size={16} />, run: go('#liked') },
      { id: 'go-playlists', section: 'Go to', title: 'Playlists', icon: <ListMusic size={16} />, run: go('#library') }
    ];
    const actions: CommandItem[] = [
      { id: 'theme', section: 'Settings', title: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme', icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />, run: onToggleTheme }
    ];
    if (activeQuery) actions.unshift({ id: 'clear', section: 'Settings', title: 'Clear current search', icon: <Search size={16} />, run: onClearSearch });

    [...destinations, ...actions].forEach((item) => {
      if (!needle || item.title.toLowerCase().includes(needle)) list.push(item);
    });
    return list;
  }, [trimmed, results, recent, theme, activeQuery, go, onSearchAll, onPlaySong, onOpenArtist, onToggleTheme, onClearSearch]);

  const sections = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    items.forEach((item) => map.set(item.section, [...(map.get(item.section) ?? []), item]));
    return [...map.entries()];
  }, [items]);

  useEffect(() => {
    setActive(0);
  }, [trimmed, results]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = useCallback((item: CommandItem | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  }, [onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (items.length === 0 ? 0 : (index + 1) % items.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (items.length === 0 ? 0 : (index - 1 + items.length) % items.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const morph = reduced ? { duration: motionTokens.duration.instant } : spring.sheet;

  return (
    <>
      {/* The pill keeps its slot while the sheet is open, so the top bar never reflows. */}
      <div className="cmdk-slot">
        <AnimatePresence initial={false}>
          {!open ? (
            <motion.button
              key="trigger"
              ref={triggerRef}
              type="button"
              layoutId={SHEET_ID}
              className="search-box cmdk-trigger"
              style={{ borderRadius: 999 }}
              transition={morph}
              onClick={onOpen}
              aria-haspopup="dialog"
              aria-label="Search music"
            >
              <Search size={17} aria-hidden="true" />
              <span className={`cmdk-trigger-text ${activeQuery ? 'has-value' : ''}`}>{activeQuery || 'Search music'}</span>
              {activeQuery ? (
                <span
                  className="search-clear"
                  role="button"
                  tabIndex={0}
                  aria-label="Clear search"
                  onClick={(event) => { event.stopPropagation(); onClearSearch(); }}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onClearSearch(); } }}
                >×</span>
              ) : <kbd>⌘ K</kbd>}
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>

      {createPortal(
        <AnimatePresence>
          {open ? (
            <div className="cmdk-layer" key="layer">
              <motion.div
                className="cmdk-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.standard }}
                onClick={onClose}
              />
              <motion.div
                layoutId={SHEET_ID}
                className="cmdk-sheet"
                style={{ borderRadius: 22 }}
                role="dialog"
                aria-modal="true"
                aria-label="Search and commands"
                transition={morph}
                onKeyDown={onKeyDown}
              >
                <div className="cmdk-input-row">
                  <Search size={18} aria-hidden="true" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search songs, artists, or jump to…"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls="cmdk-list"
                    aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {searching ? <span className="cmdk-spinner" aria-label="Searching" /> : null}
                  <kbd>Esc</kbd>
                </div>

                <motion.div
                  className="cmdk-body"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: motionTokens.duration.base, delay: reduced ? 0 : 0.08 }}
                >
                  <div id="cmdk-list" ref={listRef} role="listbox" className="cmdk-list">
                    {sections.map(([name, rows]) => (
                      <div key={name} className="cmdk-section" role="group" aria-label={name}>
                        <h3>{name}</h3>
                        {rows.map((item) => {
                          const index = items.indexOf(item);
                          const isActive = index === active;
                          return (
                            <button
                              key={item.id}
                              id={`cmdk-${item.id}`}
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              data-active={isActive ? 'true' : undefined}
                              className="cmdk-row"
                              onMouseMove={() => { if (!isActive) setActive(index); }}
                              onClick={() => choose(item)}
                            >
                              {isActive ? <motion.span layoutId="cmdk-highlight" className="cmdk-highlight" transition={reduced ? { duration: 0 } : spring.tactile} /> : null}
                              <span className="cmdk-row-icon">{item.art ? <img src={item.art} alt="" loading="lazy" /> : item.icon}</span>
                              <span className="cmdk-row-copy"><strong>{item.title}</strong>{item.hint ? <small>{item.hint}</small> : null}</span>
                              {isActive ? <kbd>↵</kbd> : null}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    {trimmed.length >= 2 && !searching && results.length === 0 ? (
                      <p className="cmdk-empty">{failed ? 'Search is unavailable right now. Try again in a moment.' : `No songs found for “${trimmed}”.`}</p>
                    ) : null}
                  </div>
                </motion.div>

                <footer className="cmdk-foot" aria-hidden="true">
                  <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                  <span><kbd>↵</kbd> select</span>
                  <span><kbd>esc</kbd> close</span>
                </footer>
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
