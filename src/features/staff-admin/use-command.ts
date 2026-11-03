import { useEffect, useRef, useState } from 'react';
import {
  StaffAdminError,
  adminUncertain,
  type AdminAttempt,
  type StaffAdminClient,
  type StaffInvitation,
} from '@/services/staff-admin/index';
export function useAdminCommand(client: StaffAdminClient, refresh: () => void) {
  const alive = useRef(false),
    lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [held, setHeld] = useState<AdminAttempt | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(''),
    [invitation, setInvitation] = useState<StaffInvitation | null>(null),
    [cooling, setCooling] = useState(false);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setCooling(false), client.retryDelay());
    return () => clearTimeout(timer);
  }, [error, client]);
  const execute = async (attempt: AdminAttempt) => {
    if (lock.current || cooling || (held && held !== attempt)) return;
    lock.current = true;
    setBusy(true);
    setHeld(attempt);
    setError(null);
    setNotice('');
    setInvitation(null);
    try {
      const result = await client.execute(attempt);
      if (!alive.current || client.scope.signal.aborted) return;
      setHeld(null);
      setInvitation(result);
      setNotice('The server recorded this exact request. Current information is being refreshed.');
      refresh();
    } catch (problem) {
      if (!alive.current || client.scope.signal.aborted) return;
      setError(problem);
      setCooling(client.retryDelay() > 0);
      if (!adminUncertain(problem)) {
        setHeld(null);
        if (
          problem instanceof StaffAdminError &&
          [403, 404, 409].includes(problem.problem.status ?? 0)
        )
          refresh();
      }
    } finally {
      lock.current = false;
      if (alive.current && !client.scope.signal.aborted) setBusy(false);
    }
  };
  return {
    busy,
    held,
    error,
    notice,
    invitation,
    cooling,
    blocked: busy || held !== null || cooling,
    clearResult: () => {
      setInvitation(null);
      setNotice('');
      if (!held && !busy && !cooling) setError(null);
    },
    run: (prepare: () => AdminAttempt) => {
      if (lock.current || held || cooling) return;
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
export type AdminCommand = ReturnType<typeof useAdminCommand>;
