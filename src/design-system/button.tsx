import type { ComponentProps } from 'react';
import { controlStyles, type ControlTone } from './control-styles';

type ButtonProps = ComponentProps<'button'> & { tone?: ControlTone; busy?: boolean };

export function Button({
  tone = 'primary',
  busy = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={controlStyles(tone, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="ds-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
