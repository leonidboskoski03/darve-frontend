import type { ComponentProps } from 'react';
import { controlStyles, type ControlTone } from './control-styles';

type ActionLinkProps = ComponentProps<'a'> & {
  href: string;
  tone?: Exclude<ControlTone, 'danger'>;
};

/** Navigation only. Commands and disabled/pending actions use Button. */
export function ActionLink({ tone = 'primary', className, ...props }: ActionLinkProps) {
  return <a {...props} className={controlStyles(tone, className)} />;
}
