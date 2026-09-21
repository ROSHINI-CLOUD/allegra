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
 * Push a sampled colour just far enough to read as colour on near-black. The hue is the cover's own;
 * saturation and lightness are only nudged into a range, so a brown cover stays brown (not pastel).
 */
function vivify(r: number, g: number, b: number): string {
  const { chroma, light, hue } = chromaOf(r, g, b);
  const saturation = light > 0 && light < 1 ? chroma / (1 - Math.abs(2 * light - 1)) : 0;
  const nextSat = Math.min(0.85, Math.max(0.45, saturation * 1.25));
  const nextLight = Math.min(0.62, Math.max(0.42, light * 1.15));
  return hslToHex(hue, nextSat, nextLight);
}

/** Same hue, different lightness: the honest way to get a second and third stop from a one-colour cover. */
function shiftLightness(hex: string, delta: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const { chroma, light, hue } = chromaOf((value >> 16) & 255, (value >> 8) & 255, value & 255);
  const saturation = light > 0 && light < 1 ? chroma / (1 - Math.abs(2 * light - 1)) : 0;
  return hslToHex(hue, Math.max(0.4, saturation), Math.min(0.68, Math.max(0.3, light + delta)));
}

function hueDistance(left: number, right: number): number {
  const gap = Math.abs(left - right) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/** Scales every stop toward black. Used where a dark tint of the cover colour is wanted, never a bright one. */
export function shadePalette(palette: Palette, factor: number): Palette {
  const shade = (hex: string): string => {
    const value = Number.parseInt(hex.slice(1), 16);
    return toHex(((value >> 16) & 255) * factor, ((value >> 8) & 255) * factor, (value & 255) * factor);
  };
  return { primary: shade(palette.primary), secondary: shade(palette.secondary), tertiary: shade(palette.tertiary) };
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
      // Ignore greys, and ignore washed-out highlights and murky shadows. A blown-out
      // headlight is a large pale-yellow region on plenty of covers; counted as a colour
      // it wins on area alone and then gets dragged to mid-lightness, which is how a warm
      // amber sleeve came out olive green.
      if (chroma < 0.08) continue;
      if (light > 0.78 && chroma < 0.4) continue;
      if (light < 0.16 && chroma < 0.3) continue;
      if (light > 0.94 || light < 0.06) continue;
      // Quantise to 5 bits per channel so similar pixels land together.
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bin = bins.get(key) ?? { r: 0, g: 0, b: 0, count: 0, score: 0 };
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bin.count += 1;
      // Vividness squared, weighted toward mid-lightness. Area still counts — every pixel
      // adds — but a saturated region now beats a larger, paler one, which is what the eye
      // reads as "the colour of this cover".
      const balance = Math.max(0.05, 1 - Math.abs(light - 0.5) * 1.4);
      bin.score += chroma * chroma * balance;
      bins.set(key, bin);
    }

    const ranked = [...bins.values()]
      .filter((bin) => bin.count > 2)
      .sort((a, b) => b.score - a.score)
      .map((bin) => ({
        hex: vivify(bin.r / bin.count, bin.g / bin.count, bin.b / bin.count),
        hue: chromaOf(bin.r / bin.count, bin.g / bin.count, bin.b / bin.count).hue,
        score: bin.score
      }));

    // A black-and-white or grey cover has no hue to use: give it a quiet neutral, not an invented colour.
    if (ranked.length === 0) return { primary: '#7d8087', secondary: '#5f6269', tertiary: '#9a9da4' };

    const primary = ranked[0];
    if (!primary) return DEFAULT_PALETTE;
    // A second / third colour must be a different hue AND a real share of the cover; otherwise use
    // lighter and darker versions of the primary so the palette never drifts off the artwork.
    const secondary = ranked.find((c) => hueDistance(c.hue, primary.hue) > 40 && c.score >= primary.score * 0.08);
    const tertiary = ranked.find(
      (c) => c !== secondary && hueDistance(c.hue, primary.hue) > 40 && (!secondary || hueDistance(c.hue, secondary.hue) > 30) && c.score >= primary.score * 0.05
    );
    return {
      primary: primary.hex,
      secondary: secondary ? secondary.hex : shiftLightness(primary.hex, 0.12),
      tertiary: tertiary ? tertiary.hex : shiftLightness(primary.hex, -0.1)
    };
  } catch {
    return DEFAULT_PALETTE;
  }
}
