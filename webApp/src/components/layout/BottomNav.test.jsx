import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomNav } from './BottomNav';

describe('BottomNav', () => {
  it('renders with accessible landmarks and visible navigation labels', () => {
    render(<BottomNav activeTab="track" onTabChange={vi.fn()} />);
    
    const nav = screen.getByRole('navigation', { name: /main navigation/i });
    expect(nav).toBeInTheDocument();

    expect(screen.getByText('Track')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('marks active tab with aria-current="page" and leaves inactive tabs unmarked', () => {
    const { rerender } = render(<BottomNav activeTab="track" onTabChange={vi.fn()} />);

    const trackBtn = screen.getByRole('button', { name: 'Track' });
    const historyBtn = screen.getByRole('button', { name: 'History' });
    const settingsBtn = screen.getByRole('button', { name: 'Settings' });

    expect(trackBtn).toHaveAttribute('aria-current', 'page');
    expect(historyBtn).not.toHaveAttribute('aria-current');
    expect(settingsBtn).not.toHaveAttribute('aria-current');

    rerender(<BottomNav activeTab="history" onTabChange={vi.fn()} />);
    expect(trackBtn).not.toHaveAttribute('aria-current');
    expect(historyBtn).toHaveAttribute('aria-current', 'page');
    expect(settingsBtn).not.toHaveAttribute('aria-current');

    rerender(<BottomNav activeTab="settings" onTabChange={vi.fn()} />);
    expect(trackBtn).not.toHaveAttribute('aria-current');
    expect(historyBtn).not.toHaveAttribute('aria-current');
    expect(settingsBtn).toHaveAttribute('aria-current', 'page');
  });

  it('triggers onTabChange callback on click and keyboard interaction', async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(<BottomNav activeTab="track" onTabChange={onTabChange} />);

    const historyBtn = screen.getByRole('button', { name: 'History' });
    await user.click(historyBtn);
    expect(onTabChange).toHaveBeenCalledWith('history');

    const settingsBtn = screen.getByRole('button', { name: 'Settings' });
    await user.click(settingsBtn);
    expect(onTabChange).toHaveBeenCalledWith('settings');
  });

  it('supports keyboard navigation via tab and activation via Enter/Space', async () => {
    const onTabChange = vi.fn();
    const user = userEvent.setup();
    render(<BottomNav activeTab="track" onTabChange={onTabChange} />);

    const trackBtn = screen.getByRole('button', { name: 'Track' });
    const historyBtn = screen.getByRole('button', { name: 'History' });

    trackBtn.focus();
    expect(trackBtn).toHaveFocus();

    await user.tab();
    expect(historyBtn).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onTabChange).toHaveBeenCalledWith('history');
  });
});
