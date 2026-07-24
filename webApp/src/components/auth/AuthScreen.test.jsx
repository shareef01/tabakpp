import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthScreen } from './AuthScreen';

vi.mock('../../firebase', () => ({ auth: {} }));
vi.mock('../../services/registryService', () => ({
  RegistryService: { ensureUserDocument: vi.fn() },
}));
vi.mock('../../hooks/useKeyboardInset', () => ({
  useKeyboardInset: () => 0,
}));
vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateProfile: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
}));

describe('AuthScreen', () => {
  beforeEach(() => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('uses Sign in / Create account tabs and password guidance', () => {
    render(<AuthScreen accent="#10B981" />);
    expect(screen.getByRole('tab', { name: /sign in/i })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /create account/i }));
    expect(screen.getByRole('tab', { name: /create account/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/use at least 12 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument();
  });

  it('keeps tablist out of reset mode', () => {
    render(<AuthScreen accent="#10B981" />);
    fireEvent.click(screen.getByRole('button', { name: /forgot password/i }));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /reset password/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });
});
