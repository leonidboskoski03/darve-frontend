import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import type {
  AdminSelection,
  StaffAdminClient,
  StaffChallenge,
  StaffStreamer,
} from '@/services/staff-admin/index';
import type { AdminCommand } from './use-command';
import { ReviewedAction } from './reviewed-action';
import { adminError } from './error';
export function Inspection({
  client,
  selection,
  command,
  onSelect,
  epoch,
}: {
  client: StaffAdminClient;
  selection: AdminSelection;
  command: AdminCommand;
  onSelect: (next: AdminSelection) => void;
  epoch: number;
}) {
  const query = useQuery({
    queryKey: client.scope.key(['staff-admin', 'inspection', selection.view, selection.id, epoch]),
    gcTime: 0,
    queryFn: async ({ signal }) =>
      selection.view === 'challenge'
        ? { kind: 'challenge' as const, value: await client.challenge(selection.id, signal) }
        : { kind: 'streamer' as const, value: await client.streamer(selection.id, signal) },
  });
  const owner = client.access.getSnapshot().permissions.includes('moderation.write');
  const restriction = useQuery({
    queryKey: client.scope.key(['staff-admin', 'restriction', selection.id, epoch]),
    gcTime: 0,
    enabled: owner && selection.view === 'streamer' && query.isSuccess,
    queryFn: ({ signal }) => client.restriction(selection.id, signal),
  });
  if (query.isPending) return <p role="status">Loading current authorized inspection…</p>;
  if (query.isError) return <p role="alert">{adminError(query.error)}</p>;
  const data = query.data;
  return (
    <section className="staff-admin-detail">
      {data.kind === 'challenge' ? (
        <ChallengeDetails
          challenge={data.value}
          onCreator={() =>
            onSelect({ view: 'streamer', id: data.value.ownerId, owner: '', state: '' })
          }
        />
      ) : (
        <StreamerDetails streamer={data.value} />
      )}
      {client.access.getSnapshot().permissions.includes('review.flag') ? (
        <ReviewedAction
          key={'flag' + epoch}
          title="Flag for manual review"
          label="Confirm review flag"
          summary={
            'Flag ' +
            data.kind +
            ' ' +
            data.value.id +
            '. This opens a review and does not automatically restrict funding.'
          }
          command={command}
          prepare={(reason) => client.prepareFlag(data.kind, data.value.id, reason)}
        />
      ) : null}
      {owner && data.kind === 'streamer' ? (
        restriction.isPending ? (
          <p role="status">Checking current restriction…</p>
        ) : restriction.isError ? (
          <p role="alert">{adminError(restriction.error)}</p>
        ) : restriction.data ? (
          <section>
            <h2>Creator restriction</h2>
            <p>
              {restriction.data.banned ? 'Banned from new activity' : 'Not currently banned'}.
              Revision {restriction.data.revision}.
            </p>
            <p>
              A ban blocks new collection, acceptance and contributions. Existing history is
              retained and in-flight provider payments may still reconcile. External checkout recall
              is not guaranteed. Removing a ban does not reopen an expired funding window.
            </p>
            <ReviewedAction
              key={'restriction' + epoch + restriction.data.revision}
              title={restriction.data.banned ? 'Remove creator ban' : 'Ban creator'}
              label={restriction.data.banned ? 'Confirm unban' : 'Confirm ban'}
              summary={
                (restriction.data.banned ? 'Unban ' : 'Ban ') +
                data.value.id +
                ' at restriction revision ' +
                restriction.data.revision +
                '. This does not issue a refund.'
              }
              command={command}
              prepare={(reason) => client.prepareRestriction(restriction.data, reason)}
            />
          </section>
        ) : null
      ) : null}
      <Button
        tone="quiet"
        disabled={command.blocked}
        onClick={() =>
          onSelect({
            view: 'reviews',
            id: '',
            owner: data.kind === 'challenge' ? data.value.ownerId : data.value.id,
            state: '',
          })
        }
      >
        View this creator’s reviews
      </Button>
    </section>
  );
}
function ChallengeDetails({
  challenge: c,
  onCreator,
}: {
  challenge: StaffChallenge;
  onCreator: () => void;
}) {
  return (
    <>
      <h2>Challenge inspection</h2>
      <p className="staff-admin-id">
        Challenge <code>{c.id}</code>
      </p>
      <p>
        {c.contentAvailable
          ? (c.text ?? 'Challenge text unavailable')
          : 'Source content is no longer available.'}
      </p>
      <dl className="staff-admin-facts">
        <div>
          <dt>Creator</dt>
          <dd>
            {c.creatorDisplayName ?? 'Display name unavailable'}
            <br />
            <code>{c.ownerId}</code>
          </dd>
        </div>
        <div>
          <dt>Provider / original broadcast</dt>
          <dd>
            {c.provider} / {c.broadcastId}
          </dd>
        </div>
        <div>
          <dt>Goal</dt>
          <dd>
            {c.goal.amountMinor} minor units · {c.goal.currency}
          </dd>
        </div>
        <div>
          <dt>Accepted terms</dt>
          <dd>
            <code>{c.termsId}</code>
          </dd>
        </div>
        <div>
          <dt>Funding deadline</dt>
          <dd>{new Date(c.fundingDeadlineAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Creator declaration</dt>
          <dd>{c.declaredAt ? new Date(c.declaredAt).toLocaleString() : 'Not declared'}</dd>
        </div>
      </dl>
      <h3>Stored funding projection</h3>
      <p>
        This inspection reads the stored projection. It does not refresh a payment provider or
        establish payment, funding or performance by itself.
      </p>
      {c.funding ? (
        <dl className="staff-admin-facts">
          <div>
            <dt>Projection state / revision</dt>
            <dd>
              {c.funding.state} / {c.funding.revision}
            </dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>{new Date(c.funding.observedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>Confirmed gross</dt>
            <dd>
              {c.funding.confirmedGross} minor units · {c.goal.currency}
            </dd>
          </div>
          <div>
            <dt>Eligible gross</dt>
            <dd>
              {c.funding.eligibleGross} minor units · {c.goal.currency}
            </dd>
          </div>
          <div>
            <dt>Unclassified gross</dt>
            <dd>
              {c.funding.unclassifiedGross} minor units · {c.goal.currency}
            </dd>
          </div>
        </dl>
      ) : (
        <p>Funding projection unavailable. No zero balance is inferred.</p>
      )}
      {c.restriction ? (
        <p>
          Restriction: {c.restriction.banned ? 'banned' : 'not banned'} (revision{' '}
          {c.restriction.revision}).
        </p>
      ) : null}
      {c.review ? (
        <p>
          {c.review.openCount} open reviews · {c.review.inReviewCount} in review.
        </p>
      ) : null}
      <Button tone="secondary" onClick={onCreator}>
        Inspect this creator
      </Button>
    </>
  );
}
function StreamerDetails({ streamer }: { streamer: StaffStreamer }) {
  return (
    <>
      <h2>Creator inspection</h2>
      <p>{streamer.displayName ?? 'Display name unavailable'}</p>
      <dl className="staff-admin-facts">
        <div>
          <dt>Creator ID</dt>
          <dd>
            <code>{streamer.id}</code>
          </dd>
        </div>
        <div>
          <dt>Account created</dt>
          <dd>{new Date(streamer.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
      <p>
        Only the safe account projection is shown. Support access depends on current assigned ticket
        context.
      </p>
    </>
  );
}
