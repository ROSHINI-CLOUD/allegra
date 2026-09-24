import type { ElementGraph } from '../audioGraph';
import {
  assembleSegment,
  catchUpChunk,
  chunkIndexAt,
  chunkTail,
  crossfadeHead,
  STREAM_HOP_SAMPLES,
  streamChunkCount
} from './roformer/chunks';
import { ROFORMER_SAMPLE_RATE } from './roformer/config';
import { getSeparator, type SeparatorJobHandlers } from './roformer/separatorClient';
import type { StereoPcm } from './roformer/stft';
import { KaraokeStreamPlayer } from './streamPlayer';

/**
 * How often readiness at the playhead is checked and the separator re-aimed. Playback
 * alone moves the playhead into a ready segment, so this cannot wait for chunk events.
 */
const TICK_MS = 500;
const HOP_MS = (STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE) * 1000;
/** First guess at one chunk's separation time, before any has been measured. */
const INITIAL_CHUNK_MS = 8000;
/** Aim a little past the estimate: landing just short costs a whole extra chunk. */
const LEAD_MARGIN_MS = 1500;
/**
 * Separation has to outrun playback. The first chunk also pays for shader compilation,
 * so it gets more room; the second is the honest measure.
 */
const MAX_FIRST_CHUNK_MS = HOP_MS * 2.5;
const MAX_CHUNK_MS = HOP_MS * 0.95;

export interface StreamSessionEvents {
  /** Model download / session build, 0–1. */
  readonly onModelProgress: (ratio: number) => void;
  /** Instrumental is ready where the listener is. Fires on first readiness and after seeks. */
  readonly onReadyAtPlayhead: () => void;
  /** Once, after two chunks: this device separates faster than the song plays. */
  readonly onKeepingUp: () => void;
  /** Once: separation is slower than playback, so most of the song would keep its vocals. */
  readonly onTooSlow: () => void;
  readonly onError: (message: string) => void;
}

interface Segment {
  readonly pcm: StereoPcm;
  /** False while its head is chunk k's raw output, waiting for chunk k - 1's tail. */
  blended: boolean;
}

/**
 * One song's live karaoke: separated chunks arrive from the worker, get stitched into
 * playable segments, and the stream player swaps them in for the original audio.
 * Turning karaoke off pauses the separator but keeps what is done, so turning it back on
 * for the same song is instant.
 */
export class LiveKaraokeStream {
  private readonly segments = new Map<number, Segment>();
  private readonly tails = new Map<number, StereoPcm>();
  private readonly player: KaraokeStreamPlayer;
  private readonly totalSamples: number;
  private readonly chunkCount: number;
  /** Handed to the worker on first enable; the page keeps no copy. */
  private mix: StereoPcm | null;
  private jobId: number | null = null;
  private timer: number | null = null;
  private chunksTimed = 0;
  /** Smoothed separation time per chunk: how far ahead of the playhead to aim. */
  private chunkMs = INITIAL_CHUNK_MS;
  private wasReady = false;
  private readonly onSeeking = (): void => this.refocus();
  private disposed = false;

  constructor(
    private readonly audio: HTMLAudioElement,
    graph: ElementGraph,
    mix: StereoPcm,
    private readonly events: StreamSessionEvents
  ) {
    this.mix = mix;
    this.totalSamples = Math.min(mix.left.length, mix.right.length);
    this.chunkCount = streamChunkCount(this.totalSamples);
    this.player = new KaraokeStreamPlayer(
      audio,
      graph,
      (index) => this.segments.get(index)?.pcm ?? null,
      this.totalSamples / ROFORMER_SAMPLE_RATE
    );
  }

  /** Share of the song already separated, 0–1. */
  public get processed(): number {
    return this.segments.size / this.chunkCount;
  }

  public readyAtPlayhead(): boolean {
    return this.player.readyAtPlayhead();
  }

  public enable(): void {
    if (this.disposed) return;
    const separator = getSeparator();
    const handlers = this.handlers();
    if (this.mix) {
      this.jobId = separator.startJob(this.mix, this.focusChunk(), handlers);
      this.mix = null;
    } else if (this.jobId === null || !separator.resume(this.jobId, handlers)) {
      // The worker was replaced since this song was handed over; the audio is gone with it.
      this.events.onError('The karaoke engine restarted. Turn Karaoke on again.');
      return;
    }
    this.audio.addEventListener('seeking', this.onSeeking);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.player.enable();
    this.wasReady = false;
    this.checkReady();
  }

  public disable(): void {
    this.audio.removeEventListener('seeking', this.onSeeking);
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.jobId !== null) getSeparator().pause(this.jobId);
    this.player.disable();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disable();
    if (this.jobId !== null) getSeparator().cancel(this.jobId);
    this.jobId = null;
    this.mix = null;
    this.player.dispose();
    this.segments.clear();
    this.tails.clear();
    this.disposed = true;
  }

  private handlers(): SeparatorJobHandlers {
    return {
      onProgress: (ratio) => this.events.onModelProgress(ratio),
      onChunk: (index, pcm, ms) => {
        if (this.disposed) return;
        this.store(index, pcm);
        this.judgePace(ms);
        this.chunkMs = this.chunkMs * 0.5 + ms * 0.5;
        this.player.segmentReady();
        this.checkReady();
      },
      onError: (message) => {
        if (!this.disposed) this.events.onError(message);
      }
    };
  }

  /** Keep only what playback needs: the segment itself and the tail its successor blends in. */
  private store(index: number, chunk: StereoPcm): void {
    const prevTail = this.tails.get(index - 1) ?? null;
    this.segments.set(index, {
      pcm: assembleSegment(index, this.totalSamples, chunk, prevTail),
      blended: index === 0 || prevTail !== null
    });
    if (prevTail) this.tails.delete(index - 1);

    const next = this.segments.get(index + 1);
    if (next && !next.blended) {
      // Its predecessor arrived late (it was separated first after a seek): finish its crossfade.
      crossfadeHead(next.pcm, chunkTail(chunk));
      next.blended = true;
    } else if (!next && index + 1 < this.chunkCount) {
      this.tails.set(index, chunkTail(chunk));
    }
  }

  private judgePace(ms: number): void {
    if (this.chunksTimed >= 2) return;
    this.chunksTimed += 1;
    const limit = this.chunksTimed === 1 ? MAX_FIRST_CHUNK_MS : MAX_CHUNK_MS;
    if (ms > limit) {
      this.chunksTimed = 2;
      this.events.onTooSlow();
    } else if (this.chunksTimed === 2) {
      this.events.onKeepingUp();
    }
  }

  /**
   * Where the separator should work next. With instrumental at the playhead, straight on
   * from there. Without it, the first chunk that will still be ahead of the listener when
   * it lands and leaves time for the next one (see `catchUpChunk`).
   */
  private focusChunk(): number {
    const now = this.audio.currentTime;
    if (this.audio.paused || this.player.readyAtPlayhead()) return chunkIndexAt(now, this.totalSamples);
    const chunkSeconds = this.chunkMs / 1000;
    const arriveAt = now + chunkSeconds + LEAD_MARGIN_MS / 1000;
    return catchUpChunk(arriveAt, chunkSeconds, this.totalSamples);
  }

  private tick(): void {
    this.refocus();
    this.checkReady();
  }

  /** Report each move from "original playing" to "instrumental playing" at the playhead. */
  private checkReady(): void {
    const ready = this.player.readyAtPlayhead();
    if (ready && !this.wasReady) this.events.onReadyAtPlayhead();
    this.wasReady = ready;
  }

  private refocus(): void {
    if (this.jobId !== null) getSeparator().focus(this.jobId, this.focusChunk());
  }
}
