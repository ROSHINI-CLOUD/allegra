/**
 * Stereo vocal attenuation that keeps the mix body.
 *
 * Plain "mute the mid" kills centered bass/kick/pad and sounds like a phone.
 * Instead: keep low mid (bass/body), only duck the vocal band in the mid
 * channel, leave the side channel (width / most instruments) alone.
 */

export interface MidSideOptions {
  /**
   * How hard to duck the vocal-band mid (0 keep fully, 1 mute).
   * Default ~0.72 — enough for vocals without gutting instruments.
   */
  readonly midAttenuation?: number;
  /** Hz below which mid is kept (bass / kick / warmth). Default 220. */
  readonly bassKeepHz?: number;
}

export interface MidSideResult {
  readonly buffer: AudioBuffer;
  /** True when source had fewer than 2 channels (little/no vocal cancel). */
  readonly monoSource: boolean;
}

/**
 * Produce a stereo instrumental AudioBuffer from a decoded mix.
 * Mono sources are duplicated L/R unchanged (no side channel to exploit).
 */
export function midSideVocalRemove(
  source: AudioBuffer,
  options: MidSideOptions = {}
): MidSideResult {
  if (!source || source.length === 0) {
    throw new Error('No audio to process.');
  }

  const channels = source.numberOfChannels;
  const length = source.length;
  const sampleRate = source.sampleRate;
  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });

  if (channels < 2) {
    const mono = source.getChannelData(0);
    out.copyToChannel(mono, 0);
    out.copyToChannel(mono, 1);
    return { buffer: out, monoSource: true };
  }

  const left = source.getChannelData(0);
  const right = source.getChannelData(1);
  const outL = out.getChannelData(0);
  const outR = out.getChannelData(1);

  processMidSideStereo(left, right, outL, outR, sampleRate, options);

  return { buffer: out, monoSource: false };
}

/** Pure DSP used by the worker and the main-thread path. */
export function processMidSideStereo(
  left: Float32Array,
  right: Float32Array,
  outL: Float32Array,
  outR: Float32Array,
  sampleRate: number,
  options: MidSideOptions = {}
): void {
  const atten = clamp01(options.midAttenuation ?? 0.72);
  const keepVocalMid = 1 - atten;
  const bassKeepHz = Math.max(80, Math.min(400, options.bassKeepHz ?? 220));
  // One-pole lowpass coefficient for bassKeepHz
  const rc = 1 / (2 * Math.PI * bassKeepHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);

  let midLow = 0;
  const n = left.length;
  for (let i = 0; i < n; i++) {
    const L = left[i] ?? 0;
    const R = right[i] ?? 0;
    const mid = (L + R) * 0.5;
    const side = (L - R) * 0.5;

    // Keep bass/body in mid; only duck the residual (vocal-ish) mid.
    midLow += alpha * (mid - midLow);
    const midHigh = mid - midLow;
    const midOut = midLow + midHigh * keepVocalMid;

    outL[i] = midOut + side;
    outR[i] = midOut - side;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/** Encode an AudioBuffer as a WAV ArrayBuffer (PCM 16-bit LE). */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  if (numFrames === 0) {
    throw new Error('Cannot encode empty audio.');
  }
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }
  return encodeWavPcm16(channels, sampleRate);
}

/** Fast PCM16 WAV encode from channel arrays (worker-safe). */
export function encodeWavPcm16(
  channels: Float32Array[],
  sampleRate: number
): ArrayBuffer {
  const numChannels = channels.length;
  const numFrames = channels[0]?.length ?? 0;
  if (numFrames === 0) throw new Error('Cannot encode empty audio.');
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);
  const pcm = new Int16Array(arrayBuffer, headerSize);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let w = 0;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      pcm[w++] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
  }

  return arrayBuffer;
}

export function audioBufferToBlobUrl(buffer: AudioBuffer): string {
  const wav = audioBufferToWav(buffer);
  const blob = new Blob([wav], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
