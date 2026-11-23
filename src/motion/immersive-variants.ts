/**
 * Experimental immersive OBS variants (owner-requested showcase, not founder-approved).
 * Every immersive family exists in a default look plus one colour variant per
 * platform (platform colours only, never platform marks) and one Darve variant.
 */
export type ImmersiveVariant = string;
export const platforms = ['twitch', 'youtube', 'kick', 'darve'] as const;
export type Platform = 'default' | (typeof platforms)[number];
const immersiveFamilies = [
  'glass',
  'neon',
  'classic',
  'drift',
  'contour',
  'halo',
  'ripple',
  'comet',
  'stardust',
];
const calmFamilies = ['drift', 'contour', 'halo', 'ripple'];
const withPlatforms = (families: string[]) =>
  families.flatMap((family) => [family, ...platforms.map((platform) => `${family}-${platform}`)]);
/** Calm templates: slow loops, small movement, capped frame rate. */
export const calmVariants: readonly string[] = withPlatforms(calmFamilies);
export const immersiveVariants: readonly string[] = withPlatforms(immersiveFamilies);
export function isImmersiveVariant(value: string): value is ImmersiveVariant {
  return immersiveVariants.includes(value);
}
export function familyOf(variant: string) {
  return variant.split('-')[0]!;
}
export function platformOf(variant: string): Platform {
  const suffix = variant.split('-')[1];
  return (platforms as readonly string[]).includes(suffix ?? '') ? (suffix as Platform) : 'default';
}

type Rgb = [number, number, number];
/** Shader colours per platform: a strong accent and a soft highlight. */
const platformColours: Record<Exclude<Platform, 'default'>, { accent: Rgb; soft: Rgb }> = {
  twitch: { accent: [0.57, 0.27, 1.0], soft: [0.8, 0.7, 1.0] },
  youtube: { accent: [1.0, 0.18, 0.25], soft: [1.0, 0.69, 0.71] },
  kick: { accent: [0.33, 0.99, 0.09], soft: [0.77, 1.0, 0.68] },
  darve: { accent: [0.8, 0.1, 0.6], soft: [0.95, 0.55, 0.81] },
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
/** Two shader colours per family: the original pair, or the platform pair. */
export function familyColours(variant: string): { a1: Rgb; a2: Rgb } {
  const family = familyOf(variant),
    platform = platformOf(variant);
  const defaults: Record<string, { a1: Rgb; a2: Rgb }> = {
    neon: { a1: [1.0, 0.16, 0.74], a2: [0.16, 0.92, 1.0] },
    classic: { a1: [0.55, 0.6, 0.82], a2: [0.62, 0.78, 1.0] },
    contour: { a1: [0.6, 0.68, 0.76], a2: [0.5, 0.92, 0.86] },
    halo: { a1: [0.8, 0.78, 0.74], a2: [0.96, 0.9, 0.8] },
    ripple: { a1: [0.78, 0.72, 1.0], a2: [0.78, 0.72, 1.0] },
  };
  if (platform === 'default') return defaults[family] ?? defaults.neon!;
  const { accent, soft } = platformColours[platform];
  const grey: Rgb = [0.62, 0.64, 0.7];
  if (family === 'neon') return { a1: accent, a2: soft };
  if (family === 'classic') return { a1: mix(soft, grey, 0.45), a2: soft };
  if (family === 'contour') return { a1: grey, a2: mix(accent, soft, 0.5) };
  return { a1: mix(soft, grey, 0.4), a2: soft };
}
