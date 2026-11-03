import { useMemo } from 'react';
import { createSupportClient, type SupportContext } from '@/services/support/index';
import type { CreatorSession } from '@/services/creator-session/index';
import { TicketList } from './list';
import { TicketThread } from './thread';
import './support.css';

export function Support({
  session,
  id,
  onOpen,
  onList,
  onContext,
}: {
  session: CreatorSession;
  id?: string | undefined;
  onOpen: (id: string) => void;
  onList: () => void;
  onContext: (context: SupportContext) => void;
}) {
  const client = useMemo(() => createSupportClient(session), [session]);
  return id ? (
    <TicketThread key={id} client={client} id={id} onList={onList} onContext={onContext} />
  ) : (
    <TicketList client={client} onOpen={onOpen} />
  );
}
