import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Button } from '@/design-system/button';
import { ActionLink } from '@/design-system/action-link';
import { ContentState } from '@/design-system/content-state';
import { LoadingState } from '@/design-system/loading-state';
import {
  CreatorAccessError,
  type CreatorAccessClient,
  type TermsDocument,
} from '@/services/creator-access/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { AccessError } from './error-message';

function Confirmation({
  document,
  client,
  session,
  accepted,
  refreshing,
  onRefresh,
}: {
  document: TermsDocument;
  client: CreatorAccessClient;
  session: CreatorSession;
  accepted: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const acceptance = useMutation({
    mutationFn: () =>
      client.acceptTerms({
        documentId: document.documentId,
        version: document.version,
        contentHash: document.contentHash,
        accepted: true,
      }),
    retry: false,
    onSuccess: async () => {
      await session.inspect();
    },
    onError: (error) => {
      setConfirmed(false);
      if (error instanceof CreatorAccessError && error.problem.status === 409) onRefresh();
    },
  });
  if (accepted)
    return (
      <div className="creator-accepted">
        <p>
          <Check size={18} aria-hidden="true" />
          You have accepted this version.
        </p>
        <ActionLink href="/integrations">Continue to your connections</ActionLink>
      </div>
    );
  return (
    <div className="creator-confirmation">
      <label className="creator-checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={acceptance.isPending || refreshing}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
        />
        <span>I have read and accept account terms version {document.version}.</span>
      </label>
      <Button
        disabled={!confirmed || refreshing}
        busy={acceptance.isPending}
        onClick={() => acceptance.mutate()}
      >
        Accept and continue
      </Button>
      <AccessError error={acceptance.error} />
      {acceptance.isError ? (
        <Button
          tone="quiet"
          onClick={() => {
            void session.inspect();
          }}
        >
          Check current acceptance
        </Button>
      ) : null}
    </div>
  );
}
export function Terms({
  client,
  session,
  snapshot,
}: {
  client: CreatorAccessClient;
  session: CreatorSession;
  snapshot: CreatorSnapshot;
}) {
  const terms = useQuery({
    queryKey: snapshot.scope.key(['creator-terms']),
    queryFn: ({ signal }) => client.terms(signal),
    retry: false,
  });
  const status = snapshot.user?.termsStatus;
  const accepted =
    status?.status === 'accepted' &&
    status.requiredVersion === terms.data?.version &&
    status.documentId === terms.data?.documentId &&
    status.contentHash === terms.data?.contentHash;
  return (
    <section className="creator-card creator-card--terms" aria-labelledby="terms-title">
      <p className="creator-step">02 · Account terms</p>
      <h1 id="terms-title">Read the current account terms</h1>
      <p className="creator-description">
        Acceptance applies to this exact document and version. Signing in alone does not accept it.
      </p>
      {terms.isPending ? (
        <LoadingState label="Loading account terms" />
      ) : terms.isError ? (
        <ContentState
          kind="unavailable"
          title="Account terms are unavailable"
          action={
            <Button
              tone="secondary"
              onClick={() => {
                void terms.refetch();
              }}
            >
              Check terms again
            </Button>
          }
        >
          <AccessError error={terms.error} />
          <p>Setup cannot be completed until the server supplies its current document.</p>
        </ContentState>
      ) : (
        <>
          <div className="creator-document-meta">
            <span>Version {terms.data.version}</span>
            {terms.data.classification === 'development' ? (
              <strong>Development document · local testing only</strong>
            ) : null}
          </div>
          <div
            className="creator-terms-document"
            role="region"
            aria-label="Current account terms"
            tabIndex={0}
          >
            {terms.data.content}
          </div>
          {terms.isFetching ? <p role="status">Refreshing the document…</p> : null}
          <Confirmation
            key={`${terms.data.documentId}:${terms.data.version}:${terms.data.contentHash}`}
            document={terms.data}
            client={client}
            session={session}
            accepted={accepted}
            refreshing={terms.isFetching}
            onRefresh={() => {
              void terms.refetch();
            }}
          />
        </>
      )}
    </section>
  );
}
