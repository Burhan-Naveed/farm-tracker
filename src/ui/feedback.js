// =========================================================
// Messages to the user: the toast at the bottom of the screen.
// =========================================================

import { logError, userMessage } from "../lib/errors.js";
import { $ } from "./dom.js";

let toastTimer = null;

/** Shows a short message at the bottom of the screen. */
export function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), isError ? 5000 : 2500);
}

export const hideToast = () => $("toast").classList.add("hidden");

/** Logs an error for developers and shows a clear message to the user. */
export function reportError(context, err, fallback) {
  logError(context, err);
  showToast(userMessage(err, fallback), true);
}

/**
 * Returns a handler for a background write that the server rejected
 * (for example, no permission). Use as: promise.catch(onWriteError("Saving entry")).
 */
export const onWriteError = (context) => (err) => reportError(context, err, "Could not save to the server. Please try again.");
