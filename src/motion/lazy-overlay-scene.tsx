import { lazy, Suspense, type ComponentProps } from 'react';

// three.js downloads only when an immersive template is shown; standalone and
// compact OBS sources keep their small bundle. The CSS backdrop covers loading.
const Scene = lazy(() =>
  import('./overlay-scene').then(({ OverlayScene }) => ({ default: OverlayScene })),
);
export function LazyOverlayScene(props: ComponentProps<typeof Scene>) {
  return (
    <Suspense fallback={null}>
      <Scene {...props} />
    </Suspense>
  );
}
