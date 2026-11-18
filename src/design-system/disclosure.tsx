import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import './disclosure.css';

type DisclosureProps = {
  label: ReactNode;
  children: ReactNode | ((open: boolean) => ReactNode);
  className?: string;
  heading?: 'h2';
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

export function Disclosure({
  label,
  children,
  className,
  heading: Heading,
  expanded,
  onExpandedChange,
}: DisclosureProps) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const open = expanded ?? localOpen;
  const trigger = (
    <button
      type="button"
      className="ds-disclosure__trigger"
      aria-expanded={open}
      aria-controls={id}
      onClick={() => {
        const next = !open;
        if (next) setOpened(true);
        if (expanded === undefined) setLocalOpen(next);
        onExpandedChange?.(next);
      }}
    >
      <span>{label}</span>
      <ChevronDown size={18} aria-hidden="true" />
    </button>
  );

  return (
    <div className={['ds-disclosure', className].filter(Boolean).join(' ')}>
      {Heading ? <Heading className="ds-disclosure__heading">{trigger}</Heading> : trigger}
      <div
        id={id}
        className="ds-disclosure__panel"
        data-open={open}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="ds-disclosure__content">
          {typeof children === 'function' ? (open || opened) && children(open) : children}
        </div>
      </div>
    </div>
  );
}
