import { useEffect, useRef } from 'react';

export interface AuraShaderProps {
  /** 0-1 audio level, same source as the Visualizer (useAudioAnalyser().readLevel()). */
  readonly energy?: number;
  /** Hex colors, typically the extracted album-art palette. */
  readonly primary: string;
  readonly secondary: string;
  /** Optional third stop; falls back to the secondary colour. */
  readonly tertiary?: string;
  readonly deep: string;
  readonly className?: string;
  /** Fill a positioned parent instead of the viewport. */
  readonly contained?: boolean;
}

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

// Three drifting glow blobs over a deep base, plus a soft wash so the album colour
// reaches every edge (the UI frosts it with backdrop blur). No raymarching.
const FRAGMENT_SHADER = `
precision mediump float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uEnergy;
uniform vec3 uPrimary;
uniform vec3 uSecondary;
uniform vec3 uTertiary;
uniform vec3 uDeep;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / uResolution.y;

  float t = uTime * (0.12 + uEnergy * 0.22);

  vec2 c1 = vec2(sin(t * 0.9) * 0.7, cos(t * 0.7) * 0.45);
  vec2 c2 = vec2(cos(t * 0.55) * 0.75, sin(t * 1.1) * 0.5);
  vec2 c3 = vec2(sin(t * 0.4 + 2.0) * 0.6, cos(t * 0.8 + 1.0) * 0.6);

  float glow1 = exp(-dot(p - c1, p - c1) * (1.05 - uEnergy * 0.4));
  float glow2 = exp(-dot(p - c2, p - c2) * (1.9 - uEnergy * 0.6));
  float glow3 = exp(-dot(p - c3, p - c3) * (2.6 - uEnergy * 0.8));

  vec3 color = uDeep;
  // The cover's main colour carries the screen; the other two are accents that drift through it.
  color = mix(color, uPrimary * 0.6, smoothstep(1.0, -1.0, p.y) * 0.5);
  color = mix(color, uPrimary, clamp(glow1, 0.0, 1.0));
  color = mix(color, uSecondary, clamp(glow2 * 0.6, 0.0, 1.0));
  color = mix(color, uTertiary, clamp(glow3 * 0.42, 0.0, 1.0));

  float grain = hash(gl_FragCoord.xy + uTime);
  color += (grain - 0.5) * 0.012;

  gl_FragColor = vec4(color, 1.0);
}
`;

type Rgb = [number, number, number];

/**
 * Pushes a cover colour into a vivid range so the glow reads as colour on a dark
 * page (a gold-and-white cover would otherwise average to brown). Near-greys stay
 * neutral: there is no hue to amplify.
 */
function vivid([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const light = Math.min(0.58, Math.max(0.4, (max + min) / 2));
  if (d < 0.05) return [light, light, light];
  const sat = Math.min(1, Math.max(d / (1 - Math.abs(max + min - 1)) * 1.25, 0.55));
  let hue: number;
  if (max === r) hue = ((g - b) / d + 6) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const m = light - chroma / 2;
  const [r1, g1, b1]: Rgb = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x] : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return [r1 + m, g1 + m, b1 + m];
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  if (import.meta.env.DEV) console.warn('[AuraShader] compile failed:', gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
}

/**
 * A quiet, audio-reactive glow field. Renders as a fixed full-viewport canvas
 * behind everything (positioning is inline so it needs no stylesheet changes).
 * Drop it once near the app root: <AuraShader energy={...} primary={...} ... />
 */
export function AuraShader({ energy = 0, primary, secondary, tertiary, deep, className = '', contained = false }: AuraShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const energyRef = useRef(energy);
  const colorsRef = useRef({ primary, secondary, tertiary: tertiary ?? secondary, deep });

  useEffect(() => {
    energyRef.current = energy;
  }, [energy]);

  useEffect(() => {
    colorsRef.current = { primary, secondary, tertiary: tertiary ?? secondary, deep };
  }, [primary, secondary, tertiary, deep]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
    if (!gl) return undefined;

    const program = createProgram(gl);
    if (!program) return undefined;

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      return undefined;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, 'aPosition');
    const uniforms = {
      resolution: gl.getUniformLocation(program, 'uResolution'),
      time: gl.getUniformLocation(program, 'uTime'),
      energy: gl.getUniformLocation(program, 'uEnergy'),
      primary: gl.getUniformLocation(program, 'uPrimary'),
      secondary: gl.getUniformLocation(program, 'uSecondary'),
      tertiary: gl.getUniformLocation(program, 'uTertiary'),
      deep: gl.getUniformLocation(program, 'uDeep')
    };

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let isVisible = true;
    let startedAt = performance.now();
    let displayEnergy = energyRef.current;
    const initial = colorsRef.current;
    // Displayed colours ease toward the target so a song change cross-fades the glow.
    const shown = { primary: vivid(hexToRgb(initial.primary)), secondary: vivid(hexToRgb(initial.secondary)), tertiary: vivid(hexToRgb(initial.tertiary)) };

    const resize = (): void => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
      const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
    };

    const draw = (timestamp: number): void => {
      frame = 0;
      resize();
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      displayEnergy += (energyRef.current - displayEnergy) * 0.08;
      const colors = colorsRef.current;

      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, reducedMotion.matches ? 0 : (timestamp - startedAt) / 1000);
      gl.uniform1f(uniforms.energy, displayEnergy);
      (['primary', 'secondary', 'tertiary'] as const).forEach((key) => {
        const target = vivid(hexToRgb(colors[key]));
        const current = shown[key];
        for (let channel = 0; channel < 3; channel += 1) current[channel] = (current[channel] ?? 0) + ((target[channel] ?? 0) - (current[channel] ?? 0)) * 0.06;
      });
      gl.uniform3fv(uniforms.primary, shown.primary);
      gl.uniform3fv(uniforms.secondary, shown.secondary);
      gl.uniform3fv(uniforms.tertiary, shown.tertiary);
      gl.uniform3fv(uniforms.deep, hexToRgb(colors.deep));
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (isVisible && !reducedMotion.matches) frame = requestAnimationFrame(draw);
    };

    const schedule = (): void => {
      if (!frame && isVisible) frame = requestAnimationFrame(draw);
    };

    const observer = new IntersectionObserver(([entry]) => {
      isVisible = entry?.isIntersecting ?? true;
      if (isVisible) schedule();
      else if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }, { threshold: 0.01 });
    const resizeObserver = new ResizeObserver(schedule);
    const onMotionChange = (): void => {
      startedAt = performance.now();
      draw(performance.now());
    };

    observer.observe(canvas);
    resizeObserver.observe(canvas);
    reducedMotion.addEventListener('change', onMotionChange);
    schedule();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      reducedMotion.removeEventListener('change', onMotionChange);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className}
      style={
        contained
          ? { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }
          : { position: 'fixed', inset: 0, zIndex: -1, width: '100%', height: '100%', pointerEvents: 'none' }
      }
    />
  );
}
