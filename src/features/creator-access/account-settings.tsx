import type { ReactNode } from 'react';
import { Panel } from '@/design-system/panel';
import type { SessionProfile } from '@/services/contracts/index';
import './account-settings.css';

export function AccountSettings({
  displayName,
  terms,
  termsLink,
  connectionsLink,
  payoutsLink,
}: {
  displayName: SessionProfile['displayName'];
  terms: Extract<SessionProfile['termsStatus'], { status: 'accepted' }>;
  termsLink: ReactNode;
  connectionsLink: ReactNode;
  payoutsLink: ReactNode;
}) {
  return (
    <div className="creator-account">
      <header className="creator-account__header">
        <h1>Account settings</h1>
        <p>Review your Darve profile and manage how your account connects to other services.</p>
      </header>
      <div className="creator-account__grid">
        <Panel title="Profile">
          <dl className="creator-account__profile">
            <dt>Display name</dt>
            <dd>{displayName?.trim() ? displayName : 'No display name is available.'}</dd>
          </dl>
        </Panel>
        <Panel title="Account terms">
          <p>Accepted version {terms.acceptedVersion}.</p>
          {terms.classification === 'development' ? (
            <p>Development terms for local testing.</p>
          ) : null}
          {termsLink}
        </Panel>
        <Panel title="Streaming connections">
          <p>Review connected Twitch, YouTube and Kick accounts and manage stream permissions.</p>
          {connectionsLink}
        </Panel>
        <Panel title="Payout settings">
          <p>
            Manage Stripe and PayPal connections and check whether they can receive contributions.
          </p>
          {payoutsLink}
        </Panel>
      </div>
    </div>
  );
}
