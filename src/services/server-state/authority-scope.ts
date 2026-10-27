import { createQueryClient } from './query-client';

let nextId = 0;

/** Each authority lifetime has a new cache/controller; no private cache is recycled. */
export function createAuthorityScope(audience: 'creator' | 'staff' | 'guest' | 'overlay') {
  const id = ++nextId;
  const controller = new AbortController();
  const queryClient = createQueryClient();
  const cleanups = new Set<() => void>();
  const assertActive = () => {
    if (controller.signal.aborted) throw new DOMException('Authority changed.', 'AbortError');
  };
  return {
    id,
    audience,
    queryClient,
    signal: controller.signal,
    key: (parts: readonly unknown[]) => [audience, id, ...parts] as const,
    onDispose(cleanup: () => void) {
      if (controller.signal.aborted) cleanup();
      else cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    async query<T>(parts: readonly unknown[], read: (signal: AbortSignal) => Promise<T>) {
      assertActive();
      return queryClient.fetchQuery({
        queryKey: [audience, id, ...parts],
        queryFn: async ({ signal }) => {
          const result = await read(AbortSignal.any([controller.signal, signal]));
          assertActive();
          return result;
        },
      });
    },
    dispose() {
      if (controller.signal.aborted) return;
      controller.abort();
      void queryClient.cancelQueries();
      queryClient.clear();
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch {
          /* Cleanup must not retain other authority resources. */
        }
      }
      cleanups.clear();
    },
  };
}
export type AuthorityScope = ReturnType<typeof createAuthorityScope>;
