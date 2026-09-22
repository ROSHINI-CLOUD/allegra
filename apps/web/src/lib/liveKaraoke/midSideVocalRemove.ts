/**
 * Stereo vocal attenuation that keeps the mix body.
 *
 * Plain "mute the mid" kills centered bass/kick/pad and sounds like a phone.
 * Instead: keep low mid (bass/body), heavily duck the vocal band in the mid
 * channel (~5% left), keep more of the air band, leave the side channel alone.
 */

export interface MidSideOptions {
  /**
   * How hard to duck the vocal-band mid (0 keep fully, 1 mute).
   * Default 0.95 — about 5% of centered vocals left.
   */
  readonly midAttenuation?: number;
  /** Hz below which mid is kept (bass / kick / warmth). Default 200. */
  readonly bassKeepHz?: number;
  /**
   * Hz above which mid is treated as air (cymbals/hihat) and ducked less.
   * Default 5200.
   */
  readonly airKeepHz?: number;
  /** Keep amount for air-band mid (0–1). Default 0.55. */
  readonly airKeep?: number;
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
  // ~5% vocal-band mid left by default; bass + side stay fuller.
  const atten = clamp01(options.midAttenuation ?? 0.95);
  const keepVocalMid = 1 - atten;
  const bassKeepHz = Math.max(80, Math.min(400, options.bassKeepHz ?? 200));
  const airKeepHz = Math.max(bassKeepHz + 500, Math.min(12000, options.airKeepHz ?? 5200));
  const airKeep = clamp01(options.airKeep ?? 0.55);

  const dt = 1 / sampleRate;
  const alphaBass = dt / (1 / (2 * Math.PI * bassKeepHz) + dt);
  const alphaAir = dt / (1 / (2 * Math.PI * airKeepHz) + dt);

  let midLow = 0;
  let midBelowAir = 0;
  const n = left.length;
  for (let i = 0; i < n; i++) {
    const L = left[i] ?? 0;
    const R = right[i] ?? 0;
    const mid = (L + R) * 0.5;
    const side = (L - R) * 0.5;

    // mid = bass + vocalBand + air
    midLow += alphaBass * (mid - midLow);
    const midNoBass = mid - midLow;
    midBelowAir += alphaAir * (midNoBass - midBelowAir);
    const midVocal = midBelowAir;
    const midAir = midNoBass - midBelowAir;

    const midOut = midLow + midVocal * keepVocalMid + midAir * airKeep;

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
