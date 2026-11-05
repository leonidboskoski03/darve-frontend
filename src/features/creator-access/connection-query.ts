import { useInfiniteQuery } from '@tanstack/react-query';
import type { CreatorAccessClient } from '@/services/creator-access/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';

export function useCreatorConnections(
  client: CreatorAccessClient,
  scope: CreatorSnapshot['scope'],
) {
  return useInfiniteQuery({
    queryKey: scope.key(['creator-connections']),
    initialPageParam: null,
    queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) =>
      client.connections(pageParam, signal),
    getNextPageParam: (last) => last.nextCursor,
    retry: false,
  });
}
