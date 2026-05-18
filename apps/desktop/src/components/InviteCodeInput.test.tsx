import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InviteCodeInput } from './InviteCodeInput.js';

function ControlledInviteCodeInput({
  onSubmit
}: {
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState('');

  return <InviteCodeInput value={value} onChange={setValue} onSubmit={onSubmit} id="invite-code-test" />;
}

describe('InviteCodeInput', () => {
  it('sanitizes typed values and submits on Enter when complete', () => {
    const onSubmit = vi.fn();

    render(<ControlledInviteCodeInput onSubmit={onSubmit} />);

    const input = screen.getByLabelText('Invite code');
    fireEvent.change(input, { target: { value: 'abc-234' } });
    expect(input).toHaveValue('ABC234');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('sanitizes pasted codes', () => {
    render(<ControlledInviteCodeInput />);

    const input = screen.getByLabelText('Invite code');
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => '  ABC234  '
      }
    });

    expect(input).toHaveValue('ABC234');
  });

  it('supports disabled state', () => {
    render(<InviteCodeInput value="AB" onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText('Invite code')).toBeDisabled();
  });
});
