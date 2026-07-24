// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/**
 * TABAK++ Firebase Configuration
 * Client config is public (VITE_FIREBASE_*). App Check (reCAPTCHA v3) is
 * strongly recommended on Spark to protect Auth/Firestore quotas:
 * set VITE_FIREBASE_APPCHECK_SITE_KEY from Firebase Console → App Check.
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
 * Auth/Firestore still work without it until you enforce App Check in Console.
 */
export const appCheckReady = (async () => {
  if (!app) return null;
  const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) {
    if (import.meta.env.PROD) {
      console.warn(
        '[firebase] App Check site key missing in production. ' +
        'Set VITE_FIREBASE_APPCHECK_SITE_KEY and enforce App Check in Firebase Console ' +
        'to protect Auth/Firestore quotas.'
      );
    }
    return null;
  }
  if (import.meta.env.DEV) {
    // Register debug tokens in Firebase Console → App Check → Manage debug tokens
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN || true;
  }
  const { initializeAppCheck, ReCaptchaV3Provider } = await import("firebase/app-check");
  return initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true
  });
})();

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
