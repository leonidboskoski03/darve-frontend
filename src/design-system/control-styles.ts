export type ControlTone = 'primary' | 'secondary' | 'quiet' | 'danger';

export function controlStyles(tone: ControlTone, className?: string) {
  return ['ds-control', `ds-control--${tone}`, className].filter(Boolean).join(' ');
}
