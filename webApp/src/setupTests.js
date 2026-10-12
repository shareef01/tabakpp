import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Firebase
vi.mock('./firebase', () => ({
  auth: {
    currentUser: null,
    onAuthStateChanged: vi.fn(),
  },
  db: {
    collection: vi.fn(),
    doc: vi.fn(),
  },
}));

// Mock ResizeObserver for Recharts
class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver;

// jsdom lacks matchMedia (used by responsive components rendered in
// HistoryScreen tests). Return a conservative no-match default.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}
