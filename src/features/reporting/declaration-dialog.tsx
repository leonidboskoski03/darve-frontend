import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { Dialog } from '@/design-system/dialog';
import {
  declarationUncertain,
  moneyText,
  type ReportingClient,
  type DeclarationAttempt,
  type Declaration,
  type ChallengeDto,
} from '@/services/reporting/index';
import { ReportProblem } from './common';
export function DeclarationDialog({
  client,
  challenge,
  current,
  attempt,
  available,
  onDismiss,
  onReconcile,
  onSuccess,
}: {
  client: ReportingClient;
  challenge: ChallengeDto;
  current: ChallengeDto | undefined;
  attempt: DeclarationAttempt;
  available: boolean;
  onDismiss: () => void;
  onReconcile: () => Promise<unknown>;
  onSuccess: (value: Declaration) => void;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [denied, setDenied] = useState(false);
  const mutation = useMutation({
    mutationFn: () => client.declare(attempt),
    retry: false,
    onSuccess,
    onError: async (error) => {
      if (!declarationUncertain(error)) {
        setDenied(true);
        await onReconcile();
      }
    },
  });
  const uncertain = mutation.isError && declarationUncertain(mutation.error),
    locked = mutation.isPending || uncertain;
  const changed =
    !available ||
    !current ||
    current.terms.version !== attempt.input.termsVersion ||
    current.performance.revision !== attempt.input.expectedVersion ||
    current.contentAvailability !== 'available' ||
    current.funding.state !== 'funded' ||
    (current.performanceAuthority?.revision ?? 0) !== attempt.authorityRevision ||
    (current.performanceAuthority?.broadcastId ?? current.stream.broadcastId) !==
      attempt.broadcastId;
  return (
    <Dialog
      open
      title="Declare challenge completion"
      description="This records your statement that you completed the challenge on its original or authorized stream."
      onDismiss={() => {
        if (!locked) onDismiss();
      }}
    >
      <p className="report-source-text">
        {available ? challenge.terms.text : 'Challenge content is currently unavailable.'}
      </p>
      <dl className="report-details">
        <div>
          <dt>Challenge goal</dt>
          <dd>{moneyText(challenge.terms.goal.amountMinor, challenge.terms.goal.currency)}</dd>
        </div>
        <div>
          <dt>Stream provider</dt>
          <dd>{attempt.provider}</dd>
        </div>
        <div>
          <dt>
            {attempt.continuationId ? 'Authorized stream reference' : 'Original stream reference'}
          </dt>
          <dd>{attempt.broadcastId}</dd>
        </div>
      </dl>
      <p>
        The server will verify the current funding state, terms and stream authority. Completion is
        recorded as a streamer declaration.
      </p>
      <label className="report-consent">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={locked || denied}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I confirm I completed this challenge on its original or authorized stream.</span>
      </label>
      <ReportProblem error={mutation.error} />
      {changed && !uncertain && (
        <p role="alert">
          The challenge changed or its current status is unavailable. Close this dialog, refresh and
          review again.
        </p>
      )}
      {uncertain && (
        <p role="status">
          The declaration is unconfirmed. Keep this screen open; a deliberate retry uses the same
          terms and request identity. Reloading can lose this in-memory receipt.
        </p>
      )}
      <div className="report-actions">
        <Button tone="secondary" disabled={locked} onClick={onDismiss}>
          Back to challenge
        </Button>
        {!denied && (
          <Button
            busy={mutation.isPending}
            disabled={!confirmed || (!uncertain && changed)}
            onClick={() => mutation.mutate()}
          >
            {uncertain ? 'Retry same declaration' : 'Confirm completion declaration'}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
