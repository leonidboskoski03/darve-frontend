import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

type DialogProps = {
  open: boolean;
  title: string;
  description: string;
  onDismiss: () => void;
  children: ReactNode;
};

/** Native modal semantics: top layer, inert background and keyboard focus containment. */
export function Dialog({ open, title, description, onDismiss, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => {
      if (node.open) node.close();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ds-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClose={(event) => {
        if (open && !event.currentTarget.open) onDismiss();
      }}
    >
      <div className="ds-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <Button tone="quiet" aria-label="Close dialog" onClick={onDismiss}>
          <X size={20} aria-hidden="true" />
        </Button>
      </div>
      <p id={descriptionId} className="ds-dialog__description">
        {description}
      </p>
      {children}
    </dialog>
  );
}
