import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/design-system/button';
import {
  reviewMessage,
  type SuggestionClient,
  type Suggestion,
} from '@/services/suggestions/index';
import { chatReason } from './chat-reason';
export function RoundChatStatus({
  client,
  roundId,
  item,
}: {
  client: SuggestionClient;
  roundId: string;
  item?: Pick<Suggestion, 'roundId' | 'id'>;
}) {
  const [pollUntil, setPollUntil] = useState(() => Date.now() + 60000);
  const query = useQuery({
    queryKey: client.scope.key(['round-chat-status', roundId]),
    queryFn: ({ signal }) => client.chatStatus(roundId, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: ({ state }) =>
      Date.now() < pollUntil &&
      (state.data?.selection?.sendState === 'pending' ||
        state.data?.selection?.sendState === 'sending' ||
        state.data?.notices.some((n) => ['pending', 'pinning', 'unpinning'].includes(n.state)))
        ? 1500
        : false,
  });
  const changed = () => {
    setPollUntil(Date.now() + 60000);
    void query.refetch();
  };
  const pin = useMutation({
    mutationFn: () => client.confirmChat(item!),
    retry: false,
    onSuccess: changed,
  });
  const unpin = useMutation({
    mutationFn: (id: string) => client.unpinChat(roundId, id),
    retry: false,
    onSuccess: changed,
  });
  const data = query.data;
  const notice = data?.notices.find((n) => n.purpose === 'collection_chosen') ?? data?.notices[0];
  const activePin = data?.notices.find((n) => n.state === 'pinned' && !n.retired);
  const reason =
    data?.selection?.sendState === 'rejected'
      ? data.selection.sendReason
      : (data?.availability?.postingReason ?? notice?.reasonCode ?? data?.availability?.pinReason);
  const text =
    notice?.state === 'unpinned'
      ? 'Removed from chat'
      : notice?.state === 'unpinning'
        ? 'Removing from chat…'
        : activePin
          ? 'Pinned in chat'
          : (chatReason(reason) ??
            (data?.selection?.sendState === 'sent'
              ? 'Announced in chat'
              : data?.selection?.sendState === 'unknown'
                ? 'The announcement is unconfirmed; check chat before another action.'
                : data?.selection
                  ? 'Chat announcement queued…'
                  : 'No chosen challenge has been announced in chat.'));
  const sameChoice =
    item &&
    data?.selection &&
    data.selection.resultVersion === item.id.split('.')[0] &&
    data.selection.suggestionId === item.id.split('.')[1];
  const chosenBusy =
    sameChoice &&
    (activePin?.purpose === 'collection_chosen' ||
      ['pending', 'sending'].includes(data?.selection?.sendState ?? ''));
  const blocked = pin.isPending || unpin.isPending || query.isFetching;
  return (
    <section className="review-panel" aria-label="DarveBot chat status">
      <h2>DarveBot chat</h2>
      {query.isError ? (
        <p role="alert">Chat status could not be verified. Refresh before another action.</p>
      ) : query.isPending ? (
        <p role="status">Reading chat status…</p>
      ) : (
        <p role="status">{text}</p>
      )}
      {item && (
        <Button
          tone="secondary"
          busy={pin.isPending}
          disabled={
            blocked ||
            query.isError ||
            Boolean(data?.availability?.postingReason) ||
            Boolean(chosenBusy)
          }
          onClick={() => pin.mutate()}
        >
          {data?.availability?.pinReason ? 'Announce in chat' : 'Pin in chat'}
        </Button>
      )}
      {activePin && (
        <Button
          tone="secondary"
          busy={unpin.isPending}
          disabled={blocked}
          onClick={() => unpin.mutate(activePin.id)}
        >
          Remove from chat
        </Button>
      )}
      <Button tone="quiet" disabled={pin.isPending || unpin.isPending} onClick={changed}>
        Refresh chat status
      </Button>
      {(pin.error || unpin.error) && (
        <p role="alert">
          {reviewMessage(pin.error ?? unpin.error)} Check current chat status before retrying the
          same action.
        </p>
      )}
    </section>
  );
}
