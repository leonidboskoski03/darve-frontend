import { useInfiniteQuery } from '@tanstack/react-query';
import type { createReportingClient } from '@/services/reporting/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';

export function useChallengePages(
  client: ReturnType<typeof createReportingClient>,
  scope: CreatorSnapshot['scope'],
  current: boolean,
) {
  return useInfiniteQuery({
    queryKey: scope.key(['challenge-history', current]),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => client.history(current, pageParam, signal),
    getNextPageParam: (page) => page.data.nextCursor,
    retry: false,
    networkMode: 'always',
  });
}
