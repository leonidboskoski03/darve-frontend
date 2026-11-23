import { verifiedAssets } from './verified-asset';
type Descriptor = {
  templateId: string;
  assetVersion: number;
  available: boolean;
  renderer: { key: string; hash: string | null } | null;
};
// The built-in standalone card plus every custody-verified asset. Apart from the
// founder-approved Darve Compact, the assets are owner-requested experimental
// styles and colour variants: never priced or activated before founder approval.
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
  ...verifiedAssets,
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
