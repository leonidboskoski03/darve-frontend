import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { CreatorSession } from '@/services/creator-session/index';
import type { SuggestionClient } from '@/services/suggestions/index';
import { AcceptanceStatus } from './acceptance-status';

const roundId = '44556677-1234-4234-8234-112233445566';
const choiceId = '55667788-1234-4234-8234-112233445566';
const pinId = '66778899-1234-4234-8234-112233445566';
const status = (state: 'pinned' | 'unpinning' | 'unpinned') => ({
  roundId,
  selection: {
    id: choiceId,
    resultVersion: '77889900-1234-4234-8234-112233445566',
    suggestionId: 'g1',
    sendState: 'sent' as const,
    restricted: false,
    sendReason: null,
    text: 'Invented chosen challenge',
  },
  notices: [
    {
      id: pinId,
      purpose: 'collection_chosen' as const,
      state,
      reasonCode: null,
      retired: state === 'unpinned',
      cleanupState: 'not_requested' as const,
    },
  ],
});

it('offers Remove from chat for a confirmed pin and reports the removal', async () => {
  const chatStatus = vi
    .fn()
    .mockResolvedValueOnce(status('pinned'))
    .mockResolvedValue(status('unpinned'));
  const unpinChat = vi.fn().mockResolvedValue(status('unpinning'));
  const client = {
    scope: { key: (parts: unknown[]) => parts },
    chatStatus,
    unpinChat,
  } as unknown as SuggestionClient;
  // The overlay owner only reads the session scope while rendering this status.
  const session = {
    getSnapshot: () => ({ scope: { signal: new AbortController().signal } }),
  } as unknown as CreatorSession;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AcceptanceStatus
        accepted={{
          id: '88990011-1234-4234-8234-112233445566',
          roundId,
          display: undefined,
          chat: { state: 'requested', choiceId, pinId },
        }}
        client={client}
        session={session}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Announced in chat ✓ (pinned)')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Remove from chat' }));
  await vi.waitFor(() => expect(unpinChat).toHaveBeenCalledWith(roundId, pinId));
  expect(await screen.findByText('Announced in chat ✓ · Removed from chat ✓')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Remove from chat' })).toBeNull();
});
