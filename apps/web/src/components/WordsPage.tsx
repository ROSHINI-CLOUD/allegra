import { ArrowLeft, ArrowUpRight, Heart, ListMusic, MessageSquare, Music2, RefreshCw, Send, Sparkles, Waves } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

import type { LyricLine, UnifiedSong } from '@shared/types';

import { LyricsPanel } from './LyricsPanel';
import { PlaylistMenu } from './PlaylistMenu';
import { SongCard } from './SongCard';
import { MusicFlowShader } from './shader/MusicFlowShader';
import { Artwork, EmptyState, IconButton, TactileButton } from './ui';
import type { Palette } from '../lib/palette';
import { formatTime } from '../lib/utils';
import { itemVariants, motionTokens, pageVariants } from '../motion';

export type WordsTab = 'upnext' | 'lyrics' | 'comments' | 'related';

interface CommentItem {
  id: string;
  user: string;
  avatarBg: string;
  timeAgo: string;
  text: string;
  likes: number;
}

const INITIAL_COMMENTS: CommentItem[] = [
  {
    id: 'c1',
    user: 'Aria V.',
    avatarBg: '#7bdcec',
    timeAgo: '2 hours ago',
    text: 'The mixing on this vocal stem is absolutely insane. Instant repeat! 🔥',
    likes: 42
  },
  {
    id: 'c2',
    user: 'Devon K.',
    avatarBg: '#a855f7',
    timeAgo: '5 hours ago',
    text: 'That transitional beat drop at 1:45 literally gave me goosebumps.',
    likes: 29
  },
  {
    id: 'c3',
    user: 'Elena M.',
    avatarBg: '#ec4899',
    timeAgo: '1 day ago',
    text: 'Perfect track for late night coding sessions. Soundstage is so wide.',
    likes: 18
  }
];

interface WordsPageProps {
  readonly song: UnifiedSong | null;
  /** Cover palette driving the background shader. */
  readonly palette?: Palette | null;
  readonly light?: boolean;
  readonly energy?: number;
  readonly queue?: UnifiedSong[];
  readonly lines: LyricLine[];
  readonly currentTime: number;
  readonly lyricsLoading: boolean;
  readonly lyricsError: string | null;
  readonly suggestions: UnifiedSong[];
  readonly suggestionsLoading: boolean;
  readonly suggestionsError: string | null;
  readonly likedIds: Set<string>;
  readonly isPlaying: boolean;
  readonly onRetryLyrics: () => void;
  readonly onRetrySuggestions: () => void;
  readonly onSeek: (timestamp: number) => void;
  readonly onPlay: (song: UnifiedSong) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onDiscover: () => void;
  readonly translating?: boolean;
  readonly translated?: boolean;
  readonly translateError?: string | null;
  readonly translateProvider?: string | null;
  readonly onToggleTranslate?: () => void;
}

/** Full-bleed YouTube Music / Apple Music style immersive stage room. */
export function WordsPage({
  song,
  palette = null,
  light = false,
  energy = 0.6,
  queue = [],
  lines,
  currentTime,
  lyricsLoading,
  lyricsError,
  suggestions,
  suggestionsLoading,
  suggestionsError,
  likedIds,
  isPlaying,
  onRetryLyrics,
  onRetrySuggestions,
  onSeek,
  onPlay,
  onLike,
  onDiscover,
  translating,
  translated,
  translateError,
  translateProvider,
  onToggleTranslate
}: WordsPageProps) {
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: motionTokens.duration.instant } : undefined;
  const [activeTab, setActiveTab] = useState<WordsTab>('lyrics');
  const [comments, setComments] = useState<CommentItem[]>(INITIAL_COMMENTS);
  const [newComment, setNewComment] = useState('');

  const isLiked = song ? likedIds.has(song.id) : false;

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    const item: CommentItem = {
      id: `user-${Date.now()}`,
      user: 'You',
      avatarBg: '#3b82f6',
      timeAgo: 'Just now',
      text: newComment.trim(),
      likes: 0
    };
    setComments([item, ...comments]);
    setNewComment('');
  };

  return (
    <motion.div
      className="words-page words-page--ytm-full"
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      transition={transition}
    >
      <motion.header className="words-ytm-bar" variants={itemVariants}>
        <TactileButton variant="ghost" icon={ArrowLeft} onClick={onDiscover} aria-label="Back to discover">
          Discover
        </TactileButton>

        {song ? (
          <div className="words-ytm-now">
            <span className="words-ytm-now-badge">
              <span className={`status-dot ${isPlaying ? 'is-playing' : ''}`} />
              {isPlaying ? 'NOW PLAYING' : 'PAUSED'}
            </span>
            <h1>{song.title}</h1>
            <p>{song.artist} • {song.album ?? 'Single'}</p>
          </div>
        ) : (
          <div className="words-ytm-now">
            <span className="words-ytm-now-badge">WORDS STAGE</span>
            <h1>Pick a song to start</h1>
            <p>Search music, press play, and experience full immersive lyrics.</p>
          </div>
        )}

        <span className="words-ytm-mark" aria-hidden="true">
          <Waves size={16} />
        </span>
      </motion.header>

      {song ? (
        <motion.div className="ytm-stage-container" variants={itemVariants}>
          {/* Backdrop ambient blur derived from artwork */}
          <div className="ytm-stage-shader" aria-hidden="true">
            <MusicFlowShader energy={energy} palette={palette} light={light} />
          </div>
          <div className="ytm-stage-veil" aria-hidden="true" />

          <div className="ytm-stage-grid">
            {/* Left Column: Large Hero Artwork Card & Controls */}
            <div className="ytm-stage-left">
              <div className="ytm-hero-art-card">
                <Artwork song={song} size="large" layoutId={`art-${song.id}`} />
                {isPlaying ? (
                  <div className="art-playing-glow" aria-hidden="true" />
                ) : null}
              </div>

              <div className="ytm-stage-track-info">
                <h2>{song.title}</h2>
                <p className="ytm-artist">{song.artist}</p>
                <p className="ytm-meta">{song.album ? `${song.album} • ` : ''}{song.language ? `${song.language} • ` : ''}{formatTime(song.duration)}</p>

                <div className="ytm-stage-actions">
                  <IconButton
                    icon={Heart}
                    label={isLiked ? 'Remove from likes' : 'Add to likes'}
                    active={isLiked}
                    onClick={() => onLike(song)}
                  />
                  <PlaylistMenu song={song} />
                  {onToggleTranslate && lines.length > 0 ? (
                    <TactileButton
                      variant={translated ? 'accent' : 'secondary'}
                      icon={Sparkles}
                      onClick={onToggleTranslate}
                    >
                      {translating ? 'Translating…' : translated ? 'Original' : 'Translate'}
                    </TactileButton>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Right Column: Stage Tabs & Content (Lyrics, Up Next, Comments, Related) */}
            <div className="ytm-stage-right">
              {/* Stage Navigation Tabs */}
              <nav className="ytm-stage-tabs" aria-label="Lyrics stage tabs">
                <button
                  type="button"
                  className={`ytm-tab ${activeTab === 'upnext' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('upnext')}
                >
                  <ListMusic size={14} aria-hidden="true" />
                  <span>UP NEXT</span>
                </button>
                <button
                  type="button"
                  className={`ytm-tab ${activeTab === 'lyrics' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('lyrics')}
                >
                  <Music2 size={14} aria-hidden="true" />
                  <span>LYRICS</span>
                </button>
                <button
                  type="button"
                  className={`ytm-tab ${activeTab === 'comments' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('comments')}
                >
                  <MessageSquare size={14} aria-hidden="true" />
                  <span>COMMENTS ({comments.length})</span>
                </button>
                <button
                  type="button"
                  className={`ytm-tab ${activeTab === 'related' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('related')}
                >
                  <Sparkles size={14} aria-hidden="true" />
                  <span>RELATED</span>
                </button>
              </nav>

              {/* Tab Content Panel */}
              <div className="ytm-stage-tab-content">
                {activeTab === 'lyrics' && (
                  <LyricsPanel
                    lines={lines}
                    currentTime={currentTime}
                    loading={lyricsLoading}
                    error={lyricsError}
                    onRetry={onRetryLyrics}
                    onSeek={onSeek}
                    artworkUrl={song.artwork}
                    translating={translating}
                    translated={translated}
                    translateError={translateError}
                    translateProvider={translateProvider}
                    onToggleTranslate={onToggleTranslate}
                  />
                )}

                {activeTab === 'upnext' && (
                  <div className="ytm-queue-panel">
                    <div className="ytm-panel-head">
                      <h3>Listening Queue ({queue.length} tracks)</h3>
                    </div>
                    {queue.length > 0 ? (
                      <div className="ytm-queue-list">
                        {queue.map((item, idx) => (
                          <button
                            key={`${item.id}-${idx}`}
                            type="button"
                            className={`ytm-queue-row ${item.id === song.id ? 'is-current' : ''}`}
                            onClick={() => onPlay(item)}
                          >
                            <span className="queue-idx">{String(idx + 1).padStart(2, '0')}</span>
                            <Artwork song={item} size="small" />
                            <div className="queue-copy">
                              <strong>{item.title}</strong>
                              <span>{item.artist}</span>
                            </div>
                            <span className="queue-dur">{formatTime(item.duration)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="Queue is empty"
                        copy="Search for songs or select picks to populate your upcoming queue."
                      />
                    )}
                  </div>
                )}

                {activeTab === 'comments' && (
                  <div className="ytm-comments-panel">
                    <form className="ytm-comment-form" onSubmit={handleAddComment}>
                      <input
                        type="text"
                        placeholder="Add a comment to this song..."
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                      />
                      <button type="submit" className="ytm-comment-submit" disabled={!newComment.trim()} aria-label="Post comment">
                        <Send size={15} />
                      </button>
                    </form>

                    <div className="ytm-comments-list">
                      {comments.map((c) => (
                        <div key={c.id} className="ytm-comment-card">
                          <div className="ytm-comment-avatar" style={{ backgroundColor: c.avatarBg }}>
                            {c.user.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="ytm-comment-body">
                            <div className="ytm-comment-header">
                              <strong>{c.user}</strong>
                              <span className="ytm-comment-time">{c.timeAgo}</span>
                            </div>
                            <p>{c.text}</p>
                            <div className="ytm-comment-foot">
                              <button
                                type="button"
                                className="ytm-like-btn"
                                onClick={() => {
                                  setComments(comments.map((item) => item.id === c.id ? { ...item, likes: item.likes + 1 } : item));
                                }}
                              >
                                ❤️ {c.likes}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === 'related' && (
                  <div className="ytm-related-panel">
                    <div className="ytm-panel-head">
                      <h3>Related Music & Similar Words</h3>
                    </div>
                    {suggestionsLoading ? (
                      <div className="suggestions-state" role="status">
                        Loading related songs…
                      </div>
                    ) : suggestionsError ? (
                      <div className="suggestions-state">
                        <p>{suggestionsError}</p>
                        <TactileButton icon={RefreshCw} onClick={onRetrySuggestions}>
                          Try again
                        </TactileButton>
                      </div>
                    ) : suggestions.length > 0 ? (
                      <div className="library-track-list">
                        {suggestions.map((suggestion, index) => (
                          <SongCard
                            key={suggestion.id}
                            song={suggestion}
                            index={index}
                            isCurrent={suggestion.id === song.id}
                            isPlaying={suggestion.id === song.id && isPlaying}
                            onPlay={() => onPlay(suggestion)}
                            onLike={() => onLike(suggestion)}
                            liked={likedIds.has(suggestion.id)}
                          />
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        title="No related songs found"
                        copy="Try playing another track to see suggestions."
                        action={
                          <TactileButton variant="accent" onClick={onDiscover}>
                            Return to discover
                          </TactileButton>
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.section className="words-empty-state" variants={itemVariants}>
          <EmptyState
            title="Start with a song"
            copy="Search for an artist, title, or feeling, then come back here for the full stage."
            action={
              <TactileButton variant="primary" icon={ArrowUpRight} onClick={onDiscover}>
                Open discover
              </TactileButton>
            }
          />
        </motion.section>
      )}
    </motion.div>
  );
}
