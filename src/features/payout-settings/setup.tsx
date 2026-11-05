import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import { receivingUncertain, type ReceivingAttempt } from '@/services/receiving/index';
import {
  flowProvider,
  providerName,
  receivingMessage,
  useExpired,
  type Client,
  type Flow,
} from './model';

type Attempt = { [F in Flow]: ReceivingAttempt<F> }[Flow];
type Handoff = { url: string; deadline: number | null };
function start(client: Client, attempt: Attempt) {
  switch (attempt.flow) {
    case 'stripe':
      return client.onboardStripe(attempt);
    case 'stripeExisting':
      return client.connectExistingStripe(attempt);
    case 'paypal':
      return client.onboardPayPal(attempt);
  }
}

export function SetupReview({
  client,
  flow,
  country: existingCountry,
  open,
  allowed,
  onClose,
  recheck,
}: {
  client: Client;
  flow: Flow;
  country: string | null;
  open: boolean;
  allowed: boolean;
  onClose: (retain: boolean) => void;
  recheck: () => Promise<unknown>;
}) {
  const [country, setCountry] = useState(existingCountry ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const provider = providerName[flowProvider(flow)];
  const expired = useExpired(handoff?.deadline ?? null);
  const close = () => {
    if (!busy) onClose(uncertain);
  };

  async function submit() {
    if (busy || (attempt ? !uncertain : !confirmed || !allowed || !/^[A-Z]{2}$/.test(country)))
      return;
    setBusy(true);
    setProblem('');
    try {
      const reviewed =
        attempt ??
        (flow === 'paypal'
          ? client.preparePayPal(country, confirmed)
          : flow === 'stripe'
            ? client.prepareStripe(country)
            : client.prepareStripeExisting(country));
      setAttempt(reviewed);
      const result = await start(client, reviewed);
      if (client.scope.signal.aborted) return;
      setUncertain(false);
      if (result.kind === 'redirect') {
        setHandoff({
          url: result.url,
          deadline: 'expiresAt' in result ? Date.parse(result.expiresAt) : null,
        });
      } else {
        setNotice(
          'state' in result && result.state === 'already_connected'
            ? 'Stripe already has a connection. Check the current receiving status.'
            : 'There is no new provider link. Check the current receiving status before taking another action.',
        );
      }
      await recheck();
    } catch (error) {
      if (client.scope.signal.aborted) return;
      const unknown = receivingUncertain(error);
      setUncertain(unknown);
      setProblem(receivingMessage(error, true));
      if (!unknown) await recheck();
    } finally {
      if (!client.scope.signal.aborted) setBusy(false);
    }
  }
  const title =
    flow === 'stripeExisting'
      ? 'Connect an existing Stripe account'
      : flow === 'stripe'
        ? existingCountry
          ? 'Continue Stripe onboarding'
          : 'Set up a Stripe test account'
        : existingCountry
          ? 'Continue PayPal seller setup'
          : 'Connect a PayPal sandbox seller';

  return (
    <Dialog
      open={open}
      title={title}
      description="Review your country and the provider action. This setup uses the test environment."
      onDismiss={close}
    >
      <form
        className="payout-review"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label>
          <span>Account country code</span>
          <input
            value={country}
            onChange={(event) => setCountry(event.target.value.toUpperCase())}
            disabled={busy || !!attempt || !!existingCountry}
            autoComplete="off"
            maxLength={2}
            pattern="[A-Z]{2}"
            required
            placeholder="US"
          />
          <span className="payout-hint">
            Use the two-letter country code for your provider account, such as US or PL.
          </span>
        </label>
        <label className="payout-check">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy || !!attempt}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          <span>
            {flow === 'paypal'
              ? 'I consent to sharing the information required for PayPal seller setup and have reviewed the country above.'
              : 'I have reviewed the country and want to start this Stripe test setup.'}
          </span>
        </label>
        {problem ? <p role="alert">{problem}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {!allowed && !attempt ? (
          <p role="status">The account status changed. Close this review and check the account.</p>
        ) : null}
        {handoff ? (
          expired ? (
            <p role="status">
              This provider link expired. Close this review and check current status.
            </p>
          ) : (
            <p>
              Continue on {provider} to complete setup. When you return, Darve reads your current
              status.
            </p>
          )
        ) : null}
        <div className="payout-actions">
          {!attempt || uncertain ? (
            <Button
              type="submit"
              busy={busy}
              disabled={!attempt && (!allowed || !confirmed || !/^[A-Z]{2}$/.test(country))}
            >
              {uncertain ? 'Retry same setup' : 'Confirm setup'}
            </Button>
          ) : null}
          {handoff && !expired ? (
            <a
              className="ds-control ds-control--primary"
              href={handoff.url}
              referrerPolicy="no-referrer"
              onClick={(event) => {
                if (
                  client.scope.signal.aborted ||
                  (handoff.deadline !== null && Date.now() >= handoff.deadline)
                )
                  event.preventDefault();
              }}
            >
              Continue to {provider} <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          ) : null}
          {attempt && !handoff ? (
            <Button tone="secondary" disabled={busy} onClick={() => void recheck()}>
              Check current status
            </Button>
          ) : null}
          <Button tone="quiet" disabled={busy} onClick={close}>
            Back to settings
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
