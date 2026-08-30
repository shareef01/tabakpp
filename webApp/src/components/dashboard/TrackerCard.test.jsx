import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TrackerCard } from './TrackerCard';

const config = { id: 'cig', name: 'Cigarettes', limit: 10, type: 'CIGARETTE' };

const setup = (props = {}) => {
  const onInc = vi.fn();
  const onDec = vi.fn();
  render(<TrackerCard config={config} count={3} onInc={onInc} onDec={onDec} index={0} {...props} />);
  return { onInc, onDec };
};

describe('TrackerCard activation', () => {
  // Regression: the buttons were bound with onPointerDown only. Screen readers,
  // Switch Access and Voice Control activate a button by dispatching a plain
  // click and never emit pointer events, so the app's primary action did
  // nothing for those users while appearing perfectly labelled.
  it('increments on a bare click, as assistive tech dispatches it', () => {
    const { onInc } = setup();
    fireEvent.click(screen.getByRole('button', { name: /increase cigarettes/i }));
    expect(onInc).toHaveBeenCalledWith('cig');
  });

  it('decrements on a bare click', () => {
    const { onDec } = setup();
    fireEvent.click(screen.getByRole('button', { name: /decrease cigarettes/i }));
    expect(onDec).toHaveBeenCalledWith('cig');
  });

  it('counts a real tap once, not twice', () => {
    const { onInc } = setup();
    const btn = screen.getByRole('button', { name: /increase cigarettes/i });
    // A genuine tap emits pointerdown and then a trailing click; cancelling
    // pointerdown suppresses compatibility mouse events but not click.
    fireEvent.pointerDown(btn, { pointerType: 'touch' });
    fireEvent.click(btn);
    expect(onInc).toHaveBeenCalledTimes(1);
  });

  // Not covered: the right-click guard (`pointerType === 'mouse' && button !== 0`).
  // jsdom's fireEvent drops both properties — the handler observes `{}` — so a
  // test here would assert jsdom's PointerEvent fidelity, not our logic. Verify
  // that path in a real browser if it ever changes.
});

describe('TrackerCard screen-reader output', () => {
  it('announces count, limit and remaining in a live region', () => {
    setup({ count: 3 });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live.textContent).toContain('Cigarettes');
    expect(live.textContent).toContain('3 of 10');
    expect(live.textContent).toContain('7 left');
  });

  it('reports the overage once past the limit', () => {
    setup({ count: 13 });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live.textContent).toContain('3 over limit');
  });

  it('does not mark a zero daily quota as limit reached at count zero', () => {
    setup({ config: { ...config, limit: 0 }, count: 0 });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live.textContent).toContain('0 of 0');
    expect(screen.getByRole('button', { name: /increase cigarettes/i }).className).toMatch(/bg-accent/);
  });

  it('hides the decorative gauge from assistive tech', () => {
    setup();
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
