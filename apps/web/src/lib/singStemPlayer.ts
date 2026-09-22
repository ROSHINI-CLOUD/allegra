import { resolveApiUrl } from './api';
import { clamp } from './utils';

export interface SingStemUrls {
  readonly vocalsUrl: string;
  readonly instrumentalUrl: string;
}

/** Two independently decoded streams can wander; re-lock once they differ by more than this. */
const MAX_DRIFT_SECONDS = 0.04;
const GUARD_INTERVAL_MS = 400;
/** HTMLMediaElement.HAVE_FUTURE_DATA — enough buffered to keep playing. */
const HAVE_FUTURE_DATA = 3;

/**
 * Dual-stem Sing playback via Web Audio GainNodes.
 * Slider moves only change gains — never contact the network or regenerate stems.
 *
 * The vocals element is the clock. A guard re-locks the instrumental to it if
 * they drift, and a stall in either stem pauses both so they resume together.
 */
export class SingStemPlayer {
  private context: AudioContext | null = null;
  private vocalsEl: HTMLAudioElement | null = null;
  private instrumentalEl: HTMLAudioElement | null = null;
  private vocalsGain: GainNode | null = null;
  private instrumentalGain: GainNode | null = null;
  private vocalsLevel = 0.4;
  private instrumentalLevel = 1;
  private masterLevel = 1;
  /** What the listener asked for; the guard restores playback after a stall. */
  private wantPlaying = false;
  private guard: number | null = null;

  public get currentTime(): number {
    return this.vocalsEl?.currentTime ?? this.instrumentalEl?.currentTime ?? 0;
  }

  public get duration(): number {
    const v = this.vocalsEl?.duration;
    const i = this.instrumentalEl?.duration;
    if (Number.isFinite(v) && (v as number) > 0) return v as number;
    if (Number.isFinite(i) && (i as number) > 0) return i as number;
    return 0;
  }

  public get paused(): boolean {
    return Boolean(this.vocalsEl?.paused ?? true);
  }

  public async start(stems: SingStemUrls, resumeAt: number, play: boolean, masterVolume: number): Promise<void> {
    await this.stop();
    this.masterLevel = clamp(masterVolume, 0, 1);

    const context = new AudioContext();
    this.context = context;
    if (context.state === 'suspended') await context.resume();

    const vocalsEl = new Audio();
    const instrumentalEl = new Audio();
    vocalsEl.crossOrigin = 'anonymous';
    instrumentalEl.crossOrigin = 'anonymous';
    vocalsEl.preload = 'auto';
    instrumentalEl.preload = 'auto';
    vocalsEl.src = resolveApiUrl(stems.vocalsUrl);
    instrumentalEl.src = resolveApiUrl(stems.instrumentalUrl);

    const vocalsSource = context.createMediaElementSource(vocalsEl);
    const instrumentalSource = context.createMediaElementSource(instrumentalEl);
    const vocalsGain = context.createGain();
    const instrumentalGain = context.createGain();
    vocalsSource.connect(vocalsGain).connect(context.destination);
    instrumentalSource.connect(instrumentalGain).connect(context.destination);

    this.vocalsEl = vocalsEl;
    this.instrumentalEl = instrumentalEl;
    this.vocalsGain = vocalsGain;
    this.instrumentalGain = instrumentalGain;
    this.applyGains();

    await Promise.all([waitReady(vocalsEl), waitReady(instrumentalEl)]);
    vocalsEl.currentTime = resumeAt;
    instrumentalEl.currentTime = resumeAt;

    const onStall = (): void => {
      if (!this.wantPlaying) return;
      vocalsEl.pause();
      instrumentalEl.pause();
    };
    vocalsEl.addEventListener('waiting', onStall);
    instrumentalEl.addEventListener('waiting', onStall);
    this.guard = window.setInterval(() => this.keepInSync(), GUARD_INTERVAL_MS);

    this.wantPlaying = play;
    if (play) {
      await Promise.all([vocalsEl.play(), instrumentalEl.play()]);
    }
  }

  public async play(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
    const vocals = this.vocalsEl;
    const instrumental = this.instrumentalEl;
    if (!vocals || !instrumental) return;
    this.wantPlaying = true;
    await Promise.all([vocals.play(), instrumental.play()]);
  }

  public pause(): void {
    this.wantPlaying = false;
    this.vocalsEl?.pause();
    this.instrumentalEl?.pause();
  }

  public seek(seconds: number): void {
    const next = Math.max(0, seconds);
    if (this.vocalsEl) this.vocalsEl.currentTime = next;
    if (this.instrumentalEl) this.instrumentalEl.currentTime = next;
  }

  public setStemLevels(vocals: number, instrumental: number): void {
    this.vocalsLevel = clamp(vocals, 0, 1);
    this.instrumentalLevel = clamp(instrumental, 0, 1);
    this.applyGains();
  }

  public setMasterVolume(value: number): void {
    this.masterLevel = clamp(value, 0, 1);
    this.applyGains();
  }

  public onTimeUpdate(listener: () => void): () => void {
    return this.listen('timeupdate', listener);
  }

  /** Fires when the track reaches its end so the queue can advance. */
  public onEnded(listener: () => void): () => void {
    return this.listen('ended', listener);
  }

  public async stop(): Promise<void> {
    this.wantPlaying = false;
    if (this.guard !== null) {
      window.clearInterval(this.guard);
      this.guard = null;
    }
    this.vocalsEl?.pause();
    this.instrumentalEl?.pause();
    if (this.vocalsEl) {
      this.vocalsEl.removeAttribute('src');
      this.vocalsEl.load();
    }
    if (this.instrumentalEl) {
      this.instrumentalEl.removeAttribute('src');
      this.instrumentalEl.load();
    }
    this.vocalsEl = null;
    this.instrumentalEl = null;
    this.vocalsGain = null;
    this.instrumentalGain = null;
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  private listen(type: 'timeupdate' | 'ended', listener: () => void): () => void {
    const el = this.vocalsEl;
    if (!el) return () => undefined;
    el.addEventListener(type, listener);
    return () => el.removeEventListener(type, listener);
  }

  private keepInSync(): void {
    const vocals = this.vocalsEl;
    const instrumental = this.instrumentalEl;
    if (!vocals || !instrumental || !this.wantPlaying) return;

    // Resume together once both stems have enough data again after a stall.
    if (vocals.paused && instrumental.paused && !vocals.ended) {
      if (vocals.readyState >= HAVE_FUTURE_DATA && instrumental.readyState >= HAVE_FUTURE_DATA) {
        instrumental.currentTime = vocals.currentTime;
        void Promise.all([vocals.play(), instrumental.play()]).catch(() => undefined);
      }
      return;
    }
    if (Math.abs(instrumental.currentTime - vocals.currentTime) > MAX_DRIFT_SECONDS) {
      instrumental.currentTime = vocals.currentTime;
    }
  }

  private applyGains(): void {
    if (this.vocalsGain) this.vocalsGain.gain.value = this.vocalsLevel * this.masterLevel;
    if (this.instrumentalGain) this.instrumentalGain.gain.value = this.instrumentalLevel * this.masterLevel;
  }
}

function waitReady(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      audio.removeEventListener('loadedmetadata', done);
      audio.removeEventListener('error', done);
      resolve();
    };
    audio.addEventListener('loadedmetadata', done, { once: true });
    audio.addEventListener('error', done, { once: true });
  });
}
