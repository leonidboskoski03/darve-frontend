import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import {
  createStaffBotClient,
  type StaffBotClient,
  type BotAccount,
} from '@/services/staff-bots/index';
import type { StaffAccess } from '@/services/staff-access/index';
import './accounts.css';
function Account({
  account,
  client,
  blocked,
}: {
  account: BotAccount;
  client: StaffBotClient;
  blocked: boolean;
}) {
  const [reason, setReason] = useState('');
  const provider = account.provider.toLowerCase();
  return (
    <section aria-labelledby={'bot-' + provider}>
      <h2 id={'bot-' + provider}>
        {account.provider === 'YOUTUBE'
          ? 'YouTube'
          : account.provider === 'TWITCH'
            ? 'Twitch'
            : 'Kick'}
      </h2>
      <p>
        {account.connected ? 'Connected' : 'Not connected'}
        {account.actorKind
          ? ' · ' + (account.actorKind === 'DARVE_BOT' ? 'DarveBot' : 'Test actor')
          : ''}
      </p>
      <dl>
        <dt>Channel name</dt>
        <dd>{account.channelName ?? 'Not yet verified; reconnect to record the name.'}</dd>
        <dt>Expiry</dt>
        <dd>
          {account.expiresAt ? (
            <time dateTime={account.expiresAt}>{new Date(account.expiresAt).toLocaleString()}</time>
          ) : (
            'Unknown'
          )}
        </dd>
        <dt>Last account outcome</dt>
        <dd>
          {account.lastOutcome ?? 'Not validated'}
          {account.checkedAt ? ' · ' + new Date(account.checkedAt).toLocaleString() : ''}
        </dd>
        <dt>Granted scopes</dt>
        <dd>{account.scopes.join(', ') || 'None'}</dd>
        <dt>Pin permission</dt>
        <dd>
          {account.provider !== 'TWITCH'
            ? 'Automatic pinning unsupported'
            : account.pinPermission
              ? 'Granted; destination authorization and moderator status are still required.'
              : 'Not granted'}
        </dd>
        {account.commandState && (
          <>
            <dt>Latest account request</dt>
            <dd>
              {account.commandState === 'uncertain'
                ? 'Unconfirmed after interruption. Review a new refresh to abandon the old request; reconnect may still be needed if the provider rotated its token.'
                : account.commandState}
            </dd>
          </>
        )}
      </dl>
      {account.authorizationId && (
        <form onSubmit={(event) => event.preventDefault()}>
          <TextField
            label={account.provider + ' change reason'}
            value={reason}
            maxLength={2000}
            disabled={blocked}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="staff-bots-actions">
            <Button
              tone="secondary"
              disabled={
                blocked ||
                !reason.trim() ||
                !account.scopes.length ||
                ['queued', 'running'].includes(account.commandState ?? '') ||
                account.lastOutcome === 'production_test_actor' ||
                account.lastOutcome === 'revoked'
              }
              onClick={() => client.prepare(account, 'refresh', reason)}
            >
              Review refresh {account.provider}
            </Button>
            <Button
              tone="quiet"
              disabled={blocked || !reason.trim()}
              onClick={() => client.prepare(account, 'revoke', reason)}
            >
              Review revoke {account.provider}
            </Button>
          </div>
        </form>
      )}
      <details>
        <summary>Reconnect {account.provider}</summary>
        <p>
          Use the loopback operator on the backend host. Staff cookies and creator tokens cannot be
          used for bot consent.
        </p>
        <ol>
          <li>
            Set the reviewed posting account binding in the private, ignored <code>.env.bot</code>:
            provider bot AUTHORIZATION_ID, SUBJECT, CHANNEL_ID and ACTOR_KIND. Production accepts
            DARVE_BOT only.
          </li>
          <li>
            Register the exact callback <code>http://localhost:3102/operator/bot/callback</code> for
            the configured operator origin. Stop an existing operator on port 3102 before starting
            another.
          </li>
          {account.provider === 'TWITCH' && (
            <li>
              Set <code>TWITCH_BOT_PIN_PERMISSION=true</code> before consent to request{' '}
              <code>moderator:manage:chat_messages</code>. Make the bot a moderator in the
              destination channel; the creator grants <code>channel:bot</code> through Allow
              DarveBot notices.
            </li>
          )}
          <li>
            From the backend folder, run <code>npm run bot:setup -- {provider} authorize</code>,
            open the local operator page in a separate browser session, and sign in as the posting
            account.
          </li>
          <li>
            Refresh this view after consent. The collector must use the same reviewed bot binding.
            Connecting alone does not prove a message was posted.
          </li>
        </ol>
      </details>
    </section>
  );
}
function Accounts({ client }: { client: StaffBotClient }) {
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [confirmation, setConfirmation] = useState<typeof state.attempt>(null);
  const confirmed = Boolean(state.attempt && confirmation === state.attempt);
  // Set on the first poll check (not during render) and renewed after each command.
  const pollUntil = useRef<number | null>(null);
  const read = useQuery({
    queryKey: client.scope.key(['staff-bots']),
    queryFn: ({ signal }) => client.read(signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: ({ state: query }) =>
      Date.now() < (pollUntil.current ??= Date.now() + 60000) &&
      query.data?.some((a) => ['queued', 'running'].includes(a.commandState ?? ''))
        ? 3000
        : false,
  });
  const refetch = read.refetch;
  useEffect(() => {
    if (['recorded', 'rejected', 'uncertain'].includes(state.phase)) {
      pollUntil.current = Date.now() + 60000;
      void refetch();
    }
  }, [state.phase, refetch]);
  return (
    <div className="staff-bots">
      <header>
        <Brand />
        <nav aria-label="Staff workspace">
          <a href="/tickets">Support desk</a>
          <a href="/reviews">Inspection and reviews</a>
          <a href="/coins">Coin tools</a>
          <a href="/">Staff access</a>
        </nav>
      </header>
      <main>
        <h1>DarveBot accounts</h1>
        <p>
          Separate posting accounts for notices. Only owner administrators can refresh or revoke
          them.
        </p>
        <Button
          tone="secondary"
          busy={read.isFetching}
          disabled={state.phase === 'sending'}
          onClick={() => void read.refetch()}
        >
          Refresh account status
        </Button>
        {state.attempt ? (
          <section aria-label="Review bot change">
            <h2>Review bot change</h2>
            <p>{state.attempt.summary}</p>
            <p>Reason: {state.attempt.body.reason}</p>
            <p>Reviewed revision: {state.attempt.body.expectedRevision}</p>
            {state.phase === 'uncertain' && (
              <p role="alert">
                Result unconfirmed. Retry keeps the same key, target, action and reason. Do not
                create a replacement request.
              </p>
            )}
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={state.phase === 'sending'}
                onChange={(event) => setConfirmation(event.target.checked ? state.attempt : null)}
              />{' '}
              I reviewed this exact account, action, reason and revision.
            </label>
            <div className="staff-bots-actions">
              <Button
                disabled={!confirmed || state.phase === 'sending'}
                onClick={() => void client.execute(confirmed)}
              >
                {state.phase === 'uncertain' ? 'Retry same bot change' : 'Confirm bot change'}
              </Button>
              {state.phase === 'review' && (
                <Button tone="quiet" onClick={() => client.cancel()}>
                  Cancel bot review
                </Button>
              )}
            </div>
          </section>
        ) : state.phase === 'recorded' ? (
          <p role="status">
            The server recorded the command. A refresh is queued for the collector; revocation is
            immediate in Darve, with provider revocation queued. Check the last account outcome for
            the provider result. This does not send chat messages.
          </p>
        ) : null}
        {state.error && (
          <p role="alert">
            {state.error.code === 'REAUTHENTICATION_REQUIRED'
              ? 'Verify your staff sign-in again, refresh the account, then review a new command.'
              : state.error.code === 'BOT_ALREADY_REVOKED'
                ? 'This account is already revoked or has no stored credentials. Refresh account status.'
                : state.error.code === 'STALE_VERSION'
                  ? 'The account changed; refresh and review its current revision.'
                  : 'The account change could not be confirmed. Check current status before another action.'}
          </p>
        )}
        {read.isError ? (
          <p role="alert">
            DarveBot status could not be verified. Refresh account status to try again.
          </p>
        ) : !read.data || read.isFetching ? (
          <p role="status">Reading posting accounts…</p>
        ) : (
          read.data.map((account) => (
            <Account
              key={account.provider}
              account={account}
              client={client}
              blocked={Boolean(state.attempt)}
            />
          ))
        )}
      </main>
    </div>
  );
}
export function StaffBots({ access }: { access: StaffAccess }) {
  const client = useMemo(() => createStaffBotClient(access), [access]);
  return (
    <QueryClientProvider client={client.scope.queryClient}>
      <Accounts client={client} />
    </QueryClientProvider>
  );
}
