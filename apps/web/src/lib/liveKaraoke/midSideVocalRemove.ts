/**
 * Stereo mid-side vocal attenuation.
 * Vocals are often centered (mid); instruments lean into the side channel.
 * Attenuating Mid and keeping Side yields a usable instrumental without a model.
 */

export interface MidSideOptions {
  /** 0 = keep mid fully, 1 = mute mid. Default 0.92. */
  readonly midAttenuation?: number;
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

  const midAttenuation = clamp01(options.midAttenuation ?? 0.92);
  const keepMid = 1 - midAttenuation;
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

  for (let i = 0; i < length; i++) {
    const L = left[i] ?? 0;
    const R = right[i] ?? 0;
    const mid = (L + R) * 0.5;
    const side = (L - R) * 0.5;
    const m = mid * keepMid;
    outL[i] = m + side;
    outR[i] = m - side;
  }

  return { buffer: out, monoSource: false };
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
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

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

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = headerSize;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c]?.[i] ?? 0));
      // Symmetric int16 conversion
      const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
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
