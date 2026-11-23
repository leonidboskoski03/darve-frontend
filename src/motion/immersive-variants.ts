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
  | 'contour'
  | 'halo'
  | 'ripple';
/** Calm templates: slow loops, small movement, capped frame rate. */
export const calmVariants: readonly string[] = ['drift', 'contour', 'halo', 'ripple'];
export const immersiveVariants: readonly string[] = [
  'glass',
  'glass-twitch',
  'glass-youtube',
  'glass-kick',
  'glass-darve',
  'neon',
  'classic',
  ...calmVariants,
];
export function isImmersiveVariant(value: string): value is ImmersiveVariant {
  return immersiveVariants.includes(value);
}
