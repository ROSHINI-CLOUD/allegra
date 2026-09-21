// Copied from VibeRoom src/components/MusicFlowShader.tsx
import { useEffect, useRef } from 'react'

import type { AudioBands } from '../../hooks/useAudioAnalyser'
import type { Palette } from '../../lib/palette'

/** One frame's worth of what the speakers are doing. */
export interface AudioReading extends AudioBands {
  /** Overall loudness, 0–1. */
  readonly level: number
}

/**
 * Sampled once per animation frame, inside the render loop. Returning `null` means nothing is
 * playing, and the field falls back to the constant `energy` prop rather than going dark.
 *
 * It is a function rather than a prop value on purpose: audio moves at 60fps and React must not
 * re-render for it.
 */
export type AudioProbe = () => AudioReading | null

type MusicFlowShaderProps = {
  /** 0–1 room energy. Steady ambient strength — not beat-synced. */
  energy?: number
  /** @deprecated Ignored. Motion is timer-only; kept for old call-site types. */
  audio?: AudioProbe
  /** Mood shifts palette and wave character. */
  mood?: 'energy' | 'chill' | 'different' | 'surprise'
  /** Album-art palette. When set it replaces the mood colours and eases between songs. */
  palette?: Palette | null
  /** Render the lifted prism treatment used by the light theme. */
  light?: boolean
  className?: string
}

const vertexShader = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

// Reeded-glass light field adapted from Cubify LookupWebGLShader.
// Cube replaced with a singing glass orb; columns breathe like audio.
const fragmentShader = `
precision highp float;

uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;
uniform float uRibs;
uniform float uEnergy;
// Live band energies: x = bass, y = mid, z = treble. All zero when nothing is playing.
uniform vec3 uBands;
uniform float uMood;
uniform vec3 uAccent;
uniform vec3 uBright;
uniform vec3 uSky;
uniform vec3 uDeep;
uniform float uLight;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float bell(float x, float center, float width) {
  float d = (x - center) / width;
  return exp(-d * d);
}

float smoother(float x) {
  x = clamp(x, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

mat3 rotX(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

mat3 rotY(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
}

vec2 orbCenter() {
  float aspect = uResolution.x / uResolution.y;
  float portrait = 1.0 - smoothstep(0.7, 1.3, aspect);
  vec2 c = mix(vec2(0.72, 0.48), vec2(0.5, 0.62), portrait);
  float sing = sin(uTime * (1.1 + uEnergy * 1.8)) * 0.012 * (0.4 + uEnergy);
  c.y += sing;
  c.x += 0.006 * sin(uTime * 0.55 + uMood);
  return c;
}

// Soft glass orb that expands with the beat — the room's "voice".
vec4 singingOrb(vec2 uv) {
  float aspect = uResolution.x / uResolution.y;
  float portrait = 1.0 - smoothstep(0.7, 1.3, aspect);
  vec2 center = orbCenter();
  float scale = mix(5.4, 7.2, portrait);
  vec2 q = (uv - center) * vec2(aspect, 1.0) * scale;

  float beat = 0.5 + 0.5 * sin(uTime * (2.2 + uEnergy * 3.4));
  float breath = mix(0.92, 1.14, smoother(beat) * (0.35 + uEnergy * 0.65));

  float yaw = uTime * (0.18 + uEnergy * 0.22) + (uPointer.x - 0.5) * 0.55;
  float pitch = -0.28 + 0.08 * sin(uTime * 0.4) + (uPointer.y - 0.5) * 0.2;
  mat3 R = rotX(pitch) * rotY(yaw);

  vec3 rdWorld = normalize(vec3(q, 6.2));
  vec3 ro = vec3(0.0, 0.0, -6.2) * R;
  vec3 rd = rdWorld * R;

  // Keep the orb as a signature, but leave the hero readable around it.
  float radius = 0.28 * breath;
  float bh = radius + 0.12;
  vec3 invD = 1.0 / (rd + vec3(0.00001));
  vec3 ta = (vec3(-bh) - ro) * invD;
  vec3 tb = (vec3(bh) - ro) * invD;
  vec3 tmn = min(ta, tb);
  vec3 tmx = max(ta, tb);
  float t0 = max(max(tmn.x, tmn.y), tmn.z);
  float t1 = min(min(tmx.x, tmx.y), tmx.z);
  if (t1 < t0) return vec4(0.0, 0.0, 0.0, 1.0);

  float T = 1.0;
  vec3 acc = vec3(0.0);
  float firstT = -1.0;
  float dt = (t1 - t0) / 40.0;

  for (int i = 0; i < 40; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * dt);
    float dist = length(p) - radius;

    // Nested singing shells — rings that feel like harmonics.
    float shell = abs(fract(length(p) * (2.4 + uMood * 0.4) - uTime * (0.35 + uEnergy)) - 0.5);
    float ripple = exp(-pow((shell - 0.12) / 0.06, 2.0));

    vec3 tint = mix(uDeep * 0.35, uAccent, 0.55 + 0.35 * sin(p.y * 3.0 + uTime));
    tint = mix(tint, uBright, clamp(ripple * (0.4 + uEnergy), 0.0, 1.0));
    tint = mix(tint, uSky, 0.25 + 0.2 * uMood * 0.15);

    if (firstT < 0.0 && dist < 0.0) firstT = t0 + (float(i) + 0.5) * dt;
    float inside = 1.0 - smoothstep(-0.04, 0.01, dist);
    float a = inside * (1.0 - exp(-dt * 0.85));
    acc += T * a * tint * (1.05 + uEnergy * 0.35);
    T *= 1.0 - a;

    float glint = exp(-pow(dist / 0.025, 2.0)) * dt * 0.95;
    acc += T * glint * mix(mix(uSky, vec3(1.0), 0.4), tint, 0.4);
    acc += T * ripple * inside * uBright * 0.08 * (0.5 + uEnergy);
    if (T < 0.03) break;
  }

  if (firstT > 0.0) {
    vec3 p = ro + rd * firstT;
    vec3 n = normalize(R * normalize(p));
    vec3 keyDir = normalize(vec3(0.4, 0.75, -0.5));
    vec3 poolDir = normalize(vec3(-0.35, -0.65, -0.55));
    vec3 refl = reflect(rdWorld, n);
    float spec = pow(max(dot(refl, keyDir), 0.0), 42.0) + 0.55 * pow(max(dot(refl, poolDir), 0.0), 28.0);
    float fres = pow(1.0 - clamp(dot(n, -rdWorld), 0.0, 1.0), 2.8);
    acc += mix(uSky, vec3(1.0), 0.45) * spec * (0.85 + uEnergy * 0.4) + uAccent * fres * 0.35;
  }

  return vec4(acc, T);
}

// Columns of light that sing — each on its own phase like a vocal / EQ stack.
vec3 lightField(vec2 uv) {
  float tempo = 0.35 + uEnergy * 0.85;
  float t = uTime * tempo;
  float aspect = uResolution.x / uResolution.y;

  float y = uv.y;
  y += (uPointer.y - 0.5) * 0.018 * (1.0 - y);
  float portrait = 1.0 - smoothstep(0.7, 1.3, aspect);
  float x = mix(uv.x, mix(0.18, 0.82, uv.x), portrait);
  x += (uPointer.x - 0.5) * 0.035;

  // Flowing wave shear — music moving through the glass.
  float flow = sin(uv.y * 6.0 - uTime * (1.2 + uEnergy * 2.0) + uMood) * 0.018 * (0.35 + uEnergy);
  x += flow;

  float dome = 0.5 + 0.5 * cos((x - 0.5) * 3.14159265 * 1.05);
  y -= dome * 0.08;

  float columns = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float center = fract(0.08 + fi * 0.618034) + 0.025 * sin(t * 0.55 + fi * 1.3);
    float width = 0.035 + 0.05 * hash(vec2(fi, 3.0 + uMood));
    // Singing: amplitude stacks harmonics of the beat.
    float fund = sin(t * (0.7 + 0.18 * fi) + fi * 1.7);
    float harm = sin(t * (1.5 + 0.25 * fi) + fi * 2.4 + uMood);
    float pulse = 0.45 + 0.55 * (0.65 * fund + 0.35 * harm);
    pulse = mix(pulse, abs(pulse), 0.25 + uEnergy * 0.35);
    // The nine columns read left to right as an EQ stack: the first three carry the kick,
    // the middle three the body of the mix, the last three the air.
    float band = fi < 3.0 ? uBands.x : (fi < 6.0 ? uBands.y : uBands.z);
    float heightBoost = 0.7 + 0.55 * uEnergy + 0.15 * sin(t * 2.0 + fi) + band * 1.15;
    columns += bell(x, center, width) * pulse * heightBoost;
  }

  float drift = bell(x, 0.5 + 0.2 * sin(t * 0.65), 0.44);
  float exposure = 0.45 + 0.95 * drift * (0.7 + uEnergy * 0.45);
  float heightFade = pow(1.0 - smoothstep(0.02, 1.0, y), 1.0);
  float light = clamp((0.14 + columns * 0.52) * heightFade * exposure, 0.0, 1.0);

  vec3 dark = uDeep * 0.06 + vec3(0.004, 0.006, 0.012);
  vec3 color = mix(dark, uAccent, smoothstep(0.05, 0.62, light));
  color = mix(color, uBright, smoothstep(0.38, 0.95, light));
  color = mix(color, uSky, smoothstep(0.55, 1.0, light) * (0.2 + uMood * 0.08));

  // The pool of light on the floor swells on the kick — the one place bass is felt, not seen.
  float poolHeight = 0.10 + 0.14 * dome + 0.06 * drift + uBands.x * 0.05;
  float pool = 1.0 - smoothstep(poolHeight - 0.08, poolHeight + 0.22, y);
  color = mix(color, mix(uBright, uSky, 0.55), pool * (0.82 + uBands.x * 0.14));
  float core = 1.0 - smoothstep(-0.08, poolHeight * 0.55, y);
  color = mix(color, mix(uSky, vec3(1.0), 0.28), core);

  float halo = bell(uv.x, 0.5, 0.32) * bell(y, 0.48, 0.32);
  color += uDeep * 0.06 * halo;
  float vignette = smoothstep(0.0, 0.08, uv.x) * (1.0 - smoothstep(0.96, 1.08, uv.x));
  color *= 0.78 + 0.22 * vignette;
  return color;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;

  float glass = smoothstep(0.02, 0.44, uv.y);
  float phase = fract(uv.x * uRibs);
  float ramp = phase - 0.5;
  float bevel = sin(ramp * 3.14159265);
  float lens = (0.55 * ramp + 0.225 * bevel) * 0.05 * glass;
  // Extra musical shimmer along the flutes.
  // Cymbals and consonants travel up the flutes as shimmer.
  lens += 0.004 * sin(uv.y * 18.0 - uTime * (1.4 + uEnergy * 2.0)) * glass * (uEnergy + uBands.z * 0.9);
  vec2 refracted = uv + vec2(lens, ramp * 0.012 * glass);

  // Allegra: no orb. Behind a translucent panel it read as a stray blob, and the raymarch
  // is the priciest part of the shader. singingOrb() stays for reference; a fully
  // transparent result leaves the flutes untouched.
  vec4 orb = vec4(0.0, 0.0, 0.0, 1.0);
  vec3 color = lightField(refracted - (uv - orbCenter()) * (1.0 - orb.a) * 0.12);
  color = color * orb.a + orb.rgb;

  float shade = exp(-pow((phase - 0.03) / 0.06, 2.0));
  float catchLight = exp(-pow((phase - 0.94) / 0.05, 2.0));
  float body = 0.9 + 0.2 * phase;
  color *= mix(1.0, body * (1.0 - 0.28 * shade), glass);
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));

  vec3 rimColor = mix(mix(uSky, uBright, 0.5), uAccent, 0.45 + 0.2 * sin(uTime + uv.x * uRibs));
  color += rimColor * catchLight * (0.03 + luminance * 0.18) * glass * (1.0 + uBands.z * 0.55);

  float grain = hash(gl_FragCoord.xy + vec2(uTime * 0.01, 0.0)) - 0.5;
  color += grain * 0.02 * (0.15 + smoothstep(0.02, 0.35, luminance));

  color += uBright * 0.09 * smoothstep(0.84, 1.0, uv.y) * (0.55 + 0.45 * sin(uv.x * 3.2 + uTime * 0.4));

  // Light mode is still the same cover-led field, but refracted through a
  // bright prism: lift the floor without washing hue into neutral gray.
  float prism = clamp(uLight, 0.0, 1.0);
  vec3 lifted = mix(color, vec3(0.96), 0.42);
  float liftedLuma = dot(lifted, vec3(0.2126, 0.7152, 0.0722));
  lifted = mix(vec3(liftedLuma), lifted, 1.18);
  color = mix(color, clamp(lifted, 0.0, 1.0), prism);

  gl_FragColor = vec4(color, 1.0);
}
`

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  if (import.meta.env.DEV) console.warn('[MusicFlowShader] compile failed:', gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
  return null
}

function createProgram(gl: WebGLRenderingContext) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShader)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShader)
  if (!vertex || !fragment) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program
  gl.deleteProgram(program)
  return null
}

const moodPalettes: Record<NonNullable<MusicFlowShaderProps['mood']>, {
  accent: [number, number, number]
  bright: [number, number, number]
  sky: [number, number, number]
  deep: [number, number, number]
  mood: number
}> = {
  energy: {
    accent: [238 / 255, 107 / 255, 95 / 255],
    bright: [255 / 255, 170 / 255, 150 / 255],
    sky: [123 / 255, 175 / 255, 212 / 255],
    deep: [40 / 255, 22 / 255, 24 / 255],
    mood: 0.2,
  },
  chill: {
    accent: [123 / 255, 175 / 255, 212 / 255],
    bright: [196 / 255, 221 / 255, 116 / 255],
    sky: [140 / 255, 190 / 255, 210 / 255],
    deep: [18 / 255, 28 / 255, 36 / 255],
    mood: 1.0,
  },
  different: {
    accent: [161 / 255, 142 / 255, 194 / 255],
    bright: [238 / 255, 107 / 255, 95 / 255],
    sky: [123 / 255, 175 / 255, 212 / 255],
    deep: [28 / 255, 22 / 255, 40 / 255],
    mood: 2.0,
  },
  surprise: {
    accent: [196 / 255, 221 / 255, 116 / 255],
    bright: [238 / 255, 107 / 255, 95 / 255],
    sky: [180 / 255, 210 / 255, 140 / 255],
    deep: [24 / 255, 32 / 255, 18 / 255],
    mood: 3.0,
  },
}

type Rgb = [number, number, number]
type Colors = { accent: Rgb; bright: Rgb; sky: Rgb; deep: Rgb }

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '')
  const value = Number.parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16)
  if (!Number.isFinite(value)) return [0.5, 0.5, 0.5]
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** Maps a cover palette onto the shader's four colours: columns, highlights, pool glow, and a tinted dark base. */
function paletteColors(palette: Palette): Colors {
  const primary = hexToRgb(palette.primary)
  const secondary = hexToRgb(palette.secondary)
  const tertiary = hexToRgb(palette.tertiary)
  const lift = (color: Rgb, amount: number): Rgb => [color[0] + (1 - color[0]) * amount, color[1] + (1 - color[1]) * amount, color[2] + (1 - color[2]) * amount]
  return {
    accent: primary,
    bright: lift(secondary, 0.3),
    sky: tertiary,
    deep: [primary[0] * 0.5, primary[1] * 0.5, primary[2] * 0.5],
  }
}

function MusicFlowShader({ energy = 0.72, mood = 'energy', palette = null, light = false, className = '' }: MusicFlowShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const energyRef = useRef(energy)
  const moodRef = useRef(mood)
  const paletteRef = useRef(palette)
  const lightRef = useRef(light)
  const redrawRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    energyRef.current = energy
  }, [energy])

  useEffect(() => {
    moodRef.current = mood
  }, [mood])

  useEffect(() => {
    paletteRef.current = palette
    // With reduced motion the loop is idle; wake it so a new song still recolours the field.
    redrawRef.current()
  }, [palette])

  useEffect(() => {
    lightRef.current = light
    redrawRef.current()
  }, [light])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance',
    })
    if (!gl) return

    const program = createProgram(gl)
    if (!program) return

    const buffer = gl.createBuffer()
    if (!buffer) {
      gl.deleteProgram(program)
      return
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)

    const position = gl.getAttribLocation(program, 'aPosition')
    const uniforms = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      pointer: gl.getUniformLocation(program, 'uPointer'),
      time: gl.getUniformLocation(program, 'uTime'),
      ribs: gl.getUniformLocation(program, 'uRibs'),
      energy: gl.getUniformLocation(program, 'uEnergy'),
      bands: gl.getUniformLocation(program, 'uBands'),
      mood: gl.getUniformLocation(program, 'uMood'),
      accent: gl.getUniformLocation(program, 'uAccent'),
      bright: gl.getUniformLocation(program, 'uBright'),
      sky: gl.getUniformLocation(program, 'uSky'),
      deep: gl.getUniformLocation(program, 'uDeep'),
      light: gl.getUniformLocation(program, 'uLight'),
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pointerTarget = { x: 0.5, y: 0.52 }
    const pointerCurrent = { ...pointerTarget }
    let isVisible = true
    let isDocumentVisible = !document.hidden
    let frame = 0
    let pixelRatio = 1
    let quality = 1
    let lastTimestamp = 0
    let averageFrame = 16
    let framesSinceAdjust = 0
    // Accumulated in clamped steps rather than read from the wall clock, so a backgrounded tab,
    // a long main-thread stall, or a dropped-frame stretch can never make uTime leap forward —
    // that leap is what read as the field suddenly "speeding up".
    let clockSeconds = 0
    let displayEnergy = energyRef.current
    // Eased toward the live reading so a band that spikes for one frame still lands as a swell.
    const displayBands = new Float32Array([0, 0, 0])
    let shellIsLight = false
    let lastThemeCheck = 0

    const targetColors = (): Colors => {
      const current = paletteRef.current
      if (current) return paletteColors(current)
      const preset = moodPalettes[moodRef.current]
      return { accent: preset.accent, bright: preset.bright, sky: preset.sky, deep: preset.deep }
    }
    // Displayed colours ease toward the target so a song change cross-fades the field.
    const shown = targetColors()
    const easeColors = (rate: number): void => {
      const target = targetColors()
      ;(['accent', 'bright', 'sky', 'deep'] as const).forEach((key) => {
        for (let channel = 0; channel < 3; channel += 1) {
          shown[key][channel] = (shown[key][channel] ?? 0) + ((target[key][channel] ?? 0) - (shown[key][channel] ?? 0)) * rate
        }
      })
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const mobileQuality = window.innerWidth < 640
      pixelRatio = Math.min(window.devicePixelRatio || 1, mobileQuality ? 1 : 1.25) * quality
      const pixels = rect.width * rect.height * pixelRatio * pixelRatio
      if (pixels > 1100000) pixelRatio *= Math.sqrt(1100000 / pixels)
      const width = Math.max(1, Math.round(rect.width * pixelRatio))
      const height = Math.max(1, Math.round(rect.height * pixelRatio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
      }
    }

    const draw = (timestamp: number) => {
      frame = 0
      const frameTime = timestamp - lastTimestamp
      lastTimestamp = timestamp
      // Clamp to a 15fps-equivalent step: the first frame after a stall or a hidden tab still
      // advances, just no faster than normal, instead of jumping uTime forward by the whole gap.
      if (frameTime > 0) clockSeconds += Math.min(frameTime, 66) / 1000
      if (frameTime > 0 && frameTime < 250) {
        averageFrame = averageFrame * 0.9 + frameTime * 0.1
        framesSinceAdjust += 1
        if (framesSinceAdjust >= 20) {
          framesSinceAdjust = 0
          if (averageFrame > 26 && quality > 0.4) quality = Math.max(0.4, quality * 0.82)
          else if (averageFrame < 15 && quality < 1) quality = Math.min(1, quality * 1.08)
        }
      }
      resize()

      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

      const preset = moodPalettes[moodRef.current]
      easeColors(reducedMotion.matches ? 1 : 0.05)

      // Slow ambient drift only — never couple to live audio / beat energy.
      displayEnergy += (energyRef.current - displayEnergy) * 0.06
      displayBands[0] = 0
      displayBands[1] = 0
      displayBands[2] = 0

      pointerCurrent.x += (pointerTarget.x - pointerCurrent.x) * 0.05
      pointerCurrent.y += (pointerTarget.y - pointerCurrent.y) * 0.05

      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
      gl.uniform2f(uniforms.pointer, pointerCurrent.x, pointerCurrent.y)
      gl.uniform1f(uniforms.ribs, canvas.clientWidth / Math.min(64, Math.max(30, canvas.clientWidth * 0.032)))
      gl.uniform1f(uniforms.time, reducedMotion.matches ? 1.6 : clockSeconds)
      gl.uniform1f(uniforms.energy, displayEnergy)
      gl.uniform3fv(uniforms.bands, displayBands)
      gl.uniform1f(uniforms.mood, preset.mood)
      gl.uniform3fv(uniforms.accent, shown.accent)
      gl.uniform3fv(uniforms.bright, shown.bright)
      gl.uniform3fv(uniforms.sky, shown.sky)
      gl.uniform3fv(uniforms.deep, shown.deep)
      if (timestamp - lastThemeCheck > 500) {
        shellIsLight = document.querySelector('.app-shell')?.getAttribute('data-theme') === 'light'
        lastThemeCheck = timestamp
      }
      gl.uniform1f(uniforms.light, lightRef.current || shellIsLight ? 1 : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (isVisible && isDocumentVisible && !reducedMotion.matches) {
        frame = requestAnimationFrame(draw)
      }
    }

    const schedule = () => {
      if (!frame && isVisible && isDocumentVisible) frame = requestAnimationFrame(draw)
    }

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointerTarget.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      pointerTarget.y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height))
    }

    const onVisibilityChange = () => {
      isDocumentVisible = !document.hidden
      if (isDocumentVisible) {
        // Forget the stale timestamp from before the tab was hidden, so the resumed frame's
        // delta is measured from "now", not from however long the tab was away.
        lastTimestamp = 0
        schedule()
      }
    }

    const onMotionChange = () => {
      cancelAnimationFrame(frame)
      frame = 0
      schedule()
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? true
        if (isVisible) schedule()
        else if (frame) {
          cancelAnimationFrame(frame)
          frame = 0
        }
      },
      { threshold: 0.01 },
    )
    const resizeObserver = new ResizeObserver(schedule)

    observer.observe(canvas)
    resizeObserver.observe(canvas)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('visibilitychange', onVisibilityChange)
    reducedMotion.addEventListener('change', onMotionChange)
    canvas.classList.add('is-ready')
    redrawRef.current = schedule
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      reducedMotion.removeEventListener('change', onMotionChange)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [])

  return <canvas ref={canvasRef} className={`music-flow-canvas ${className}`.trim()} aria-hidden="true" />
}

export { MusicFlowShader }
