import { useEffect, useState } from 'react';
import { reportTime } from '@/services/reporting/index';

export function FundingCloseTime({
  deadline,
  serverTime,
  open,
}: {
  deadline: string;
  serverTime: string;
  open: boolean;
}) {
  return (
    <>
      <time dateTime={deadline}>{reportTime(deadline)}</time>
      {open && (
        <ServerCountdown key={deadline + serverTime} deadline={deadline} serverTime={serverTime} />
      )}
    </>
  );
}

function ServerCountdown({ deadline, serverTime }: { deadline: string; serverTime: string }) {
  const remaining = Date.parse(deadline) - Date.parse(serverTime);
  const [sample] = useState(() => performance.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - sample;
      setElapsed(elapsed);
      if (elapsed >= remaining) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining, sample]);
  const minutes = Math.ceil((remaining - elapsed) / 60_000);
  return minutes > 0 ? <span> · Closes in {minutes} min</span> : null;
}
