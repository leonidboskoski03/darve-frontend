export function ProviderMark({
  provider,
  size = 24,
}: {
  provider: 'twitch' | 'youtube' | 'kick';
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      {provider === 'twitch' ? (
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
      ) : provider === 'youtube' ? (
        <>
          <rect x="2" y="5" width="20" height="14" rx="4" />
          <path fill="var(--color-background)" d="m10 9 6 3-6 3z" />
        </>
      ) : (
        <path d="M3 3h6v6h3V6h3V3h6v6h-3v3h-3v3h3v3h3v3h-6v-3h-3v-3H9v6H3z" />
      )}
    </svg>
  );
}
