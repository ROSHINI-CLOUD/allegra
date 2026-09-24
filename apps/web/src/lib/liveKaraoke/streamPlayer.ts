import type { ElementGraph } from '../audioGraph';
import { ROFORMER_SAMPLE_RATE } from './roformer/config';
import { STREAM_HOP_SAMPLES } from './roformer/chunks';
import type { StereoPcm } from './roformer/stft';

/** Schedule this far ahead of "now" so a start never lands in the past. */
const LEAD_SECONDS = 0.03;
/** Keep this much instrumental queued ahead of the playhead. */
const QUEUE_AHEAD_SECONDS = 12;
/** Re-lock to the element when the two clocks disagree by more than this. */
const MAX_DRIFT_SECONDS = 0.12;
const RAMP_SECONDS = 0.015;
const TICK_MS = 250;
const SEGMENT_SECONDS = STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE;

interface Scheduled {
  readonly node: AudioBufferSourceNode;
  readonly index: number;
  readonly endCtx: number;
}

/**
 * Plays a separated instrumental in place of the <audio> element's own sound, segment by
 * segment, as the separator produces them.
 *
 * The element stays the clock and keeps playing its original stream — its src never
 * changes, so play/pause/seek, the progress bar and the lyrics keep working untouched.
 * Where a processed segment is ready the element's dry signal is muted and the segment
 * plays instead; where it is not (yet), the listener hears the original song rather
 * than silence.
 */
export class KaraokeStreamPlayer {
  /** Gate: opens where a processed segment plays. Automated, so volume lives elsewhere. */
  private readonly wet: GainNode;
  /** Mirrors the element's volume and mute, which the processed path would otherwise skip. */
  private readonly volume: GainNode;
  private scheduled: Scheduled[] = [];
  /** Maps context time to song time while the chain runs: song = pos + (ctx - ctx0). */
  private anchor: { ctx0: number; pos: number } | null = null;
  private timer: number | null = null;
  private enabled = false;
  private readonly unlisten: Array<() => void> = [];

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly graph: ElementGraph,
    private readonly getSegment: (index: number) => StereoPcm | null,
    private readonly totalSeconds: number
  ) {
    this.wet = graph.context.createGain();
    this.wet.gain.value = 0;
    this.volume = graph.context.createGain();
    this.wet.connect(this.volume).connect(graph.bus);
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    const on = (type: string, fn: () => void): void => {
      this.audio.addEventListener(type, fn);
      this.unlisten.push(() => this.audio.removeEventListener(type, fn));
    };
    const halt = (): void => this.halt();
    on('pause', halt);
    on('waiting', halt);
    on('seeking', halt);
    on('emptied', halt);
    on('ended', halt);
    on('playing', () => this.relock());
    on('seeked', () => this.relock());
    on('volumechange', () => this.applyVolume());
    this.applyVolume();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.relock();
  }

  /** Back to the original song. The graph stays; the element simply sounds again. */
  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const off of this.unlisten.splice(0)) off();
    this.halt();
    this.setDry(1);
  }

  public dispose(): void {
    this.disable();
    this.wet.disconnect();
    this.volume.disconnect();
  }

  /** The separator finished a segment: extend the queue if it is the one we are waiting for. */
  public segmentReady(): void {
    if (this.enabled) this.topUp();
  }

  /** Whether processed audio exists at the current playhead. */
  public readyAtPlayhead(): boolean {
    return this.getSegment(this.segmentAt(this.audio.currentTime)) !== null;
  }

  private segmentAt(seconds: number): number {
    return Math.max(0, Math.floor(seconds / SEGMENT_SECONDS));
  }

  private playing(): boolean {
    return !this.audio.paused && !this.audio.seeking && !this.audio.ended;
  }

  private songTimeAt(ctxTime: number): number {
    const a = this.anchor;
    return a ? a.pos + (ctxTime - a.ctx0) : this.audio.currentTime;
  }

  /** Stop everything queued. Mute the dry path only if we can take over the moment playback resumes. */
  private halt(): void {
    for (const s of this.scheduled) {
      try {
        s.node.stop();
      } catch {
        /* already stopped */
      }
      s.node.disconnect();
    }
    this.scheduled = [];
    this.anchor = null;
    const now = this.graph.context.currentTime;
    this.wet.gain.cancelScheduledValues(now);
    this.wet.gain.setValueAtTime(0, now);
    this.setDry(this.enabled && this.readyAtPlayhead() ? 0 : 1);
  }

  /** Throw the queue away and rebuild it from where the element is now. */
  private relock(): void {
    this.halt();
    if (!this.enabled || !this.playing()) return;
    const ctx = this.graph.context;
    this.anchor = { ctx0: ctx.currentTime, pos: this.audio.currentTime };
    this.topUp();
  }

  private topUp(): void {
    if (!this.enabled || !this.playing()) return;
    const ctx = this.graph.context;
    if (!this.anchor) this.anchor = { ctx0: ctx.currentTime, pos: this.audio.currentTime };

    // Drop sources that have finished.
    const now = ctx.currentTime;
    this.scheduled = this.scheduled.filter((s) => s.endCtx > now);

    const last = this.scheduled[this.scheduled.length - 1];
    let startCtx = last ? last.endCtx : now + LEAD_SECONDS;
    let songPos = this.songTimeAt(startCtx);
    let index = last ? last.index + 1 : this.segmentAt(songPos);
    const chainStart = startCtx;

    while (startCtx - now < QUEUE_AHEAD_SECONDS && songPos < this.totalSeconds) {
      const pcm = this.getSegment(index);
      if (!pcm) break;
      const segStart = index * SEGMENT_SECONDS;
      const offset = Math.max(0, songPos - segStart);
      const buffer = ctx.createBuffer(2, Math.max(1, pcm.left.length), ROFORMER_SAMPLE_RATE);
      buffer.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
      buffer.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
      if (offset >= buffer.duration) {
        index += 1;
        continue;
      }
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.wet);
      node.start(startCtx, offset);
      const endCtx = startCtx + (buffer.duration - offset);
      this.scheduled.push({ node, index, endCtx });
      startCtx = endCtx;
      songPos = this.songTimeAt(startCtx);
      index += 1;
    }

    const queuedUntil = this.scheduled[this.scheduled.length - 1]?.endCtx;
    if (queuedUntil === undefined) {
      // Nothing ready at the playhead: the listener hears the original meanwhile.
      this.setDry(1);
      return;
    }
    // Wet on from where the chain starts; hand back to the dry signal where it runs out.
    const wet = this.wet.gain;
    const dry = this.graph.dry.gain;
    const from = Math.max(now, Math.min(chainStart, this.scheduled[0]!.endCtx));
    wet.cancelScheduledValues(from);
    dry.cancelScheduledValues(from);
    if (!last) {
      wet.setValueAtTime(0, from);
      wet.linearRampToValueAtTime(1, from + RAMP_SECONDS);
      dry.setValueAtTime(dry.value, from);
      dry.linearRampToValueAtTime(0, from + RAMP_SECONDS);
    }
    wet.setValueAtTime(1, queuedUntil);
    wet.linearRampToValueAtTime(0, queuedUntil + RAMP_SECONDS);
    dry.setValueAtTime(0, queuedUntil);
    dry.linearRampToValueAtTime(1, queuedUntil + RAMP_SECONDS);
  }

  private tick(): void {
    if (!this.enabled) return;
    if (!this.playing()) return;
    if (this.scheduled.length > 0 && this.anchor) {
      const drift = this.audio.currentTime - this.songTimeAt(this.graph.context.currentTime);
      if (Math.abs(drift) > MAX_DRIFT_SECONDS) {
        this.relock();
        return;
      }
    }
    this.topUp();
  }

  private setDry(value: number): void {
    const now = this.graph.context.currentTime;
    const dry = this.graph.dry.gain;
    dry.cancelScheduledValues(now);
    dry.setValueAtTime(dry.value, now);
    dry.linearRampToValueAtTime(value, now + RAMP_SECONDS);
  }

  private applyVolume(): void {
    this.volume.gain.value = this.audio.muted ? 0 : this.audio.volume;
  }
}
