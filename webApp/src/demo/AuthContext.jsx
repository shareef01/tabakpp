import { createContext, useContext } from 'react';

// Demo auth for the screenshot build. A fake signed-in user by default; loading
// `#auth` in the URL renders the logged-out sign-in screen instead.
const DEMO_USER = { uid: 'demo', displayName: 'Alex Rendine', email: 'alex@tabak.pp', photoURL: null };

const AuthContext = createContext({ user: null, loading: true });
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const loggedOut = typeof location !== 'undefined' && location.hash.includes('auth');
  const value = { user: loggedOut ? null : DEMO_USER, loading: false, isAuthenticated: !loggedOut };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
