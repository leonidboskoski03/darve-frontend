import { useEffect, useRef, useState } from 'react';
import { createOverlaySubscription, type OverlayStreamSnapshot } from '@/services/realtime/index';
import { createAuthorityScope } from '@/services/server-state/index';
import { OverlayParamsSchema, OverlayReaderQuerySchema } from '@/services/contracts/index';
import { Button } from '@/design-system/button';

export function RealtimeProbe({
  displayId,
  grantId,
  protocol,
}: {
  displayId: string;
  grantId: string;
  protocol: 1 | 2;
}) {
  const [value, setValue] = useState<OverlayStreamSnapshot>({
    phase: 'idle',
    error: null,
    snapshot: null,
    presentation: null,
  });
  const stop = useRef(() => {});
  const valid =
    OverlayParamsSchema.safeParse({ id: displayId }).success &&
    OverlayReaderQuerySchema.safeParse({ grantId }).success;
  useEffect(() => {
    if (!valid) return;
    const scope = createAuthorityScope('overlay');
    const stream = createOverlaySubscription({
      origin: 'http://127.0.0.1:3310',
      displayId,
      grantId,
      protocol,
      scope,
    });
    const unsubscribe = stream.subscribe(() => setValue(stream.getSnapshot()));
    stop.current = () => stream.stop();
    stream.start();
    return () => {
      unsubscribe();
      scope.dispose();
    };
  }, [displayId, grantId, protocol, valid]);
  const template =
    value.snapshot && 'template' in value.snapshot.preferences
      ? value.snapshot.preferences.template.templateId
      : 'standalone';
  return (
    <main className="message-page">
      <h1>Realtime transport acceptance</h1>
      <p>
        Read-only local stream probe. This is not the OBS screen; no grant is issued or bootstrapped
        here.
      </p>
      {!valid ? (
        <p role="status">A valid local display and reader grant are required.</p>
      ) : (
        <>
          <p role="status" data-testid="connection-phase">
            {value.phase}
          </p>
          <dl>
            <dt>Projection version</dt>
            <dd data-testid="projection-version">{value.snapshot?.version ?? 'hidden'}</dd>
            <dt>Presentation state</dt>
            <dd data-testid="presentation-state">
              {value.snapshot?.presentationState ?? 'hidden'}
            </dd>
            <dt>Template</dt>
            <dd data-testid="template-id">{value.snapshot ? template : 'hidden'}</dd>
          </dl>
          <Button tone="secondary" onClick={() => stop.current()}>
            Stop subscription
          </Button>
        </>
      )}
    </main>
  );
}
