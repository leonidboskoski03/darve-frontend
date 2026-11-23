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
import type { Built } from './calm-scenes';

/*
 * Comet (experimental, owner-requested): a glowing light trail that travels across
 * the card on its own. Original compact implementation: a fading trail buffer
 * (two small passes per frame) instead of a full fluid simulation, so it stays
 * light enough for an OBS source. Colours follow the variant; goal and completion
 * warm it to gold; a verified contribution releases a small burst at the head.
 */
type Rgb = [number, number, number];
const palettes: Record<string, { color: Rgb; cool: Rgb }> = {
  comet: { color: [0.37, 0.55, 1.0], cool: [0.24, 0.3, 1.0] },
  'comet-twitch': { color: [0.57, 0.27, 1.0], cool: [0.36, 0.17, 0.82] },
  'comet-youtube': { color: [1.0, 0.23, 0.29], cool: [0.77, 0.07, 0.16] },
  'comet-kick': { color: [0.33, 0.99, 0.09], cool: [0.12, 0.66, 0.29] },
  'comet-darve': { color: [0.95, 0.55, 0.81], cool: [0.61, 0.0, 0.43] },
};
const linger = 2.2; // seconds the light stays visible
const trailPx = 2.2; // radius of the freshly drawn line
const resolution = 0.5; // trail buffer scale relative to the canvas

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Fade and gently soften the previous trail, then draw the newest segment.
// r = light energy, g = heat (fresh light; cools faster, shifting the tint).
const trailFragment = /* glsl */ `
uniform sampler2D uPrev;
uniform vec2 uTexel;
uniform vec2 uA;
uniform vec2 uB;
uniform float uAspect;
uniform float uRadius;
uniform vec2 uDecay;
uniform float uDraw;
uniform float uBurst;
varying vec2 vUv;
void main() {
  // Very light diffusion: the trail softens with age without dissolving.
  vec4 c = texture2D(uPrev, vUv) * 0.92
    + (texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)) + texture2D(uPrev, vUv - vec2(uTexel.x, 0.0))
    + texture2D(uPrev, vUv + vec2(0.0, uTexel.y)) + texture2D(uPrev, vUv - vec2(0.0, uTexel.y))) * 0.02;
  vec2 light = c.rg * uDecay;
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 a = vec2(uA.x * uAspect, uA.y);
  vec2 ab = vec2(uB.x * uAspect, uB.y) - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  vec2 d = p - a - ab * h;
  float line = exp(-dot(d, d) / (uRadius * uRadius)) * uDraw;
  vec2 head = p - vec2(uB.x * uAspect, uB.y);
  float burst = exp(-dot(head, head) / (uRadius * uRadius * 40.0)) * uBurst;
  light += vec2(1.8, 1.8) * line + vec2(1.6, 1.0) * burst;
  gl_FragColor = vec4(min(light, vec2(8.0)), 0.0, 1.0);
}`;

// Tint by freshness, add a white-hot core and a soft glow, then tone-map into
// premultiplied alpha so the light composites over the card like a screen.
const displayFragment = /* glsl */ `
uniform sampler2D uTrail;
uniform vec2 uTexel;
uniform vec3 uColor;
uniform vec3 uCool;
uniform float uGoal;
uniform float uComplete;
varying vec2 vUv;
vec3 shade(vec2 t) {
  float energy = max(t.x, 0.0);
  float heat = clamp(t.y, 0.0, energy);
  float warm = max(uGoal, uComplete);
  vec3 color = mix(uColor, vec3(1.0, 0.8, 0.45), warm);
  vec3 cool = mix(uCool, vec3(0.85, 0.5, 0.18), warm);
  return mix(cool, color, heat / max(energy, 1e-4)) * energy + vec3(heat * heat * 0.22);
}
void main() {
  vec3 light = shade(texture2D(uTrail, vUv).rg);
  // Soft glow: 16 directions x 3 radii, weighted towards the line.
  vec3 glow = vec3(0.0);
  for (int i = 0; i < 16; i++) {
    float angle = float(i) * 0.3927;
    vec2 dir = vec2(cos(angle), sin(angle)) * uTexel;
    glow += shade(texture2D(uTrail, vUv + dir * 1.5).rg) * 0.5;
    glow += shade(texture2D(uTrail, vUv + dir * 4.0).rg) * 0.32;
    glow += shade(texture2D(uTrail, vUv + dir * 8.0).rg) * 0.18;
    glow += shade(texture2D(uTrail, vUv + dir * 14.0).rg) * 0.1;
  }
  vec3 color = 1.0 - exp(-(light * 1.2 + glow * 0.11));
  gl_FragColor = vec4(color, max(color.r, max(color.g, color.b)));
}`;

export function buildComet(
  variant: string,
  scene: Scene,
  uniforms: Record<string, IUniform>,
  renderer: WebGLRenderer,
): Built {
  const palette = palettes[variant] ?? palettes.comet!;
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
    uDecay: { value: new Vector2(1, 1) },
    uDraw: { value: 0 },
    uBurst: { value: 0 },
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

  let width = 1,
    height = 1,
    last = 0,
    bursting = false;
  // Emitter (head) spring-follows a slow wandering target across the card.
  const emitter = { x: 0.5, y: 0.5, vx: 0, vy: 0, primed: false };
  const targetAt = (t: number) => ({
    x: 0.5 + 0.44 * Math.sin(t * 0.37 + 0.6 * Math.sin(t * 0.23)),
    y: 0.5 + 0.38 * Math.sin(t * 0.71 + 1.1) * Math.cos(t * 0.19),
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
    },
    tick(seconds) {
      const dt = last ? Math.min(1 / 20, Math.max(1 / 240, seconds - last)) : 1 / 60;
      last = seconds;
      const goal = targetAt(seconds);
      if (!emitter.primed) Object.assign(emitter, { x: goal.x, y: goal.y, primed: true });
      const px = emitter.x,
        py = emitter.y;
      const omega = 7,
        steps = Math.max(1, Math.ceil(dt / 0.004)),
        step = dt / steps;
      // Positions use card pixels so the spring behaves the same on any size.
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
      trailUniforms.uDecay.value.set(
        Math.exp((-dt * 4.6) / (linger * 0.8)),
        Math.exp((-dt * 4.6) / (linger * 0.25)),
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
    },
  };
}
