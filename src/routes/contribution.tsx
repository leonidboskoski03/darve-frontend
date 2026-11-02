import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMatches, useParams, useNavigate, useLocation } from 'react-router-dom';
import { Brand } from '@/design-system/brand';
import {
  Contribution,
  PrivateReceipt,
  ReceiptLookup,
  GuestBoundary,
} from '@/features/contributions/index';
import type { ContributionRuntime } from '@/services/contributions/index';

function Configured({ runtime }: { runtime: ContributionRuntime }) {
  const { publicId, checkoutId } = useParams(),
    navigate = useNavigate(),
    location = useLocation();
  const { visible, revision } = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot,
  );
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus();
    document.title = (publicId ? 'Support a challenge' : 'Private receipt') + ' — Darve';
  }, [publicId, checkoutId, location.pathname]);
  return (
    <div className="contribution-shell" data-color-scheme="light">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="contribution-brand-rail">
        <a href="/">
          <Brand />
          <span className="alpha-label">ALPHA</span>
        </a>
        <p>
          good ideas.
          <br />
          shared moments.
        </p>
        <small>Made for viewers. Built for streamers.</small>
      </aside>
      <main id="main-content" ref={main} tabIndex={-1} className="contribution-main">
        {publicId ? (
          <Contribution
            key={publicId}
            runtime={runtime}
            publicId={publicId}
            onReceipt={(id) => {
              void navigate('/receipts/' + id);
            }}
          />
        ) : checkoutId ? (
          <PrivateReceipt
            key={checkoutId}
            runtime={runtime}
            id={checkoutId}
            visible={visible}
            revision={revision}
          />
        ) : (
          <ReceiptLookup
            onOpen={(id) => {
              void navigate('/receipts/' + id);
            }}
          />
        )}
      </main>
    </div>
  );
}
export function Component() {
  const matches = useMatches();
  const handle = matches.at(-1)?.handle as { apiOrigin?: string } | undefined;
  const origin = handle?.apiOrigin;
  return origin ? (
    <GuestBoundary key={origin} origin={origin}>
      {(runtime) => <Configured runtime={runtime} />}
    </GuestBoundary>
  ) : (
    <main id="main-content" className="message-page">
      <h1>{origin ? 'Opening contribution page…' : 'Contribution service not connected'}</h1>
      <p>
        {origin
          ? 'Checking the configured service.'
          : 'An API connection is required to view current challenge and private receipt records.'}
      </p>
      <a href="/">Return to Darve</a>
    </main>
  );
}
