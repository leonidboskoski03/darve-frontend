import { useEffect, useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { useMotionPreference } from './use-motion-preference';
import { calmVariants, familyColours, type ImmersiveVariant } from './immersive-variants';
import { buildCalm, type Built } from './calm-scenes';
import { buildComet } from './comet-scene';

gsap.registerPlugin(useGSAP);

/**
 * Experimental immersive OBS backdrops (owner-requested showcase, not
 * founder-approved). The canvas only decorates: challenge text, funding and
 * QR stay in the safe card DOM above it. Any WebGL failure leaves the CSS
 * background visible, so the stream never loses the card.
 */

type SceneProps = {
  variant: ImmersiveVariant;
  /** Deadline-eligible funding as 0..1. */
  progress: number;
  funded: boolean;
  complete: boolean;
  /** Changes whenever verified money arrives; drives a short pulse. */
  pulseKey: string;
};

const vertexQuad = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const noise = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}`;

const uniformsHeader = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uPulse;
uniform float uGoal;
uniform float uComplete;
uniform vec2 uResolution;
varying vec2 vUv;`;

// Minimal Glass: domain-warped liquid light behind a frosted panel. The light
// band fills from the left with funding progress; goal and completion warm it.
const glassFragment = /* glsl */ `
${uniformsHeader}
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec3 uTint;
uniform float uCircles;
${noise}
void main() {
  vec2 uv = vUv;
  vec2 p = uv * vec2(uResolution.x / uResolution.y, 1.0) * 1.5;
  float t = uTime * 0.05;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + t * 1.3), fbm(p + 2.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 2.0 * r);
  vec3 gold = vec3(1.0, 0.8, 0.45);
  vec3 col = mix(uDeep, uMid, clamp(f * 1.35, 0.0, 1.0));
  col = mix(col, uHigh, clamp(length(q) * 0.6, 0.0, 1.0) * 0.5);
  // Darve mark motif: two large soft discs drifting very slowly, as in the logo.
  vec2 a = uv * vec2(uResolution.x / uResolution.y, 1.0);
  float aspect = uResolution.x / uResolution.y;
  vec2 c1 = vec2(aspect * (0.78 + 0.03 * sin(uTime * 0.05)), 0.95 + 0.04 * cos(uTime * 0.04));
  vec2 c2 = vec2(aspect * (0.18 + 0.03 * cos(uTime * 0.045)), -0.15 + 0.04 * sin(uTime * 0.05));
  float discs = smoothstep(0.92, 0.88, length(a - c1)) + smoothstep(1.05, 1.01, length(a - c2));
  col += uCircles * 0.07 * discs * vec3(1.0);
  float fill = smoothstep(uProgress + 0.03, uProgress - 0.03, uv.x);
  float edge = exp(-pow((uv.x - uProgress) * 28.0, 2.0)) * step(0.001, uProgress);
  col += fill * 0.1 * uTint + edge * 0.35 * mix(uTint, vec3(1.0), 0.5);
  col = mix(col, col + gold * 0.16, uGoal * 0.7);
  col = mix(col, gold * 0.6 + col * 0.4, uComplete * 0.45);
  col += uPulse * 0.22 * mix(uTint, vec3(1.0), 0.375);
  col *= 0.78 + 0.22 * smoothstep(1.25, 0.25, length(uv - 0.5));
  gl_FragColor = vec4(col, 1.0);
}`;

// Neon Pulse: a perspective grid under a horizon glow. Lines light up cyan
// from the left as funding grows; each contribution sends a pulse forward.
const neonFragment = /* glsl */ `
${uniformsHeader}
uniform vec3 uA1;
uniform vec3 uA2;
float gridLine(float coord, float width) {
  float d = abs(fract(coord) - 0.5);
  return smoothstep(0.5 - width, 0.5, d);
}
void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  float horizon = 0.46;
  vec3 col = mix(vec3(0.015, 0.0, 0.045), vec3(0.16, 0.01, 0.2), smoothstep(0.0, 1.0, uv.y));
  vec3 magenta = uA1;
  vec3 cyan = uA2;
  vec3 gold = vec3(1.0, 0.8, 0.38);
  vec2 sp = vec2((uv.x - 0.8) * aspect, uv.y - horizon - 0.04);
  float sun = smoothstep(0.34, 0.0, length(sp));
  float bands = step(0.5, fract((uv.y - horizon) * 26.0 - uTime * 0.25));
  vec3 sunCol = mix(mix(magenta, cyan, uGoal), gold, uComplete);
  col += sunCol * sun * (0.45 + 0.25 * bands * step(horizon, uv.y));
  col += sunCol * 0.3 * exp(-abs(uv.y - horizon) * 22.0);
  if (uv.y < horizon) {
    float d = horizon - uv.y;
    float z = 0.22 / (d + 0.004);
    float x = (uv.x - 0.5) * aspect * z;
    float zz = z + uTime * 1.6;
    // Cap the width so far lines (near the horizon) stay thin, not a bright bar.
    float w = clamp(0.03 * z, 0.02, 0.09);
    float lines = max(gridLine(x * 0.8, w), gridLine(zz * 0.55, w));
    float fade = exp(-z * 0.11);
    float lit = step(uv.x, uProgress);
    vec3 lineCol = mix(mix(magenta, cyan, lit), gold, uComplete);
    float pulse = uPulse * exp(-pow(fract(zz * 0.08 - uTime * 0.4) - 0.5, 2.0) * 40.0);
    col += lineCol * lines * fade * (0.85 + 0.6 * uGoal + 1.6 * pulse);
  }
  col += uPulse * 0.08 * cyan;
  gl_FragColor = vec4(col, 1.0);
}`;

// Classic: a slowly turning orbit of particles around the card. The lit share is the
// funding progress; money arriving makes it breathe, the goal turns it gold.
const classicVertex = /* glsl */ `
attribute float aFrac;
attribute float aSeed;
uniform float uTime;
uniform float uProgress;
uniform float uPulse;
uniform float uPixel;
varying float vLit;
varying float vSeed;
void main() {
  float ang = aFrac * 6.2831853 + uTime * 0.12;
  float r = 1.0 + (aSeed - 0.5) * 0.2 + uPulse * 0.32 * aSeed;
  vec3 p = vec3(cos(ang) * r, sin(aSeed * 40.0 + uTime * 0.7) * 0.05 + (aSeed - 0.5) * 0.09, sin(ang) * r);
  float tilt = 1.05;
  p = vec3(p.x, p.y * cos(tilt) - p.z * sin(tilt), p.y * sin(tilt) + p.z * cos(tilt));
  vLit = step(aFrac, uProgress);
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (2.8 + vLit * 2.8 + uPulse * 2.4) * uPixel * (3.4 / -mv.z);
}`;
const classicFragment = /* glsl */ `
uniform vec3 uA1;
uniform vec3 uA2;
uniform float uGoal;
uniform float uComplete;
varying float vLit;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d);
  vec3 dim = uA1;
  vec3 lit = mix(uA2, vec3(1.0, 0.8, 0.42), max(uGoal, uComplete));
  vec3 col = mix(dim, lit, vLit) * (0.85 + 0.3 * vSeed);
  gl_FragColor = vec4(col, a * (0.62 + 0.38 * vLit));
}`;

type Palette = { deep: number[]; mid: number[]; high: number[]; tint: number[]; circles: number };
// Minimal Glass palettes. The original keeps its exact colours; platform
// variants use only platform colours (never marks); Darve adds its logo discs.
const glassPalettes: Record<string, Palette> = {
  glass: {
    deep: [0.03, 0.05, 0.13],
    mid: [0.22, 0.42, 0.95],
    high: [0.72, 0.52, 1.0],
    tint: [0.6, 0.8, 1.0],
    circles: 0,
  },
  'glass-twitch': {
    deep: [0.078, 0.051, 0.149],
    mid: [0.24, 0.12, 0.46],
    high: [0.5, 0.4, 0.74],
    tint: [0.8, 0.7, 1.0],
    circles: 0,
  },
  'glass-youtube': {
    deep: [0.1, 0.04, 0.047],
    mid: [0.4, 0.06, 0.1],
    high: [0.66, 0.34, 0.38],
    tint: [1.0, 0.75, 0.78],
    circles: 0,
  },
  'glass-kick': {
    deep: [0.03, 0.08, 0.04],
    mid: [0.08, 0.28, 0.06],
    high: [0.4, 0.6, 0.34],
    tint: [0.75, 1.0, 0.65],
    circles: 0,
  },
  'glass-darve': {
    deep: [0.11, 0.043, 0.2],
    mid: [0.3, 0.08, 0.42],
    high: [0.52, 0.08, 0.38],
    tint: [0.95, 0.55, 0.81],
    circles: 1,
  },
};

function build(variant: ImmersiveVariant, pixel: number, renderer: WebGLRenderer): Built {
  const scene = new Scene();
  const palette = glassPalettes[variant] ?? glassPalettes.glass!;
  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uPulse: { value: 0 },
    uGoal: { value: 0 },
    uComplete: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    uPixel: { value: pixel },
    uDeep: { value: new Vector3(...palette.deep) },
    uMid: { value: new Vector3(...palette.mid) },
    uHigh: { value: new Vector3(...palette.high) },
    uTint: { value: new Vector3(...palette.tint) },
    uCircles: { value: palette.circles },
    uA1: { value: new Vector3(...familyColours(variant).a1) },
    uA2: { value: new Vector3(...familyColours(variant).a2) },
  };
  if (calmVariants.includes(variant)) return buildCalm(variant, scene, uniforms);
  if (variant.startsWith('comet') || variant.startsWith('stardust'))
    return buildComet(variant, scene, uniforms, renderer);
  if (variant.startsWith('classic')) {
    const count = 1600;
    const frac = new Float32Array(count),
      seed = new Float32Array(count),
      position = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      frac[i] = i / count;
      // Deterministic jitter keeps captures and tests reproducible.
      const s = Math.sin(i * 12.9898) * 43758.5453;
      seed[i] = s - Math.floor(s);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('aFrac', new BufferAttribute(frac, 1));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 1));
    const material = new ShaderMaterial({
      uniforms,
      vertexShader: classicVertex,
      fragmentShader: classicFragment,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    const camera = new PerspectiveCamera(32, 4, 0.1, 50);
    camera.position.set(0, 0, 4.6);
    return {
      scene,
      camera,
      material,
      resize(width, height) {
        const aspect = width / Math.max(height, 1);
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        // A wide orbit around the whole card; its lit arc is the funding progress.
        points.scale.set(Math.max(1, aspect * 1.12), 1.25, 1);
        uniforms.uResolution.value.set(width, height);
      },
      dispose() {
        geometry.dispose();
        material.dispose();
      },
    };
  }
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: vertexQuad,
    fragmentShader: variant.startsWith('glass') ? glassFragment : neonFragment,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new Mesh(geometry, material));
  return {
    scene,
    camera: new OrthographicCamera(-1, 1, 1, -1, 0, 1),
    material,
    resize(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function OverlayScene({ variant, progress, funded, complete, pulseKey }: SceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<{ material: ShaderMaterial; draw: () => void } | null>(null);
  const reduced = useMotionPreference();
  const previousPulse = useRef(pulseKey);
  const latest = useRef({ progress, funded, complete });
  useLayoutEffect(() => {
    latest.current = { progress, funded, complete };
  }, [progress, funded, complete]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'default' });
    } catch {
      return; // No WebGL: the variant's CSS background remains the card backdrop.
    }
    const pixel = Math.min(window.devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(pixel);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    element.appendChild(renderer.domElement);
    const built = build(variant, pixel, renderer);
    const draw = () => renderer.render(built.scene, built.camera);
    // useGSAP runs before this effect on mount, so seed the current values here.
    const initial = built.material.uniforms;
    initial.uProgress!.value = Math.min(Math.max(latest.current.progress, 0), 1);
    initial.uGoal!.value = latest.current.funded ? 1 : 0;
    initial.uComplete!.value = latest.current.complete ? 1 : 0;
    live.current = { material: built.material, draw };
    const size = () => {
      const width = Math.max(element.clientWidth, 1),
        height = Math.max(element.clientHeight, 1);
      renderer.setSize(width, height, false);
      built.resize(width, height);
      draw();
    };
    const observer = new ResizeObserver(size);
    observer.observe(element);
    size();
    // Reduced motion: settle a still snapshot of simulated scenes once.
    if (reduced && built.tick) {
      for (let i = 1; i <= 150; i++) built.tick(i / 60);
      draw();
    }
    let frame = 0,
      last = 0;
    const started = performance.now();
    // Calm templates render at most 30 fps to keep the streaming GPU light.
    const interval = calmVariants.includes(variant) ? 1000 / 30 : 0;
    const loop = (now: number) => {
      frame = 0;
      if (document.visibilityState === 'hidden') return;
      if (now - last >= interval) {
        last = now;
        const seconds = (now - started) / 1000;
        built.material.uniforms.uTime!.value = seconds;
        built.tick?.(seconds);
        draw();
      }
      frame = requestAnimationFrame(loop);
    };
    const resume = () => {
      if (!reduced && !frame && document.visibilityState === 'visible')
        frame = requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', resume);
      observer.disconnect();
      live.current = null;
      built.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [variant, reduced]);

  // Business values flow one way into uniforms; animation never feeds back.
  useGSAP(
    () => {
      const scene = live.current;
      if (!scene) return;
      const u = scene.material.uniforms;
      const targets = {
        uProgress: Math.min(Math.max(progress, 0), 1),
        uGoal: funded ? 1 : 0,
        uComplete: complete ? 1 : 0,
      };
      if (reduced) {
        for (const [key, value] of Object.entries(targets)) u[key]!.value = value;
        u.uPulse!.value = 0;
        scene.draw();
        return;
      }
      for (const [key, value] of Object.entries(targets))
        gsap.to(u[key]!, { value, duration: 1.1, ease: 'power2.out', overwrite: true });
      if (previousPulse.current !== pulseKey) {
        previousPulse.current = pulseKey;
        gsap.fromTo(
          u.uPulse!,
          { value: 1 },
          calmVariants.includes(variant)
            ? { value: 0, duration: 2.6, ease: 'sine.out', overwrite: true }
            : { value: 0, duration: 1.6, ease: 'power3.out', overwrite: true },
        );
        const card = host.current?.parentElement;
        const amount = card?.querySelector('.obs-funding strong');
        if (amount)
          gsap.fromTo(
            amount,
            { scale: calmVariants.includes(variant) ? 1.04 : 1.12, transformOrigin: 'left center' },
            { scale: 1, duration: 0.7, ease: 'back.out(3)', clearProps: 'transform' },
          );
      }
    },
    { dependencies: [progress, funded, complete, pulseKey, reduced, variant] },
  );

  // The content entrance lives in immersive.css: this scene is lazy-loaded, so
  // a script entrance would start after the text is already painted and jump.
  return <div ref={host} className="obs-scene" data-variant={variant} />;
}
