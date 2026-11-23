import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import { createDriftMotes, type Built } from './calm-scenes';
import { familyOf, platformOf } from './immersive-variants';

/*
 * Comet (experimental, owner-requested): a glowing light that travels across the
 * whole card on its own and leaves smoky trails. Original compact implementation:
 * one trail buffer per frame (line energy, fresh heat, long-lived smoke) carried
 * by a slowly evolving divergence-free swirl field (curl noise) instead of a full
 * fluid simulation, so it stays light enough for an OBS source. Colours follow
 * the variant; goal and completion warm it to gold; a verified contribution
 * releases a small burst at the head.
 *
 * Stardust (Drift + Comet) adds Drift's own wandering dust motes; a mote also
 * lights up while the trail passes over it.
 */
type Rgb = [number, number, number];
const palettes: Record<string, { color: Rgb; cool: Rgb }> = {
  default: { color: [0.37, 0.55, 1.0], cool: [0.24, 0.3, 1.0] },
  twitch: { color: [0.57, 0.27, 1.0], cool: [0.36, 0.17, 0.82] },
  youtube: { color: [1.0, 0.23, 0.29], cool: [0.77, 0.07, 0.16] },
  kick: { color: [0.33, 0.99, 0.09], cool: [0.12, 0.66, 0.29] },
  darve: { color: [0.95, 0.55, 0.81], cool: [0.61, 0.0, 0.43] },
};
// A thin, compact, smooth light: fine line, short tail, tight glow.
const linger = 1.9; // seconds the light stays visible
const trailPx = 1.1; // radius of the freshly drawn line (CSS px)
const resolution = 0.75; // trail buffer scale relative to the canvas

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// r = line energy, g = heat (fresh light, cools fast), b = smoke (wide, lingers).
// Everything is carried by a curl-noise swirl field, so older trails drift and
// curl into smoky threads.
const trailFragment = /* glsl */ `
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec2 uA;
uniform vec2 uB;
uniform float uAspect;
uniform float uRadius;
uniform float uWide;
uniform vec3 uDecay;
uniform float uDraw;
uniform float uBurst;
uniform float uTime;
uniform float uDt;
uniform float uFlow;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float field(vec2 p) {
  return noise(p + vec2(uTime * 0.07, -uTime * 0.05)) + 0.5 * noise(p * 2.1 - vec2(uTime * 0.11, uTime * 0.04));
}
vec2 curl(vec2 p) {
  float e = 0.05;
  float dx = field(p + vec2(e, 0.0)) - field(p - vec2(e, 0.0));
  float dy = field(p + vec2(0.0, e)) - field(p - vec2(0.0, e));
  return vec2(dy, -dx) / (2.0 * e);
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 flow = curl(p * 1.5) * uFlow;
  vec2 from = vUv - uDt * vec2(flow.x / uAspect, flow.y);
  vec3 c = texture2D(uPrev, from).rgb * 0.94
    + (texture2D(uPrev, from + vec2(uTexel.x, 0.0)).rgb + texture2D(uPrev, from - vec2(uTexel.x, 0.0)).rgb
    + texture2D(uPrev, from + vec2(0.0, uTexel.y)).rgb + texture2D(uPrev, from - vec2(0.0, uTexel.y)).rgb) * 0.015;
  vec3 light = c * uDecay;
  vec2 a = vec2(uA.x * uAspect, uA.y);
  vec2 ab = vec2(uB.x * uAspect, uB.y) - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  vec2 d = p - a - ab * h;
  float r2 = dot(d, d);
  float line = exp(-r2 / (uRadius * uRadius)) * uDraw;
  float wide = exp(-r2 / (uWide * uWide)) * uDraw;
  vec2 head = p - vec2(uB.x * uAspect, uB.y);
  float burst = exp(-dot(head, head) / (uRadius * uRadius * 60.0)) * uBurst;
  light += vec3(1.6, 1.6, 0.0) * line + vec3(0.0, 0.0, 0.12) * wide + vec3(1.2, 0.8, 0.45) * burst;
  gl_FragColor = vec4(min(light, vec3(8.0)), 1.0);
}`;

// Tint by freshness, add smoke in the cool colour, a white-hot core and a soft
// glow, then tone-map into premultiplied alpha so it composites like light.
const displayFragment = /* glsl */ `
uniform sampler2D uTrail;
uniform vec2 uTexel;
uniform vec3 uColor;
uniform vec3 uCool;
uniform float uGoal;
uniform float uComplete;
varying vec2 vUv;
vec3 shade(vec3 t) {
  float energy = max(t.r, 0.0);
  float heat = clamp(t.g, 0.0, energy);
  float smoke = max(t.b, 0.0);
  float warm = max(uGoal, uComplete);
  vec3 color = mix(uColor, vec3(1.0, 0.8, 0.45), warm);
  vec3 cool = mix(uCool, vec3(0.85, 0.5, 0.18), warm);
  vec3 tint = mix(cool, color, heat / max(energy, 1e-4));
  return tint * energy + cool * smoke * 0.9 + vec3(heat * heat * 0.22);
}
void main() {
  vec3 light = shade(texture2D(uTrail, vUv).rgb);
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float angle = float(i) * 0.3927;
    vec2 dir = vec2(cos(angle), sin(angle)) * uTexel;
    glow += shade(texture2D(uTrail, vUv + dir * 1.2).rgb) * 0.5;
    glow += shade(texture2D(uTrail, vUv + dir * 3.0).rgb) * 0.3;
    glow += shade(texture2D(uTrail, vUv + dir * 6.0).rgb) * 0.14;
  }
  vec3 color = 1.0 - exp(-(light * 1.15 + glow * 0.085));
  gl_FragColor = vec4(color, max(color.r, max(color.g, color.b)));
}`;

export function buildComet(
  variant: string,
  scene: Scene,
  uniforms: Record<string, IUniform>,
  renderer: WebGLRenderer,
): Built {
  const palette = palettes[platformOf(variant)] ?? palettes.default!;
  const half =
    renderer.extensions.has('EXT_color_buffer_float') ||
    renderer.extensions.has('EXT_color_buffer_half_float');
  const target = () =>
    new WebGLRenderTarget(2, 2, {
      type: half ? HalfFloatType : UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
  let read = target(),
    write = target();
  const quad = new PlaneGeometry(2, 2);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const trailUniforms = {
    uPrev: { value: read.texture },
    uTexel: { value: new Vector2(0.5, 0.5) },
    uA: { value: new Vector2(0.5, 0.5) },
    uB: { value: new Vector2(0.5, 0.5) },
    uAspect: { value: 4 },
    uRadius: { value: 0.01 },
    uWide: { value: 0.05 },
    uDecay: { value: new Vector3(1, 1, 1) },
    uDraw: { value: 0 },
    uBurst: { value: 0 },
    uTime: { value: 0 },
    uDt: { value: 1 / 60 },
    uFlow: { value: 0.08 },
  };
  const trail = new ShaderMaterial({
    uniforms: trailUniforms,
    vertexShader: quadVertex,
    fragmentShader: trailFragment,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const trailScene = new Scene();
  trailScene.add(new Mesh(quad, trail));
  const display = new ShaderMaterial({
    uniforms: {
      ...uniforms,
      uTrail: { value: read.texture },
      uTexel: { value: new Vector2(0.5, 0.5) },
      uColor: { value: new Vector3(...palette.color) },
      uCool: { value: new Vector3(...palette.cool) },
    },
    vertexShader: quadVertex,
    fragmentShader: displayFragment,
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  scene.add(new Mesh(quad, display));
  // Stardust: Drift's motes (same size, glow and progress colour), lit by the trail.
  const motes =
    familyOf(variant) === 'stardust'
      ? createDriftMotes(variant.replace('stardust', 'drift'), display.uniforms, true)
      : null;
  if (motes) scene.add(motes.points);

  let width = 1,
    height = 1,
    last = 0,
    bursting = false;
  // The head spring-follows a slow wandering target across the whole card.
  const emitter = { x: 0.5, y: 0.5, vx: 0, vy: 0, primed: false };
  const targetAt = (t: number) => ({
    x: 0.5 + 0.44 * Math.sin(t * 0.33 + 0.6 * Math.sin(t * 0.19)),
    y: 0.5 + 0.36 * Math.sin(t * 0.67 + 1.1) * Math.cos(t * 0.17),
  });

  return {
    scene,
    camera,
    material: display,
    resize(w, h) {
      width = w;
      height = h;
      const pixel = renderer.getPixelRatio();
      const tw = Math.max(2, Math.round(w * pixel * resolution)),
        th = Math.max(2, Math.round(h * pixel * resolution));
      read.setSize(tw, th);
      write.setSize(tw, th);
      trailUniforms.uTexel.value.set(1 / tw, 1 / th);
      (display.uniforms.uTexel!.value as Vector2).set(1 / tw, 1 / th);
      trailUniforms.uAspect.value = w / Math.max(h, 1);
      trailUniforms.uRadius.value = trailPx / Math.max(h, 1);
      trailUniforms.uWide.value = (trailPx * 3 + 3) / Math.max(h, 1);
    },
    tick(seconds) {
      const dt = last ? Math.min(1 / 20, Math.max(1 / 240, seconds - last)) : 1 / 60;
      last = seconds;
      const goal = targetAt(seconds);
      if (!emitter.primed) Object.assign(emitter, { x: goal.x, y: goal.y, primed: true });
      const px = emitter.x,
        py = emitter.y;
      const omega = 5,
        steps = Math.max(1, Math.ceil(dt / 0.004)),
        step = dt / steps;
      for (let k = 0; k < steps; k++) {
        emitter.vx += (omega * omega * (goal.x - emitter.x) - 2 * omega * emitter.vx) * step;
        emitter.vy += (omega * omega * (goal.y - emitter.y) - 2 * omega * emitter.vy) * step;
        emitter.x += emitter.vx * step;
        emitter.y += emitter.vy * step;
      }
      const moved = Math.hypot((emitter.x - px) * width, (emitter.y - py) * height);
      // A contribution (pulse rising) releases one burst at the head.
      const pulse = uniforms.uPulse!.value as number;
      const burst = pulse > 0.9 && !bursting;
      if (pulse > 0.9) bursting = true;
      else if (pulse < 0.5) bursting = false;
      trailUniforms.uPrev.value = read.texture;
      trailUniforms.uA.value.set(px, py);
      trailUniforms.uB.value.set(emitter.x, emitter.y);
      trailUniforms.uDraw.value = moved > 0.05 ? 1 : 0;
      trailUniforms.uBurst.value = burst ? 1 : 0;
      trailUniforms.uTime.value = seconds;
      trailUniforms.uDt.value = dt;
      trailUniforms.uDecay.value.set(
        Math.exp((-dt * 4.6) / (linger * 0.8)),
        Math.exp((-dt * 4.6) / (linger * 0.22)),
        Math.exp((-dt * 4.6) / (linger * 1.4)),
      );
      renderer.setRenderTarget(write);
      renderer.render(trailScene, camera);
      renderer.setRenderTarget(null);
      [read, write] = [write, read];
      display.uniforms.uTrail!.value = read.texture;
    },
    dispose() {
      read.dispose();
      write.dispose();
      quad.dispose();
      trail.dispose();
      display.dispose();
      motes?.geometry.dispose();
      motes?.material.dispose();
    },
  };
}
