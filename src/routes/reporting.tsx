import { useContext, useEffect } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { CreatorSessionContext, useCreatorSession } from '@/features/session-status/index';
import { CreatorAccess } from '@/features/creator-access/index';
import {
  Dashboard,
  History,
  ChallengeDetail,
  RoundAnalytics,
  type HistoryFilter,
} from '@/features/reporting/index';
import { defaultReportingZone, reportingParameters } from '@/services/reporting/index';
function Configured() {
  const { controller, snapshot } = useCreatorSession(),
    { pathname } = useLocation(),
    { challengeId, roundId } = useParams(),
    [search, setSearch] = useSearchParams();
  if (snapshot.phase !== 'authenticated' || snapshot.user?.termsStatus.status !== 'accepted')
    return (
      <CreatorAccess
        runtime={{ origin: controller.origin!, session: controller, snapshot }}
        notice={null}
        mode="connect"
      />
    );
  const runtime = { session: controller, snapshot };
  if (challengeId) return <ChallengeDetail key={challengeId} {...runtime} id={challengeId} />;
  if (roundId) return <RoundAnalytics key={roundId} {...runtime} roundId={roundId} />;
  if (pathname === '/challenges') {
    const value = search.get('status');
    const filter: HistoryFilter =
      value === 'funding' || value === 'funded' || value === 'declared' || value === 'unsuccessful'
        ? value
        : 'all';
    return (
      <History
        {...runtime}
        current={search.get('scope') === 'current'}
        filter={filter}
        onFilters={(current, next) => {
          void setSearch({
            ...(current ? { scope: 'current' } : {}),
            ...(next !== 'all' ? { status: next } : {}),
          });
        }}
      />
    );
  }
  const input = {
    timeZone: search.get('timeZone') ?? defaultReportingZone(),
    ...(search.has('fromDate') ? { fromDate: search.get('fromDate')! } : {}),
    ...(search.has('throughDate') ? { throughDate: search.get('throughDate')! } : {}),
    ...(search.has('broadcastId') ? { broadcastId: search.get('broadcastId')! } : {}),
  };
  return (
    <Dashboard
      key={search.toString()}
      {...runtime}
      input={input}
      onApply={(value) => {
        void setSearch(reportingParameters(value));
      }}
    />
  );
}
export function Component() {
  const session = useContext(CreatorSessionContext),
    { pathname } = useLocation();
  useEffect(() => {
    document.title =
      (pathname === '/dashboard'
        ? 'Dashboard'
        : pathname.endsWith('/analytics')
          ? 'Round analytics'
          : 'Challenges') + ' — Darve';
  }, [pathname]);
  return session?.origin ? (
    <Configured />
  ) : (
    <CreatorAccess runtime={null} notice={null} mode="connect" />
  );
}
