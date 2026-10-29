import { Link, Outlet, useLocation } from 'react-router-dom';
import { useContext, useEffect, useRef, useState } from 'react';
import { Menu } from 'lucide-react';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import { ProviderMark } from '@/design-system/provider-mark';
import { CreatorSessionContext, SessionStatus } from '@/features/session-status/index';
import { Workspace } from './workspace-layout';

export function RootLayout() {
  const creator = useContext(CreatorSessionContext);
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const previous = useRef(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (previous.current !== pathname) {
      main.current?.focus();
      previous.current = pathname;
    }
  }, [pathname]);
  if (pathname === '/collection' || pathname.startsWith('/collection/'))
    return (
      <Workspace session={creator ? <SessionStatus /> : <span>Server not connected</span>}>
        <Outlet />
      </Workspace>
    );
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand-link" aria-label="Darve home">
          <Brand />
          <span className="alpha-label">ALPHA</span>
        </Link>
        <div className="site-header__actions">
          {creator ? <SessionStatus /> : null}
          <Button
            tone="quiet"
            className="site-menu-button"
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={20} aria-hidden="true" />
          </Button>
        </div>
      </header>
      <main id="main-content" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <p>© 2026 Darve. Built for streamers.</p>
        <div className="site-socials">
          <a
            href="https://x.com/darveapp"
            aria-label="Darve on X"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
              <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-7.4L5.5 22H2.3l7.9-9L1.1 2h6.5l4.5 6.8zM17.9 20h1.7L6.6 3.9H4.8z" />
            </svg>
          </a>
          <a
            href="https://www.youtube.com/@darveapp"
            aria-label="Darve on YouTube"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ProviderMark provider="youtube" size={16} />
          </a>
          <a
            href="https://www.instagram.com/darveapp/"
            aria-label="Darve on Instagram"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </a>
          <a
            href="https://www.tiktok.com/@darveapp"
            aria-label="Darve on TikTok"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <path d="M14 2h4c0 3 1.7 5 4 5v4a9 9 0 0 1-4-1v7a7 7 0 1 1-7-7v4a3 3 0 1 0 3 3z" />
            </svg>
          </a>
        </div>
      </footer>
      <Dialog
        open={menuOpen}
        onDismiss={() => setMenuOpen(false)}
        title="Explore Darve"
        description="Connect your account or learn how Darve works."
        className="site-menu"
      >
        <nav aria-label="Main navigation" className="site-menu__links">
          <Link to="/collection" onClick={() => setMenuOpen(false)}>
            Creator workspace
          </Link>
          <Link to="/authorize" onClick={() => setMenuOpen(false)}>
            Connect your stream
          </Link>
          <Link to="/integrations" onClick={() => setMenuOpen(false)}>
            Account connections
          </Link>
          <Link to="/terms" onClick={() => setMenuOpen(false)}>
            Account terms
          </Link>
          <a href="/#how-it-works" onClick={() => setMenuOpen(false)}>
            How it works
          </a>
        </nav>
      </Dialog>
    </div>
  );
}
