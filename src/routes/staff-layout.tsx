import { useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useRouteEntrance } from '@/motion/use-route-entrance';

export function StaffLayout() {
  const { pathname } = useLocation();
  const surface = useRef<HTMLDivElement>(null);
  useRouteEntrance(surface, pathname);

  return (
    <div ref={surface}>
      <Outlet />
    </div>
  );
}
