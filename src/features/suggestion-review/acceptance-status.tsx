import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import type { CreatorSession } from '@/services/creator-session/index';
import { createOverlayOwner } from '@/services/overlay/index';
import type { AcceptedChallenge, SuggestionClient } from '@/services/suggestions/index';

const reasons: Record<string, string> = {
  BOT_UNCONFIGURED: 'DarveBot is unavailable for this channel.',
  CONTEXT_CHANGED: 'The stream or chat connection changed.',
  ROUND_NOT_READY: 'This round can no longer announce its selection.',
  INPUT_RESTRICTED: 'This choice is no longer available to announce.',
  INVALID_INPUT: 'The challenge and support link do not fit the chat notice.',
  SUPPORT_LINK_UNAVAILABLE: 'The public support link is unavailable.',
  CHOICE_REPLACED: 'A newer chat choice replaced this one.',
  pin_disabled: 'Pinning was disabled for this round.',
  automatic_pin_unsupported: 'This platform does not support automatic pins.',
  unavailable: 'The chat provider is temporarily unavailable.',
  binding: 'DarveBot’s authorization is unavailable.',
  permission: 'DarveBot does not have permission in this chat.',
  stale: 'The chat notice expired or the stream changed.',
  message: 'The chat provider rejected the notice text.',
};

export function AcceptanceStatus({
  accepted,
  client,
  session,
}: {
  accepted: Pick<AcceptedChallenge, 'id' | 'roundId' | 'display' | 'chat'>;
  client: SuggestionClient;
  session: CreatorSession;
}) {
  const overlay = useMemo(() => createOverlayOwner(session), [session]);
  const [shown, setShown] = useState(accepted.display?.state === 'shown');
  const [pollUntil] = useState(() => Date.now() + 60_000);
  const chat = accepted.chat;
  const requested = chat?.state === 'requested' ? chat : null;
  const display = accepted.display;
  const chatQuery = useQuery({
    queryKey: client.scope.key(['accepted-chat', accepted.roundId, accepted.id]),
    queryFn: ({ signal }) => client.chatStatus(accepted.roundId, signal),
    enabled: requested !== null,
    retry: false,
    refetchInterval: ({ state }) => {
      if (!requested || Date.now() >= pollUntil) return false;
      const data = state.data;
      if (!data) return 2000;
      const choice = data.selection;
      if (choice?.id !== requested.choiceId || choice.restricted) return false;
      if (choice.sendState === 'pending' || choice.sendState === 'sending') return 1500;
      const pin = data.notices.find((notice) => notice.id === requested.pinId);
      return choice.sendState === 'sent' &&
        !pin?.retired &&
        (pin?.state === 'pending' || pin?.state === 'pinning')
        ? 1500
        : false;
    },
  });
  const select = useMutation({
    mutationFn: async (id: string) => {
      const current = await overlay.selection(id);
      if (current.challengeId !== accepted.id) {
        await overlay.select(id, {
          expectedVersion: current.version,
          roundId: accepted.roundId,
          challengeId: accepted.id,
        });
      }
    },
    onSuccess: () => setShown(true),
  });
  let chatText: string | undefined;
  if (chat?.state === 'unavailable') {
    chatText = reasons[chat.reason] ?? 'DarveBot could not queue this announcement.';
  } else if (requested) {
    const choice = chatQuery.data?.selection;
    const pin = chatQuery.data?.notices.find((notice) => notice.id === requested.pinId);
    if (chatQuery.isError) chatText = 'Chat status is temporarily unavailable.';
    else if (!chatQuery.data) chatText = 'Chat announcement queued…';
    else if (choice?.id !== requested.choiceId || choice.restricted)
      chatText = 'This chat choice is no longer active.';
    else if (choice.sendState === 'sent') {
      const suffix =
        pin?.state === 'pinned' && !pin.retired
          ? ' (pinned)'
          : pin?.reasonCode
            ? ` (${reasons[pin.reasonCode] ?? 'Pin unavailable.'})`
            : !pin?.retired && (pin?.state === 'pending' || pin?.state === 'pinning')
              ? ' (pin pending)'
              : requested.pinId
                ? ' (pin not confirmed)'
                : '';
      chatText = `Announced in chat ✓${suffix}`;
    } else if (choice.sendState === 'rejected')
      chatText = reasons[choice.sendReason ?? ''] ?? 'DarveBot could not post the announcement.';
    else if (choice.sendState === 'unknown')
      chatText = 'DarveBot could not confirm the announcement.';
    else chatText = 'Chat announcement queued…';
  }

  const status = [
    shown
      ? 'Shown on stream ✓'
      : display?.state === 'offer_switch'
        ? 'Current OBS selection kept.'
        : display?.state === 'no_display'
          ? 'No OBS display is set up.'
          : null,
    chatText,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      {status && <p role="status">{status}</p>}
      {!shown && display?.state === 'offer_switch' && (
        <Button
          tone="secondary"
          busy={select.isPending}
          onClick={() => select.mutate(display.displayId)}
        >
          Show on stream now?
        </Button>
      )}
      {select.isError && (
        <p role="alert">Could not switch the OBS display. Try again or use manual selection.</p>
      )}
    </>
  );
}
