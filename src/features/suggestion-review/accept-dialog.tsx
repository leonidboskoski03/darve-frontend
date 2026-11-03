import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import { consumerMoney } from '@/services/contracts/index';
import {
  reviewMessage,
  uncertainReview,
  type Suggestion,
  type ReviewPage,
  type SuggestionClient,
  type AcceptanceAttempt,
  type AcceptedChallenge,
  type AcceptancePolicy,
} from '@/services/suggestions/index';
export function AcceptDialog({
  client,
  page,
  item,
  current,
  allowed,
  onDismiss,
  onAccepted,
  onReconcile,
}: {
  client: SuggestionClient;
  page: ReviewPage;
  item: Suggestion;
  current: Suggestion | undefined;
  allowed: boolean;
  onDismiss: () => void;
  onAccepted: (value: AcceptedChallenge) => void;
  onReconcile: () => Promise<unknown>;
}) {
  const [decimal, setDecimal] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [seconds, setSeconds] = useState('');
  const [attempt, setAttempt] = useState<AcceptanceAttempt | null>(null);
  const [inputError, setInputError] = useState<unknown>(null);
  const [denied, setDenied] = useState(false);
  const policyRead = useQuery({
    queryKey: client.scope.key(['suggestion-acceptance-policy']),
    gcTime: 0,
    queryFn: ({ signal }) => client.acceptancePolicy(signal),
  });
  const policy = policyRead.data;
  const [consentedPolicy, setConsentedPolicy] = useState<AcceptancePolicy | null>(null);
  const currencies = Object.keys(policy?.currencies ?? {}).filter((value) =>
    ['EUR', 'USD'].includes(value),
  );
  const chosenCurrency = currencies.includes(currency) ? currency : (currencies[0] ?? '');
  const limits = policy?.currencies[chosenCurrency];
  const mutation = useMutation({
    mutationFn: (value: AcceptanceAttempt) => client.accept(value),
    retry: false,
    onSuccess: onAccepted,
    onError: async (error) => {
      if (!uncertainReview(error)) {
        setDenied(true);
        await onReconcile();
      }
    },
  });
  const uncertain = mutation.isError && uncertainReview(mutation.error);
  const locked = mutation.isPending || uncertain;
  const changed =
    !allowed ||
    !current ||
    current.version !== item.version ||
    current.analysisRunId !== item.analysisRunId ||
    current.snapshotVersion !== item.snapshotVersion ||
    current.selectedChallengeId !== null ||
    current.dismissed;
  return (
    <Dialog
      open
      title={attempt ? 'Confirm challenge terms' : 'Configure challenge'}
      description="Accept one idea from this round. Challenges from other rounds are kept."
      onDismiss={() => {
        if (!locked) onDismiss();
      }}
    >
      <p className="review-dialog-text">
        {allowed ? item.text : 'The source is currently unavailable. Refresh before reviewing it.'}
      </p>
      {changed && !uncertain ? (
        <p role="alert">
          This idea or result changed. Close this dialog, refresh and review again.
        </p>
      ) : null}
      <p className="review-muted">
        Performance is tied to this collection’s stream. Funding duration is separate from
        collection time. The server checks receiving readiness and allowed terms.
      </p>
      {inputError || mutation.error ? (
        <p role="alert">{reviewMessage(inputError ?? mutation.error)}</p>
      ) : null}
      {!attempt ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setInputError(null);
            try {
              setAttempt(
                client.prepare(page, item, {
                  decimal,
                  currency: chosenCurrency,
                  seconds,
                  policy: policy ?? null,
                  extensionAccepted: consentedPolicy === policy,
                }),
              );
            } catch (error) {
              setInputError(error);
            }
          }}
        >
          <label className="ds-field">
            <span className="ds-field__label">Funding goal</span>
            <input
              className="ds-input"
              inputMode="decimal"
              autoComplete="off"
              value={decimal}
              onChange={(event) => setDecimal(event.target.value)}
              placeholder="e.g. 25.50"
              required
            />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Currency</span>
            <select
              className="ds-input"
              value={chosenCurrency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {currencies.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Funding duration in seconds</span>
            <input
              className="ds-input"
              inputMode="numeric"
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
              placeholder="e.g. 600"
              required
            />
          </label>
          {policyRead.isPending ? <p role="status">Checking current acceptance policy…</p> : null}
          {policyRead.isError ? (
            <>
              <p role="alert">Current acceptance policy is unavailable.</p>
              <Button tone="secondary" onClick={() => void policyRead.refetch()}>
                Retry policy check
              </Button>
            </>
          ) : null}
          {policyRead.isSuccess && !policy ? <p>Challenge acceptance is not configured.</p> : null}
          {policy && !currencies.length ? (
            <p>The configured currencies are not supported by this form.</p>
          ) : null}
          {policy && limits ? (
            <p className="review-muted">
              Policy {policy.version}. Allowed goal:{' '}
              {consumerMoney(limits.minimumMinor, chosenCurrency).decimal}–
              {consumerMoney(limits.maximumMinor, chosenCurrency).decimal} {chosenCurrency}. Funding
              duration: {policy.minimumFundingSeconds}–{policy.maximumFundingSeconds} seconds. Use
              decimal text with up to two decimal places.
            </p>
          ) : null}
          {policy?.extensionPolicy ? (
            <>
              <p>{policy.extensionPolicy.disclosure}</p>
              <label className="review-policy-check">
                <input
                  type="checkbox"
                  checked={consentedPolicy === policy}
                  onChange={(event) => setConsentedPolicy(event.target.checked ? policy : null)}
                />
                <span>
                  I understand and accept this funding extension policy (
                  {policy.extensionPolicy.version}).
                </span>
              </label>
            </>
          ) : null}
          <div className="review-actions">
            <Button tone="secondary" onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                changed ||
                !limits ||
                policyRead.isError ||
                Boolean(policy?.extensionPolicy && consentedPolicy !== policy)
              }
            >
              Review exact terms
            </Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="review-terms">
            <dt>Funding goal</dt>
            <dd>
              {consumerMoney(attempt.input.goal.amountMinor, attempt.input.goal.currency).decimal}{' '}
              {attempt.input.goal.currency}
            </dd>
            <dt>Funding duration</dt>
            <dd>{attempt.input.fundingDurationSeconds} seconds</dd>
            {attempt.input.extensionPolicyVersion ? (
              <>
                <dt>Accepted extension disclosure</dt>
                <dd>
                  {attempt.extensionDisclosure} ({attempt.input.extensionPolicyVersion})
                </dd>
              </>
            ) : null}
            <dt>Source</dt>
            <dd>
              Published idea #{item.rank} · version {attempt.input.expectedVersion}
            </dd>
          </dl>
          {uncertain ? (
            <p role="status">
              Acceptance is unconfirmed. Keep this screen open. A deliberate retry sends the same
              terms and request identity; it cannot create a second operation. Reloading can lose
              this in-memory receipt.
            </p>
          ) : null}
          <div className="review-actions">
            <Button tone="secondary" disabled={locked} onClick={onDismiss}>
              Back to review
            </Button>
            {!denied && (
              <Button
                busy={mutation.isPending}
                disabled={!uncertain && changed}
                onClick={() => mutation.mutate(attempt)}
              >
                {uncertain ? 'Retry same acceptance' : 'Confirm acceptance'}
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
