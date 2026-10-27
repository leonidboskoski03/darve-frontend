import { useState } from 'react';
import { SessionStatus, useCreatorSession } from '@/features/session-status/index';
import { ProfileResponseSchema } from '@/services/contracts/index';
import { Button } from '@/design-system/button';
import { TextField } from '@/design-system/text-field';
import '@/design-system/styles.css';

export function SessionProbe() {
  const { controller, snapshot } = useCreatorSession();
  const [profile, setProfile] = useState('');
  const [error, setError] = useState('');
  return (
    <main className="message-page">
      <h1>Local API connection</h1>
      <p>
        Isolated session/transport acceptance. No sign-in simulator or provider action is available.
      </p>
      <SessionStatus />
      {snapshot.phase === 'authenticated' ? (
        <div className="ds-field">
          <TextField label="Temporary private draft" />
          <Button
            tone="secondary"
            onClick={() => {
              void snapshot.scope
                .query(['profile'], async (signal) => {
                  const result = await controller.request({
                    path: '/api/profile',
                    schema: ProfileResponseSchema,
                    success: [200],
                    signal,
                  });
                  if (result.kind !== 'data') throw new Error('Profile unavailable.');
                  return result.data;
                })
                .then((result) => {
                  if (!snapshot.scope.signal.aborted)
                    setProfile(result.data.displayName ?? 'Creator profile');
                })
                .catch(() => {
                  if (!snapshot.scope.signal.aborted) setError('Profile unavailable.');
                });
            }}
          >
            Read private profile
          </Button>
          <p>{profile}</p>
          <p role="status">{error}</p>
        </div>
      ) : null}
      <Button
        tone="quiet"
        onClick={() => {
          void controller.inspect();
        }}
      >
        Refresh session
      </Button>
    </main>
  );
}
