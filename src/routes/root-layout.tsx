import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { Brand } from '@/design-system/brand';
import { SessionStatus } from '@/features/session-status/index';
import { environment } from '@/services/config/index';

export function RootLayout() {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current !== pathname) {
      main.current?.focus();
      previous.current = pathname;
    }
  }, [pathname]);
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <a href="/" className="brand-link" aria-label="Darve home">
          <Brand />
        </a>
        <span className="environment-label">LOCAL FOUNDATION</span>
        {environment.apiOrigin ? <SessionStatus /> : null}
      </header>
      <main id="main-content" ref={main} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">Darve · Built for streamers</footer>
    </div>
  );
}
