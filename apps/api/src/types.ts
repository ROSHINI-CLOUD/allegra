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

/** Mirrors packages/shared/types.ts. */
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
  readonly songs: UnifiedSong[];
  readonly albums: ArtistAlbum[];
  readonly similar: ArtistSummary[];
}

export interface HomePayload {
  readonly trending: UnifiedSong[];
  readonly madeForYou: UnifiedSong[];
  readonly recommended: UnifiedSong[];
}

export type ApiSuccess<T> = { readonly success: true; readonly data: T };
export type ApiFailure = {
  readonly success: false;
  readonly data: null;
  readonly error: string;
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
