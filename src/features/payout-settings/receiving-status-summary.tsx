import { useState } from 'react';
import { StatusBadge } from '@/design-system/status-badge';
import type { CreatorSession } from '@/services/creator-session/index';
import { createReceivingClient } from '@/services/receiving/index';
import {
  providerName,
  statusText,
  useExpired,
  useReceivingStatus,
  type Client,
  type Provider,
} from './model';

function ProviderStatus({ client, provider }: { client: Client; provider: Provider }) {
  const query = useReceivingStatus(client, provider);
  const expired = useExpired(query.data?.deadline ?? null);
  const state = query.data?.status.state;
  const verified = state === 'ready' && query.data?.deadline != null && !expired;
  const label = query.isFetching
    ? 'Checking status'
    : query.isError || !state
      ? 'Status unavailable'
      : statusText[state === 'ready' && !verified ? 'unavailable' : state][0];
  return (
    <li>
      <strong>{providerName[provider]}</strong>{' '}
      <StatusBadge tone={!query.isFetching && !query.isError && verified ? 'success' : 'neutral'}>
        {label}
      </StatusBadge>
    </li>
  );
}

export function ReceivingStatusSummary({ session }: { session: CreatorSession }) {
  const [client] = useState(() => createReceivingClient(session));
  return (
    <ul aria-label="Test receiving status" aria-live="polite">
      <ProviderStatus client={client} provider="stripe" />
      <ProviderStatus client={client} provider="paypal" />
    </ul>
  );
}
