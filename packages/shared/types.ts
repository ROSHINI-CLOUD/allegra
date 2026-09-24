export interface UnifiedSong {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly artwork: string;
  readonly streamUrl: string;
  readonly duration: number;
  readonly hasLyrics: boolean;
  readonly language?: string;
  readonly playCount: number;
  readonly source: 'Saavn' | 'Gaana';
  /** Other release rows for the same recording. Search/suggestions only; never nested. */
  readonly variants?: readonly UnifiedSong[];
}

export interface LyricLine {
  readonly timestamp: number;
  readonly text: string;
  readonly lineOrder: number;
}

export interface LyricsPayload {
  readonly source: string;
  readonly type: 'synced' | 'plain';
  readonly matchScore: number;
  readonly matchReason: string;
  readonly lines: LyricLine[];
}

/** A lead artist as the catalog knows them: a real photo when the provider has one. */
export interface ArtistSummary {
  readonly id: string;
  readonly name: string;
  readonly image: string | null;
}

export interface ArtistAlbum {
  readonly id: string;
  readonly name: string;
  readonly year: string | null;
  readonly image: string | null;
}

export interface ArtistProfile extends ArtistSummary {
  readonly isVerified: boolean;
  readonly followerCount: number | null;
  readonly bio: string | null;
  /** Most popular songs first. Every entry is playable (has a stream). */
  readonly songs: UnifiedSong[];
  readonly albums: ArtistAlbum[];
  readonly similar: ArtistSummary[];
}

export interface HomePayload {
  readonly trending: UnifiedSong[];
  readonly madeForYou: UnifiedSong[];
  readonly recommended: UnifiedSong[];
}

export type ApiResponse<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly data: null; readonly error: string };

export interface AccountProfile {
  readonly userId: string;
  readonly isGuest: boolean;
  readonly createdAt: string;
  readonly displayName?: string;
  readonly email?: string;
}

/** What the app has learned about a listener, strongest first. */
export interface TasteSummary {
  readonly topArtists: { readonly name: string; readonly score: number }[];
  readonly languages: { readonly name: string; readonly score: number }[];
  readonly signals: number;
  /** False until they pick favourites or listen enough for us to know. */
  readonly onboarded: boolean;
  /** 3–6 search/mood chips derived from this taste (server-built). */
  readonly prompts: readonly string[];
}

export interface SharedPlaylist {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  /** Custom playlist cover when the owner uploaded one (CloudFront / public S3 URL). */
  readonly coverUrl?: string;
  readonly ownerName: string;
  readonly songs: UnifiedSong[];
}
