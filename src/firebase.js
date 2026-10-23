// =========================================================
// Firebase setup (SDK 13.0.0 from the official CDN).
// Offline persistence keeps a local copy of the data, so the app
// works with weak internet and syncs later.
//
// Local testing: open the app on localhost with "?emulator" in the
// URL to use the Firebase emulators instead of the real database.
// =========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { firebaseConfig } from "../firebase-config.js";

const isLocalhost = ["localhost", "127.0.0.1"].includes(location.hostname);
const useEmulator = isLocalhost && new URLSearchParams(location.search).has("emulator");

// The emulators use a "demo-" project, so tests can never touch real data
const config = useEmulator ? { ...firebaseConfig, apiKey: "demo-key", projectId: "demo-farm-tracker" } : firebaseConfig;

const firebaseApp = initializeApp(config);

export const auth = getAuth(firebaseApp);
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

if (useEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
