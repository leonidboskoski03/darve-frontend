import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, it } from 'vitest';
import { RouteError } from './route-error';

it('route failures expose a recovery link without leaking exception details', async () => {
  const router = createMemoryRouter([
    {
      path: '/',
      loader: () => {
        throw new Error('private-provider-response-marker');
      },
      element: <p>Success must not be displayed.</p>,
      errorElement: <RouteError />,
    },
  ]);
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole('heading', { name: 'We couldn’t open this page.' })).toBeVisible();
  expect(screen.queryByText(/private-provider-response-marker/)).not.toBeInTheDocument();
  expect(screen.queryByText('Success must not be displayed.')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Return to Darve' })).toHaveAttribute('href', '/');
  router.dispose();
});
