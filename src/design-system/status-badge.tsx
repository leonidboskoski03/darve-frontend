import type { ReactNode } from 'react';

type StatusBadgeProps = {
  children: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
};

/** Visible wording carries the state. This is not a live announcement region. */
export function StatusBadge({ children, tone = 'neutral' }: StatusBadgeProps) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>;
}
