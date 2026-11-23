import { classicAsset, compactAsset, minimalGlassAsset, neonPulseAsset } from './verified-asset';
type Descriptor = {
  templateId: string;
  assetVersion: number;
  available: boolean;
  renderer: { key: string; hash: string | null } | null;
};
const entries = [
  {
    id: 'standalone',
    version: 1,
    key: 'standalone',
    hash: null,
    name: 'Standalone',
    variant: 'standalone',
    experimental: false,
  },
  compactAsset,
  // Owner-requested immersive showcase; experimental until founder approval.
  minimalGlassAsset,
  neonPulseAsset,
  classicAsset,
] as const;
export function catalogueTemplate(id: string, version: number) {
  return entries.find((entry) => entry.id === id && entry.version === version) ?? null;
}
/** Local showcase only: every registered renderer with its exact key and hash. */
export function registeredTemplates() {
  return entries;
}
/** Exact local allowlist only: no scripts, URLs, CSS or fallback from server metadata. */
export function resolveOverlayTemplate(value: Descriptor) {
  const entry = catalogueTemplate(value.templateId, value.assetVersion);
  return value.available &&
    entry &&
    value.renderer?.key === entry.key &&
    value.renderer.hash === entry.hash
    ? entry
    : null;
}
