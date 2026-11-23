/** Experimental immersive OBS variants (owner-requested showcase, not founder-approved). */
export type ImmersiveVariant = 'glass' | 'neon' | 'classic';
export const immersiveVariants: readonly string[] = ['glass', 'neon', 'classic'];
export function isImmersiveVariant(value: string): value is ImmersiveVariant {
  return immersiveVariants.includes(value);
}
