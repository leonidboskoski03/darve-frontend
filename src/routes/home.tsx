import { useEffect } from 'react';
import { Landing } from '@/features/landing/index';

export function Component() {
  useEffect(() => {
    document.title = 'Darve — The Engagement Engine for Your Viewers';
  }, []);
  return <Landing connectHref="/authorize" />;
}
