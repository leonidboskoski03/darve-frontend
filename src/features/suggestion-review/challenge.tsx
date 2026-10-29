import { useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import { consumerMoney } from '@/services/contracts/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';
import { reviewMessage, type SuggestionClient } from '@/services/suggestions/index';
export function ChallengeStatus({
  client,
  snapshot,
  id,
  roundId,
  suggestionId,
}: {
  client: SuggestionClient;
  snapshot: CreatorSnapshot;
  id: string;
  roundId: string;
  suggestionId: string;
}) {
  const query = useQuery({
    queryKey: snapshot.scope.key(['review-challenge', roundId, suggestionId, id]),
    queryFn: ({ signal }) => client.challenge(id, roundId, suggestionId, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const value = query.data;
  let goal = value?.terms.goal.amountMinor ?? '';
  if (value && ['USD', 'EUR'].includes(value.terms.goal.currency))
    goal = consumerMoney(goal, value.terms.goal.currency).decimal ?? '';
  return (
    <section className="review-panel" aria-labelledby="accepted-title">
      <h2 id="accepted-title">Accepted challenge</h2>
      <a href={'/challenges/' + id}>View challenge details and declaration</a>
      {query.isPending ? (
        <p role="status">Loading challenge status…</p>
      ) : query.isError ? (
        <p role="alert">{reviewMessage(query.error)}</p>
      ) : value ? (
        <>
          <p>
            {value.contentAvailability === 'available'
              ? value.terms.text
              : 'Challenge content is unavailable.'}
          </p>
          <dl className="review-terms">
            <dt>Goal</dt>
            <dd>
              {goal} {value.terms.goal.currency}
            </dd>
            <dt>Funding closes</dt>
            <dd>
              <time
                dateTime={value.fundingWindow?.effectiveClosesAt ?? value.terms.fundingClosesAt}
              >
                {value.fundingWindow?.effectiveClosesAt ?? value.terms.fundingClosesAt}
              </time>
            </dd>
            <dt>Funding status</dt>
            <dd>
              {value.funding.state === 'pending'
                ? 'Awaiting funding'
                : value.funding.state === 'funded'
                  ? 'Funded'
                  : 'Funding unsuccessful'}
            </dd>
          </dl>
          <p className="review-muted">
            This acceptance does not reject other ideas or close challenges from other rounds.
          </p>
        </>
      ) : null}
      <Button
        tone="secondary"
        busy={query.isFetching}
        onClick={() => {
          void query.refetch();
        }}
      >
        Refresh challenge
      </Button>
    </section>
  );
}
