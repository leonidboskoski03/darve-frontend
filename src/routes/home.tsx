import { useEffect } from 'react';
import { LandingFoundation } from '@/features/landing/index';

export function Component() {
  useEffect(() => {
    document.title = 'Darve — frontend foundation';
  }, []);
  return <LandingFoundation />;
}
