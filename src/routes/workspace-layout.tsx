import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Cable, Menu, Radio, FileText, ArrowUpRight } from 'lucide-react';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import './workspace-layout.css';

const navigation = [
  { href: '/collection', label: 'Collection', Icon: Radio },
  { href: '/integrations', label: 'Connections', Icon: Cable },
  { href: '/terms', label: 'Account terms', Icon: FileText },
];
function Navigation({ close }: { close?: () => void }) {
  return (
    <nav className="workspace-navigation" aria-label="Creator workspace">
      {navigation.map(({ href, label, Icon }) => (
        <NavLink key={href} to={href} onClick={close}>
          <Icon size={19} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
export function Workspace({ children, session }: { children: ReactNode; session: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus();
  }, [pathname]);
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <aside className="workspace-sidebar">
        <Link className="brand-link" to="/" aria-label="Darve home">
          <Brand />
          <span className="alpha-label">ALPHA</span>
        </Link>
        <Navigation />
        <p className="workspace-sidebar__foot">
          Built for your live stream.
          <Link to="/">
            Public homepage <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </p>
      </aside>
      <div className="workspace-body">
        <header className="workspace-topbar">
          <div>
            <Button
              className="workspace-menu"
              tone="quiet"
              aria-label="Open workspace navigation"
              aria-haspopup="dialog"
              onClick={() => setOpen(true)}
            >
              <Menu size={20} aria-hidden="true" />
            </Button>
            <span>Creator workspace</span>
          </div>
          <div className="workspace-session">{session}</div>
        </header>
        <main id="workspace-main" tabIndex={-1} ref={main}>
          {children}
        </main>
      </div>
      <Dialog
        open={open}
        title="Creator workspace"
        description="Navigate your Darve account."
        onDismiss={() => setOpen(false)}
      >
        <Navigation close={() => setOpen(false)} />
      </Dialog>
    </div>
  );
}
