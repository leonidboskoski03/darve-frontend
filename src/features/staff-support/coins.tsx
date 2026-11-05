import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { coinAmount } from '@/services/coins/index';
import type { StaffSupportClient } from '@/services/staff-support/index';
export function TicketCoins({
  client,
  id,
  epoch,
}: {
  client: StaffSupportClient;
  id: string;
  epoch: number;
}) {
  const read = useQuery({
    queryKey: client.scope.key(['staff-support', 'thread', id, epoch, 'coins']),
    gcTime: 0,
    retry: false,
    queryFn: ({ signal }) => client.coins(id, signal),
  });
  // Never retain the previous projection across a reconnect, reassignment or failed read.
  const data = !read.isError && !read.isFetching ? read.data : undefined;
  return (
    <section aria-labelledby="ticket-coins-heading">
      <h2 id="ticket-coins-heading">Creator coin context</h2>
      <p>Read-only context for this authorized ticket.</p>
      {read.isError ? (
        <p role="alert">Coin context is unavailable with the current ticket access.</p>
      ) : !data ? (
        <p role="status">Checking current coin context…</p>
      ) : (
        <>
          <dl>
            <dt>Recorded balance</dt>
            <dd>{coinAmount(data.balance)} coins</dd>
            <dt>Qualifying progress</dt>
            <dd>
              {data.progress} / {data.progressCap}
            </dd>
          </dl>
          <ul>
            {data.templates.map((item) => (
              <li key={item.id}>
                {item.displayName} · {item.ownershipState.replaceAll('_', ' ')} ·{' '}
                {item.available ? 'Available' : 'Unavailable'} · Version {item.assetVersion}
              </li>
            ))}
          </ul>
          {!data.templates.length ? <p>No templates in this authorized context.</p> : null}
        </>
      )}
      <Button tone="quiet" disabled={read.isFetching} onClick={() => void read.refetch()}>
        Refresh coin context
      </Button>
    </section>
  );
}
