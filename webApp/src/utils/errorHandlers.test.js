import { describe, it, expect } from 'vitest';
import { mapAuthError, mapFirestoreError } from './errorHandlers';

describe('mapAuthError', () => {
  it('hides credential enumeration on login', () => {
    expect(mapAuthError({ code: 'auth/user-not-found' }, 'login')).toBe('Invalid email or password.');
    expect(mapAuthError({ code: 'auth/wrong-password' }, 'login')).toBe('Invalid email or password.');
  });

  it('always returns the same reset acknowledgment', () => {
    expect(mapAuthError({ code: 'auth/user-not-found' }, 'reset')).toMatch(/reset link was sent/);
    expect(mapAuthError(null, 'reset')).toMatch(/reset link was sent/);
  });

  it('does not reveal existing accounts during registration', () => {
    expect(mapAuthError({ code: 'auth/email-already-in-use' }, 'register'))
      .toBe(mapAuthError({ code: 'auth/internal-error' }, 'register'));
  });

  it('describes the client password minimum', () => {
    expect(mapAuthError({ code: 'auth/weak-password' }, 'register'))
      .toMatch(/12 characters/);
  });
});

describe('mapFirestoreError', () => {
  it('maps permission-denied clearly', () => {
    expect(mapFirestoreError({ code: 'permission-denied' })).toMatch(/security rules/);
  });

  it('maps missing profile', () => {
    expect(mapFirestoreError({ message: 'USER_NOT_FOUND' })).toMatch(/Profile not ready/);
  });
});
