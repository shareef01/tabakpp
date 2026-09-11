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
    // A genuine tap emits pointerdown and then a trailing click. Since
    // increment/decrement bind only onClick (item 9), the leading
    // pointerdown does nothing and the tap counts exactly once.
    fireEvent.pointerDown(btn, { pointerType: 'touch' });
    fireEvent.click(btn);
    expect(onInc).toHaveBeenCalledTimes(1);
  });
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

  it('reports the overage once past the limit, as "N above target"', () => {
    setup({ count: 13 });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live.textContent).toContain('3 above target');
  });

  it('reports "Limit reached" exactly at the limit — distinct from over', () => {
    setup({ count: 10 });
    const live = document.querySelector('[aria-live="polite"]');
    expect(live.textContent).toContain('Limit reached');
    // "at" gets the amber warning tone, never the same red as "over" (item 5).
    expect(screen.getByRole('button', { name: /increase cigarettes/i }).className).toMatch(/bg-amber-500\b/);
  });

  describe('zero-target semantics (item 4)', () => {
    it('target=0, actual=0 -> reports "Limit reached", not a meaningless 0%', () => {
      setup({ config: { ...config, limit: 0 }, count: 0 });
      const live = document.querySelector('[aria-live="polite"]');
      expect(live.textContent).toContain('0 of 0');
      expect(live.textContent).toContain('Limit reached');
    });

    it('target=0, actual=1 -> "1 above target"', () => {
      setup({ config: { ...config, limit: 0 }, count: 1 });
      const live = document.querySelector('[aria-live="polite"]');
      expect(live.textContent).toContain('1 above target');
    });

    it('target=0, actual=5 -> "5 above target"', () => {
      setup({ config: { ...config, limit: 0 }, count: 5 });
      const live = document.querySelector('[aria-live="polite"]');
      expect(live.textContent).toContain('5 above target');
    });
  });

  it('hides the decorative gauge from assistive tech', () => {
    setup();
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('scales the gauge down in compact density', () => {
    setup({ globalSize: 'SMALL' });
    const gauge = document.querySelector('[aria-hidden="true"]');
    expect(gauge.className).toMatch(/h-8/);
  });

  it('uses a taller gauge in spacious density', () => {
    setup({ globalSize: 'LARGE' });
    const gauge = document.querySelector('[aria-hidden="true"]');
    expect(gauge.className).toMatch(/h-11/);
  });
});
