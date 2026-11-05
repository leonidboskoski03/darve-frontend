import { useState, type ReactNode } from 'react';
import { Button } from '@/design-system/button';
import { StatusBadge } from '@/design-system/status-badge';
import { createCreatorAccessClient, type Connection } from '@/services/creator-access/index';
import type { SessionProfile } from '@/services/contracts/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';
import { useCreatorConnections } from './connection-query';
import { providers } from './provider-options';
import './onboarding.css';

const grantCopy: Record<Connection['grantState'], string> = {
  usable: 'Account linked',
  disconnected: 'Disconnected',
  unknown: 'Connection status unknown',
  expired: 'Connection expired',
  refreshing: 'Verification pending',
  reauthorization_required: 'Reconnect needed',
  revoked: 'Connection revoked',
  unconfigured: 'Provider not configured',
  missing: 'Permission missing',
};

function connectionLabel(connection: Connection) {
  if (connection.grantState !== 'usable') return grantCopy[connection.grantState];
  if (connection.reauthorizationRequired) return grantCopy.reauthorization_required;
  if (!connection.channels.length) return 'Channel verification needed';
  if (connection.capabilities.chatRead.reasonCode === 'PERMISSION_REQUIRED')
    return 'Chat permission needed';
  return grantCopy.usable;
}

function ConnectionSummary({
  session,
  scope,
}: {
  session: CreatorSession;
  scope: CreatorSnapshot['scope'];
}) {
  const [client] = useState(() => createCreatorAccessClient({ origin: session.origin!, session }));
  const query = useCreatorConnections(client, scope);
  const rows = new Map<string, Connection>();
  for (const page of query.data?.pages ?? [])
    for (const row of page.items)
      if ((rows.get(row.id)?.version ?? 0) <= row.version) rows.set(row.id, row);
  return (
    <div aria-live="polite">
      {query.isFetching ? (
        <p>Checking streaming connections…</p>
      ) : query.isError ? (
        <p>Streaming connection status is unavailable.</p>
      ) : rows.size === 0 && !query.hasNextPage ? (
        <p>No streaming accounts are connected.</p>
      ) : (
        <>
          <ul aria-label="Streaming connection status">
            {providers.map(({ id, label }) => {
              const states = [
                ...new Set(
                  [...rows.values()].filter((row) => row.provider === id).map(connectionLabel),
                ),
              ];
              return states.length ? (
                <li key={id}>
                  <strong>{label}</strong> {states.join(' · ')}
                </li>
              ) : null;
            })}
          </ul>
          {query.hasNextPage ? <p>Open Connections to review additional accounts.</p> : null}
        </>
      )}
    </div>
  );
}

function Step({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <li>
      <span className="onboarding-step-number" aria-hidden="true">
        {number}
      </span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </li>
  );
}

export function OnboardingGuide({
  session,
  scope,
  terms,
  notice,
  termsLink,
  connectionsLink,
  receiving,
  payoutsLink,
  obsLink,
  dashboardLink,
}: {
  session: CreatorSession;
  scope: CreatorSnapshot['scope'];
  terms: SessionProfile['termsStatus'];
  notice: string | null;
  termsLink: ReactNode;
  connectionsLink: ReactNode;
  receiving: ReactNode;
  payoutsLink: ReactNode;
  obsLink: ReactNode;
  dashboardLink: ReactNode;
}) {
  const accepted = terms.status === 'accepted';
  return (
    <div className="onboarding-guide">
      <header className="onboarding-intro">
        <p className="workspace-eyebrow">Creator setup</p>
        <h1>Set up your stream</h1>
        <p>
          Review your Darve account, connect the services you use, and get ready to run a challenge.
        </p>
        {notice ? <p role="status">{notice}</p> : null}
        {accepted ? (
          <div className="onboarding-actions">
            {dashboardLink}
            <Button
              tone="quiet"
              onClick={() => {
                void session.inspect();
              }}
            >
              Check setup status
            </Button>
          </div>
        ) : null}
      </header>
      <ol className="onboarding-steps" aria-label="Setup steps">
        <Step number="01" title="Account terms">
          {accepted ? (
            <p>
              <StatusBadge tone="success">Accepted</StatusBadge> Version {terms.acceptedVersion}
            </p>
          ) : terms.status === 'unconfigured' ? (
            <p>
              Account terms are unavailable in this environment. Check the terms page for current
              availability.
            </p>
          ) : (
            <p>Review and accept the current terms to continue with creator setup.</p>
          )}
          {termsLink}
        </Step>
        <Step number="02" title="Streaming connections">
          <p>
            Link your Twitch, YouTube or Kick account and review its chat permissions. Live stream
            checks run in Collection.
          </p>
          {accepted ? (
            <>
              <ConnectionSummary session={session} scope={scope} />
              {connectionsLink}
            </>
          ) : (
            <p>Available after you accept the account terms.</p>
          )}
        </Step>
        <Step number="03" title="Viewer contributions">
          <p>
            Connect and verify a receiving account for viewer contributions. These statuses are for
            the test environment.
          </p>
          {accepted ? (
            <>
              {receiving}
              {payoutsLink}
            </>
          ) : (
            <p>Available after you accept the account terms.</p>
          )}
        </Step>
        <Step number="04" title="OBS display">
          <p>
            Open OBS Display for the instructions and private Browser Source link. Preview the
            source in OBS to check that it works.
          </p>
          {accepted ? obsLink : <p>Available after you accept the account terms.</p>}
        </Step>
      </ol>
    </div>
  );
}
