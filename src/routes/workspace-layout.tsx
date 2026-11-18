import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Cable,
  Menu,
  Radio,
  FileText,
  ArrowUpRight,
  LayoutDashboard,
  History,
  Monitor,
  MessageSquare,
  Coins,
  LayoutTemplate,
  Wallet,
  UserRound,
  ListChecks,
} from 'lucide-react';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import { useRouteEntrance } from '@/motion/use-route-entrance';
import './workspace-layout.css';

const navigation = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/onboarding', label: 'Setup guide', Icon: ListChecks },
  { href: '/challenges', label: 'Challenge history', Icon: History },
  { href: '/collection', label: 'Collection', Icon: Radio },
  { href: '/obs', label: 'OBS display', Icon: Monitor },
  { href: '/coins', label: 'Coins', Icon: Coins },
  { href: '/templates', label: 'Templates', Icon: LayoutTemplate },
  { href: '/account', label: 'Account', Icon: UserRound },
  { href: '/integrations', label: 'Connections', Icon: Cable },
  { href: '/account/payments', label: 'Payout settings', Icon: Wallet },
  { href: '/support', label: 'Support', Icon: MessageSquare },
  { href: '/terms', label: 'Account terms', Icon: FileText },
];
function Navigation({ close, primary = false }: { close?: () => void; primary?: boolean }) {
  return (
    <nav className="workspace-navigation" aria-label={primary ? 'Dashboard' : 'Creator workspace'}>
      {(primary ? navigation.slice(0, 1) : navigation).map(({ href, label, Icon }) => (
        <NavLink key={href} to={href} end={href === '/account'} onClick={close}>
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
  const title = [...navigation]
    .reverse()
    .find(({ href }) => pathname === href || pathname.startsWith(href + '/'))?.label;
  const main = useRef<HTMLElement>(null);
  useRouteEntrance(main, pathname);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);
  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">
        Skip to content
      </a>
      <aside className="workspace-sidebar">
        <Link className="brand-link" to="/" title="Darve home">
          <Brand />
        </Link>
        <Navigation primary />
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
            <span>{pathname === '/account' ? 'My profile' : (title ?? 'Creator workspace')}</span>
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
        <Link className="workspace-public-link" to="/welcome" onClick={() => setOpen(false)}>
          Public homepage <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </Dialog>
    </div>
  );
}
