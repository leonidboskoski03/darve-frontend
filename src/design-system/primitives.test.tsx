import { render, screen } from '@testing-library/react';
import type { FormEvent } from 'react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { ActionLink } from './action-link';
import { TextField } from './text-field';

describe('command semantics', () => {
  it('does not accidentally submit a surrounding form and prevents pending duplicate actions', async () => {
    const submit = vi.fn((event: FormEvent) => event.preventDefault());
    const activate = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <form onSubmit={submit}>
        <Button onClick={activate}>Continue</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(activate).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    rerender(
      <Button busy onClick={activate}>
        Continue
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(activate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps a navigation action a link', () => {
    render(<ActionLink href="/">Return home</ActionLink>);
    expect(screen.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('field accessibility', () => {
  it('associates labels and combines caller, help and error descriptions without colliding IDs', () => {
    const { rerender } = render(
      <>
        <p id="context">External context</p>
        <TextField
          label="Title"
          hint="Use plain text"
          error="Required by the example"
          aria-describedby="context"
        />
        <TextField label="Other title" />
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'Title' });
    expect(field).toHaveAccessibleDescription(
      'External context Use plain text Required by the example',
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.id).not.toBe(screen.getByRole('textbox', { name: 'Other title' }).id);
    rerender(<TextField id="explicit" label="Title" />);
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveAttribute('aria-describedby');
  });
});
