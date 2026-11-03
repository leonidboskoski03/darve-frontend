import { useEffect, useRef, useState } from 'react';
import {
  SupportError,
  uncertainSupport,
  type SupportAttempt,
  type SupportClient,
} from '@/services/support/index';
export function useSupportCommand(
  client: SupportClient,
  onConfirmed: (id: string, kind: SupportAttempt['kind']) => void,
  onConflict: () => void,
  onDenied?: () => void,
) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<SupportAttempt | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const [cooling, setCooling] = useState(false);
  useEffect(() => {
    if (!error) return;
    const delay = client.retryDelay();
    const timer = setTimeout(() => setCooling(false), delay);
    return () => clearTimeout(timer);
  }, [client, error]);
  const send = async (attempt: SupportAttempt) => {
    if (busy || cooling || (held && held !== attempt)) return;
    setBusy(true);
    setHeld(attempt);
    setError(null);
    setNotice('');
    try {
      const result = await client.execute(attempt);
      if (client.scope.signal.aborted || !mounted.current) return;
      setHeld(null);
      setNotice(
        {
          create: 'Ticket created.',
          reply: 'Reply recorded.',
          read: 'Read position recorded.',
          context: 'Context change recorded.',
        }[attempt.kind],
      );
      onConfirmed(result.ticketId, attempt.kind);
    } catch (problem) {
      if (client.scope.signal.aborted || !mounted.current) return;
      setError(problem);
      setCooling(client.retryDelay() > 0);
      if (!uncertainSupport(problem)) {
        setHeld(null);
        if (problem instanceof SupportError && problem.problem.status === 409) onConflict();
        if (problem instanceof SupportError && [403, 404].includes(problem.problem.status ?? 0))
          onDenied?.();
      }
    } finally {
      if (!client.scope.signal.aborted && mounted.current) setBusy(false);
    }
  };
  const run = (prepare: () => SupportAttempt) => {
    if (busy || held || cooling) return;
    try {
      void send(prepare());
    } catch (problem) {
      setError(problem);
      setCooling(client.retryDelay() > 0);
    }
  };
  return {
    run,
    blocked: busy || held !== null || cooling,
    busy,
    held,
    error,
    notice,
    cooling,
    retry: () => {
      if (held) void send(held);
    },
  };
}
