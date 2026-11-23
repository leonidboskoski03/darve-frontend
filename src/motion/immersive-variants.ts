/** Experimental immersive OBS variants (owner-requested showcase, not founder-approved). */
export type ImmersiveVariant =
  | 'glass'
  | 'glass-twitch'
  | 'glass-youtube'
  | 'glass-kick'
  | 'glass-darve'
  | 'neon'
  | 'classic'
  | 'drift'
  | 'drift-twitch'
  | 'drift-youtube'
  | 'drift-kick'
  | 'drift-darve'
  | 'contour'
  | 'halo'
  | 'ripple'
  | 'comet'
  | 'comet-twitch'
  | 'comet-youtube'
  | 'comet-kick'
  | 'comet-darve';
/** Calm templates: slow loops, small movement, capped frame rate. */
export const calmVariants: readonly string[] = [
  'drift',
  'drift-twitch',
  'drift-youtube',
  'drift-kick',
  'drift-darve',
  'contour',
  'halo',
  'ripple',
];
export const immersiveVariants: readonly string[] = [
  'glass',
  'glass-twitch',
  'glass-youtube',
  'glass-kick',
  'glass-darve',
  'neon',
  'classic',
  ...calmVariants,
  'comet',
  'comet-twitch',
  'comet-youtube',
  'comet-kick',
  'comet-darve',
];
export function isImmersiveVariant(value: string): value is ImmersiveVariant {
  return immersiveVariants.includes(value);
}
