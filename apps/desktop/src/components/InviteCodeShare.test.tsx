import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InviteCodeShare } from './InviteCodeShare.js';

vi.mock('../lib/clipboard.js', () => ({
  copyText: vi.fn().mockResolvedValue(true)
}));

describe('InviteCodeShare', () => {
  it('copies the invite code and shows confirmation', async () => {
    const { copyText } = await import('../lib/clipboard.js');

    render(<InviteCodeShare code="ABC234" />);

    fireEvent.click(screen.getByRole('button', { name: /copy invite code/i }));

    await waitFor(() => {
      expect(copyText).toHaveBeenCalledWith('ABC234');
      expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
    });
  });

  it('renders a compact copy control', () => {
    render(<InviteCodeShare code="XYZ789" compact />);
    expect(screen.getByText('XYZ789')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument();
  });

  it('shows a compact copy failure hint', async () => {
    const { copyText } = await import('../lib/clipboard.js');
    vi.mocked(copyText).mockResolvedValueOnce(false);

    render(<InviteCodeShare code="ABC234" compact />);
    fireEvent.click(screen.getByRole('button', { name: /copy code/i }));

    await waitFor(() => {
      expect(screen.getByText(/copy failed/i)).toBeInTheDocument();
    });
  });

  it('shows a manual copy hint when clipboard access fails', async () => {
    const { copyText } = await import('../lib/clipboard.js');
    vi.mocked(copyText).mockResolvedValueOnce(false);

    render(<InviteCodeShare code="ABC234" />);
    fireEvent.click(screen.getByRole('button', { name: /copy invite code/i }));

    await waitFor(() => {
      expect(screen.getByText(/copy it manually/i)).toBeInTheDocument();
    });
  });
});
