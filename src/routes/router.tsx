import { createBrowserRouter } from 'react-router-dom';
import { RouteError } from './route-error';
import { environment } from '@/services/config/index';
import { CreatorRuntime } from './creator-runtime';

export const createAppRouter = ({
  apiOrigin = environment.apiOrigin,
}: { apiOrigin?: string } = {}) =>
  createBrowserRouter([
    ...['/contribute/:publicId', '/receipts', '/receipts/:checkoutId', '/payments/return'].map(
      (path) => ({
        path,
        hydrateFallbackElement: (
          <p role="status" className="message-page">
            Opening contribution page…
          </p>
        ),
        lazy: () => import('./contribution'),
        errorElement: <RouteError />,
        handle: { apiOrigin },
      }),
    ),
    {
      element: <CreatorRuntime origin={apiOrigin} />,
      hydrateFallbackElement: (
        <p role="status" className="message-page">
          Opening Darve…
        </p>
      ),
      errorElement: <RouteError />,
      children: [
        { path: '/', lazy: () => import('./home') },
        { path: '/authorize', lazy: () => import('./creator-connection') },
        { path: '/integrations', lazy: () => import('./creator-connection') },
        { path: '/terms', lazy: () => import('./creator-connection') },
        { path: '/collection', lazy: () => import('./collection') },
        { path: '/collection/:roundId', lazy: () => import('./collection') },
        { path: '/collection/:roundId/suggestions', lazy: () => import('./suggestions') },
        { path: '/dashboard', lazy: () => import('./reporting') },
        { path: '/challenges', lazy: () => import('./reporting') },
        { path: '/challenges/:challengeId', lazy: () => import('./reporting') },
        { path: '/collection/:roundId/analytics', lazy: () => import('./reporting') },
        { path: '*', lazy: () => import('./not-found') },
      ],
    },
  ]);
