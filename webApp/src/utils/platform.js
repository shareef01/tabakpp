/**
 * iOS / PWA platform helpers for auth and layout branching.
 */
export const isIosLike = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as MacIntel with touch
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
};

export const isStandalonePwa = () => {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia?.('(display-mode: standalone)')?.matches;
  return !!(mq || window.navigator.standalone === true);
};

/** Prefer redirect OAuth on iOS Safari and installed PWAs (popups are unreliable). */
export const prefersAuthRedirect = () => isIosLike() || isStandalonePwa();

export const AUTH_INTENT_KEY = 'tabakpp.authIntent';
export const PENDING_DELETE_KEY = 'tabakpp.pendingDelete';
