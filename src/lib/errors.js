// =========================================================
// Error handling: a clear message for the user, and a detailed
// console log (with context) for developers.
// =========================================================

/** Simple messages for Firebase error codes (Auth and Firestore). */
const MESSAGES = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/missing-password": "Please enter your password.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  "auth/network-request-failed": "No internet connection. Please check your connection.",
  "permission-denied": "You do not have permission for this action.",
  "unavailable": "The server cannot be reached. Please check your internet connection.",
  "deadline-exceeded": "The server took too long to answer. Please try again.",
  "resource-exhausted": "The daily free limit of the database has been reached. Please try again tomorrow.",
  "not-found": "This record no longer exists. It may have been deleted on another device.",
  "invalid-argument": "The data could not be saved because it is not valid."
};

/** Returns a user-friendly message for any error. */
export function userMessage(err, fallback = "Something went wrong. Please try again.") {
  if (err && MESSAGES[err.code]) return MESSAGES[err.code];
  return fallback;
}

/** Logs an error for developers with a short description of what was happening. */
export function logError(context, err) {
  console.error(`[Farm Tracker] ${context}:`, err);
}
