// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/**
 * TABAK++ Firebase Configuration
 * Client config is public (VITE_FIREBASE_*).
 *
 * Spark-only by design: Firebase Authentication + Cloud Firestore + Hosting,
 * with Firestore Security Rules as the single authorization/validation
 * boundary. App Check is deliberately NOT used (no provider, no token, no
 * enforcement) — see README → Security and SECURITY.md. The only required
 * environment variables are the VITE_FIREBASE_* client identifiers below.
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

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
