import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContributionRuntime } from '@/services/contributions/index';
export function ViewerLink({ runtime, slug }: { runtime: ContributionRuntime; slug: string }) {
  const query = useQuery(
    {
      queryKey: ['viewer-link', slug],
      queryFn: ({ signal }) => runtime.resolveViewerLink(slug, signal),
      retry: false,
      gcTime: 0,
    },
    runtime.publicQueries,
  );
  useEffect(() => {
    // The viewer relay supplies payment-specific CSP on the destination document.
    if (query.isSuccess && query.data) window.location.replace('/contribute/' + query.data);
  }, [query.isSuccess, query.data]);
  if (query.isPending) return <p role="status">Finding the current challenge…</p>;
  if (query.isError)
    return (
      <>
        <h1>Couldn’t find the current challenge</h1>
        <button type="button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </>
    );
  return query.data ? (
    <p role="status">Opening the contribution page…</p>
  ) : (
    <h1>No open challenge right now</h1>
  );
}
