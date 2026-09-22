/**
 * Optional dedicated player for an instrumental blob URL.
 * Prefer useAudioPlayer.swapAudioSource for unified transport.
 * Does not revoke URLs it did not create (caller owns blob lifecycle).
 */

export interface LiveKaraokePlayerOptions {
  readonly onEnded?: () => void;
  readonly onTimeUpdate?: (currentTime: number) => void;
  readonly onPlayState?: (playing: boolean) => void;
}

export class LiveKaraokePlayer {
  private readonly audio: HTMLAudioElement;
  private src: string | null = null;
  private opts: LiveKaraokePlayerOptions;

  constructor(options: LiveKaraokePlayerOptions = {}) {
    this.opts = options;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';
    this.audio.addEventListener('ended', () => this.opts.onEnded?.());
    this.audio.addEventListener('timeupdate', () =>
      this.opts.onTimeUpdate?.(this.audio.currentTime)
    );
    this.audio.addEventListener('play', () => this.opts.onPlayState?.(true));
    this.audio.addEventListener('pause', () => this.opts.onPlayState?.(false));
  }

  async loadBlobUrl(url: string, resumeAt = 0): Promise<void> {
    this.src = url;
    this.audio.src = url;
    this.audio.load();
    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(new Error('Could not load instrumental audio.'));
      };
      const cleanup = (): void => {
        this.audio.removeEventListener('loadedmetadata', onReady);
        this.audio.removeEventListener('error', onError);
      };
      this.audio.addEventListener('loadedmetadata', onReady, { once: true });
      this.audio.addEventListener('error', onError, { once: true });
    });
    if (Number.isFinite(resumeAt) && resumeAt > 0) {
      this.audio.currentTime = resumeAt;
    }
  }

  async play(): Promise<void> {
    await this.audio.play();
  }

  pause(): void {
    this.audio.pause();
  }

  seek(seconds: number): void {
    this.audio.currentTime = Math.max(0, seconds);
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  get duration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  dispose(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.src = null;
    // Caller owns revokeObjectURL.
  }
}
