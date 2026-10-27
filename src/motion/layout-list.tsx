import { LazyMotion, domMax, m } from 'framer-motion';
import { useState, type ReactNode } from 'react';
import { motionTokens } from './tokens';
import { useMotionPreference } from './use-motion-preference';
import './layout-list.css';

type LayoutListProps = {
  label: string;
  items: readonly { id: string; content: ReactNode }[];
  className?: string;
};

/** Stable IDs preserve DOM/focus. Callers own order/removal and move focus before removing a row. */
export function LayoutList({ label, items, className }: LayoutListProps) {
  const reduce = useMotionPreference();
  const [containsFocus, setContainsFocus] = useState(false);
  return (
    <LazyMotion features={domMax} strict>
      <m.ul
        aria-label={label}
        className={['motion-layout-list', className].filter(Boolean).join(' ')}
        onFocusCapture={() => setContainsFocus(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setContainsFocus(false);
        }}
      >
        {items.map(({ id, content }) => (
          <m.li
            key={id}
            layout={reduce || containsFocus ? false : 'position'}
            transition={{ layout: { duration: reduce ? 0 : motionTokens.standard } }}
          >
            {content}
          </m.li>
        ))}
      </m.ul>
    </LazyMotion>
  );
}
