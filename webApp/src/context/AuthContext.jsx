import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { auth, appCheckReady } from '../firebase';
import { onAuthStateChanged, setPersistence, browserLocalPersistence, getRedirectResult } from 'firebase/auth';
import { RegistryService } from '../services/registryService';
import { AUTH_INTENT_KEY, PENDING_DELETE_KEY } from '../utils/platform';
import { mapAuthError } from '../utils/errorHandlers';

const AuthContext = createContext({
  user: null,
  loading: true,
  deleteError: null,
  clearDeleteError: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteError, setDeleteError] = useState(null);

  const unsubRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      try {
        await appCheckReady;
        if (cancelled) return;
        await setPersistence(auth, browserLocalPersistence);
        if (cancelled) return;

        // Complete Google redirect flows (iOS Safari / standalone PWA).
        try {
          const result = await getRedirectResult(auth);
          const intent = sessionStorage.getItem(AUTH_INTENT_KEY);
          sessionStorage.removeItem(AUTH_INTENT_KEY);
          if (result?.user) {
            if (intent === 'google-delete') {
              sessionStorage.setItem(PENDING_DELETE_KEY, '1');
            } else {
              await RegistryService.ensureUserDocument(result.user.uid, {
                name: result.user.displayName || '',
              });
            }
          }
        } catch (redirectErr) {
          console.error('Auth redirect result failed:', redirectErr);
          sessionStorage.removeItem(AUTH_INTENT_KEY);
        }
      } catch (error) {
        console.error("Auth persistence failure:", error);
      }

      if (cancelled) return;

      unsubRef.current = onAuthStateChanged(auth, (currentUser) => {
        if (cancelled) return;
        setUser(currentUser);
        setLoading(false);
      }, (error) => {
        console.error("Auth error:", error);
        if (!cancelled) setLoading(false);
      });
    };

    initAuth();

    return () => {
      cancelled = true;
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  // Complete Google reauth → delete after redirect. Lives here (not in
  // SettingsScreen) so it runs regardless of which tab is active on landing.
  useEffect(() => {
    if (!user || sessionStorage.getItem(PENDING_DELETE_KEY) !== '1') return undefined;
    sessionStorage.removeItem(PENDING_DELETE_KEY);
    let cancelled = false;
    (async () => {
      try {
        await RegistryService.deleteAllUserData(user.uid);
        if (cancelled) return;
        // Retry the Auth user removal a few times — Firestore is already wiped,
        // so a transient failure shouldn't strand a half-deleted account.
        let lastErr = null;
        for (let attempt = 1; attempt <= 3 && !cancelled; attempt++) {
          try {
            await auth.currentUser.delete();
            lastErr = null;
            break;
          } catch (authErr) {
            lastErr = authErr;
            // auth/requires-recent-login is not retryable; bail immediately.
            if (authErr?.code === 'auth/requires-recent-login') break;
            if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
        if (!cancelled && lastErr) {
          console.error(lastErr);
          setDeleteError({
            title: 'Delete incomplete',
            message: 'Your data was erased but login removal failed. Sign in again and retry Delete Account.',
          });
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setDeleteError({
            title: 'Delete failed',
            message: mapAuthError(err, 'delete'),
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  const clearDeleteError = useCallback(() => setDeleteError(null), []);

  const value = {
    user,
    loading,
    isAuthenticated: !!user,
    deleteError,
    clearDeleteError,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
