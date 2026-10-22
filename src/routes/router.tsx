import { createBrowserRouter } from 'react-router-dom';
import { RouteError } from './route-error';
import { RootLayout } from './root-layout';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', lazy: () => import('./home') },
      { path: '*', lazy: () => import('./not-found') },
    ],
  },
]);
