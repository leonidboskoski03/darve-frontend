import { useCallback, useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Brand } from '@/design-system/brand';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import {
  createStaffAdminClient,
  type AdminSelection,
  type AdminView,
} from '@/services/staff-admin/index';
import type { StaffAccess } from '@/services/staff-access/index';
import { useAdminCommand } from './use-command';
import { AdminFeedback } from './feedback';
import { AdminLists } from './lists';
import { Inspection } from './inspection';
import './workspace.css';
const titles: Record<AdminView, string> = {
  challenges: 'Challenge inspection',
  challenge: 'Challenge inspection',
  streamer: 'Creator inspection',
  reviews: 'Manual reviews',
  staff: 'Staff administration',
  audit: 'Staff audit history',
};
export function StaffAdminWorkspace({
  access,
  selection,
  onSelect,
}: {
  access: StaffAccess;
  selection: AdminSelection;
  onSelect: (selection: AdminSelection) => void;
}) {
  const client = useMemo(() => createStaffAdminClient(access, window.location.origin), [access]);
  const [epoch, setEpoch] = useState(0);
  const refresh = useCallback(() => {
    const key = client.scope.key(['staff-admin']);
    void client.scope.queryClient.cancelQueries({ queryKey: key });
    client.scope.queryClient.removeQueries({ queryKey: key });
    setEpoch((value) => value + 1);
  }, [client]);
  const command = useAdminCommand(client, refresh);
  const choose = (next: AdminSelection) => {
    if (command.blocked) return;
    command.clearResult();
    refresh();
    onSelect(next);
  };
  const owner = access.getSnapshot().permissions.includes('staff.manage');
  const allowed =
    selection.view === 'staff'
      ? owner
      : selection.view === 'audit'
        ? access.getSnapshot().permissions.includes('staff.audit.read')
        : access.getSnapshot().permissions.includes('review.read');
  return (
    <QueryClientProvider client={client.scope.queryClient}>
      <div className="staff-admin-shell">
        <a className="skip-link" href="#staff-admin-main">
          Skip to staff tools
        </a>
        <header className="staff-admin-header">
          <Brand />
          <span>
            Staff tools ·{' '}
            {access.getSnapshot().role === 'OWNER_ADMIN' ? 'Owner administrator' : 'Support'}
          </span>
          <nav aria-label="Staff workspace">
            <a href="/tickets">Support desk</a>
            <a href="/">Staff access</a>
            <Button tone="secondary" onClick={() => void access.logout()}>
              Sign out
            </Button>
          </nav>
        </header>
        <main id="staff-admin-main" tabIndex={-1}>
          <header>
            <h1>{titles[selection.view]}</h1>
            <p>
              {owner
                ? 'Inspect authorized records and review sensitive changes before submitting.'
                : 'Only current assigned ticket context is available. You can flag concerns; moderation decisions and staff administration require an owner administrator.'}
            </p>
          </header>
          <nav className="staff-admin-toolbar" aria-label="Staff tools">
            <div>
              {(
                ['reviews', 'challenges', ...(owner ? (['staff', 'audit'] as const) : [])] as const
              ).map((view) => (
                <Button
                  key={view}
                  tone={selection.view === view ? 'primary' : 'quiet'}
                  disabled={command.blocked}
                  onClick={() => choose({ view, id: '', owner: '', state: '' })}
                >
                  {view === 'reviews'
                    ? 'Manual reviews'
                    : view === 'challenges'
                      ? 'Inspect challenges'
                      : view === 'staff'
                        ? 'Staff members'
                        : 'Audit history'}
                </Button>
              ))}
            </div>
            <Button
              tone="secondary"
              onClick={() => {
                command.clearResult();
                refresh();
              }}
            >
              Refresh current records
            </Button>
          </nav>
          {allowed ? (
            <>
              <Filters
                key={'filters:' + selection.view + selection.owner + selection.state + epoch}
                selection={selection}
                disabled={command.blocked}
                onSelect={choose}
              />
              {selection.view === 'challenge' || selection.view === 'streamer' ? (
                <Inspection
                  key={'inspection:' + selection.view + selection.id + epoch}
                  client={client}
                  selection={selection}
                  command={command}
                  onSelect={choose}
                  epoch={epoch}
                />
              ) : (
                <AdminLists
                  key={'list:' + selection.view + selection.owner + selection.state + epoch}
                  client={client}
                  selection={selection}
                  command={command}
                  onSelect={choose}
                  epoch={epoch}
                />
              )}
            </>
          ) : (
            <p role="alert">These tools are not available with your current staff access.</p>
          )}
          <AdminFeedback key={command.invitation?.id ?? 'result'} command={command} />
        </main>
      </div>
    </QueryClientProvider>
  );
}
function Filters({
  selection,
  disabled,
  onSelect,
}: {
  selection: AdminSelection;
  disabled: boolean;
  onSelect: (next: AdminSelection) => void;
}) {
  const [owner, setOwner] = useState(selection.owner),
    [state, setState] = useState(selection.state),
    [id, setId] = useState(''),
    [kind, setKind] = useState<'challenge' | 'streamer'>('challenge');
  const pattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  if (selection.view === 'staff' || selection.view === 'audit') return null;
  return (
    <div className="staff-admin-filters">
      {selection.view === 'challenges' || selection.view === 'reviews' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSelect({ ...selection, owner: owner.trim(), state });
          }}
        >
          <TextField
            label="Creator filter ID"
            pattern={pattern}
            value={owner}
            disabled={disabled}
            onChange={(event) => setOwner(event.target.value)}
          />
          {selection.view === 'reviews' ? (
            <>
              <label htmlFor="staff-review-state">Review state</label>
              <select
                id="staff-review-state"
                className="ds-input"
                disabled={disabled}
                value={state}
                onChange={(event) => setState(event.target.value)}
              >
                <option value="">All review states</option>
                <option value="open">Open</option>
                <option value="in_review">In review</option>
                <option value="resolved">Resolved</option>
              </select>
            </>
          ) : null}
          <Button type="submit" tone="secondary" disabled={disabled}>
            Apply record filters
          </Button>
        </form>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSelect({ view: kind, id: id.trim(), owner: '', state: '' });
        }}
      >
        <label htmlFor="staff-inspection-kind">Inspection target</label>
        <select
          id="staff-inspection-kind"
          className="ds-input"
          disabled={disabled}
          value={kind}
          onChange={(event) =>
            setKind(event.target.value === 'streamer' ? 'streamer' : 'challenge')
          }
        >
          <option value="challenge">Challenge</option>
          <option value="streamer">Creator</option>
        </select>
        <TextField
          label="Inspection target ID"
          required
          pattern={pattern}
          value={id}
          disabled={disabled}
          onChange={(event) => setId(event.target.value)}
        />
        <Button type="submit" tone="secondary" disabled={disabled || !id.trim()}>
          Inspect known target
        </Button>
      </form>
    </div>
  );
}
