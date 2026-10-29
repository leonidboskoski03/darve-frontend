import { createBrowserRouter } from 'react-router-dom';
import { RouteError } from './route-error';
import { RootLayout } from './root-layout';

export const createAppRouter = () =>
  createBrowserRouter([
    {
      element: <RootLayout />,
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
        { path: '*', lazy: () => import('./not-found') },
      ],
    },
  ]);
