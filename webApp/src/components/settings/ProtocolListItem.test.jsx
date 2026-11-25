import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../firebase', () => ({ auth: null, db: null }));

import { ProtocolListItem } from './SettingsScreen';

const config = { id: 'ryo', name: 'Roll-ups', type: 'RYO_ROLL', limit: 8, order: 1 };

const renderItem = (over = {}) => render(
  <ProtocolListItem config={config} idx={1} total={2} onReo={vi.fn()} onEdit={vi.fn()} onDel={vi.fn()} {...over} />
);

describe('Settings tracker row', () => {
  it('gives the tracker name its own line, with the type badge below it', () => {
    renderItem();
    const name = screen.getByTitle('Roll-ups');
    const badge = screen.getByText('RYO');
    const column = name.parentElement;
    // A badge beside the name squeezed it to "R" on a 375px phone: the name is
    // now alone on the first line, and the badge sits on the second.
    expect(column.className).toContain('flex-col');
    expect(column.firstElementChild).toBe(name);
    expect(name.contains(badge)).toBe(false);
    expect(column.contains(badge)).toBe(true);
    expect(badge.className).toContain('min-w-0');
    expect(badge.className).not.toContain('shrink-0');
  });

  it('shows the daily limit once, under the name, not in its own column', () => {
    const { container } = renderItem();
    const perDay = screen.getByText('/ day');
    expect(perDay.parentElement.textContent).toBe('8/ day');
    expect(screen.getByTitle('Roll-ups').parentElement.contains(perDay)).toBe(true);
    expect(screen.queryByText(/Daily limit/i)).toBeNull();
    expect(container.textContent.match(/8/g)).toHaveLength(1);
  });

  it('names the tracker in every row action, so screen readers can tell rows apart', () => {
    renderItem();
    expect(screen.getByRole('button', { name: 'Move Roll-ups up' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move Roll-ups down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit Roll-ups' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete Roll-ups' })).toBeTruthy();
  });
});
