import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { SuggestionClient } from '@/services/suggestions/index';
import { chatReason } from './chat-reason';
import { RoundChatStatus } from './chat-status';

const ids = {
  round: '44556677-1234-4234-8234-112233445566',
  result: '77889900-1234-4234-8234-112233445566',
  challenge: '88990011-1234-4234-8234-112233445566',
  source: '00112233-1234-4234-8234-112233445566',
};
const notice = {
  id: ids.source,
  purpose: 'collection_chosen',
  state: 'pinned',
  retired: false,
  reasonCode: null,
  cleanupState: 'not_requested',
};
function mount(data: Record<string, unknown>) {
  const status = vi.fn().mockResolvedValue(data),
    confirmChat = vi.fn().mockResolvedValue(data),
    unpinChat = vi.fn().mockImplementation(() => {
      status.mockResolvedValue({
        ...data,
        notices: [{ ...notice, state: 'unpinned', retired: true }],
      });
      return Promise.resolve(data);
    });
  const client = {
    scope: { key: (parts: unknown[]) => parts },
    chatStatus: status,
    confirmChat,
    unpinChat,
  } as unknown as SuggestionClient;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <RoundChatStatus
        client={client}
        roundId={ids.round}
        item={{ roundId: ids.round, id: ids.result + '.g1' }}
      />
    </QueryClientProvider>,
  );
  return { status, confirmChat, unpinChat };
}
it('reads chat status after reload without an in-memory acceptance receipt and explains a missing bot', async () => {
  const f = mount({
    roundId: ids.round,
    selection: null,
    notices: [],
    availability: { postingReason: 'bot_not_connected', pinReason: null },
  });
  expect(await screen.findByText(/DarveBot is not connected/)).toBeVisible();
  expect(f.status).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Pin in chat' })).toBeDisabled();
});
it('keeps the explicit chosen pin action available when an end notice is currently pinned', async () => {
  const f = mount({
    roundId: ids.round,
    selection: null,
    notices: [{ ...notice, purpose: 'collection_ended' }],
    availability: { postingReason: null, pinReason: null },
  });
  await screen.findByText('Pinned in chat');
  fireEvent.click(screen.getByRole('button', { name: 'Pin in chat' }));
  await vi.waitFor(() => expect(f.confirmChat).toHaveBeenCalledOnce());
});
it('unpins the exact notice and reports confirmed removal', async () => {
  const f = mount({
    roundId: ids.round,
    selection: {
      id: ids.challenge,
      resultVersion: ids.result,
      suggestionId: 'g1',
      sendState: 'sent',
      restricted: false,
      text: 'Invented challenge',
    },
    notices: [notice],
  });
  await screen.findByText('Pinned in chat');
  fireEvent.click(screen.getByRole('button', { name: 'Remove from chat' }));
  await vi.waitFor(() => expect(f.unpinChat).toHaveBeenCalledWith(ids.round, ids.source));
  expect(await screen.findByText('Removed from chat')).toBeVisible();
});
it.each([
  'bot_expired',
  'channel_bot_missing',
  'pin_scope_missing',
  'permission',
  'unavailable',
  'automatic_pin_unsupported',
])('gives a concrete next action for %s', (reason) =>
  expect(chatReason(reason)).toMatch(/owner|Allow DarveBot|provider|platform/),
);
