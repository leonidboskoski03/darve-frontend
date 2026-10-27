import type { ReactNode } from 'react';
import { CircleAlert, CircleHelp, Inbox } from 'lucide-react';

type ContentStateProps = {
  kind: 'empty' | 'unavailable' | 'error';
  title: string;
  children: ReactNode;
  action?: ReactNode;
};
const icons = { empty: Inbox, unavailable: CircleHelp, error: CircleAlert };

/** Feature owners choose recovery actions and announce async changes deliberately. */
export function ContentState({ kind, title, children, action }: ContentStateProps) {
  const Icon = icons[kind];
  return (
    <div className={`ds-content-state ds-content-state--${kind}`}>
      <Icon size={24} aria-hidden="true" />
      <h3>{title}</h3>
      <div className="ds-content-state__body">{children}</div>
      {action ? <div className="ds-content-state__action">{action}</div> : null}
    </div>
  );
}
