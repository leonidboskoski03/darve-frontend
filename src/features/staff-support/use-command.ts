import { useEffect, useRef, useState } from 'react';
import {
  StaffSupportError,
  staffSupportUncertain,
  type StaffAttempt,
  type StaffSupportClient,
} from '@/services/staff-support/index';
export function useStaffCommand(
  client: StaffSupportClient,
  onConfirmed: (id: string | null) => void,
  onConflict: () => void,
) {
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [held, setHeld] = useState<StaffAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(''),
    [cooling, setCooling] = useState(false);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setCooling(false), client.retryDelay());
    return () => clearTimeout(timer);
  }, [client, error]);
  const execute = async (attempt: StaffAttempt) => {
    if (busy || cooling || (held && held !== attempt)) return;
    setHeld(attempt);
    setBusy(true);
    setError(null);
    setNotice('');
    try {
      const id = await client.execute(attempt);
      if (!alive.current || client.scope.signal.aborted) return;
      setHeld(null);
      setNotice('The server recorded this request. Current information is being refreshed.');
      onConfirmed(id);
    } catch (problem) {
      if (!alive.current || client.scope.signal.aborted) return;
      setError(problem);
      setCooling(client.retryDelay() > 0);
      if (!staffSupportUncertain(problem)) {
        setHeld(null);
        if (
          problem instanceof StaffSupportError &&
          [403, 404, 409].includes(problem.problem.status ?? 0)
        )
          onConflict();
      }
    } finally {
      if (alive.current && !client.scope.signal.aborted) setBusy(false);
    }
  };
  return {
    busy,
    blocked: busy || held !== null || cooling,
    error,
    notice,
    held,
    cooling,
    run: (prepare: () => StaffAttempt) => {
      if (busy || held || cooling) return;
      try {
        void execute(prepare());
      } catch (problem) {
        setError(problem);
      }
    },
    retry: () => {
      if (held) void execute(held);
    },
  };
}
