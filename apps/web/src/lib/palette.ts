/**
 * Pulls a small, vivid palette out of album artwork.
 *
 * The previous version read a single pixel after scaling the image to 1x1, which
 * is an average. Averaging a colourful cover gives mud: a red-and-teal sleeve
 * averages to grey-brown. This bins the pixels instead and keeps the most
 * populated *saturated* bins, so the colours it returns are colours that are
 * actually in the picture.
 */

export interface Palette {
  /** Most prominent vivid colour. Drives the accent glow. */
  readonly primary: string;
  /** A different hue from the same cover, for gradient range. */
  readonly secondary: string;
  /** A third stop, falling back to a shifted primary when the cover is nearly monochrome. */
  readonly tertiary: string;
}

export const DEFAULT_PALETTE: Palette = {
  primary: '#5b9dff',
  secondary: '#7f6bff',
  tertiary: '#41d8ff'
};

interface Bin {
  r: number;
  g: number;
  b: number;
  count: number;
  score: number;
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

/** Chroma and lightness of an sRGB triple, both 0..1. */
function chromaOf(r: number, g: number, b: number): { chroma: number; light: number; hue: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const chroma = max - min;
  const light = (max + min) / 2;
  let hue = 0;
  if (chroma !== 0) {
    if (max === rn) hue = ((gn - bn) / chroma + 6) % 6;
    else if (max === gn) hue = (bn - rn) / chroma + 2;
    else hue = (rn - gn) / chroma + 4;
    hue *= 60;
  }
  return { chroma, light, hue };
}

/** sRGB triple back out of hue (deg), saturation and lightness (both 0..1). */
function hslToHex(hue: number, sat: number, light: number): string {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * Push a sampled colour to something that actually reads as colour on near-black.
 *
 * Album art is frequently a muted photograph. Returning its true average gives a
 * grey card, which looks broken rather than moody. So the art is treated as a
 * *hue source*: the hue is kept, saturation and lightness are driven up to a
 * floor. A brown mountain cover becomes a warm amber room, not a grey one.
 */
function vivify(r: number, g: number, b: number): string {
  const { chroma, light, hue } = chromaOf(r, g, b);
  const saturation = light > 0 && light < 1 ? chroma / (1 - Math.abs(2 * light - 1)) : 0;
  // Floors chosen so even a near-monochrome cover produces a visible tint.
  const nextSat = Math.min(1, Math.max(0.62, saturation * 1.5));
  const nextLight = Math.min(0.68, Math.max(0.52, light * 1.25));
  return hslToHex(hue, nextSat, nextLight);
}

function rotateHue(hex: string, degrees: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const { chroma, light, hue } = chromaOf(r, g, b);
  const nextHue = (hue + degrees + 360) % 360;
  const saturation = light > 0 && light < 1 ? chroma / (1 - Math.abs(2 * light - 1)) : 0;
  return hslToHex(nextHue, Math.max(0.6, saturation), Math.min(0.66, Math.max(0.5, light)));
}

/**
 * Reads the artwork and returns its palette. Resolves to DEFAULT_PALETTE when the
 * image cannot be decoded or is not CORS-readable, so callers never branch on it.
 */
export async function extractPalette(src: string, signal?: AbortSignal): Promise<Palette> {
  if (!src) return DEFAULT_PALETTE;
  try {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = src;
    await image.decode();
    if (signal?.aborted) return DEFAULT_PALETTE;

    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return DEFAULT_PALETTE;
    context.drawImage(image, 0, 0, size, size);

    const { data } = context.getImageData(0, 0, size, size);
    const bins = new Map<number, Bin>();

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0;
      if (alpha < 128) continue;
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const { chroma, light } = chromaOf(r, g, b);
      // Ignore near-white and near-black: they carry no hue and would dominate.
      if (light > 0.94 || light < 0.06) continue;
      // Quantise to 5 bits per channel so similar pixels land together.
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, count: 0, score: 0 };
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.count += 1;
      // Population alone returns beige backgrounds. Weighting by chroma returns
      // the colour a person would name if you asked them about the cover.
      // Squared so a small patch of real colour outranks a large grey field.
      bin.score += 1 + chroma * chroma * 26;
      bins.set(key, bin);
    }

    const ranked = [...bins.values()]
      .filter((bin) => bin.count > 2)
      .sort((a, b) => b.score - a.score)
      .map((bin) => ({
        hex: vivify(bin.r / bin.count, bin.g / bin.count, bin.b / bin.count),
        hue: chromaOf(bin.r / bin.count, bin.g / bin.count, bin.b / bin.count).hue
      }));

    if (ranked.length === 0) return DEFAULT_PALETTE;

    const primary = ranked[0];
    // Prefer a genuinely different hue for the second stop so gradients have range.
    const secondary = ranked.find((c) => Math.abs(c.hue - primary.hue) > 40) ?? ranked[1];
    const tertiary =
      ranked.find((c) => c !== primary && c !== secondary && Math.abs(c.hue - primary.hue) > 80) ?? null;

    /*
     * A cover with one hue would otherwise give three near-identical stops and a
     * flat card. Rotating around the primary keeps the record's identity while
     * giving the gradients somewhere to travel.
     */
    return {
      primary: primary.hex,
      secondary: secondary && secondary !== primary ? secondary.hex : rotateHue(primary.hex, 42),
      tertiary: tertiary ? tertiary.hex : rotateHue(primary.hex, -52)
    };
  } catch {
    return DEFAULT_PALETTE;
  }
}
