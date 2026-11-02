import { useState, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionProvider } from '@/motion/provider';
import { createQueryClient } from '@/services/server-state/index';
import { environment } from '@/services/config/index';

export function AppProviders({ children }: PropsWithChildren) {
  const [publicQueries] = useState(createQueryClient);
  return (
    <MotionProvider>
      <div data-environment={environment.appEnv}>
        <QueryClientProvider client={publicQueries}>{children}</QueryClientProvider>
      </div>
    </MotionProvider>
  );
}
