import { useQuery } from '@tanstack/react-query';
import type { CollectionClient } from '@/services/collection/index';
import type { CreatorSnapshot } from '@/services/creator-session/index';

export function useCurrentCollection(client: CollectionClient, scope: CreatorSnapshot['scope']) {
  return useQuery({
    queryKey: scope.key(['collection-current']),
    queryFn: ({ signal }) => client.currentRound(signal),
    retry: false,
    networkMode: 'always',
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
