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

export interface HomePayload {
  readonly trending: UnifiedSong[];
  readonly madeForYou: UnifiedSong[];
  readonly recommended: UnifiedSong[];
}

export type ApiResponse<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly data: null; readonly error: string };
