import type { ReactNode } from 'react';
import { UserRound } from 'lucide-react';
import type { SessionProfile } from '@/services/contracts/index';
import './account-settings.css';

export function AccountSettings({
  displayName,
  connectionsLink,
  payoutsLink,
}: {
  displayName: SessionProfile['displayName'];
  connectionsLink: ReactNode;
  payoutsLink: ReactNode;
}) {
  return (
    <div className="creator-account">
      <section className="creator-account__identity" aria-labelledby="account-profile">
        <span className="creator-account__avatar" aria-hidden="true">
          {displayName?.trim() ? displayName.trim().slice(0, 1).toLocaleUpperCase() : <UserRound />}
        </span>
        <header className="creator-account__header">
          <h1>Account settings</h1>
          <h2 id="account-profile">{displayName?.trim() || 'Your profile'}</h2>
        </header>
        <dl className="creator-account__profile">
          <dt>Display name</dt>
          <dd>{displayName?.trim() || 'No display name'}</dd>
        </dl>
      </section>
      <div className="creator-account__settings">
        <section className="creator-account__row" aria-labelledby="account-connections">
          <h2 id="account-connections">Streaming connections</h2>
          <p>Linked accounts and chat permissions.</p>
          <div className="creator-account__action">{connectionsLink}</div>
        </section>
        <section className="creator-account__row" aria-labelledby="account-payouts">
          <h2 id="account-payouts">Payout settings</h2>
          <p>Stripe and PayPal receiving accounts.</p>
          <div className="creator-account__action">{payoutsLink}</div>
        </section>
      </div>
    </div>
  );
}
