import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Line,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  type Scene,
  ShaderMaterial,
  type Camera,
  type IUniform,
  Vector3,
} from 'three';

/*
 * Calm experimental OBS backdrops (owner-requested showcase, not founder-approved).
 * Rules: slow loops (10 s or longer), small movement, no flashing; the render
 * loop is capped at 30 fps. Everything draws in clip space, so no camera math.
 */
export type Built = {
  scene: Scene;
  camera: Camera;
  material: ShaderMaterial;
  dispose: () => void;
  resize: (width: number, height: number) => void;
};
type Uniforms = Record<string, IUniform>;

const shared = /* glsl */ `
uniform float uTime;
uniform float uProgress;
uniform float uPulse;
uniform float uGoal;
uniform float uComplete;
uniform float uPixel;
uniform vec2 uResolution;`;
const gold = 'vec3(1.0, 0.8, 0.45)';

// Drift: dust motes that wander gently in every direction forever. Each mote
// follows its own layered sine path (incommensurate speeds, so the pattern never
// visibly repeats), breathes slightly in size and glow, and motes left of the
// funding progress take the accent colour.
const driftVertex = /* glsl */ `
${shared}
attribute vec3 aSeed;
uniform vec3 uDim;
uniform vec3 uLit;
varying float vLit;
varying float vGlow;
void main() {
  float t = uTime;
  vec2 wander = vec2(
    sin(t * (0.21 + aSeed.z * 0.23) + aSeed.x * 31.0) + 0.55 * sin(t * (0.37 + aSeed.y * 0.19) + aSeed.z * 17.0),
    cos(t * (0.18 + aSeed.y * 0.21) + aSeed.y * 23.0) + 0.55 * cos(t * (0.33 + aSeed.x * 0.17) + aSeed.z * 11.0)
  );
  // Roughly 15 px of travel on a 960 x 236 card: present, never busy.
  vec2 p = aSeed.xy + wander * vec2(0.011, 0.045);
  float breath = sin(t * (0.45 + aSeed.z * 0.5) + aSeed.x * 40.0);
  vLit = step(p.x, uProgress);
  vGlow = 0.8 + 0.2 * breath;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = (7.0 + aSeed.z * 5.0) * (1.0 + 0.12 * breath + 0.1 * vLit + 0.12 * uPulse) * uPixel;
}`;
const driftFragment = /* glsl */ `
${shared}
uniform vec3 uDim;
uniform vec3 uLit;
varying float vLit;
varying float vGlow;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  // A small bright core with a faint halo: glow without bloom.
  float core = smoothstep(0.16, 0.0, d);
  float halo = exp(-d * d * 22.0) * 0.45;
  vec3 lit = mix(uLit, ${gold}, max(uGoal, uComplete));
  vec3 col = mix(uDim, lit, vLit);
  gl_FragColor = vec4(col, (core + halo * vGlow) * (0.32 + 0.4 * vLit) * vGlow);
}`;

// Contour: four thin lines gently swaying like map contours; they brighten
// from the left up to the funding progress.
const contourVertex = /* glsl */ `
${shared}
attribute float aX;
attribute float aLine;
varying float vLit;
varying float vEdge;
void main() {
  float base = 0.2 + aLine * 0.18;
  float y = base
    + 0.03 * sin(aX * 5.5 + uTime * 0.22 + aLine * 1.7)
    + 0.015 * sin(aX * 12.0 - uTime * 0.15 + aLine);
  vLit = step(aX, uProgress);
  vEdge = smoothstep(0.0, 0.08, aX) * smoothstep(1.0, 0.92, aX);
  gl_Position = vec4(aX * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
}`;
const contourFragment = /* glsl */ `
${shared}
varying float vLit;
varying float vEdge;
void main() {
  vec3 lit = mix(vec3(0.5, 0.92, 0.86), ${gold}, max(uGoal, uComplete));
  vec3 col = mix(vec3(0.6, 0.68, 0.76), lit, vLit);
  gl_FragColor = vec4(col, vEdge * (0.14 + 0.46 * vLit + 0.18 * uPulse));
}`;

// Halo: one thin arc framing the left edge; it fills from the bottom with the
// funding progress and breathes very slowly.
const haloVertex = /* glsl */ `
${shared}
attribute float aT;
attribute float aRing;
varying float vLit;
varying float vRing;
void main() {
  float aspect = uResolution.x / uResolution.y;
  float angle = -1.5707963 + aT * 3.1415927;
  float radius = 0.4 + aRing * 0.035;
  vec2 uv = vec2(0.0, 0.5) + vec2(cos(angle) * radius / aspect, sin(angle) * radius);
  vLit = step(aT, uProgress) * (1.0 - aRing);
  vRing = aRing;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;
const haloFragment = /* glsl */ `
${shared}
varying float vLit;
varying float vRing;
void main() {
  float breath = 0.5 + 0.5 * sin(uTime * 0.45);
  vec3 lit = mix(vec3(0.96, 0.9, 0.8), ${gold}, max(uGoal, uComplete));
  vec3 col = mix(vec3(0.8, 0.78, 0.74), lit, vLit);
  float alpha = mix(0.16 + 0.04 * breath, 0.55 + 0.15 * breath + 0.2 * uPulse, vLit);
  gl_FragColor = vec4(col, alpha * (1.0 - 0.5 * vRing));
}`;

// Ripple: still until verified money arrives; then a single soft ring spreads
// from the funding area and fades (uPulse runs 1 -> 0).
const rippleVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;
const rippleFragment = /* glsl */ `
${shared}
varying vec2 vUv;
void main() {
  float aspect = uResolution.x / uResolution.y;
  vec2 p = (vUv - vec2(0.56, 0.22)) * vec2(aspect, 1.0);
  float rippling = step(0.001, uPulse);
  float radius = (1.0 - uPulse) * aspect * 0.55;
  float ring = exp(-pow((length(p) - radius) * 22.0, 2.0)) * uPulse * rippling;
  vec3 col = mix(vec3(0.78, 0.72, 1.0), ${gold}, max(uGoal, uComplete));
  gl_FragColor = vec4(col, ring * 0.45);
}`;

function material(uniforms: Uniforms, vertexShader: string, fragmentShader: string) {
  return new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}
type Rgb = [number, number, number];
// Drift palettes: platform variants use platform colours only (no marks).
const driftPalettes: Record<string, { dim: Rgb; lit: Rgb }> = {
  drift: { dim: [0.78, 0.82, 0.95], lit: [0.66, 0.76, 1.0] },
  'drift-twitch': { dim: [0.82, 0.78, 0.95], lit: [0.68, 0.5, 1.0] },
  'drift-youtube': { dim: [0.95, 0.84, 0.86], lit: [1.0, 0.42, 0.48] },
  'drift-kick': { dim: [0.84, 0.95, 0.82], lit: [0.45, 1.0, 0.3] },
  'drift-darve': { dim: [0.88, 0.8, 0.94], lit: [0.95, 0.5, 0.8] },
};
const seeded = (i: number) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function buildCalm(variant: string, scene: Scene, uniforms: Uniforms): Built {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometries: BufferGeometry[] = [];
  let shader: ShaderMaterial;
  if (variant.startsWith('drift')) {
    const palette = driftPalettes[variant] ?? driftPalettes.drift!;
    uniforms.uDim = { value: new Vector3(...palette.dim) };
    uniforms.uLit = { value: new Vector3(...palette.lit) };
    const count = 80,
      seed = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) seed[i] = seeded(i);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seed, 3));
    shader = material(uniforms, driftVertex, driftFragment);
    const points = new Points(geometry, shader);
    points.frustumCulled = false;
    scene.add(points);
    geometries.push(geometry);
  } else if (variant === 'contour' || variant === 'halo') {
    const contour = variant === 'contour',
      lines = contour ? 4 : 2,
      steps = contour ? 180 : 140;
    shader = material(
      uniforms,
      contour ? contourVertex : haloVertex,
      contour ? contourFragment : haloFragment,
    );
    for (let line = 0; line < lines; line++) {
      const t = new Float32Array(steps),
        index = new Float32Array(steps).fill(line);
      for (let i = 0; i < steps; i++) t[i] = i / (steps - 1);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(steps * 3), 3));
      geometry.setAttribute(contour ? 'aX' : 'aT', new BufferAttribute(t, 1));
      geometry.setAttribute(contour ? 'aLine' : 'aRing', new BufferAttribute(index, 1));
      const object = new Line(geometry, shader);
      object.frustumCulled = false;
      scene.add(object);
      geometries.push(geometry);
    }
  } else {
    const geometry = new PlaneGeometry(2, 2);
    shader = material(uniforms, rippleVertex, rippleFragment);
    scene.add(new Mesh(geometry, shader));
    geometries.push(geometry);
  }
  return {
    scene,
    camera,
    material: shader,
    resize(width, height) {
      (uniforms.uResolution!.value as { set: (x: number, y: number) => void }).set(width, height);
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      shader.dispose();
    },
  };
}
