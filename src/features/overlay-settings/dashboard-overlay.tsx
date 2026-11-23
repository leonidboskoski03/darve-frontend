import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '@/design-system/panel';
import { ActionLink } from '@/design-system/action-link';
import { Button } from '@/design-system/button';
import { createOverlayOwner } from '@/services/overlay/index';
import type { CreatorSession, CreatorSnapshot } from '@/services/creator-session/index';

export function DashboardOverlay({
  session,
  scope,
}: {
  session: CreatorSession;
  scope: CreatorSnapshot['scope'];
}) {
  const [client] = useState(() => createOverlayOwner(session));
  const preferences = useQuery({
    queryKey: scope.key(['overlay-preferences']),
    queryFn: ({ signal }) => client.preferences(signal),
    retry: false,
    networkMode: 'always',
  });
  const selection = useQuery({
    queryKey: scope.key(['overlay-selection']),
    queryFn: ({ signal }) => client.currentSelection(signal),
    retry: false,
    networkMode: 'always',
  });
  const template =
    !preferences.isFetching && !preferences.isError ? preferences.data?.template : undefined;
  const selected = !selection.isFetching && !selection.isError ? selection.data : undefined;
  return (
    <Panel title="OBS display">
      <div aria-live="polite">
        <p>
          {preferences.isFetching
            ? 'Checking OBS preferences…'
            : template
              ? `Template: ${template.templateId}${template.available ? '' : ' (unavailable)'}`
              : 'OBS preferences are unavailable.'}
        </p>
        <p>
          {selection.isFetching
            ? 'Checking this display’s selection…'
            : selection.isError
              ? 'This display’s selection is unavailable. Check OBS settings to try again.'
              : !selected
                ? 'Open OBS setup to create your first display.'
                : selected.challengeId
                  ? 'This display is set to an accepted challenge.'
                  : selected.roundId
                    ? 'This display is set to a collection round.'
                    : 'This display has no selection.'}
        </p>
        {selected?.challengeId ? (
          <p>
            <a href={'/challenges/' + selected.challengeId}>Open displayed challenge</a>
          </p>
        ) : selected?.roundId ? (
          <p>
            <a href={'/collection/' + selected.roundId}>Open displayed round</a>
          </p>
        ) : null}
      </div>
      <ActionLink tone="secondary" href="/obs">
        Open OBS setup
      </ActionLink>
      <Button
        tone="quiet"
        busy={preferences.isFetching || selection.isFetching}
        onClick={() => {
          void preferences.refetch();
          void selection.refetch();
        }}
      >
        Check OBS settings
      </Button>
    </Panel>
  );
}
