// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/**
 * TABAK++ Firebase Configuration
 * Client config is public (VITE_FIREBASE_*).
 *
 * App Check is OPTIONAL here and is NOT part of the security boundary: this
 * project runs on Spark with Firestore Security Rules as the authorization and
 * validation boundary, and App Check enforcement is deliberately OFF on both
 * clients (see README → Security and SECURITY.md). A missing
 * VITE_FIREBASE_APPCHECK_SITE_KEY is therefore a normal, supported
 * configuration — never report it as an error or imply the deploy is broken.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

/** True when Vite baked empty/missing VITE_FIREBASE_* (common cause of blank prod screens). */
export const firebaseConfigError = missingKeys.length
  ? `Missing Firebase config (${missingKeys.join(', ')}). Copy webApp/.env.example to .env.local and rebuild.`
  : null;

if (firebaseConfigError) {
  console.error('[firebase]', firebaseConfigError);
}

const app = firebaseConfigError ? null : initializeApp(firebaseConfig);

/**
 * Resolves when App Check is ready (or immediately if no site key).
 *
 * App Check is an OPTIONAL, advisory integration in this project: enforcement
 * is off, so an absent site key is a supported configuration (the whole app
 * works, unenforced, on Firestore Security Rules alone). Initialization is
 * therefore silent when the key is missing — reporting it as a production error
 * made a deliberately App-Check-free deploy look misconfigured.
 */
export const appCheckReady = (async () => {
  if (!app) return null;
  const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) return null;
  if (import.meta.env.DEV) {
    // Register debug tokens in Firebase Console → App Check → Manage debug tokens
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || true;
  }
  const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("firebase/app-check");
  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true
  });
})();

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
