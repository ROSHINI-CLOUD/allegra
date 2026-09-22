/**
 * Optional dedicated player for an instrumental AudioBuffer / blob URL.
 * Prefer useAudioPlayer.swapAudioSource for unified transport; this class
 * remains available if the main element cannot take a blob URL.
 */

export interface LiveKaraokePlayerOptions {
  readonly onEnded?: () => void;
  readonly onTimeUpdate?: (currentTime: number) => void;
  readonly onPlayState?: (playing: boolean) => void;
}

export class LiveKaraokePlayer {
  private readonly audio: HTMLAudioElement;
  private blobUrl: string | null = null;
  private opts: LiveKaraokePlayerOptions;

  constructor(options: LiveKaraokePlayerOptions = {}) {
    this.opts = options;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => this.opts.onEnded?.());
    this.audio.addEventListener('timeupdate', () =>
      this.opts.onTimeUpdate?.(this.audio.currentTime)
    );
    this.audio.addEventListener('play', () => this.opts.onPlayState?.(true));
    this.audio.addEventListener('pause', () => this.opts.onPlayState?.(false));
  }

  async loadBlobUrl(url: string, resumeAt = 0): Promise<void> {
    this.revoke();
    this.blobUrl = url;
    this.audio.src = url;
    this.audio.load();
    await new Promise<void>((resolve) => {
      const done = (): void => {
        this.audio.removeEventListener('loadedmetadata', done);
        this.audio.removeEventListener('error', done);
        resolve();
      };
      this.audio.addEventListener('loadedmetadata', done, { once: true });
      this.audio.addEventListener('error', done, { once: true });
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

  muteMain(main: HTMLAudioElement | null): void {
    if (!main) return;
    main.pause();
    main.muted = true;
  }

  restoreMain(main: HTMLAudioElement | null): void {
    if (!main) return;
    main.muted = false;
  }

  dispose(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.revoke();
  }

  private revoke(): void {
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }
}
