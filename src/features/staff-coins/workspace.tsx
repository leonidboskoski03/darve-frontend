import { useMemo, useState, useSyncExternalStore } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import { createStaffCoinClient, type StaffCoinClient } from '@/services/staff-coins/index';
import type { StaffAccess } from '@/services/staff-access/index';
import type { CoinToolSelection } from './model';
import { Command } from './command';
import { Configuration, Account, Prices } from './views';
import './workspace.css';
function Workspace({
  client,
  selection,
  onSelect,
}: {
  client: StaffCoinClient;
  selection: CoinToolSelection;
  onSelect: (value: CoinToolSelection) => void;
}) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot),
    [epoch, setEpoch] = useState(0),
    [owner, setOwner] = useState(selection.owner);
  const refresh = useMemo(
    () => () => {
      void client.scope.queryClient.cancelQueries({ queryKey: client.scope.key(['staff-coins']) });
      client.scope.queryClient.removeQueries({ queryKey: client.scope.key(['staff-coins']) });
      setEpoch((value) => value + 1);
    },
    [client],
  );
  const blocked = Boolean(state.attempt);
  return (
    <div className="staff-coins-shell">
      <a className="skip-link" href="#staff-coins-main">
        Skip to coin tools
      </a>
      <header className="staff-coins-topbar">
        <Brand />
        <span>Owner coin tools</span>
        <nav aria-label="Staff workspace">
          <a href="/tickets">Support desk</a>
          <a href="/reviews">Inspection and reviews</a>
          <a href="/">Staff access</a>
          <Button tone="secondary" onClick={() => void client.access.logout()}>
            Sign out
          </Button>
        </nav>
      </header>
      <main id="staff-coins-main" tabIndex={-1}>
        <header>
          <h1>Coin administration</h1>
          <p>
            Review current rewards, creator balances and template prices. Coins have no cash value.
          </p>
        </header>
        <nav className="staff-coins-actions" aria-label="Coin tools">
          {(['configuration', 'account', 'prices'] as const).map((view) => (
            <Button
              key={view}
              tone={selection.view === view ? 'primary' : 'quiet'}
              disabled={blocked}
              onClick={() => onSelect({ ...selection, view })}
            >
              {view === 'configuration'
                ? 'Rewards and configuration'
                : view === 'account'
                  ? 'Creator account'
                  : 'Template prices'}
            </Button>
          ))}
          <Button tone="secondary" disabled={state.phase === 'sending'} onClick={refresh}>
            Refresh coin records
          </Button>
        </nav>
        <Command client={client} refresh={refresh} />
        {selection.view === 'account' ? (
          <form
            className="staff-coins-filter"
            onSubmit={(event) => {
              event.preventDefault();
              onSelect({ ...selection, owner: owner.trim().toLowerCase() });
            }}
          >
            <TextField
              label="Creator account ID"
              required
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              value={owner}
              disabled={blocked}
              onChange={(event) => setOwner(event.target.value)}
            />
            <Button type="submit" disabled={blocked}>
              Read creator account
            </Button>
          </form>
        ) : null}
        {selection.view === 'configuration' ? (
          <Configuration
            key={'configuration:' + epoch}
            client={client}
            epoch={epoch}
            blocked={blocked}
          />
        ) : selection.view === 'account' ? (
          <Account
            key={selection.owner + ':' + epoch}
            client={client}
            owner={selection.owner}
            epoch={epoch}
            blocked={blocked}
          />
        ) : (
          <Prices
            key={selection.template + ':' + epoch}
            client={client}
            template={selection.template}
            epoch={epoch}
            blocked={blocked}
            choose={(template) => onSelect({ ...selection, template })}
          />
        )}
      </main>
    </div>
  );
}
export function StaffCoins({
  access,
  selection,
  onSelect,
}: {
  access: StaffAccess;
  selection: CoinToolSelection;
  onSelect: (value: CoinToolSelection) => void;
}) {
  const client = useMemo(() => createStaffCoinClient(access), [access]);
  return (
    <QueryClientProvider client={client.scope.queryClient}>
      <Workspace client={client} selection={selection} onSelect={onSelect} />
    </QueryClientProvider>
  );
}
