import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, LogOut, MessageSquare, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCreatorSession } from '@/features/session-status/index';

export function WorkspaceAccountMenu() {
  const { controller, snapshot } = useCreatorSession();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const displayName = snapshot.user?.displayName?.trim();

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return (
    <div
      ref={root}
      className="workspace-account"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          trigger.current?.focus();
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="workspace-account__trigger"
        aria-label={displayName ? `${displayName} Account menu` : 'Account menu'}
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="workspace-account__name" title={displayName}>
          {displayName || 'Account'}
        </span>
        <span className="workspace-account__avatar" aria-hidden="true">
          <UserRound size={17} />
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <nav id={menuId} className="workspace-account__links" aria-label="Account" hidden={!open}>
        <Link to="/account" onClick={() => setOpen(false)}>
          <UserRound size={16} aria-hidden="true" /> My profile
        </Link>
        <Link to="/support" onClick={() => setOpen(false)}>
          <MessageSquare size={16} aria-hidden="true" /> Support
        </Link>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            void controller.logout();
          }}
        >
          <LogOut size={16} aria-hidden="true" /> Sign out
        </button>
      </nav>
    </div>
  );
}
