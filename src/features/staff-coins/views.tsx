import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { coinAmount } from '@/services/coins/index';
import type { StaffCoinClient } from '@/services/staff-coins/index';
import { ConfigurationForm, AdjustmentForm, PriceForm, FeeForm } from './forms';
import { feeText, minorText } from './model';
import { History, ReadFailure } from './history';
export function Configuration({
  client,
  epoch,
  blocked,
}: {
  client: StaffCoinClient;
  epoch: number;
  blocked: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const read = useQuery({
    queryKey: client.scope.key(['staff-coins', 'configuration', epoch, cursor]),
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const [current, history] = await Promise.all([
        client.configuration(signal),
        client.configurationHistory(cursor, signal),
      ]);
      return { current, history };
    },
  });
  if (read.isError)
    return (
      <ReadFailure
        error={read.error}
        historyCursor={cursor !== null}
        first={() => setCursor(null)}
        refresh={() => void read.refetch()}
      />
    );
  if (!read.data || read.isFetching)
    return <p role="status">Reading reward configuration and history…</p>;
  const { current, history } = read.data;
  return (
    <>
      <section>
        <h2>Reward configuration</h2>
        <p>
          Program {current.programId} · Revision {current.revision}
        </p>
        {!current.configurations.length ? (
          <p>No reward configuration is recorded. Enter each reward explicitly before review.</p>
        ) : null}
        <ConfigurationForm
          key={current.revision}
          client={client}
          current={current}
          disabled={blocked || !client.access.getSnapshot().permissions.includes('coins.configure')}
        />
      </section>
      <History
        items={history.items}
        next={history.nextCursor}
        first={() => {
          setCursor(null);
          void read.refetch();
        }}
        advance={setCursor}
        disabled={blocked}
      />
    </>
  );
}
export function Account({
  client,
  owner,
  epoch,
  blocked,
}: {
  client: StaffCoinClient;
  owner: string;
  epoch: number;
  blocked: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const read = useQuery({
    queryKey: client.scope.key(['staff-coins', 'account', owner, epoch, cursor]),
    retry: false,
    gcTime: 0,
    enabled: Boolean(owner),
    queryFn: async ({ signal }) => {
      const [current, history] = await Promise.all([
        client.account(owner, signal),
        client.ledger(owner, cursor, signal),
      ]);
      return { current, history };
    },
  });
  if (!owner) return <p>Enter the immutable creator ID to read its coin account.</p>;
  if (read.isError)
    return (
      <ReadFailure
        error={read.error}
        historyCursor={cursor !== null}
        first={() => setCursor(null)}
        refresh={() => void read.refetch()}
      />
    );
  if (!read.data || read.isFetching)
    return <p role="status">Reading the current creator account…</p>;
  const { current, history } = read.data;
  return (
    <>
      <section>
        <h2>Creator coin account</h2>
        <p>Creator {current.ownerId}</p>
        <dl>
          <dt>Recorded balance</dt>
          <dd>{coinAmount(current.balance)} coins</dd>
          <dt>Synchronization</dt>
          <dd>{current.state.replaceAll('_', ' ')}</dd>
          <dt>Account revision</dt>
          <dd>{current.revision}</dd>
          <dt>Qualifying progress</dt>
          <dd>
            {current.progress} / {current.progressCap}
          </dd>
        </dl>
        <AdjustmentForm
          key={current.revision}
          client={client}
          current={current}
          disabled={blocked || !client.access.getSnapshot().permissions.includes('coins.adjust')}
        />
      </section>
      <History
        items={history.items}
        next={history.nextCursor}
        first={() => {
          setCursor(null);
          void read.refetch();
        }}
        advance={setCursor}
        disabled={blocked}
      />
    </>
  );
}
export function Prices({
  client,
  template,
  epoch,
  blocked,
  choose,
}: {
  client: StaffCoinClient;
  template: string;
  epoch: number;
  blocked: boolean;
  choose: (id: string) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    selectId = useId();
  const read = useQuery({
    queryKey: client.scope.key(['staff-coins', 'prices', template, epoch, cursor]),
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const [catalogue, history] = await Promise.all([
        client.catalogue(signal),
        template ? client.prices(template, cursor, signal) : Promise.resolve(null),
      ]);
      return { catalogue, history };
    },
  });
  if (read.isError)
    return (
      <ReadFailure
        error={read.error}
        historyCursor={cursor !== null}
        first={() => setCursor(null)}
        refresh={() => void read.refetch()}
      />
    );
  if (!read.data || read.isFetching) return <p role="status">Reading available template prices…</p>;
  const { catalogue, history } = read.data,
    item = catalogue.find((row) => row.id === template);
  return (
    <>
      <section>
        <h2>Template prices</h2>
        <label htmlFor={selectId}>Template to inspect</label>
        <select
          id={selectId}
          disabled={blocked}
          value={template}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">Choose a template</option>
          {catalogue.map((row) => (
            <option key={row.id} value={row.id}>
              {row.displayName} ({row.id})
            </option>
          ))}
        </select>
        {!catalogue.length ? <p>No templates are available to inspect.</p> : null}
        {item ? (
          <>
            <p>
              Template {item.id} · Version {item.assetVersion} ·{' '}
              {item.available ? 'Available' : 'Unavailable'}
            </p>
            <p>
              Current price:{' '}
              {item.amount === null ? 'Not configured' : coinAmount(item.amount) + ' coins'} · Price
              revision: {item.priceRevision ?? 'none'}
            </p>
            <PriceForm
              key={item.id + ':' + item.priceRevision}
              client={client}
              item={item}
              disabled={blocked || !client.access.getSnapshot().permissions.includes('coins.price')}
            />
          </>
        ) : template ? (
          <p role="alert">The requested template is not in the current catalogue.</p>
        ) : null}
      </section>
      {history ? (
        <History
          items={history.items}
          next={history.nextCursor}
          first={() => {
            setCursor(null);
            void read.refetch();
          }}
          advance={setCursor}
          disabled={blocked}
        />
      ) : null}
    </>
  );
}
export function Fees({
  client,
  owner,
  epoch,
  blocked,
}: {
  client: StaffCoinClient;
  owner: string;
  epoch: number;
  blocked: boolean;
}) {
  const read = useQuery({
    queryKey: client.scope.key(['staff-coins', 'fees', owner, epoch]),
    enabled: Boolean(owner),
    retry: false,
    gcTime: 0,
    queryFn: ({ signal }) => client.feeAgreements(owner, signal),
  });
  if (!owner) return <p>Enter a creator account ID to read their fee agreement.</p>;
  if (read.isError)
    return (
      <ReadFailure
        error={read.error}
        historyCursor={false}
        first={() => undefined}
        refresh={() => void read.refetch()}
      />
    );
  if (!read.data || read.isFetching) return <p role="status">Reading the fee agreement…</p>;
  const current = read.data.items[0] ?? null;
  return (
    <>
      <section aria-labelledby="staff-fees-current">
        <h2 id="staff-fees-current">Creator fee agreement</h2>
        {current ? (
          <>
            <p>
              Version {current.revision} ·{' '}
              {current.reason === null ? 'Darve default' : 'Staff offer: ' + current.reason}
            </p>
            <ul>
              {Object.entries(current.policy.currencies).map(([currency, terms]) => (
                <li key={currency}>
                  {currency}: {feeText(terms.darveFee, currency)} · contributions{' '}
                  {minorText(terms.minimumMinor)}–{minorText(terms.maximumMinor)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            This creator has no fee agreement, so their viewers cannot pay yet. An offer creates
            version 1.
          </p>
        )}
      </section>
      <FeeForm client={client} owner={owner} current={current} disabled={blocked} />
      {read.data.items.length > 1 ? (
        <section aria-labelledby="staff-fees-history">
          <h2 id="staff-fees-history">Earlier versions</h2>
          <ol>
            {read.data.items.slice(1).map((item) => (
              <li key={item.id}>
                Version {item.revision} · {new Date(item.createdAt).toLocaleString()} ·{' '}
                {item.reason === null ? 'Darve default' : item.reason} ·{' '}
                {Object.entries(item.policy.currencies)
                  .map(([currency, terms]) => currency + ' ' + feeText(terms.darveFee, currency))
                  .join(', ')}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
