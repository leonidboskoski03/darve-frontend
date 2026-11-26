import { useEffect, useId, useRef, useState } from 'react';

const CONNECT_OPTIONS = [
  {
    id: 'twitch',
    label: 'Connect with Twitch',
    icon: (
      <path d="M4 2 2 7v14h5v3l4-3h4l7-7V2H4Zm16 11-4 4h-5l-3 3v-3H4V4h16v9Zm-3-6h-2v6h2V7Zm-5 0h-2v6h2V7Z" />
    ),
  },
  {
    id: 'kick',
    label: 'Connect with Kick',
    icon: <path d="M3 3h6v7l5-7h7l-7 9 7 9h-7l-5-7v7H3V3Z" />,
  },
  {
    id: 'youtube',
    label: 'Connect with YouTube',
    icon: (
      <path d="M21.6 7.2a2.8 2.8 0 0 0-2-2C17.9 4.7 12 4.7 12 4.7s-5.9 0-7.6.5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 2 12a29 29 0 0 0 .4 4.8 2.8 2.8 0 0 0 2 2c1.7.5 7.6.5 7.6.5s5.9 0 7.6-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22 12a29 29 0 0 0-.4-4.8ZM10 15.5v-7l6 3.5-6 3.5Z" />
    ),
  },
] as const;

/**
 * Concept 70 CONNECT dropdown — presentation only.
 * Every option navigates to Leonid’s existing `/authorize` entry (connectHref).
 * No OAuth, tokens, or provider calls from the landing.
 */
export function ConnectMenu({ connectHref }: { connectHref: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const toggleId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const wrap = wrapRef.current;
      if (wrap && !wrap.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`landing-connect${open ? ' is-open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        className="landing-connect__toggle"
        id={toggleId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span>CONNECT</span>
        <svg
          aria-hidden="true"
          className="landing-connect__chevron"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="m3.5 6 4.5 4 4.5-4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      <div
        className="landing-connect__menu"
        id={menuId}
        role="menu"
        aria-labelledby={toggleId}
        hidden={!open}
        aria-hidden={!open}
      >
        {CONNECT_OPTIONS.map((option) => (
          <a
            key={option.id}
            className="landing-connect__item"
            href={connectHref}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={() => setOpen(false)}
          >
            <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
              {option.icon}
            </svg>
            <span>{option.label}</span>
            <span aria-hidden="true" className="landing-connect__arrow">
              ↗
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
