import { useRef, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { FlaskConical, Wallet } from 'lucide-react';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import type { CreatorSession } from '@/services/creator-session/index';
import { createReceivingClient } from '@/services/receiving/index';
import {
  flowProvider,
  providerName,
  receivingMessage,
  statusText,
  useExpired,
  useReceivingStatus,
  type Client,
  type Flow,
  type Provider,
  type Reading,
  type Receiving,
} from './model';
import { SetupReview } from './setup';
import './workspace.css';

type Setup = {
  flow: Flow;
  country: string | null;
  version: number | null;
  state: Receiving['data']['state'];
};
type Target = { version: number; country: string | null };
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function ProviderCard({
  provider,
  query,
  client,
  setupHeld,
  onSetup,
}: {
  provider: Provider;
  query: UseQueryResult<Reading>;
  client: Client;
  setupHeld: boolean;
  onSetup: (setup: Setup) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const expired = useExpired(query.data?.deadline ?? null);
  const name = providerName[provider];
  const account = query.isError || query.isFetching || busy ? null : query.data?.status;
  const state = expired && account?.state === 'ready' ? 'unavailable' : account?.state;
  const [label, details] = state
    ? statusText[state]
    : query.isError
      ? ['Status unavailable', 'Check current status to reconnect to the account service.']
      : ['Checking status', 'Reading current account information from Darve.'];
  const startable = account && ['not_connected', 'revoked'].includes(account.state);
  const resumable =
    account &&
    ['pending', 'restricted', 'unavailable'].includes(account.state) &&
    !!account.country;
  const canVerify =
    account && !['unconfigured', 'not_connected', 'revoked'].includes(account.state);
  const canDisconnect = canVerify && account.version !== null;
  const reviewed =
    !!target &&
    !!canDisconnect &&
    account.version === target.version &&
    account.country === target.country;

  async function command(kind: 'verify' | 'revoke') {
    if (busy || (kind === 'verify' ? !canVerify : !target || !reviewed || !confirmed)) return;
    setBusy(true);
    setNotice('');
    setProblem('');
    try {
      if (kind === 'verify') {
        if (provider === 'stripe') await client.refreshStripe();
        else await client.refreshPayPal();
      } else if (target) {
        if (provider === 'stripe') await client.revokeStripe(target.version);
        else await client.revokePayPal(target.version);
      }
      if (!client.scope.signal.aborted)
        setNotice(
          kind === 'verify'
            ? 'Provider verification completed. Check the status above.'
            : 'Disconnect request completed. Check the status above.',
        );
    } catch (error) {
      if (!client.scope.signal.aborted) setProblem(receivingMessage(error));
    } finally {
      if (!client.scope.signal.aborted) {
        await query.refetch();
        setTarget(null);
        setBusy(false);
      }
    }
  }
  function openSetup(flow: Flow) {
    if (!account || setupHeld || (!startable && !resumable)) return;
    onSetup({
      flow,
      country: resumable ? account.country : null,
      version: account.version,
      state: account.state,
    });
  }

  return (
    <section className="payout-provider" aria-labelledby={'payout-' + provider}>
      <div className="payout-provider-heading">
        <span className={'payout-mark payout-mark--' + provider} aria-hidden="true">
          {provider === 'stripe' ? 'S' : 'P'}
        </span>
        <div>
          <h2 id={'payout-' + provider}>{name}</h2>
          <p>{provider === 'stripe' ? 'Stripe Connect' : 'PayPal seller account'}</p>
        </div>
        <span className="payout-state" data-state={state}>
          {label}
        </span>
      </div>
      <p className="payout-summary" role="status">
        {expired && account?.state === 'ready'
          ? 'The previous verification expired. Verify receiving again.'
          : details}
      </p>
      {account && (
        <dl className="payout-facts">
          <div>
            <dt>Country</dt>
            <dd>{account.country ?? '—'}</dd>
          </div>
          <div>
            <dt>Verified currencies</dt>
            <dd>{!expired && account.currencies.length ? account.currencies.join(', ') : '—'}</dd>
          </div>
          {'walletActive' in account ? (
            <>
              <div>
                <dt>PayPal wallet</dt>
                <dd>{!expired && account.walletActive ? 'Confirmed' : 'Unconfirmed'}</dd>
              </div>
              <div>
                <dt>Card payments</dt>
                <dd>
                  {!expired && 'cardsActive' in account && account.cardsActive === true
                    ? 'Confirmed'
                    : 'Unconfirmed'}
                </dd>
              </div>
            </>
          ) : null}
          {account.observedAt ? (
            <div>
              <dt>Last verified</dt>
              <dd>{formatter.format(new Date(account.observedAt))}</dd>
            </div>
          ) : null}
        </dl>
      )}
      {problem ? (
        <p className="payout-feedback" role="alert">
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p className="payout-feedback" role="status">
          {notice}
        </p>
      ) : null}
      <div className="payout-actions">
        {(startable || resumable) &&
          !setupHeld &&
          (provider === 'stripe' ? (
            <>
              <Button onClick={() => openSetup('stripeExisting')}>Connect existing Stripe</Button>
              <Button tone="secondary" onClick={() => openSetup('stripe')}>
                {startable ? 'Set up a Stripe test account' : 'Continue Stripe onboarding'}
              </Button>
            </>
          ) : (
            <Button onClick={() => openSetup('paypal')}>
              {startable ? 'Connect PayPal' : 'Continue PayPal setup'}
            </Button>
          ))}
        <Button
          tone="secondary"
          disabled={busy || query.isFetching}
          onClick={() => {
            setNotice('');
            setProblem('');
            void query.refetch();
          }}
        >
          Check {name} status
        </Button>
        {canVerify ? (
          <Button tone="secondary" onClick={() => void command('verify')}>
            Verify {name} receiving
          </Button>
        ) : null}
        {canDisconnect ? (
          <Button
            tone="quiet"
            onClick={() => {
              setConfirmed(false);
              setTarget({ version: account.version!, country: account.country });
            }}
          >
            Disconnect {name}
          </Button>
        ) : null}
      </div>
      {target ? (
        <Dialog
          open
          title={'Disconnect ' + name}
          description="Darve will stop using this connection for receiving. Review the connection before you confirm."
          onDismiss={() => {
            if (!busy) setTarget(null);
          }}
        >
          <div className="payout-review">
            <p>Account country {target.country ?? 'unavailable'}</p>
            {!reviewed && !busy ? (
              <p role="status">The account changed. Close this review and check current status.</p>
            ) : null}
            <label className="payout-check">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy || !reviewed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />{' '}
              <span>I want to disconnect this receiving account.</span>
            </label>
            <div className="payout-actions">
              <Button
                tone="danger"
                busy={busy}
                disabled={!reviewed || !confirmed}
                onClick={() => void command('revoke')}
              >
                Confirm disconnect
              </Button>
              <Button tone="quiet" disabled={busy} onClick={() => setTarget(null)}>
                Keep account
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

export function PayoutSettings({ session }: { session: CreatorSession }) {
  const [client] = useState(() => createReceivingClient(session));
  const [setup, setSetup] = useState<Setup | null>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  const stripe = useReceivingStatus(client, 'stripe');
  const paypal = useReceivingStatus(client, 'paypal');
  const current = setup && (flowProvider(setup.flow) === 'stripe' ? stripe : paypal);
  const allowed =
    !!current &&
    !current.isError &&
    !current.isFetching &&
    current.data?.status.version === setup?.version &&
    current.data?.status.state === setup?.state;
  const showSetup = (value: Setup) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSetup(value);
    setOpen(true);
  };

  return (
    <div className="payout-page">
      <header className="payout-title">
        <div>
          <p className="workspace-eyebrow">
            <Wallet size={16} aria-hidden="true" /> Creator account
          </p>
          <h1 ref={heading} tabIndex={-1}>
            Payout settings
          </h1>
          <p>Connect and verify the accounts that receive viewer contributions.</p>
        </div>
        <span className="payout-environment">
          <FlaskConical size={16} aria-hidden="true" /> Test environment
        </span>
      </header>
      <div className="payout-grid">
        <ProviderCard
          provider="stripe"
          client={client}
          query={stripe}
          setupHeld={!!setup && !open}
          onSetup={showSetup}
        />
        <ProviderCard
          provider="paypal"
          client={client}
          query={paypal}
          setupHeld={!!setup && !open}
          onSetup={showSetup}
        />
      </div>
      <aside className="payout-guide">
        <h2>After connecting</h2>
        <p>
          Return here and verify receiving. Darve uses the current provider status to determine
          whether contributions are available.
        </p>
      </aside>
      {setup && !open ? (
        <Button ref={resume} tone="secondary" onClick={() => setOpen(true)}>
          Resume reviewed setup
        </Button>
      ) : null}
      {setup && current ? (
        <SetupReview
          client={client}
          flow={setup.flow}
          country={setup.country}
          open={open}
          allowed={allowed}
          onClose={(retain) => {
            setOpen(false);
            if (!retain) setSetup(null);
            requestAnimationFrame(() => {
              if (client.scope.signal.aborted) return;
              const previous = trigger.current;
              (retain
                ? resume.current
                : previous?.isConnected
                  ? previous
                  : heading.current
              )?.focus();
            });
          }}
          recheck={() => current.refetch()}
        />
      ) : null}
    </div>
  );
}
