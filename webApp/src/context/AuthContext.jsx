import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { auth, appCheckReady } from '../firebase';
import { onAuthStateChanged, setPersistence, browserLocalPersistence, getRedirectResult } from 'firebase/auth';
import { RegistryService } from '../services/registryService';
import { AUTH_INTENT_KEY, PENDING_DELETE_KEY } from '../utils/platform';
import { mapAuthError } from '../utils/errorHandlers';
import { deleteAuthUserAfterWipe, DELETE_INCOMPLETE_MESSAGE } from '../utils/deleteAuthUserAfterWipe';

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
        try {
          await deleteAuthUserAfterWipe(auth, auth.currentUser);
        } catch (authErr) {
          if (!cancelled) {
            console.error(authErr);
            setDeleteError({
              title: 'Delete incomplete',
              message: DELETE_INCOMPLETE_MESSAGE,
            });
          }
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
